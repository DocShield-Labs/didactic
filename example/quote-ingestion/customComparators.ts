/**
 * Domain-specific comparators for insurance quote ingestion.
 *
 * These demonstrate how to use the `custom` comparator to build
 * business-logic-specific comparison rules.
 */

import { custom, date } from '../../src/index.js';

/**
 * Compares retroactive_date with RDI (Retroactive Date Inception) handling.
 *
 * In insurance, "RDI" means the retroactive date equals the policy effective date.
 * Uses context to access effective_date from the parent object.
 *
 * Logic:
 * - Both RDI → pass
 * - Expected RDI, actual is date → pass if date matches effective_date
 * - Actual RDI, expected is date → pass if date matches effective_date
 * - Neither RDI → standard date comparison
 *
 * @example
 * ```ts
 * comparators: {
 *   retroactive_date: retroactiveDateRDI,
 * }
 * ```
 */
export const retroactiveDateRDI = custom<string>({
  compare: (expected, actual, context) => {
    const actualParent = context?.actualParent as Record<string, unknown> | undefined;
    const effectiveDate = actualParent?.effective_date as string | undefined;

    const expIsRDI = expected?.toUpperCase() === 'RDI';
    const actIsRDI = actual?.toUpperCase() === 'RDI';

    // Both RDI
    if (expIsRDI && actIsRDI) return true;

    // Expected RDI, actual is date → check against effective_date
    if (expIsRDI && effectiveDate) {
      return date(actual, effectiveDate).passed;
    }

    // Actual RDI, expected is date → check against effective_date
    if (actIsRDI && effectiveDate) {
      return date(expected, effectiveDate).passed;
    }

    // Neither RDI → standard date comparison
    return date(expected, actual).passed;
  },
});

/**
 * Validates employment_status with part_time/full_time handling.
 *
 * Rules:
 * - If expected is "part_time": actual must be "part_time"
 * - If expected is "full_time": fails only if actual is "part_time" (null/undefined OK)
 * - Other expected values: auto-pass
 *
 * @example
 * ```ts
 * comparators: {
 *   employment_status: employmentStatus,
 * }
 * ```
 */
export const employmentStatus = custom<string>({
  compare: (expected, actual) => {
    const expectedLower = (expected ?? '').toLowerCase();
    const actualLower = (actual ?? '').toLowerCase();

    if (expectedLower === 'part_time') {
      return actualLower === 'part_time';
    }

    if (expectedLower === 'full_time') {
      // Fail only if actual is part_time; null/undefined is OK
      return actualLower !== 'part_time';
    }

    return true; // Auto-pass for other expectations
  },
});

/**
 * Extended presence check that treats sentinel values as absent.
 *
 * In addition to null, undefined, and empty string, this comparator
 * also treats "EMPTY" and "NOT_FOUND" as absent values.
 *
 * Passes if:
 * - Both values are absent (null/undefined/empty/"EMPTY"/"NOT_FOUND")
 * - Expected is absent
 * - Actual has a real value when expected has a real value
 *
 * Only fails when expected has a value but actual is absent.
 *
 * @example
 * ```ts
 * comparators: {
 *   optionalField: presenceWithSentinels,
 * }
 * ```
 */
export const presenceWithSentinels = custom<unknown>({
  compare: (expected, actual) => {
    // Helper: Determines if a value should be treated as "absent"
    // Sentinel values are special strings that indicate "no value"
    const isAbsent = (v: unknown): boolean => {
      if (v == null || v === '') return true;

      // Sentinel string checks (case-insensitive)
      if (typeof v === 'string') {
        const upper = v.toUpperCase();
        return upper === 'EMPTY' || upper === 'NOT_FOUND' || upper === 'N/A';
      }
      return false;
    };

    const expectedPresent = !isAbsent(expected);
    const actualPresent = !isAbsent(actual);

    // Truth table:
    //   expected=absent,  actual=absent  → pass (nothing to check)
    //   expected=absent,  actual=present → pass (got more than expected)
    //   expected=present, actual=present → pass (both have values)
    //   expected=present, actual=absent  → FAIL (expected value, got nothing)
    return !expectedPresent || actualPresent;
  },
});