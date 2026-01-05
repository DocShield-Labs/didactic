import { describe, it, expect } from 'vitest';
import { matchArrays } from '../src/matching.js';
import { exact, within, date } from '../src/comparators.js';

const testCase1Actual = [
  {
    applicant_name: 'Gabriel Barciela',
    status: 'quoted',
    policy_structure: 'modified_claims_made',
    per_occurrence_limit: 250000,
    aggregate_limit: 750000,
    premium: 9589,
    taxes: 0,
    fees: 0,
    retroactive_date: '01/01/2026',
  },
  {
    applicant_name: 'Gabriel Barciela',
    status: 'quoted',
    policy_structure: 'modified_claims_made',
    per_occurrence_limit: 250000,
    aggregate_limit: 750000,
    premium: 7588, // Should match to 7500 premium from expected
    taxes: 0,
    fees: 0,
    retroactive_date: '01/01/2026',
  },
];

const testCase1Expected = [
  {
    applicant_name: 'Gabriel Barciela',
    status: 'quoted',
    policy_structure: 'modified_claims_made',
    per_occurrence_limit: 250000,
    aggregate_limit: 750000,
    premium: 9589,
  },
  {
    applicant_name: 'Gabriel Barciela',
    status: 'quoted',
    policy_structure: 'modified_claims_made',
    per_occurrence_limit: 250000,
    aggregate_limit: 750000,
    premium: 7500,
  },
];

const testCase2Actual = [
  {
    applicant_name: 'Gabriel Barciela',
    status: 'quoted',
    policy_structure: 'modified_claims_made',
    per_occurrence_limit: 250000,
    aggregate_limit: 750000,
    premium: 9589,
    effective_date: '01/03/2026',
  },
  {
    applicant_name: 'Gabriel Barciela',
    status: 'quoted',
    policy_structure: 'modified_claims_made',
    per_occurrence_limit: 250000,
    aggregate_limit: 750000,
    premium: 9589,
    effective_date: '01/02/2026', // Should match 01/01/2026 from expected since it's closest
  },
];

const testCase2Expected = [
  {
    applicant_name: 'Gabriel Barciela',
    status: 'quoted',
    policy_structure: 'modified_claims_made',
    per_occurrence_limit: 250000,
    aggregate_limit: 750000,
    premium: 9589,
    effective_date: '01/01/2026',
  },
];

