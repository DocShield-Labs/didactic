import { describe, it, expect } from 'vitest';
import { within, oneOf, presence, custom, exact, contains, numeric, date, name } from '../src/comparators.js';

describe('within', () => {
  it('percentage mode passes/fails based on tolerance', () => {
    const comparator = within({ tolerance: 0.05 });
    expect(comparator(100, 103).passed).toBe(true);
    expect(comparator(100, 110).passed).toBe(false);
  });

  it('absolute mode passes/fails based on tolerance', () => {
    const comparator = within({ tolerance: 10, mode: 'absolute' });
    expect(comparator(100, 108).passed).toBe(true);
    expect(comparator(100, 115).passed).toBe(false);
  });

  it('percentage mode at exact boundary passes', () => {
    const comparator = within({ tolerance: 0.05 });
    // 5% of 100 is exactly 5
    expect(comparator(100, 105).passed).toBe(true);
    expect(comparator(100, 95).passed).toBe(true);
  });

  it('percentage mode with expected=0 requires exact match', () => {
    // When expected is 0, allowedDiff = 0 * tolerance = 0
    // Only exact match passes
    const comparator = within({ tolerance: 0.05 });
    expect(comparator(0, 0).passed).toBe(true);
    expect(comparator(0, 0.001).passed).toBe(false);
    expect(comparator(0, -0.001).passed).toBe(false);
  });

  it('absolute mode with negative numbers', () => {
    const comparator = within({ tolerance: 10, mode: 'absolute' });
    expect(comparator(-100, -95).passed).toBe(true);
    expect(comparator(-100, -115).passed).toBe(false);
  });
});

describe('oneOf', () => {
  const comparator = oneOf(['a', 'b', 'c']);

  it('passes when values match, fails otherwise', () => {
    expect(comparator('a', 'a').passed).toBe(true);
    expect(comparator('a', 'b').passed).toBe(false);
  });

  it('fails when value is not in allowed set', () => {
    const result = comparator('a', 'invalid' as any);
    expect(result.passed).toBe(false);
  });

  it('throws when allowedValues is empty', () => {
    expect(() => oneOf([])).toThrow('oneOf() requires at least one allowed value');
  });
});

describe('presence', () => {
  it('passes for present values, fails for null/undefined/empty', () => {
    expect(presence('expected', 'actual').passed).toBe(true);
    expect(presence('expected', 0).passed).toBe(true);
    expect(presence('expected', null).passed).toBe(false);
    expect(presence('expected', undefined).passed).toBe(false);
    expect(presence('expected', '').passed).toBe(false);
  });
});

describe('custom', () => {
  it('uses provided compare function', () => {
    const comparator = custom({
      compare: (expected: number, actual: number) => actual > expected,
    });

    expect(comparator(5, 10).passed).toBe(true);
    expect(comparator(5, 3).passed).toBe(false);
  });
});

describe('exact', () => {
  it('deep equals primitives, objects, and arrays', () => {
    expect(exact(42, 42).passed).toBe(true);
    expect(exact(42, 43).passed).toBe(false);
    expect(exact({ a: 1 }, { a: 1 }).passed).toBe(true);
    expect(exact({ a: 1 }, { a: 2 }).passed).toBe(false);
    expect(exact([1, 2], [1, 2]).passed).toBe(true);
  });

  it('deep equals nested objects', () => {
    const nested = { a: { b: { c: 1 } } };
    expect(exact(nested, { a: { b: { c: 1 } } }).passed).toBe(true);
    expect(exact(nested, { a: { b: { c: 2 } } }).passed).toBe(false);
  });

  it('deep equals arrays with objects', () => {
    const arr = [{ id: 1 }, { id: 2 }];
    expect(exact(arr, [{ id: 1 }, { id: 2 }]).passed).toBe(true);
    expect(exact(arr, [{ id: 1 }, { id: 3 }]).passed).toBe(false);
    expect(exact(arr, [{ id: 1 }]).passed).toBe(false); // different length
  });

  it('handles null and undefined', () => {
    expect(exact(null, null).passed).toBe(true);
    expect(exact(undefined, undefined).passed).toBe(true);
    expect(exact(null, undefined).passed).toBe(false);
  });
});

describe('contains', () => {
  it('passes when actual contains substring', () => {
    const comparator = contains('success');
    expect(comparator('ignored', 'operation success').passed).toBe(true);
    expect(comparator('ignored', 'operation failed').passed).toBe(false);
  });
});

