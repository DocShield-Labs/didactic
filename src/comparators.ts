import type { Comparator, ComparatorContext, ComparatorResult } from './types.js';
import * as chrono from 'chrono-node';
import { differenceInDays } from 'date-fns';
import Levenshtein from 'levenshtein';

// ═══════════════════════════════════════════════════════════════════════════
// COMPARATORS
// ═══════════════════════════════════════════════════════════════════════════
// contains  - substring check
// custom    - user-defined logic
// date      - normalized date comparison
// exact     - deep equality (default)
// name      - normalized name comparison
// numeric   - normalized number comparison (.nullable variant)
// oneOf     - enum validation
// presence  - value exists check
// within    - numeric tolerance


/** Checks if actual string contains a substring. */
export function contains(substring: string): Comparator<string> {
  return (_expected, actual) => {
    const passed = actual.includes(substring);
    return { passed, similarity: passed ? 1.0 : 0.0 };
  };
}

/** Creates a comparator with custom logic. */
export function custom<T>(config: {
  compare: (expected: T, actual: T, context?: ComparatorContext) => boolean;
}): Comparator<T> {
  return (expected, actual, context) => {
    const passed = config.compare(expected, actual, context);
    return { passed, similarity: passed ? 1.0 : 0.0 };
  };
}

/** Compares dates after normalizing various formats (ISO, US, written). */
export function date(expected: unknown, actual: unknown): ComparatorResult {
  const expDate = normalizeDate(expected);
  const actDate = normalizeDate(actual);

  if (expDate === null && actDate === null) {
    return { passed: true, similarity: 1.0 };
  }

  if (expDate === null || actDate === null) {
    return { passed: false, similarity: 0.0 };
  }

  const passed = expDate === actDate;
  const daysDiff = Math.abs(differenceInDays(new Date(expDate), new Date(actDate)));

  return { passed, similarity: Math.exp(-daysDiff / 30) };
}

/** Deep equality comparison. Default when no comparator is specified. */
export function exact(expected: unknown, actual: unknown): ComparatorResult {
  const passed = deepEqual(expected, actual);
  return {
    passed,
    similarity: passed ? 1.0 : 0.0,
  };
}

/** Compares names after normalizing case, whitespace, and business suffixes. */
export function name(expected: unknown, actual: unknown): ComparatorResult {
  const expName = normalizeName(expected);
  const actName = normalizeName(actual);

  if (expName === null && actName === null) {
    return { passed: true, similarity: 1.0 };
  }

  if (expName === null || actName === null) {
    return { passed: false, similarity: 0.0 };
  }

  if (expName === actName) {
    return { passed: true, similarity: 1.0 };
  }

  // First/last token matching for middle name tolerance
  const expTokens = expName.split(' ').filter(Boolean);
  const actTokens = actName.split(' ').filter(Boolean);

  if (expTokens.length >= 2 && actTokens.length >= 2) {
    if (expTokens[0] === actTokens[0] && expTokens.at(-1) === actTokens.at(-1)) {
      return { passed: true, similarity: 0.95 };
    }
  }

  // Fuzzy match using Levenshtein distance
  const distance = new Levenshtein(expName, actName).distance;
  const similarity = 1 - distance / Math.max(expName.length, actName.length);
  if (similarity >= 0.9) {
    return { passed: true, similarity };
  }

  return { passed: false, similarity };
}

/** Compares numbers after stripping currency symbols, commas, and formatting. */
export const numeric = Object.assign(
  (expected: unknown, actual: unknown) => numericCompare(expected, actual),
  { nullable: (expected: unknown, actual: unknown) => numericCompare(expected, actual, true) }
);

