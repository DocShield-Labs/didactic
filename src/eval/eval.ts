import type {
  EvalConfig,
  EvalResult,
  FieldResult,
  NestedComparatorConfig,
  Comparator,
  ComparatorWithOrdering,
  LLMConfig,
  TestCaseResult,
} from '../types.js';
import { matchArrays } from './comparators/matching.js';
import { exact } from './comparators/comparators.js';
import { DEFAULT_PER_TEST_THRESHOLD } from '../library/constants.js';
import {
  createProgressUpdater,
  trackPromiseProgress,
} from '../optimizer/optimizer-logging.js';
import { writeEvalLogs } from './eval-logging.js';
import * as path from 'path';
import * as crypto from 'crypto';

/**
 * Run all test cases and return results.
 */
export async function evaluate<TInput, TOutput>(
  config: EvalConfig<TInput, TOutput>
): Promise<EvalResult<TInput, TOutput>> {
  // Read config
  const { testCases, systemPrompt, executor, comparators, comparatorOverride } =
    config;

  if (testCases.length === 0) {
    throw new Error('testCases array cannot be empty');
  }

  if (!executor) {
    throw new Error('executor is required');
  }

  // Track timing for logs
  const startTime = Date.now();

  // Resolve log path if storeLogs is enabled
  const logPath = config.storeLogs
    ? typeof config.storeLogs === 'string'
      ? config.storeLogs
      : `./didactic-logs/eval_${Date.now()}_${crypto.randomUUID().slice(0, 8)}/rawData.json`
    : undefined;

  // Execute a single test case
  const executeTestCase = async ({
    input,
    expected,
  }: {
    input: TInput;
    expected: TOutput;
  }) => {
    try {
      // Run the executor
      const result = await executor(input, systemPrompt);

      let fields: Record<string, FieldResult>;
      if (comparatorOverride) {
        // Whole-object comparison mode (custom override)
        const compResult = await comparatorOverride(expected, result.output);
        fields = {
          '': {
            passed: compResult.passed,
            expected,
            actual: result.output,
          },
        };
      } else {
        // If comparators is a function (plain Comparator or ComparatorWithOrdering),
        // wrap it in { '': comparators } for consistent handling of root-level outputs.
        // Default to `exact` if no comparators provided.
        let comparatorConfig: NestedComparatorConfig;
        if (!comparators) {
          comparatorConfig = { '': exact };
        } else if (typeof comparators === 'function') {
          comparatorConfig = { '': comparators };
        } else {
          comparatorConfig = comparators;
        }

        // Field-level comparison mode (nested structure)
        fields = await compareFields({
          expected,
          actual: result.output,
          comparators: comparatorConfig,
          llmConfig: config.llmConfig,
        });
      }

      const passedFields = Object.values(fields).filter((f) => f.passed).length;
      const totalFields = Object.values(fields).length;
      const passRate = totalFields === 0 ? 1 : passedFields / totalFields;
      const threshold = config.perTestThreshold ?? DEFAULT_PER_TEST_THRESHOLD;
      const passed = passRate >= threshold;

      // Aggregate comparator costs from all fields
      const comparatorCost = Object.values(fields).reduce(
        (sum, field) => sum + (field.cost ?? 0),
        0
      );

      return {
        input,
        expected,
        actual: result.output,
        additionalContext: result.additionalContext,
        cost: result.cost ?? 0,
        comparatorCost,
        passed,
        fields,
        passedFields,
        totalFields,
        passRate,
      };
    } catch (error) {
      return {
        input,
        expected,
        actual: undefined,
        cost: 0,
        comparatorCost: 0,
        passed: false,
        fields: {},
        passedFields: 0,
        totalFields: 0,
        passRate: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };

  // Run test cases (batched or all in parallel)
  const rateLimitBatch = config.rateLimitBatch;
  let results: TestCaseResult<TInput, TOutput>[];

  if (rateLimitBatch && rateLimitBatch > 0) {
    // Batched execution: run N test cases at a time
    results = [];
    const progress = createProgressUpdater('evals');

    for (let i = 0; i < testCases.length; i += rateLimitBatch) {
      const batch = testCases.slice(i, i + rateLimitBatch);
      const batchResults = await Promise.all(batch.map(executeTestCase));
      results.push(...batchResults);

      // Update progress
      progress.update(results.length, testCases.length);

      // Pause between batches (skip after last batch)
      const rateLimitPause = config.rateLimitPause;
      if (
        rateLimitPause &&
        rateLimitPause > 0 &&
        i + rateLimitBatch < testCases.length
      ) {
        await new Promise((r) => setTimeout(r, rateLimitPause * 1000));
      }
    }

    progress.finish();
  } else {
    // Run all test cases in parallel
    const progress = createProgressUpdater('evals');

    const wrappedTasks = testCases.map((tc) => executeTestCase(tc));

    // Track progress as each test completes
    const settledResults = await trackPromiseProgress(
      wrappedTasks,
      (completed, total) => progress.update(completed, total)
    );

    // Extract values (all are fulfilled since executeTestCase catches errors internally)
    results = settledResults.map(
      (r) =>
        (r as PromiseFulfilledResult<TestCaseResult<TInput, TOutput>>).value
    );

    progress.finish();
  }

  // Sort: failures first (by passRate ascending), then passes (100% at bottom)
  results.sort((a, b) => {
    if (a.passed !== b.passed) return a.passed ? 1 : -1;
    return a.passRate - b.passRate;
  });

  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  const successRate = total > 0 ? passed / total : 0;

  let correctFields = 0;
  let totalFields = 0;
  for (const r of results) {
    const fieldResults = Object.values(r.fields);
    totalFields += fieldResults.length;
    correctFields += fieldResults.filter((f) => f.passed).length;
  }
  const accuracy = totalFields > 0 ? correctFields / totalFields : 0;
  const cost = results.reduce((sum, r) => sum + (r.cost ?? 0), 0);
  const comparatorCost = results.reduce(
    (sum, r) => sum + (r.comparatorCost ?? 0),
    0
  );

  const durationMs = Date.now() - startTime;
  const logFolder = logPath ? path.dirname(logPath) : undefined;

  const evalResult: EvalResult<TInput, TOutput> = {
    systemPrompt,
    testCases: results,
    passed,
    total,
    successRate,
    correctFields,
    totalFields,
    accuracy,
    cost,
    comparatorCost,
    ...(logFolder && { logFolder }),
  };

  // Write logs if enabled
  if (logPath) {
    writeEvalLogs(logPath, evalResult, durationMs, config.perTestThreshold);
  }

  return evalResult;
}

/**
 * Recursively compare expected vs actual, returning field-level results.
 * Path patterns: 'carrier', 'quote.premium', '[0]', 'quotes[0].carrier'
 */
async function compareFields(opts: {
  expected: unknown;
  actual: unknown;
  comparators: NestedComparatorConfig;
  path?: string;
  expectedParent?: unknown;
  actualParent?: unknown;
  llmConfig?: LLMConfig;
}): Promise<Record<string, FieldResult>> {
  const {
    expected,
    actual,
    comparators,
    path = '',
    expectedParent,
    actualParent,
    llmConfig,
  } = opts;
  const results: Record<string, FieldResult> = {};
  const indexPath = (i: number) => (path ? `${path}[${i}]` : `[${i}]`);

  // ─── ARRAYS ─────────────────────────────────────────────────────────────────
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      return { [path]: { passed: false, expected, actual } };
    }
    if (expected.length === 0) {
      return {};
    }

    // Get the comparator config for this array field
    const arrayFieldName = getFieldName(path);
    const fieldComparator = comparators[arrayFieldName];

    // Check if this specific array should use unordered matching
    const isUnordered =
      fieldComparator &&
      typeof fieldComparator === 'function' &&
      '_unordered' in fieldComparator &&
      fieldComparator._unordered === true;

    // Get nested comparators for array items
    let itemComparators: NestedComparatorConfig;

    if (isUnordered) {
      // Unordered array: extract nested comparators from ComparatorWithOrdering
      itemComparators =
        (fieldComparator as ComparatorWithOrdering)._nestedComparators ||
        comparators;
    } else if (
      fieldComparator &&
      typeof fieldComparator === 'object' &&
      !('_unordered' in fieldComparator)
    ) {
      // Ordered array with nested comparators: use the plain object directly
      itemComparators = fieldComparator as NestedComparatorConfig;
    } else {
      // No nested comparators specified, use parent level
      itemComparators = comparators;
    }

    // Get matched pairs: [expectedIdx, actualIdx]
    let matchedPairs: [number, number][];

    if (isUnordered) {
      // Use Hungarian algorithm to find best matches
      matchedPairs = (await matchArrays(expected, actual, itemComparators))
        .assignments;
    } else {
      // Use simple index-based pairing (ordered)
      matchedPairs = [];
      for (let i = 0; i < expected.length && i < actual.length; i++) {
        matchedPairs.push([i, i]);
      }
    }

    const matchedIndices = new Set(matchedPairs.map(([i]) => i));

    // Compare matched pairs
    for (const [expIdx, actIdx] of matchedPairs) {
      Object.assign(
        results,
        await compareFields({
          expected: expected[expIdx],
          actual: actual[actIdx],
          comparators: itemComparators,
          path: indexPath(expIdx),
          expectedParent,
          actualParent,
          llmConfig,
        })
      );
    }

    // Report unmatched expected items as failures
    const hasArrayComparator = fieldComparator !== undefined;

    for (let i = 0; i < expected.length; i++) {
      if (matchedIndices.has(i)) continue;

      const item = expected[i];
      if (isObject(item)) {
        for (const [field, value] of Object.entries(item)) {
          if (field in itemComparators) {
            results[`${indexPath(i)}.${field}`] = {
              passed: false,
              expected: value,
              actual: undefined,
            };
          }
        }
      } else if (hasArrayComparator) {
        results[indexPath(i)] = {
          passed: false,
          expected: item,
          actual: undefined,
        };
      }
    }

    return results;
  }

  // ─── OBJECTS ────────────────────────────────────────────────────────────────
  if (isObject(expected)) {
    if (!isObject(actual)) {
      return { [path]: { passed: false, expected, actual } };
    }

    for (const [field, expValue] of Object.entries(expected)) {
      const fieldPath = path ? `${path}.${field}` : field;

      // Check if this field has a comparator (direct or nested)
      const fieldConfig = comparators[field];

      // Skip fields without any comparator defined
      if (fieldConfig === undefined) {
        continue;
      }

      let fieldComparators: NestedComparatorConfig;

      if (
        fieldConfig &&
        typeof fieldConfig === 'object' &&
        !('_unordered' in fieldConfig)
      ) {
        // It's a nested comparator config (plain object, not a comparator function)
        fieldComparators = fieldConfig as NestedComparatorConfig;
      } else {
        // It's a comparator function (possibly with _unordered flag) or undefined
        // Keep using current level comparators
        fieldComparators = comparators;
      }

      Object.assign(
        results,
        await compareFields({
          expected: expValue,
          actual: actual[field],
          comparators: fieldComparators,
          path: fieldPath,
          expectedParent: expected,
          actualParent: actual,
          llmConfig,
        })
      );
    }

    return results;
  }

  // ─── PRIMITIVES ─────────────────────────────────────────────────────────────
  const fieldName = getFieldName(path);
  let comparatorConfig = comparators[fieldName];

  // If no comparator found and we're at root, use exact as default
  if (!comparatorConfig && fieldName === '') {
    comparatorConfig = exact;
  }

  if (!comparatorConfig) {
    return {};
  }

  // Extract the actual comparator function
  // (could be a plain Comparator or a ComparatorWithOrdering)
  const comparator: Comparator<unknown> =
    typeof comparatorConfig === 'function'
      ? comparatorConfig
      : (exact as Comparator<unknown>);

  const result = await comparator(expected, actual, {
    expectedParent,
    actualParent,
    llmConfig,
  });
  return {
    [path]: {
      ...result,
      expected,
      actual,
    },
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function getFieldName(path: string): string {
  const lastSegment = path.split('.').pop() || '';
  return lastSegment.replace(/\[\d+\]$/, '');
}