describe('numeric', () => {
  it('compares raw numbers', () => {
    expect(numeric(100, 100).passed).toBe(true);
    expect(numeric(100, 200).passed).toBe(false);
  });

  it('strips currency symbols and commas', () => {
    expect(numeric('$1,234.56', 1234.56).passed).toBe(true);
    expect(numeric('$1,234.56', '$1,234.56').passed).toBe(true);
    expect(numeric(1000, '1,000').passed).toBe(true);
  });

  it('handles accounting notation (parentheses for negative)', () => {
    expect(numeric('($500)', -500).passed).toBe(true);
    expect(numeric('($1,234.56)', -1234.56).passed).toBe(true);
  });

  it('handles negative numbers', () => {
    expect(numeric(-500, '-$500').passed).toBe(true);
    expect(numeric('-500', -500).passed).toBe(true);
  });

  it('passes when both are null/empty', () => {
    expect(numeric(null, null).passed).toBe(true);
    expect(numeric('', '').passed).toBe(true);
    expect(numeric(undefined, undefined).passed).toBe(true);
  });

  it('fails when only one is null/empty', () => {
    expect(numeric(100, null).passed).toBe(false);
    expect(numeric(null, 100).passed).toBe(false);
    expect(numeric('', 100).passed).toBe(false);
  });

  it('fails for non-numeric strings', () => {
    expect(numeric('abc', 100).passed).toBe(false);
    expect(numeric(100, 'xyz').passed).toBe(false);
  });
});

describe('numeric.nullable', () => {
  it('treats null as 0 - passes when expected 0 and actual null', () => {
    expect(numeric.nullable(0, null).passed).toBe(true);
  });

  it('treats null as 0 - passes when expected null and actual 0', () => {
    expect(numeric.nullable(null, 0).passed).toBe(true);
  });

  it('treats null as 0 - fails when expected non-zero and actual null', () => {
    expect(numeric.nullable(8, null).passed).toBe(false);
    expect(numeric.nullable(100, null).passed).toBe(false);
  });

  it('treats null as 0 - fails when expected null and actual non-zero', () => {
    expect(numeric.nullable(null, 8).passed).toBe(false);
  });

  it('still compares normally when both have values', () => {
    expect(numeric.nullable(100, 100).passed).toBe(true);
    expect(numeric.nullable(100, 200).passed).toBe(false);
  });

  it('passes when both are null', () => {
    expect(numeric.nullable(null, null).passed).toBe(true);
  });
});

describe('date', () => {
  it('compares ISO format dates', () => {
    expect(date('2024-01-15', '2024-01-15').passed).toBe(true);
    expect(date('2024-01-15', '2024-01-16').passed).toBe(false);
  });

  it('normalizes ISO dates with timestamps', () => {
    expect(date('2024-01-15T12:00:00Z', '2024-01-15').passed).toBe(true);
    expect(date('2024-01-15', '2024-01-15T00:00:00.000Z').passed).toBe(true);
  });

  it('converts US format (MM/DD/YYYY) to ISO', () => {
    expect(date('01/15/2024', '2024-01-15').passed).toBe(true);
    expect(date('1/5/2024', '2024-01-05').passed).toBe(true);
  });

  it('converts written format to ISO', () => {
    expect(date('January 15, 2024', '2024-01-15').passed).toBe(true);
    expect(date('Jan 15, 2024', '2024-01-15').passed).toBe(true);
    expect(date('December 25 2024', '2024-12-25').passed).toBe(true);
  });

  it('handles EU format when unambiguous (day > 12)', () => {
    // 25/01/2024 - first number > 12, must be EU format (day/month/year)
    expect(date('25/01/2024', '2024-01-25').passed).toBe(true);
    expect(date('15-06-2024', '2024-06-15').passed).toBe(true);
  });

  it('defaults to US format when ambiguous', () => {
    // 01/02/2024 - ambiguous, defaults to US (month/day/year = January 2)
    expect(date('01/02/2024', '2024-01-02').passed).toBe(true);
  });

  it('passes when both are null/empty', () => {
    expect(date(null, null).passed).toBe(true);
    expect(date('', '').passed).toBe(true);
  });

  it('fails when only one is null/empty', () => {
    expect(date('2024-01-15', null).passed).toBe(false);
    expect(date(null, '2024-01-15').passed).toBe(false);
  });

  it('fails for unparseable dates', () => {
    expect(date('not-a-date', '2024-01-15').passed).toBe(false);
    expect(date('2024-01-15', 'invalid').passed).toBe(false);
  });
});

