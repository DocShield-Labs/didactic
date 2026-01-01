import type {
  EvalConfig,
  EvalResult,
  FieldResult,
  ComparatorMap,
} from './types.js';
import { matchArrays } from './matching.js';
import { exact } from './comparators.js';
import { DEFAULT_PER_TEST_THRESHOLD } from './constants.js';

/**
 * Run all test cases and return results.
 */
export async function evaluate<TInput, TOutput>(
  config: EvalConfig<TInput, TOutput>
): Promise<EvalResult<TInput, TOutput>> {

  // Read config
  const { testCases, systemPrompt, executor, comparators, comparatorOverride } = config;

  if (testCases.length === 0) {
    throw new Error('testCases array cannot be empty');
  }

  if (!executor) {
    throw new Error('executor is required');
  }

  if (!comparators && !comparatorOverride) {
    throw new Error('either "comparators" (field mapping or single function) or "comparatorOverride" (whole-object) is required');
  }

  // Execute a single test case
  const executeTestCase = async ({ input, expected }: { input: TInput; expected: TOutput }) => {
    try {

      // Run the executor
      const result = await executor(input, systemPrompt);

      let fields: Record<string, FieldResult>;
      if (comparatorOverride) {
        // Whole-object comparison mode (custom override)
        const compResult = comparatorOverride(expected, result.output);
        fields = {
          '': {
            passed: compResult.passed,
            expected,
            actual: result.output,
          }
        };
      } else if (typeof comparators === 'function') {
        // Arrays always use element-wise comparison (for better debugging)
        if (Array.isArray(expected)) {
          // Descend into array elements (ordered or unordered based on config.unorderedList)
          fields = compareFields({
            expected,
            actual: result.output,
            comparators: { '': comparators },
            unorderedList: config.unorderedList,
          });
        } else {
          // Primitives and objects: whole-object comparison
          const compResult = comparators(expected, result.output, {
            expectedParent: undefined,
            actualParent: undefined,
          });
          fields = {
            '': {
              ...compResult,
              expected,
              actual: result.output,
            }
          };
        }
      } else {
        // Field-level comparison mode (field mapping)
        fields = compareFields({
          expected,
          actual: result.output,
          comparators,
          unorderedList: config.unorderedList,
        });
      }

      const passedFields = Object.values(fields).filter((f) => f.passed).length;
      const totalFields = Object.values(fields).length;
      const passRate = totalFields === 0 ? 1 : passedFields / totalFields;
      const threshold = config.perTestThreshold ?? DEFAULT_PER_TEST_THRESHOLD;
      const passed = passRate >= threshold;

      return {
        input,
        expected,
        actual: result.output,
        additionalContext: result.additionalContext,
        cost: result.cost ?? 0,
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
  let results;

  if (rateLimitBatch && rateLimitBatch > 0) {
    // Batched execution: run N test cases at a time
    results = [];
    for (let i = 0; i < testCases.length; i += rateLimitBatch) {
      const batch = testCases.slice(i, i + rateLimitBatch);
      const batchResults = await Promise.all(batch.map(executeTestCase));
      results.push(...batchResults);

      // Pause between batches (skip after last batch)
      const rateLimitPause = config.rateLimitPause;
      if (rateLimitPause && rateLimitPause > 0 && i + rateLimitBatch < testCases.length) {
        await new Promise(r => setTimeout(r, rateLimitPause * 1000));
      }
    }
  } else {
    // Run all test cases in parallel
    results = await Promise.all(testCases.map(executeTestCase));
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

  return {
    systemPrompt,
    testCases: results,
    passed,
    total,
    successRate,
    correctFields,
    totalFields,
    accuracy,
    cost,
  };
}

/**
 * Recursively compare expected vs actual, returning field-level results.
 * Path patterns: 'carrier', 'quote.premium', '[0]', 'quotes[0].carrier'
 */
function compareFields(opts: {
  expected: unknown;
  actual: unknown;
  comparators: ComparatorMap;
  path?: string;
  expectedParent?: unknown;
  actualParent?: unknown;
  unorderedList?: boolean;
}): Record<string, FieldResult> {
  const { expected, actual, comparators, path = '', expectedParent, actualParent, unorderedList = false } = opts;
  const results: Record<string, FieldResult> = {};
  const indexPath = (i: number) => path ? `${path}[${i}]` : `[${i}]`;

  // ─── ARRAYS ─────────────────────────────────────────────────────────────────
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      return { [path]: { passed: false, expected, actual } };
    }
    if (expected.length === 0) {
      return {};
    }

    // Get matched pairs: [expectedIdx, actualIdx]
    let matchedPairs: [number, number][];

    // If unorderedList is true, use the matching algorithm to find the best pairs (expected[i] -> actual[j])
    if (unorderedList) {
      matchedPairs = matchArrays(expected, actual, comparators).assignments;
    } else {
      // Otherwise, use the simple index-based pairing (expected[i] -> actual[i])
      matchedPairs = [];
      for (let i = 0; i < expected.length && i < actual.length; i++) {
        matchedPairs.push([i, i]);
      }
    }

    const matchedIndices = new Set(matchedPairs.map(([i]) => i));

    // Compare matched pairs
    for (const [expIdx, actIdx] of matchedPairs) {
      Object.assign(results, compareFields({
        expected: expected[expIdx],
        actual: actual[actIdx],
        comparators,
        path: indexPath(expIdx),
        expectedParent,
        actualParent,
        unorderedList,
      }));
    }

    // Report unmatched expected items as failures
    const arrayFieldName = getFieldName(path);
    const hasArrayComparator = arrayFieldName in comparators || arrayFieldName === '';

    for (let i = 0; i < expected.length; i++) {
      if (matchedIndices.has(i)) continue;

      const item = expected[i];
      if (isObject(item)) {
        for (const [field, value] of Object.entries(item)) {
          if (field in comparators) {
            results[`${indexPath(i)}.${field}`] = { passed: false, expected: value, actual: undefined };
          }
        }
      } else if (hasArrayComparator) {
        results[indexPath(i)] = { passed: false, expected: item, actual: undefined };
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
      Object.assign(results, compareFields({
        expected: expValue,
        actual: actual[field],
        comparators,
        path: fieldPath,
        expectedParent: expected,
        actualParent: actual,
        unorderedList,
      }));
    }

    return results;
  }

  // ─── PRIMITIVES ─────────────────────────────────────────────────────────────
  const fieldName = getFieldName(path);
  const comparator = comparators[fieldName] ?? (fieldName === '' ? exact : undefined);

  if (!comparator) {
    return {};
  }

  const result = comparator(expected, actual, { expectedParent, actualParent });
  return { [path]: { ...result, expected, actual } };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function getFieldName(path: string): string {
  const lastSegment = path.split('.').pop() || '';
  return lastSegment.replace(/\[\d+\]$/, '');
}
