import munkres from 'munkres-js';
import type { ComparatorMap } from './types.js';
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
function getSimilarity(
  expected: unknown,
  actual: unknown,
  comparators: ComparatorMap
): number {
  // Arrays: recursively match and calculate average similarity
  if (Array.isArray(expected) && Array.isArray(actual)) {
    if (expected.length === 0 && actual.length === 0) {
      return 1.0;
    }
    if (expected.length === 0 || actual.length === 0) {
      return 0.0;
    }

    const result = matchArrays(expected, actual, comparators);
    let total = 0;
    for (const [expIdx, actIdx] of result.assignments) {
      total += getSimilarity(expected[expIdx], actual[actIdx], comparators);
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

  const fields = Object.keys(expected).filter((key) => comparators[key]);

  // Exit early if no fields with comparators to compare
  if (fields.length === 0) {
    return 1.0;
  }

  let total = 0;
  for (const key of fields) {
    const comparator = comparators[key];
    const result = comparator(expected[key], actual[key], {
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
 * @param comparators - Map of field names to comparator functions
 * @returns Matching result with assignments and unmatched indices
 */
export function matchArrays(
  expected: unknown[],
  actual: unknown[],
  comparators: ComparatorMap = {}
): MatchResult {
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
  const matrix = expected.map((exp) =>
    actual.map((act) => 1 - getSimilarity(exp, act, comparators))
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