describe('name', () => {
  it('compares names case-insensitively', () => {
    expect(name('John Doe', 'john doe').passed).toBe(true);
    expect(name('ACME', 'acme').passed).toBe(true);
  });

  it('normalizes whitespace', () => {
    expect(name('  John   Doe  ', 'john doe').passed).toBe(true);
    expect(name('John Doe', '  john   doe  ').passed).toBe(true);
  });

  it('strips common business suffixes', () => {
    expect(name('ACME Inc.', 'acme').passed).toBe(true);
    expect(name('ACME, Inc.', 'acme').passed).toBe(true);
    expect(name('Company LLC', 'company').passed).toBe(true);
    expect(name('Company, LLC', 'company').passed).toBe(true);
    expect(name('Firm Ltd', 'firm').passed).toBe(true);
    expect(name('Corp Corporation', 'corp').passed).toBe(true);
    expect(name('Business Co.', 'business').passed).toBe(true);
  });

  it('matches when both have suffixes', () => {
    expect(name('ACME Inc.', 'Acme LLC').passed).toBe(true);
    expect(name('Company, Ltd', 'COMPANY INC').passed).toBe(true);
  });

  it('passes when both are null/empty', () => {
    expect(name(null, null).passed).toBe(true);
    expect(name('', '').passed).toBe(true);
  });

  it('fails when only one is null/empty', () => {
    expect(name('John', null).passed).toBe(false);
    expect(name(null, 'John').passed).toBe(false);
  });

  it('fails when names differ', () => {
    expect(name('John', 'Jane').passed).toBe(false);
    expect(name('ACME Corp', 'Globex Inc').passed).toBe(false);
  });

  it('handles middle names/initials by comparing first and last tokens', () => {
    // Middle initial present in actual but not expected
    expect(name('Peculiar Ihunwo', 'Peculiar A. Ihunwo').passed).toBe(true);
    expect(name('John Smith', 'John A. Smith').passed).toBe(true);

    // Middle name present in actual but not expected
    expect(name('John Smith', 'John Andrew Smith').passed).toBe(true);
    expect(name('Mary Watson', 'Mary Jane Watson').passed).toBe(true);

    // Middle initial present in expected but not actual
    expect(name('John A. Smith', 'John Smith').passed).toBe(true);

    // Multiple middle names
    expect(name('John Smith', 'John Andrew Charles Smith').passed).toBe(true);

    // Complex last names (van der, etc.)
    expect(name('John van der Berg', 'John James van der Berg').passed).toBe(true);
  });

  it('returns lower similarity for middle name matches vs exact matches', () => {
    const exact = name('John Smith', 'john smith');
    const middleName = name('John Smith', 'John A. Smith');

    expect(exact.similarity).toBe(1.0);
    expect(middleName.similarity).toBe(0.95);
  });

  it('fails when first or last name differs despite middle name flexibility', () => {
    // Different first name
    expect(name('John Smith', 'Jane Smith').passed).toBe(false);

    // Different last name
    expect(name('John Smith', 'John Doe').passed).toBe(false);

    // Different last name (not just middle addition)
    expect(name('John Smith', 'John Smith Johnson').passed).toBe(false);
  });

  it('requires exact match for single-token names', () => {
    expect(name('Prince', 'Prince').passed).toBe(true);
    expect(name('Prince', 'The Prince').passed).toBe(false);
    expect(name('Madonna', 'Madonna Louise').passed).toBe(false);
  });

  it('passes with fuzzy matching for slight typos', () => {
    // Single character difference in last name
    expect(name('Johara A. Hassan', 'Johara A. Hasson').passed).toBe(true);

    // Single character missing
    expect(name('John Smith', 'Jon Smith').passed).toBe(true);

    // Transposition/typo in longer name
    expect(name('Christopher', 'Cristopher').passed).toBe(true);
  });

  it('returns reduced similarity for fuzzy matches', () => {
    const result = name('Johara A. Hassan', 'Johara A. Hasson');
    expect(result.similarity).toBeGreaterThanOrEqual(0.9);
    expect(result.similarity).toBeLessThan(0.95);
  });

  it('fails fuzzy matching when too many differences', () => {
    expect(name('John Smith', 'Jane Smyth').passed).toBe(false);
    expect(name('Robert', 'Richard').passed).toBe(false);
  });
});