function numericCompare(expected: unknown, actual: unknown, nullable = false): ComparatorResult {
  let expNum = normalizeNumeric(expected);
  let actNum = normalizeNumeric(actual);

  if (nullable) {
    expNum ??= 0;
    actNum ??= 0;
  }

  if (expNum === null && actNum === null) {
    return { passed: true, similarity: 1.0 };
  }

  if (expNum === null || actNum === null) {
    return { passed: false, similarity: 0.0 };
  }

  const passed = expNum === actNum;
  return { passed, similarity: passed ? 1.0 : 0.0 };
}

/** Validates that actual equals expected AND both are in the allowed set. */
export function oneOf<T extends string>(allowedValues: readonly T[]): Comparator<T> {
  if (allowedValues.length === 0) {
    throw new Error('oneOf() requires at least one allowed value');
  }

  const allowed = new Set(allowedValues);

  return (expected, actual) => {
    const actualAllowed = allowed.has(actual);
    const passed = actualAllowed && expected === actual;
    return { passed, similarity: passed ? 1.0 : 0.0 };
  };
}

/** Passes if both absent, or if actual has any value when expected does. */
export function presence(expected: unknown, actual: unknown): ComparatorResult {
  const expectedPresent = expected != null && expected !== '';
  const actualPresent = actual != null && actual !== '';
  const passed = !expectedPresent || actualPresent;
  return { passed, similarity: passed ? 1.0 : 0.0 };
}

/** Checks if a numeric value is within tolerance (percentage or absolute). */
export function within(config: {
  tolerance: number;
  mode?: 'percentage' | 'absolute';
}): Comparator<number> {
  const { tolerance, mode = 'percentage' } = config;

  return (expected, actual) => {
    const diff = Math.abs(expected - actual);
    const threshold = mode === 'absolute' ? tolerance : Math.abs(expected * tolerance);
    const passed = diff <= threshold;

    // Similarity: 1.0 at exact match, 0.5 at boundary, decays beyond
    const similarity = threshold > 0
      ? Math.exp(-diff / threshold * 0.693)
      : (diff === 0 ? 1.0 : 0.0);

    return { passed, similarity };
  };
}


// Private helpers

/**
 * Deep equality comparison with cycle detection.
 * Uses WeakSet to track visited object pairs to prevent stack overflow on circular references.
 */
function deepEqual(a: unknown, b: unknown, visited = new WeakSet<object>()): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;

  // Handle arrays
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;

    // Check for cycles
    if (visited.has(a)) return true; // Already comparing this array
    visited.add(a);

    return a.every((item, i) => deepEqual(item, b[i], visited));
  }

  // Handle objects
  if (typeof a === 'object' && typeof b === 'object') {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;

    // Check for cycles
    if (visited.has(aObj)) return true; // Already comparing this object
    visited.add(aObj);

    const aKeys = Object.keys(aObj);
    if (aKeys.length !== Object.keys(bObj).length) return false;
    return aKeys.every(key => deepEqual(aObj[key], bObj[key], visited));
  }

  return false;
}

function normalizeDate(value: unknown): string | null {
  if (value == null || value === '') return null;
  const parsed = chrono.parseDate(String(value));
  return parsed?.toISOString().split('T')[0] ?? null;
}

// Requires at least one word before suffix (via lookbehind)
const NAME_SUFFIXES = /(?<=\S)\s*,?\s*(inc\.?|llc\.?|ltd\.?|l\.l\.c\.?|corp\.?|corporation|company|co\.?)$/i;

function normalizeName(value: unknown): string | null {
  if (value == null || value === '') return null;
  const str = String(value).toLowerCase().trim().replace(/\s+/g, ' ').replace(NAME_SUFFIXES, '').trim();
  return str || null;
}

function normalizeNumeric(value: unknown): number | null {
  if (value == null || value === '') return null;

  const str = String(value);
  const isNegativeParens = /^\(.*\)$/.test(str.trim());

  let cleaned = str.replace(/[^0-9.\-]/g, '');
  if (isNegativeParens && !cleaned.startsWith('-')) {
    cleaned = '-' + cleaned;
  }

  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}
