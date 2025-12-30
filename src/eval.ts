import type {
  EvalConfig,
  EvalResult,
  FieldResult,
  ComparatorMap,
} from './types.js';
import { matchArrays } from './matching.js';
import { exact } from './comparators.js';

/**
 * Run all test cases and return results.
 */
export async function evaluate<TInput, TOutput>(
  config: EvalConfig<TInput, TOutput>
): Promise<EvalResult<TInput, TOutput>> {

  const { testCases, systemPrompt, executor } = config;
  const comparators = 'comparators' in config ? config.comparators : undefined;
  const comparator = 'comparator' in config ? config.comparator : undefined;

  if (testCases.length === 0) {
    throw new Error('testCases array cannot be empty');
  }

  // Run all test cases in parallel
  const results = await Promise.all(
    testCases.map(async ({ input, expected }) => {
      try {
        const result = await executor(input, systemPrompt);

        let fields: Record<string, FieldResult>;
        if (comparator) {
          // Whole-object comparison mode
          const compResult = comparator(expected, result.output, { expectedParent: undefined, actualParent: undefined });
          fields = {
            '': {
              passed: compResult.passed,
              expected,
              actual: result.output,
            }
          };
        } else {
          // Field-level comparison mode
          const unorderedList = config.unorderedList ?? false;
          fields = compareFields(expected, result.output, comparators!, '', null, null, unorderedList);
        }

        const passedFields = Object.values(fields).filter((f) => f.passed).length;
        const totalFields = Object.values(fields).length;
        const passRate = totalFields === 0 ? 1 : passedFields / totalFields;
        const threshold = config.perTestThreshold ?? 1.0;
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
    })
  );

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
function compareFields(
  expected: unknown,
  actual: unknown,
  comparators: ComparatorMap,
  path = '',
  expectedParent?: unknown,
  actualParent?: unknown,
  unorderedList = false
): Record<string, FieldResult> {
  const results: Record<string, FieldResult> = {};

  // ─── ARRAYS ─────────────────────────────────────────────────────────────────
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      return { [path || 'value']: { passed: false, expected, actual } };
    }
    if (expected.length === 0) {
      return {};
    }

    // Get matched pairs: [expectedIdx, actualIdx]
    let matchedPairs: [number, number][];
    if (unorderedList) {
      matchedPairs = matchArrays(expected, actual, comparators).assignments;
    } else {
      matchedPairs = [];
      for (let i = 0; i < expected.length && i < actual.length; i++) {
        matchedPairs.push([i, i]);
      }
    }

    const matchedIndices = new Set(matchedPairs.map(([i]) => i));

    // Compare matched pairs
    for (const [expIdx, actIdx] of matchedPairs) {
      const itemPath = path ? `${path}[${expIdx}]` : `[${expIdx}]`;
      Object.assign(results, compareFields(
        expected[expIdx],
        actual[actIdx],
        comparators,
        itemPath,
        expectedParent,
        actualParent,
        unorderedList
      ));
    }

    // Report unmatched expected items as failures
    for (let i = 0; i < expected.length; i++) {
      if (matchedIndices.has(i)) {
        continue;
      }

      const itemPath = path ? `${path}[${i}]` : `[${i}]`;
      const item = expected[i];

      if (isObject(item)) {
        // Report each field that has a comparator
        for (const field of Object.keys(item)) {
          if (field in comparators) {
            results[`${itemPath}.${field}`] = {
              passed: false,
              expected: item[field],
              actual: undefined,
            };
          }
        }
      } else {
        // For primitives, check if the array name has a comparator
        const arrayName = path.replace(/\[\d+\]$/, '').split('.').pop() || '';
        const hasComparator = arrayName in comparators || arrayName === '';
        if (hasComparator) {
          results[itemPath] = { passed: false, expected: item, actual: undefined };
        }
      }
    }

    return results;
  }

  // ─── OBJECTS ────────────────────────────────────────────────────────────────
  if (isObject(expected)) {
    if (!isObject(actual)) {
      return { [path || 'value']: { passed: false, expected, actual } };
    }

    for (const [field, expValue] of Object.entries(expected)) {
      const fieldPath = path ? `${path}.${field}` : field;
      Object.assign(results, compareFields(
        expValue,
        actual[field],
        comparators,
        fieldPath,
        expected,
        actual,
        unorderedList
      ));
    }

    return results;
  }

  // ─── PRIMITIVES ─────────────────────────────────────────────────────────────
  const lastSegment = path.split('.').pop() || path || '';
  const fieldName = lastSegment.replace(/\[\d+\]$/, '');
  const comparator = comparators[fieldName] ?? (fieldName === '' ? exact : undefined);

  if (!comparator) {
    return {};
  }

  const result = comparator(expected, actual, { expectedParent, actualParent });
  return { [path || '']: { ...result, expected, actual } };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