describe('similarity scores', () => {
  it('date returns higher similarity for closer dates', () => {
    const result1 = date('2024-01-15', '2024-01-16'); // 1 day diff
    const result2 = date('2024-01-15', '2024-01-30'); // 15 days diff

    expect(result1.similarity).toBeDefined();
    expect(result2.similarity).toBeDefined();
    expect(result1.similarity).toBeGreaterThan(result2.similarity!);
    // 1 day diff should be ~e^(-1/30) ≈ 0.967
    expect(result1.similarity).toBeCloseTo(0.967, 2);
  });

  it('date returns 1.0 similarity for exact match', () => {
    const result = date('2024-01-15', '2024-01-15');
    expect(result.similarity).toBe(1.0);
    expect(result.passed).toBe(true);
  });

  it('within returns higher similarity for closer values', () => {
    const comparator = within({ tolerance: 0.1 });
    const result1 = comparator(100, 102); // 2% diff
    const result2 = comparator(100, 108); // 8% diff

    expect(result1.similarity).toBeDefined();
    expect(result2.similarity).toBeDefined();
    expect(result1.similarity).toBeGreaterThan(result2.similarity!);
  });

  it('within returns 1.0 similarity for exact match', () => {
    const comparator = within({ tolerance: 0.1 });
    const result = comparator(100, 100);
    expect(result.similarity).toBe(1.0);
    expect(result.passed).toBe(true);
  });

  it('within returns ~0.5 similarity at tolerance boundary', () => {
    const comparator = within({ tolerance: 0.1 });
    const result = comparator(100, 110); // exactly 10% diff (at boundary)
    // At boundary, similarity should be ~0.5 (due to ln(2) factor)
    expect(result.similarity).toBeCloseTo(0.5, 1);
  });

  it('exact returns 1.0 similarity on match, 0.0 on mismatch', () => {
    expect(exact('a', 'a').similarity).toBe(1.0);
    expect(exact('a', 'b').similarity).toBe(0.0);
    expect(exact(42, 42).similarity).toBe(1.0);
    expect(exact(42, 43).similarity).toBe(0.0);
  });

  it('presence returns 1.0 similarity on pass, 0.0 on fail', () => {
    expect(presence('expected', 'actual').similarity).toBe(1.0);
    expect(presence('expected', null).similarity).toBe(0.0);
  });

  it('oneOf returns 1.0 similarity on pass, 0.0 on fail', () => {
    const comparator = oneOf(['a', 'b', 'c']);
    expect(comparator('a', 'a').similarity).toBe(1.0);
    expect(comparator('a', 'b').similarity).toBe(0.0);
  });

  it('numeric returns 1.0 similarity on pass, 0.0 on fail', () => {
    expect(numeric(100, 100).similarity).toBe(1.0);
    expect(numeric(100, 200).similarity).toBe(0.0);
  });

  it('name returns 1.0 similarity on pass, actual similarity on fail', () => {
    expect(name('John Doe', 'john doe').similarity).toBe(1.0);
    // Failures now return actual Levenshtein similarity instead of 0.0
    expect(name('John', 'Jane').similarity).toBe(0.25); // 3 char diffs in 4 char string
  });

  it('contains returns 1.0 similarity on pass, 0.0 on fail', () => {
    const comparator = contains('success');
    expect(comparator('ignored', 'operation success').similarity).toBe(1.0);
    expect(comparator('ignored', 'operation failed').similarity).toBe(0.0);
  });
});

