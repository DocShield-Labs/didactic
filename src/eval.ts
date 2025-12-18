import type {
  EvalConfig,
  EvalResult,
  FieldResult,
  Comparator,
} from './types.js';
import { matchArrays } from './matching.js';
import { exact } from './comparators.js';

/**
 * Run all test cases and return results.
 */
export async function evaluate<TInput, TOutput>(
  config: EvalConfig<TInput, TOutput>
): Promise<EvalResult<TInput>> {

  const { testCases, systemPrompt, executor, comparators } = config;

  if (testCases.length === 0) {
    throw new Error('testCases array cannot be empty');
  }

  // Run all test cases in parallel
  const results = await Promise.all(
    testCases.map(async ({ input, expected }) => {
      try {
        const result = await executor(input, systemPrompt);
        const fields = compareFields(expected, result.output, comparators);

        const passedFields = Object.values(fields).filter((f) => f.passed).length;
        const totalFields = Object.values(fields).length;
        const passRate = totalFields === 0 ? 1 : passedFields / totalFields;
        const threshold = config.perTestThreshold ?? 1.0;
        const passed = passRate >= threshold;

        return {
          input,
          expected,
          actual: result.output,
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

  return {
    systemPrompt,
    testCases: results,
    passed,
    total,
    successRate,
    correctFields,
    totalFields,
    accuracy,
  };
}

/**
 * Recursively compare expected vs actual, building a flat map of field results.
 *
 * Key format:
 * - Objects: 'field', 'nested.field'
 * - Arrays: '[0]', '[0].field', 'arr[0].nested'
 * - Primitives at root: ''
 */
function compareFields(
  expected: unknown,
  actual: unknown,
  comparators: Record<string, Comparator> | Comparator,
  prefix = '',
  expectedParent: unknown = null,
  actualParent: unknown = null
): Record<string, FieldResult> {

  // Handle array of outputs
  if (Array.isArray(expected)) {

    // Exit early if actual is not an array
    if (!Array.isArray(actual)) {
      return {
        [prefix || 'value']: { passed: false, expected, actual }
      };
    }
    if (expected.length === 0 && actual.length === 0) {
      return {};
    }

    // Use Hungarian algorithm to find optimal pairing between expected and actual elements
    const results: Record<string, FieldResult> = {};
    const { assignments, unmatchedExpected } = matchArrays(expected, actual, comparators);

    // For each matched pair, compare the expected and actual items
    for (const [expIdx, actIdx] of assignments) {
      const itemPrefix = prefix ? `${prefix}[${expIdx}]` : `[${expIdx}]`;

      // Recursively compare each element
      Object.assign(results, compareFields(
        expected[expIdx],
        actual[actIdx],
        comparators,
        itemPrefix,
        expectedParent, // expected parent item (for cross-field access)
        actualParent, // actual parent item (for cross-field access)
      ));
    }

    // Mark unmatched expected items as failed (only for fields with comparators)
    for (const idx of unmatchedExpected) {
      const itemPrefix = prefix ? `${prefix}[${idx}]` : `[${idx}]`;
      const exp = expected[idx];

      if (isObject(exp)) {
        if (typeof comparators !== 'function') {
          for (const field of Object.keys(exp)) {
            if (comparators[field]) {  // Only include fields with comparators
              results[`${itemPrefix}.${field}`] = {
                passed: false,
                expected: exp[field],
                actual: undefined,
              };
            }
          }
        }
      } else {
        // For primitive arrays: fail if function comparator, named comparator exists, or root level
        const arrayName = prefix.replace(/\[\d+\]$/, '').split('.').pop() || prefix;
        const shouldFail = typeof comparators === 'function'
          || (typeof comparators !== 'function' && comparators[arrayName])
          || arrayName === '';
        if (shouldFail) {
          results[itemPrefix] = {
            passed: false,
            expected: exp,
            actual: undefined,
          };
        }
      }
    }

    return results;
  }

  // Objects: recurse for each field
  if (isObject(expected)) {
    if (!isObject(actual)) {
      return {
        [prefix || 'value']: { passed: false, expected, actual }
      };
    }

    const results: Record<string, FieldResult> = {};
    for (const [field, expValue] of Object.entries(expected)) {
      const fieldPrefix = prefix ? `${prefix}.${field}` : field;
      Object.assign(results, compareFields(
        expValue,
        actual[field],
        comparators,
        fieldPrefix,
        expected,
        actual
      ));
    }
    return results;
  }

  // Primitives: use function comparator, field comparator, or default exact for root
  const lastSegment = prefix.split('.').pop() || prefix || '';
  const fieldName = lastSegment.replace(/\[\d+\]$/, '');
  const comparator = typeof comparators === 'function'
    ? comparators
    : (comparators[fieldName] ?? (fieldName === '' ? exact : undefined));
  if (!comparator) {
    return {};  // Skip fields without explicit comparators
  }
  const result = comparator(expected, actual, { expectedParent, actualParent });
  return {
    [prefix || '']: {
      ...result,
      expected,
      actual
    }
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