describe('matchArrays', () => {
  describe('primitives', () => {
    it('matches identical arrays', () => {
      const result = matchArrays([1, 2, 3], [1, 2, 3]);
      expect(result.unmatchedExpected).toHaveLength(0);
      expect(result.assignments).toHaveLength(3);
    });

    it('matches reordered arrays', () => {
      const result = matchArrays([1, 2, 3], [3, 1, 2]);
      expect(result.unmatchedExpected).toHaveLength(0);
      expect(result.assignments).toHaveLength(3);
    });

    it('reports unmatched when expected items missing from actual', () => {
      const result = matchArrays([1, 2, 3], [1, 2]);
      // With similarity-based matching, Hungarian will still pair all 2 actual items
      // The 3rd expected item has no actual to pair with
      expect(result.unmatchedExpected).toHaveLength(1);
    });

    it('allows extra actual items (lenient)', () => {
      const result = matchArrays([1, 2], [1, 2, 3]);
      expect(result.unmatchedExpected).toHaveLength(0);
      expect(result.unmatchedActual).toContain(2);
    });

    it('handles empty arrays', () => {
      expect(matchArrays([], []).unmatchedExpected).toHaveLength(0);
      expect(matchArrays([], [1]).unmatchedActual).toHaveLength(1);
      expect(matchArrays([1], []).unmatchedExpected).toHaveLength(1);
    });
  });

  describe('objects with exact matching', () => {
    interface Quote {
      carrier: string;
      premium: number;
    }

    it('matches identical object arrays', () => {
      const expected: Quote[] = [
        { carrier: 'Acme', premium: 100 },
        { carrier: 'Beta', premium: 200 },
      ];
      const actual: Quote[] = [
        { carrier: 'Acme', premium: 100 },
        { carrier: 'Beta', premium: 200 },
      ];

      const result = matchArrays(expected, actual);
      expect(result.unmatchedExpected).toHaveLength(0);
      expect(result.assignments).toHaveLength(2);
    });

    it('matches reordered object arrays', () => {
      const expected: Quote[] = [
        { carrier: 'Acme', premium: 100 },
        { carrier: 'Beta', premium: 200 },
      ];
      const actual: Quote[] = [
        { carrier: 'Beta', premium: 200 },
        { carrier: 'Acme', premium: 100 },
      ];

      const result = matchArrays(expected, actual);
      expect(result.unmatchedExpected).toHaveLength(0);
    });

    it('matches objects even when some fields differ (similarity-based)', () => {
      const expected: Quote[] = [{ carrier: 'Acme', premium: 100 }];
      const actual: Quote[] = [{ carrier: 'Acme', premium: 999 }];

      // With similarity-based matching, Hungarian pairs them (50% similarity)
      const result = matchArrays(expected, actual);
      expect(result.assignments).toHaveLength(1);
      expect(result.unmatchedExpected).toHaveLength(0);
      // Note: Field-level failures are reported at the compare() level, not here
    });

    it('reports unmatched when expected object missing from actual', () => {
      const expected: Quote[] = [
        { carrier: 'Acme', premium: 100 },
        { carrier: 'Beta', premium: 200 },
      ];
      const actual: Quote[] = [{ carrier: 'Acme', premium: 100 }];

      const result = matchArrays(expected, actual);
      expect(result.unmatchedExpected).toHaveLength(1);
    });

    it('allows extra objects in actual (lenient)', () => {
      const expected: Quote[] = [{ carrier: 'Acme', premium: 100 }];
      const actual: Quote[] = [
        { carrier: 'Acme', premium: 100 },
        { carrier: 'Extra', premium: 999 },
      ];

      const result = matchArrays(expected, actual);
      expect(result.unmatchedExpected).toHaveLength(0);
      expect(result.unmatchedActual).toHaveLength(1);
    });
  });

  describe('objects with field comparators', () => {
    interface Quote {
      carrier: string;
      premium: number;
    }

    it('similarity score reflects field comparator results', () => {
      const expected: Quote[] = [{ carrier: 'Acme', premium: 100 }];
      const actual: Quote[] = [{ carrier: 'Acme', premium: 105 }]; // 5% diff

      // Without tolerance: still matches (similarity-based), but with 50% similarity
      const strictResult = matchArrays(expected, actual);
      expect(strictResult.assignments).toHaveLength(1);
      expect(strictResult.unmatchedExpected).toHaveLength(0);

      // With tolerance: 100% similarity (both fields pass)
      const tolerantResult = matchArrays(expected, actual, {
        premium: within({ tolerance: 0.1 }),
      });
      expect(tolerantResult.unmatchedExpected).toHaveLength(0);
    });

    it('matches reordered arrays using field comparators', () => {
      const expected: Quote[] = [
        { carrier: 'Acme', premium: 100 },
        { carrier: 'Beta', premium: 200 },
      ];
      const actual: Quote[] = [
        { carrier: 'Beta', premium: 210 }, // 5% diff
        { carrier: 'Acme', premium: 95 }, // 5% diff
      ];

      const result = matchArrays(expected, actual, {
        carrier: exact,
        premium: within({ tolerance: 0.1 }),
      });

      expect(result.unmatchedExpected).toHaveLength(0);
      expect(result.assignments).toHaveLength(2);
    });

    it('hungarian finds optimal pairing even with partial similarity', () => {
      const expected: Quote[] = [{ carrier: 'Acme', premium: 100 }];
      const actual: Quote[] = [{ carrier: 'Wrong', premium: 100 }];

      // With similarity-based matching, Hungarian still pairs them
      // (one field matches = 50% similarity, better than nothing)
      const result = matchArrays(expected, actual, {
        carrier: exact,
        premium: within({ tolerance: 0.1 }),
      });

      expect(result.assignments).toHaveLength(1);
      expect(result.unmatchedExpected).toHaveLength(0);
      // Field-level failures are reported at the compare() level
    });
  });

  describe('real-world quote matching scenarios', () => {
    it('hungarian algorithm pairs quotes by closest premium', () => {
      const result = matchArrays(testCase1Expected, testCase1Actual, {
        premium: within({ tolerance: 0.02 }), // 2% tolerance covers 1.17% diff
      });

      expect(result.assignments).toHaveLength(2);
      expect(result.unmatchedExpected).toHaveLength(0);

      // Verify optimal pairing:
      // Expected[0] (premium: 9589) should match Actual[0] (premium: 9589)
      // Expected[1] (premium: 7500) should match Actual[1] (premium: 7588)
      expect(result.assignments).toContainEqual([0, 0]); // exact premium match
      expect(result.assignments).toContainEqual([1, 1]); // closest premium match
    });

    it('matches quotes even with exact matching (suboptimal similarity)', () => {
      const result = matchArrays(testCase1Expected, testCase1Actual);

      expect(result.assignments).toHaveLength(2);
      expect(result.unmatchedExpected).toHaveLength(0);
      // Pairing still happens, just with lower similarity on mismatched premium
    });

    it('handles more actual items than expected items', () => {
      const result = matchArrays(testCase2Expected, testCase2Actual);

      expect(result.assignments).toHaveLength(1);
      expect(result.unmatchedExpected).toHaveLength(0);
      expect(result.unmatchedActual).toHaveLength(1);
    });

    it('matches closest date when actual > expected using date similarity', () => {
      const result = matchArrays(testCase2Expected, testCase2Actual, {
        effective_date: date,
      });

      expect(result.assignments).toHaveLength(1);
      expect(result.unmatchedExpected).toHaveLength(0);
      expect(result.unmatchedActual).toHaveLength(1);

      // With date similarity, 01/02/2026 (1 day diff) should be preferred over 01/03/2026 (2 days diff)
      // Expected[0] should match Actual[1] (01/02/2026)
      expect(result.assignments[0]).toEqual([0, 1]);
      expect(result.unmatchedActual).toContain(0); // Actual[0] (01/03/2026) unmatched
    });
  });

  describe('edge cases', () => {
    it('handles nested objects with similarity calculation', () => {
      const expected = [{ user: { name: 'John', age: 30 }, status: 'active' }];
      const actual = [
        { user: { name: 'John', age: 31 }, status: 'active' }, // nested age differs
      ];

      const result = matchArrays(expected, actual);

      // Should still match (partial similarity on nested object)
      expect(result.assignments).toHaveLength(1);
      expect(result.unmatchedExpected).toHaveLength(0);
    });

    it('treats array fields as primitives requiring exact match', () => {
      const expected = [{ tags: ['a', 'b'], name: 'item1' }];
      const actual = [{ tags: ['a', 'b'], name: 'item1' }];

      const result = matchArrays(expected, actual);
      expect(result.assignments).toHaveLength(1);
      expect(result.unmatchedExpected).toHaveLength(0);
    });

    it('array fields with different values reduce similarity', () => {
      const expected = [{ tags: ['a', 'b'], name: 'item1' }];
      const actual = [{ tags: ['a', 'b', 'c'], name: 'item1' }]; // extra tag

      const result = matchArrays(expected, actual);
      // Still matches (50% similarity - name matches, tags don't)
      expect(result.assignments).toHaveLength(1);
      expect(result.unmatchedExpected).toHaveLength(0);
    });

    it('handles null field values', () => {
      const expected = [{ name: 'John', optional: null }];
      const actual = [{ name: 'John', optional: null }];

      const result = matchArrays(expected, actual);
      expect(result.assignments).toHaveLength(1);
      expect(result.unmatchedExpected).toHaveLength(0);
    });

    it('handles undefined vs null field mismatch', () => {
      const expected = [{ name: 'John', optional: null }];
      const actual = [{ name: 'John', optional: undefined }];

      const result = matchArrays(expected, actual);
      // Still matches with partial similarity (name matches)
      expect(result.assignments).toHaveLength(1);
      expect(result.unmatchedExpected).toHaveLength(0);
    });

    it('ignores extra fields in actual objects', () => {
      const expected = [{ name: 'John' }];
      const actual = [{ name: 'John', extra: 'ignored', another: 123 }];

      const result = matchArrays(expected, actual);
      // Only expected fields are compared, extra fields ignored
      expect(result.assignments).toHaveLength(1);
      expect(result.unmatchedExpected).toHaveLength(0);
    });

    it('handles all-identical items in both arrays', () => {
      const expected = [{ x: 1 }, { x: 1 }, { x: 1 }];
      const actual = [{ x: 1 }, { x: 1 }, { x: 1 }];

      const result = matchArrays(expected, actual);
      // All should be matched (any valid pairing is acceptable)
      expect(result.assignments).toHaveLength(3);
      expect(result.unmatchedExpected).toHaveLength(0);
      expect(result.unmatchedActual).toHaveLength(0);
    });

    it('picks optimal match when competing similar objects exist', () => {
      const expected = [{ premium: 100 }];
      const actual = [
        { premium: 90 }, // 10% diff
        { premium: 102 }, // 2% diff - should be picked
      ];

      const result = matchArrays(expected, actual, {
        premium: within({ tolerance: 0.15 }),
      });

      expect(result.assignments).toHaveLength(1);
      // Should pick actual[1] (premium: 102) as it's closer
      expect(result.assignments[0]).toEqual([0, 1]);
      expect(result.unmatchedActual).toContain(0);
    });

    it('handles empty objects', () => {
      const expected = [{}];
      const actual = [{}];

      const result = matchArrays(expected, actual);
      // Empty objects have 1.0 similarity (no fields to compare)
      expect(result.assignments).toHaveLength(1);
      expect(result.unmatchedExpected).toHaveLength(0);
    });

    it('handles type mismatches between string and number', () => {
      const expected = [{ value: '100' }]; // string
      const actual = [{ value: 100 }]; // number

      const result = matchArrays(expected, actual);
      // Type mismatch means field doesn't match exactly
      // Still pairs them (they're the only options)
      expect(result.assignments).toHaveLength(1);
      expect(result.unmatchedExpected).toHaveLength(0);
    });

    it('uses exact comparator for fields without explicit comparator', () => {
      const expected = [{ carrier: 'Acme', premium: 100, region: 'US' }];
      const actual = [{ carrier: 'Acme', premium: 105, region: 'US' }];

      // Only premium has comparator; carrier and region use exact
      const result = matchArrays(expected, actual, {
        premium: within({ tolerance: 0.1 }),
      });

      expect(result.assignments).toHaveLength(1);
      expect(result.unmatchedExpected).toHaveLength(0);
    });

    it('handles mixed comparators with some fields failing', () => {
      const expected = [{ carrier: 'Acme', premium: 100, region: 'US' }];
      const actual = [
        { carrier: 'Beta', premium: 105, region: 'US' }, // carrier differs
      ];

      const result = matchArrays(expected, actual, {
        premium: within({ tolerance: 0.1 }),
        carrier: exact,
        region: exact,
      });

      // Still matches (2/3 fields pass = 66% similarity)
      expect(result.assignments).toHaveLength(1);
      expect(result.unmatchedExpected).toHaveLength(0);
    });

    it('handles deeply nested objects', () => {
      const expected = [
        {
          level1: {
            level2: {
              level3: { value: 'deep' },
            },
          },
        },
      ];
      const actual = [
        {
          level1: {
            level2: {
              level3: { value: 'deep' },
            },
          },
        },
      ];

      const result = matchArrays(expected, actual);
      expect(result.assignments).toHaveLength(1);
      expect(result.unmatchedExpected).toHaveLength(0);
    });

    it('handles objects with boolean fields', () => {
      const expected = [{ active: true, premium: 100 }];
      const actual = [{ active: false, premium: 100 }]; // boolean differs

      const result = matchArrays(expected, actual);
      // Matches with 50% similarity
      expect(result.assignments).toHaveLength(1);
      expect(result.unmatchedExpected).toHaveLength(0);
    });

    it('handles large arrays efficiently', () => {
      const expected = Array.from({ length: 50 }, (_, i) => ({
        id: i,
        value: i * 10,
      }));
      const actual = Array.from({ length: 50 }, (_, i) => ({
        id: i,
        value: i * 10,
      }));

      const result = matchArrays(expected, actual);
      expect(result.assignments).toHaveLength(50);
      expect(result.unmatchedExpected).toHaveLength(0);
      expect(result.unmatchedActual).toHaveLength(0);
    });
  });

  describe('optimal pairing verification', () => {
    it('pairs each expected to its exact match when available', () => {
      const expected = [
        { carrier: 'Acme', premium: 100 },
        { carrier: 'Beta', premium: 200 },
        { carrier: 'Gamma', premium: 300 },
      ];
      const actual = [
        { carrier: 'Gamma', premium: 300 }, // idx 0
        { carrier: 'Acme', premium: 100 }, // idx 1
        { carrier: 'Beta', premium: 200 }, // idx 2
      ];

      const result = matchArrays(expected, actual, {
        carrier: exact,
        premium: exact,
      });

      // Verify exact pairings by index
      expect(result.assignments).toContainEqual([0, 1]); // Acme -> Acme
      expect(result.assignments).toContainEqual([1, 2]); // Beta -> Beta
      expect(result.assignments).toContainEqual([2, 0]); // Gamma -> Gamma
    });

    it('hungarian finds global optimum over greedy local choice', () => {
      // Scenario: Greedy would pair E0->A0 (90% match), leaving E1->A1 (50% match)
      // Optimal: E0->A1 (100% match), E1->A0 (80% match) = better total
      const expected = [
        { carrier: 'Acme', premium: 100 }, // E0
        { carrier: 'Beta', premium: 200 }, // E1
      ];
      const actual = [
        { carrier: 'Acme', premium: 200 }, // A0: matches E0 carrier, E1 premium
        { carrier: 'Acme', premium: 100 }, // A1: exact match for E0
      ];

      const result = matchArrays(expected, actual, {
        carrier: exact,
        premium: exact,
      });

      // Hungarian should find: E0->A1 (exact), E1->A0 (partial)
      expect(result.assignments).toContainEqual([0, 1]); // E0 gets exact match A1
      expect(result.assignments).toContainEqual([1, 0]); // E1 gets A0
    });

    it('pairs by closest numeric value with within comparator', () => {
      const expected = [
        { premium: 100 }, // E0
        { premium: 200 }, // E1
        { premium: 300 }, // E2
      ];
      const actual = [
        { premium: 305 }, // A0: closest to E2
        { premium: 198 }, // A1: closest to E1
        { premium: 102 }, // A2: closest to E0
      ];

      const result = matchArrays(expected, actual, {
        premium: within({ tolerance: 0.1 }),
      });

      expect(result.assignments).toContainEqual([0, 2]); // 100 -> 102
      expect(result.assignments).toContainEqual([1, 1]); // 200 -> 198
      expect(result.assignments).toContainEqual([2, 0]); // 300 -> 305
    });

    it('pairs by closest date with date comparator', () => {
      const expected = [
        { date: '01/01/2024' }, // E0: Jan 1
        { date: '01/15/2024' }, // E1: Jan 15
      ];
      const actual = [
        { date: '01/14/2024' }, // A0: Jan 14 - closest to E1
        { date: '01/02/2024' }, // A1: Jan 2 - closest to E0
      ];

      const result = matchArrays(expected, actual, {
        date: date,
      });

      expect(result.assignments).toContainEqual([0, 1]); // Jan 1 -> Jan 2
      expect(result.assignments).toContainEqual([1, 0]); // Jan 15 -> Jan 14
    });

    it('optimizes multi-field matching for best overall pairing', () => {
      const expected = [
        { carrier: 'Acme', region: 'US', premium: 100 }, // E0
        { carrier: 'Acme', region: 'EU', premium: 200 }, // E1
      ];
      const actual = [
        { carrier: 'Acme', region: 'EU', premium: 200 }, // A0: exact for E1
        { carrier: 'Acme', region: 'US', premium: 100 }, // A1: exact for E0
      ];

      const result = matchArrays(expected, actual, {
        carrier: exact,
        region: exact,
        premium: exact,
      });

      // Should find exact matches despite order
      expect(result.assignments).toContainEqual([0, 1]); // E0 -> A1 (US, 100)
      expect(result.assignments).toContainEqual([1, 0]); // E1 -> A0 (EU, 200)
    });

    it('selects best actual when multiple compete for one expected', () => {
      const expected = [{ carrier: 'Target', premium: 500 }];
      const actual = [
        { carrier: 'Target', premium: 400 }, // A0: 80% premium match
        { carrier: 'Target', premium: 500 }, // A1: exact match
        { carrier: 'Target', premium: 600 }, // A2: 80% premium match
      ];

      const result = matchArrays(expected, actual, {
        premium: within({ tolerance: 0.5 }),
      });

      // Should pick A1 (exact match)
      expect(result.assignments).toEqual([[0, 1]]);
      expect(result.unmatchedActual).toEqual([0, 2]);
    });

    it('distributes actuals optimally when expected items compete', () => {
      // Two expected items, three actuals
      // E0 wants premium ~100, E1 wants premium ~100
      // A0=100 (exact), A1=105, A2=110
      // Optimal: E0->A0, E1->A1 (not both fighting for A0)
      const expected = [
        { carrier: 'Acme', premium: 100 }, // E0
        { carrier: 'Acme', premium: 105 }, // E1
      ];
      const actual = [
        { carrier: 'Acme', premium: 100 }, // A0: exact for E0
        { carrier: 'Acme', premium: 105 }, // A1: exact for E1
        { carrier: 'Acme', premium: 200 }, // A2: poor match for both
      ];

      const result = matchArrays(expected, actual, {
        premium: within({ tolerance: 0.1 }),
      });

      expect(result.assignments).toContainEqual([0, 0]); // E0 -> A0 (exact)
      expect(result.assignments).toContainEqual([1, 1]); // E1 -> A1 (exact)
      expect(result.unmatchedActual).toContain(2); // A2 unmatched
    });

    it('avoids suboptimal greedy pairing in complex scenario', () => {
      // Classic Hungarian algorithm test case
      // Greedy approach: E0->A0 (2 fields match), then E1 stuck with A1 (0 fields match)
      // Optimal: E0->A1 (1 field), E1->A0 (1 field) = both get partial matches
      const expected = [
        { a: 1, b: 2 }, // E0
        { a: 3, b: 4 }, // E1
      ];
      const actual = [
        { a: 1, b: 4 }, // A0: shares 'a' with E0, shares 'b' with E1
        { a: 1, b: 2 }, // A1: exact match for E0
      ];

      const result = matchArrays(expected, actual, { a: exact, b: exact });

      // Hungarian should give E0 its exact match
      expect(result.assignments).toContainEqual([0, 1]); // E0 -> A1 (exact)
      expect(result.assignments).toContainEqual([1, 0]); // E1 -> A0 (partial)
    });

    it('handles asymmetric matching with more expected than actual', () => {
      const expected = [
        { id: 1, score: 100 }, // E0
        { id: 2, score: 200 }, // E1
        { id: 3, score: 300 }, // E2
      ];
      const actual = [
        { id: 2, score: 200 }, // A0: exact for E1
      ];

      const result = matchArrays(expected, actual, { id: exact, score: exact });

      // Only E1 should match, others unmatched
      expect(result.assignments).toEqual([[1, 0]]);
      expect(result.unmatchedExpected).toEqual([0, 2]);
    });

    it('handles asymmetric matching with more actual than expected', () => {
      const expected = [
        { id: 2, score: 200 }, // E0
      ];
      const actual = [
        { id: 1, score: 100 }, // A0
        { id: 2, score: 200 }, // A1: exact for E0
        { id: 3, score: 300 }, // A2
      ];

      const result = matchArrays(expected, actual, { id: exact, score: exact });

      // E0 should match A1 (exact match)
      expect(result.assignments).toEqual([[0, 1]]);
      expect(result.unmatchedActual).toEqual([0, 2]);
    });
  });

  describe('nested array matching', () => {
    it('matches nested arrays of primitives in different order', () => {
      const expected = [
        [1, 2],
        [3, 4],
      ];
      const actual = [
        [3, 4],
        [1, 2],
      ];

      const result = matchArrays(expected, actual);

      expect(result.assignments).toHaveLength(2);
      expect(result.unmatchedExpected).toHaveLength(0);
      // [1,2] should match [1,2], [3,4] should match [3,4]
      expect(result.assignments).toContainEqual([0, 1]);
      expect(result.assignments).toContainEqual([1, 0]);
    });

    it('matches nested arrays of objects using field comparators', () => {
      const expected = [[{ a: 1 }], [{ a: 2 }]];
      const actual = [[{ a: 2 }], [{ a: 1 }]];

      const result = matchArrays(expected, actual, { a: exact });

      expect(result.assignments).toHaveLength(2);
      expect(result.unmatchedExpected).toHaveLength(0);
      // [{a:1}] should match [{a:1}], [{a:2}] should match [{a:2}]
      expect(result.assignments).toContainEqual([0, 1]);
      expect(result.assignments).toContainEqual([1, 0]);
    });

    it('matches nested arrays with partial object matches', () => {
      const expected = [[{ a: 1, b: 10 }], [{ a: 2, b: 20 }]];
      const actual = [[{ a: 2, b: 99 }], [{ a: 1, b: 99 }]];

      const result = matchArrays(expected, actual, { a: exact });

      expect(result.assignments).toHaveLength(2);
      // Should pair by field 'a' similarity
      expect(result.assignments).toContainEqual([0, 1]); // a:1 -> a:1
      expect(result.assignments).toContainEqual([1, 0]); // a:2 -> a:2
    });

    it('handles deeply nested arrays (3+ levels)', () => {
      const expected = [[[1]], [[2]]];
      const actual = [[[2]], [[1]]];

      const result = matchArrays(expected, actual);

      expect(result.assignments).toHaveLength(2);
      expect(result.unmatchedExpected).toHaveLength(0);
      expect(result.assignments).toContainEqual([0, 1]);
      expect(result.assignments).toContainEqual([1, 0]);
    });

    it('handles mixed nested structures', () => {
      const expected = [[{ id: 1 }, { id: 2 }], [{ id: 3 }]];
      const actual = [[{ id: 3 }], [{ id: 1 }, { id: 2 }]];

      const result = matchArrays(expected, actual, { id: exact });

      expect(result.assignments).toHaveLength(2);
      expect(result.assignments).toContainEqual([0, 1]);
      expect(result.assignments).toContainEqual([1, 0]);
    });

    it('penalizes length mismatches in nested arrays', () => {
      const expected = [[1, 2, 3], [4]];
      const actual = [[4], [1, 2]]; // [1,2] is closer to [1,2,3] than [4] is

      const result = matchArrays(expected, actual);

      expect(result.assignments).toHaveLength(2);
      // [1,2,3] should pair with [1,2] (2/3 similarity)
      // [4] should pair with [4] (1/1 similarity)
      expect(result.assignments).toContainEqual([0, 1]);
      expect(result.assignments).toContainEqual([1, 0]);
    });

    it('handles empty nested arrays', () => {
      const expected = [[], [1]];
      const actual = [[1], []];

      const result = matchArrays(expected, actual);

      expect(result.assignments).toHaveLength(2);
      expect(result.assignments).toContainEqual([0, 1]); // [] -> []
      expect(result.assignments).toContainEqual([1, 0]); // [1] -> [1]
    });

    it('matches complex nested object arrays', () => {
      const expected = [
        [
          { carrier: 'Acme', premium: 100 },
          { carrier: 'Beta', premium: 200 },
        ],
        [{ carrier: 'Gamma', premium: 300 }],
      ];
      const actual = [
        [{ carrier: 'Gamma', premium: 300 }],
        [
          { carrier: 'Acme', premium: 100 },
          { carrier: 'Beta', premium: 200 },
        ],
      ];

      const result = matchArrays(expected, actual, {
        carrier: exact,
        premium: exact,
      });

      expect(result.assignments).toHaveLength(2);
      expect(result.assignments).toContainEqual([0, 1]);
      expect(result.assignments).toContainEqual([1, 0]);
    });
  });
});