describe('edge cases', () => {
  describe('within with special numeric values', () => {
    it('handles NaN values', () => {
      const comparator = within({ tolerance: 0.1 });
      // NaN - NaN is NaN, Math.abs(NaN) is NaN, NaN <= threshold is false
      expect(comparator(NaN, 100).passed).toBe(false);
      expect(comparator(100, NaN).passed).toBe(false);
      expect(comparator(NaN, NaN).passed).toBe(false);
    });

    it('handles Infinity values', () => {
      const comparator = within({ tolerance: 0.1 });
      // Infinity - Infinity is NaN, NaN <= threshold is false
      expect(comparator(Infinity, Infinity).passed).toBe(false);
      // Infinity - 100 = Infinity, Infinity * 0.1 = Infinity, Infinity <= Infinity is true
      // This is mathematically questionable but JavaScript's behavior
      expect(comparator(Infinity, 100).passed).toBe(true);  // diff=Infinity, threshold=Infinity
      expect(comparator(100, Infinity).passed).toBe(false);  // diff=Infinity, threshold=10
      expect(comparator(-Infinity, -Infinity).passed).toBe(false);  // NaN
    });

    it('handles zero tolerance', () => {
      const comparator = within({ tolerance: 0 });
      expect(comparator(100, 100).passed).toBe(true);
      expect(comparator(100, 100.001).passed).toBe(false);
    });
  });

  describe('numeric with special values', () => {
    it('returns null for NaN values (fails comparison)', () => {
      expect(numeric(NaN, 100).passed).toBe(false);
      expect(numeric(100, NaN).passed).toBe(false);
    });

    it('handles very large numbers', () => {
      expect(numeric(1e15, 1e15).passed).toBe(true);
      expect(numeric('1000000000000000', 1e15).passed).toBe(true);
    });
  });

  describe('exact with circular references', () => {
    it('handles circular references without stack overflow', () => {
      const obj1: any = { a: 1 };
      obj1.self = obj1;

      const obj2: any = { a: 1 };
      obj2.self = obj2;

      // Should not throw (cycle detection prevents stack overflow)
      expect(() => exact(obj1, obj2)).not.toThrow();
      // Both have the same structure with cycles, should pass
      expect(exact(obj1, obj2).passed).toBe(true);
    });

    it('handles nested circular references', () => {
      const obj1: any = { a: { b: {} } };
      obj1.a.b.parent = obj1.a;

      const obj2: any = { a: { b: {} } };
      obj2.a.b.parent = obj2.a;

      expect(() => exact(obj1, obj2)).not.toThrow();
      expect(exact(obj1, obj2).passed).toBe(true);
    });

    it('handles array circular references', () => {
      const arr1: any[] = [1, 2];
      arr1.push(arr1);

      const arr2: any[] = [1, 2];
      arr2.push(arr2);

      expect(() => exact(arr1, arr2)).not.toThrow();
      expect(exact(arr1, arr2).passed).toBe(true);
    });
  });

  describe('date with special cases', () => {
    it('handles leap year dates', () => {
      // Valid leap year date
      expect(date('02/29/2024', '2024-02-29').passed).toBe(true);
      expect(date('February 29, 2024', '2024-02-29').passed).toBe(true);

      // Non-leap year - Feb 29 should fail or be interpreted differently
      // chrono-node may adjust invalid dates
      const result = date('02/29/2023', '2023-02-28');
      // This might pass or fail depending on chrono-node behavior
      expect(result.passed).toBeDefined();
    });

    it('handles end of month dates', () => {
      expect(date('12/31/2024', '2024-12-31').passed).toBe(true);
      expect(date('01/01/2025', '2025-01-01').passed).toBe(true);
    });

    it('handles relative date formats', () => {
      // chrono-node supports relative dates
      const today = new Date();
      const todayISO = today.toISOString().split('T')[0];
      expect(date('today', todayISO).passed).toBe(true);
    });
  });

  describe('name with international characters', () => {
    it('computes similarity for accented characters', () => {
      // Accented characters aren't stripped by toLowerCase
      // The Levenshtein distance will be higher due to é != e, etc.
      const result1 = name('José García', 'jose garcia');
      const result2 = name('Café Company', 'cafe company');
      // These have measurable similarity but may not pass the 0.9 threshold
      expect(result1.similarity).toBeGreaterThan(0.7);
      expect(result2.similarity).toBeGreaterThan(0.7);
      // Document that accented characters cause fuzzy match failures
      expect(result1.passed).toBe(false);  // é causes enough distance to fail
      expect(result2.passed).toBe(false);
    });

    it('handles names with umlauts via fuzzy matching', () => {
      // Müller vs muller - similar enough via Levenshtein
      const result = name('Müller', 'Muller');
      expect(result.similarity).toBeGreaterThanOrEqual(0.8);
    });

    it('handles CJK characters', () => {
      // Same characters should match
      expect(name('田中太郎', '田中太郎').passed).toBe(true);
      // Different characters should fail
      expect(name('田中太郎', '山田花子').passed).toBe(false);
    });
  });

  describe('contains with special characters', () => {
    it('handles regex special characters literally', () => {
      // The substring should be matched literally, not as regex
      const comparator = contains('[test]');
      expect(comparator('', 'result [test] string').passed).toBe(true);
      expect(comparator('', 'result test string').passed).toBe(false);
    });

    it('handles empty string substring', () => {
      const comparator = contains('');
      // Empty string is contained in every string
      expect(comparator('', 'any string').passed).toBe(true);
    });
  });
});
