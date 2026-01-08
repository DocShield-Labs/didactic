import munkres from 'munkres-js';
import type { NestedComparatorConfig, Comparator } from '../../types.js';
import { exact } from './comparators.js'; // Used for primitive comparison

export interface MatchResult {
  assignments: [number, number][]; // [expIdx, actIdx] - matched pairs
  unmatchedExpected: number[];
  unmatchedActual: number[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Calculate similarity score between two values (0.0 to 1.0).
 * For arrays: recursively match and average similarity of paired elements.
 * For objects: average similarity across all fields using comparator results.
 * For primitives: uses exact comparison's similarity score.
 */
async function getSimilarity(
  expected: unknown,
  actual: unknown,
  comparators: NestedComparatorConfig
): Promise<number> {
  // Arrays: recursively match and calculate average similarity
  if (Array.isArray(expected) && Array.isArray(actual)) {
    if (expected.length === 0 && actual.length === 0) {
      return 1.0;
    }
    if (expected.length === 0 || actual.length === 0) {
      return 0.0;
    }

    const result = await matchArrays(expected, actual, comparators);
    let total = 0;
    for (const [expIdx, actIdx] of result.assignments) {
      total += await getSimilarity(
        expected[expIdx],
        actual[actIdx],
        comparators
      );
    }

    // Penalize for unmatched items
    const maxLen = Math.max(expected.length, actual.length);
    return total / maxLen;
  }

  // Primitives (including type mismatches like array vs non-array)
  if (!isObject(expected) || !isObject(actual)) {
    const result = exact(expected, actual);
    return result.similarity ?? (result.passed ? 1.0 : 0.0);
  }

  const fields = Object.keys(expected).filter((key) => {
    const comp = comparators[key];
    return comp !== undefined && typeof comp === 'function';
  });

  // Exit early if no fields with comparators to compare
  if (fields.length === 0) {
    return 1.0;
  }

  let total = 0;
  for (const key of fields) {
    const comparatorConfig = comparators[key];
    // Extract the actual comparator function (handle ComparatorWithOrdering)
    const comparator: Comparator<unknown> =
      typeof comparatorConfig === 'function' ? comparatorConfig : exact;

    const result = await comparator(expected[key], actual[key], {
      expectedParent: expected,
      actualParent: actual,
    });
    total += result.similarity ?? (result.passed ? 1.0 : 0.0);
  }
  return total / fields.length;
}

/**
 * Find optimal pairing between expected and actual arrays using Hungarian algorithm.
 * Pure matching - no pass/fail determination.
 *
 * @param expected - Array of expected items
 * @param actual - Array of actual items
 * @param comparators - Nested comparator configuration for array items
 * @returns Matching result with assignments and unmatched indices
 */
export async function matchArrays(
  expected: unknown[],
  actual: unknown[],
  comparators: NestedComparatorConfig = {}
): Promise<MatchResult> {
  // Handle empty arrays
  if (expected.length === 0) {
    return {
      assignments: [],
      unmatchedExpected: [],
      unmatchedActual: [...Array(actual.length).keys()],
    };
  }

  if (actual.length === 0) {
    return {
      assignments: [],
      unmatchedExpected: [...Array(expected.length).keys()],
      unmatchedActual: [],
    };
  }

  // Build cost matrix: cost = 1 - similarity (lower cost = better match)
  const matrix = await Promise.all(
    expected.map(async (exp) =>
      Promise.all(
        actual.map(
          async (act) => 1 - (await getSimilarity(exp, act, comparators))
        )
      )
    )
  );

  // Run Hungarian algorithm
  const rawAssignments = munkres(matrix);

  // Process assignments
  const assignments: [number, number][] = [];
  const matchedExp = new Set<number>();
  const matchedAct = new Set<number>();

  for (const [row, col] of rawAssignments) {
    // Accept all valid assignments from Hungarian (no threshold filtering)
    if (row < expected.length && col < actual.length) {
      assignments.push([row, col]);
      matchedExp.add(row);
      matchedAct.add(col);
    }
  }

  return {
    assignments,
    unmatchedExpected: [...Array(expected.length).keys()].filter(
      (i) => !matchedExp.has(i)
    ),
    unmatchedActual: [...Array(actual.length).keys()].filter(
      (i) => !matchedAct.has(i)
    ),
  };
}
