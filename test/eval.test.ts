import { describe, it, expect, vi } from 'vitest';
import { evaluate } from '../src/eval.js';
import { exact, within } from '../src/comparators.js';
import { mock } from '../src/executors.js';
import type { Executor } from '../src/types.js';

type Input = { id: number };
type Output = { v: number };

describe('evaluate', () => {
  describe('validation', () => {
    it('throws when testCases array is empty', async () => {
      await expect(
        evaluate({
          executor: async () => ({ output: {} }),
          comparators: {},
          testCases: [],
        })
      ).rejects.toThrow('testCases array cannot be empty');
    });
  });

  describe('execution', () => {
    it('passes input and systemPrompt to executor', async () => {
      const executor = vi.fn(async () => ({ output: { v: 1 } }));

      await evaluate<Input, Output>({
        systemPrompt: 'test prompt',
        executor,
        comparators: {},
        testCases: [{ input: { id: 42 }, expected: { v: 1 } }],
      });

      expect(executor).toHaveBeenCalledWith({ id: 42 }, 'test prompt');
    });
  });

  describe('comparison', () => {
    it('uses custom comparator when provided', async () => {
      const result = await evaluate<Input, Output>({
        executor: mock([{ v: 105 }]),
        comparators: { v: within({ tolerance: 0.1 }) },
        testCases: [{ input: { id: 1 }, expected: { v: 100 } }],
      });

      expect(result.testCases[0].passed).toBe(true);
    });

    it('skips fields without explicit comparators', async () => {
      const result = await evaluate<Input, Output>({
        executor: mock([{ v: 999 }]),  // Different value
        comparators: {},  // No comparators
        testCases: [{ input: { id: 1 }, expected: { v: 1 } }],
      });

      // With no comparators, no fields are compared, so it passes
      expect(result.testCases[0].passed).toBe(true);
      expect(result.testCases[0].fields).toEqual({});
    });

    it('only compares fields with explicit comparators', async () => {
      const result = await evaluate<Input, { a: number; b: number }>({
        executor: async () => ({ output: { a: 1, b: 999 } }),
        comparators: { a: exact },  // Only compare 'a'
        testCases: [{ input: { id: 1 }, expected: { a: 1, b: 2 } }],
      });

      // Only 'a' is compared (and matches), 'b' is skipped
      expect(result.testCases[0].passed).toBe(true);
      expect(result.testCases[0].fields['a'].passed).toBe(true);
      expect(result.testCases[0].fields['b']).toBeUndefined();
    });

    it('marks test case failed when any field fails', async () => {
      const result = await evaluate<Input, { a: number; b: number }>({
        executor: async () => ({ output: { a: 1, b: 999 } }),
        comparators: { a: exact, b: exact },
        testCases: [{ input: { id: 1 }, expected: { a: 1, b: 2 } }],
      });

      expect(result.testCases[0].passed).toBe(false);
      expect(result.testCases[0].fields['a'].passed).toBe(true);
      expect(result.testCases[0].fields['b'].passed).toBe(false);
    });

    it('fails when actual is missing expected field with comparator', async () => {
      const result = await evaluate<Input, { a: number; b: number }>({
        executor: async () => ({ output: { a: 1 } as { a: number; b: number } }),
        comparators: { a: exact, b: exact },
        testCases: [{ input: { id: 1 }, expected: { a: 1, b: 2 } }],
      });

      expect(result.testCases[0].passed).toBe(false);
      expect(result.testCases[0].fields['b'].passed).toBe(false);
    });
  });

  describe('aggregation', () => {
    it('calculates pass count and total', async () => {
      const result = await evaluate<Input, Output>({
        executor: mock([{ v: 1 }, { v: 999 }, { v: 3 }]),
        comparators: { v: exact },
        testCases: [
          { input: { id: 1 }, expected: { v: 1 } },
          { input: { id: 2 }, expected: { v: 2 } },
          { input: { id: 3 }, expected: { v: 3 } },
        ],
      });

      expect(result.passed).toBe(2);
      expect(result.total).toBe(3);
    });
  });

  describe('error handling', () => {
    it('marks test case as failed when executor throws', async () => {
      let call = 0;
      const executor: Executor<Input, Output> = async () => {
        call++;
        if (call === 2) throw new Error('executor failed');
        return { output: { v: 1 } };
      };

      const result = await evaluate<Input, Output>({
        executor,
        comparators: { v: exact },
        testCases: [
          { input: { id: 1 }, expected: { v: 1 } },
          { input: { id: 2 }, expected: { v: 1 } },
          { input: { id: 3 }, expected: { v: 1 } },
        ],
      });

      expect(result.passed).toBe(2);
      expect(result.total).toBe(3);
      // Failures are sorted first
      const failedCase = result.testCases.find(tc => !tc.passed);
      expect(failedCase).toBeDefined();
      expect(failedCase!.error).toBe('executor failed');
      expect(failedCase!.fields).toEqual({});
    });

    it('continues evaluatening other test cases after one fails', async () => {
      let callCount = 0;
      const executor: Executor<Input, Output> = async () => {
        callCount++;
        if (callCount === 1) throw new Error('first call failed');
        return { output: { v: 1 } };
      };

      const result = await evaluate<Input, Output>({
        executor,
        comparators: { v: exact },
        testCases: [
          { input: { id: 1 }, expected: { v: 1 } },
          { input: { id: 2 }, expected: { v: 1 } },
          { input: { id: 3 }, expected: { v: 1 } },
        ],
      });

      // All 3 test cases should have been attempted
      expect(result.testCases.length).toBe(3);
      expect(result.testCases[0].error).toBe('first call failed');
      expect(result.testCases[1].passed).toBe(true);
      expect(result.testCases[2].passed).toBe(true);
    });

    it('captures non-Error throws as strings', async () => {
      const executor: Executor<Input, Output> = async () => {
        throw 'string error';
      };

      const result = await evaluate<Input, Output>({
        executor,
        comparators: {},
        testCases: [{ input: { id: 1 }, expected: { v: 1 } }],
      });

      expect(result.testCases[0].error).toBe('string error');
    });
  });

  describe('array matching', () => {
    interface Quote { carrier: string; premium: number }
    type QuotesOutput = { quotes: Quote[] };

    it('matches arrays regardless of order', async () => {
      const result = await evaluate<Input, QuotesOutput>({
        executor: async () => ({
          output: {
            quotes: [
              { carrier: 'Beta', premium: 200 },
              { carrier: 'Acme', premium: 100 },
            ],
          },
        }),
        comparators: { carrier: exact, premium: exact },
        testCases: [{
          input: { id: 1 },
          expected: {
            quotes: [
              { carrier: 'Acme', premium: 100 },
              { carrier: 'Beta', premium: 200 },
            ],
          },
        }],
      });

      expect(result.testCases[0].passed).toBe(true);
    });

    it('applies field comparators to array elements', async () => {
      const result = await evaluate<Input, QuotesOutput>({
        executor: async () => ({
          output: { quotes: [{ carrier: 'Acme', premium: 105 }] },
        }),
        comparators: {
          carrier: exact,
          premium: within({ tolerance: 0.1 }), // 10% tolerance
        },
        testCases: [{
          input: { id: 1 },
          expected: { quotes: [{ carrier: 'Acme', premium: 100 }] },
        }],
      });

      expect(result.testCases[0].passed).toBe(true);
    });

    it('fails when array element count differs', async () => {
      const result = await evaluate<Input, QuotesOutput>({
        executor: async () => ({
          output: { quotes: [{ carrier: 'Acme', premium: 100 }] },
        }),
        comparators: { carrier: exact, premium: exact },
        testCases: [{
          input: { id: 1 },
          expected: {
            quotes: [
              { carrier: 'Acme', premium: 100 },
              { carrier: 'Beta', premium: 200 },
            ],
          },
        }],
      });

      expect(result.testCases[0].passed).toBe(false);
    });

    it('fails when array element fields dont match', async () => {
      const result = await evaluate<Input, QuotesOutput>({
        executor: async () => ({
          output: { quotes: [{ carrier: 'Wrong', premium: 100 }] },
        }),
        comparators: { carrier: exact, premium: exact },
        testCases: [{
          input: { id: 1 },
          expected: { quotes: [{ carrier: 'Acme', premium: 100 }] },
        }],
      });

      expect(result.testCases[0].passed).toBe(false);
    });

    it('passes when actual has extra array items (lenient matching)', async () => {
      const result = await evaluate<Input, QuotesOutput>({
        executor: async () => ({
          output: {
            quotes: [
              { carrier: 'Acme', premium: 100 },
              { carrier: 'Beta', premium: 200 },
              { carrier: 'Extra', premium: 300 },
            ],
          },
        }),
        comparators: {},
        testCases: [{
          input: { id: 1 },
          expected: {
            quotes: [
              { carrier: 'Acme', premium: 100 },
              { carrier: 'Beta', premium: 200 },
            ],
          },
        }],
      });

      expect(result.testCases[0].passed).toBe(true);
    });

    it('applies field comparator to primitive array elements', async () => {
      type PricesOutput = { prices: number[] };

      const result = await evaluate<Input, PricesOutput>({
        executor: async () => ({
          output: { prices: [105, 210] },
        }),
        comparators: {
          prices: within({ tolerance: 0.1 }), // 10% tolerance
        },
        testCases: [{
          input: { id: 1 },
          expected: { prices: [100, 200] },
        }],
      });

      expect(result.testCases[0].passed).toBe(true);
    });

    it('skips primitive arrays without comparator', async () => {
      type PricesOutput = { prices: number[] };

      const result = await evaluate<Input, PricesOutput>({
        executor: async () => ({
          output: { prices: [105, 200] },
        }),
        comparators: {},  // No comparator for prices
        testCases: [{
          input: { id: 1 },
          expected: { prices: [100, 200] },
        }],
      });

      // Without comparator, nothing is compared, so it passes
      expect(result.testCases[0].passed).toBe(true);
      expect(result.testCases[0].fields).toEqual({});
    });
  });

  describe('perTestThreshold', () => {
    it('passes when passRate meets threshold', async () => {
      const result = await evaluate<Input, { a: number; b: number }>({
        executor: async () => ({ output: { a: 1, b: 999 } }),
        comparators: { a: exact, b: exact },
        testCases: [{ input: { id: 1 }, expected: { a: 1, b: 2 } }],
        perTestThreshold: 0.5,  // 50% threshold - only need 1 of 2 fields
      });

      // 1 of 2 fields passed = 50% >= 50% threshold
      expect(result.testCases[0].passed).toBe(true);
      expect(result.testCases[0].passRate).toBe(0.5);
    });

    it('fails when passRate is below threshold', async () => {
      const result = await evaluate<Input, { a: number; b: number; c: number }>({
        executor: async () => ({ output: { a: 1, b: 999, c: 999 } }),
        comparators: { a: exact, b: exact, c: exact },
        testCases: [{ input: { id: 1 }, expected: { a: 1, b: 2, c: 3 } }],
        perTestThreshold: 0.5,  // 50% threshold - need 2 of 3 fields
      });

      // 1 of 3 fields passed = 33% < 50% threshold
      expect(result.testCases[0].passed).toBe(false);
      expect(result.testCases[0].passRate).toBeCloseTo(0.333, 2);
    });

    it('defaults to 1.0 (all fields must pass) when not specified', async () => {
      const result = await evaluate<Input, { a: number; b: number }>({
        executor: async () => ({ output: { a: 1, b: 999 } }),
        comparators: { a: exact, b: exact },
        testCases: [{ input: { id: 1 }, expected: { a: 1, b: 2 } }],
        // perTestThreshold not specified - defaults to 1.0
      });

      expect(result.testCases[0].passed).toBe(false);
    });

    it('passes with 0.0 threshold even when all fields fail', async () => {
      const result = await evaluate<Input, { a: number; b: number }>({
        executor: async () => ({ output: { a: 999, b: 999 } }),
        comparators: { a: exact, b: exact },
        testCases: [{ input: { id: 1 }, expected: { a: 1, b: 2 } }],
        perTestThreshold: 0.0,  // 0% threshold - always passes
      });

      expect(result.testCases[0].passed).toBe(true);
      expect(result.testCases[0].passRate).toBe(0);
    });

    it('calculates overall successRate correctly with threshold', async () => {
      const result = await evaluate<Input, { a: number; b: number }>({
        executor: mock([
          { a: 1, b: 2 },  // Both match
          { a: 1, b: 999 },  // Only a matches = 50%
          { a: 999, b: 999 },  // Neither matches
        ]),
        comparators: { a: exact, b: exact },
        testCases: [
          { input: { id: 1 }, expected: { a: 1, b: 2 } },
          { input: { id: 2 }, expected: { a: 1, b: 2 } },
          { input: { id: 3 }, expected: { a: 1, b: 2 } },
        ],
        perTestThreshold: 0.5,
      });

      // Test 1: 100% >= 50% = pass
      // Test 2: 50% >= 50% = pass
      // Test 3: 0% < 50% = fail
      expect(result.passed).toBe(2);
      expect(result.successRate).toBeCloseTo(0.666, 2);
    });
  });

  describe('root-level primitives', () => {
    it('auto-applies exact to root-level primitive arrays', async () => {
      const result = await evaluate<Input, number[]>({
        executor: async () => ({ output: [1, 2, 3] }),
        comparators: {},
        testCases: [{ input: { id: 1 }, expected: [1, 2, 3] }],
      });

      expect(result.testCases[0].passed).toBe(true);
      expect(result.testCases[0].totalFields).toBe(3);
    });

    it('fails when root-level primitive arrays differ', async () => {
      const result = await evaluate<Input, number[]>({
        executor: async () => ({ output: [1, 2, 999] }),
        comparators: {},
        testCases: [{ input: { id: 1 }, expected: [1, 2, 3] }],
      });

      expect(result.testCases[0].passed).toBe(false);
    });

    it('fails when root-level primitive array has missing elements', async () => {
      const result = await evaluate<Input, number[]>({
        executor: async () => ({ output: [1, 2] }),
        comparators: {},
        testCases: [{ input: { id: 1 }, expected: [1, 2, 3] }],
      });

      expect(result.testCases[0].passed).toBe(false);
      expect(result.testCases[0].fields['[2]'].passed).toBe(false);
      expect(result.testCases[0].fields['[2]'].actual).toBeUndefined();
    });

    it('uses function comparator for primitive arrays', async () => {
      const result = await evaluate<Input, number[]>({
        executor: async () => ({ output: [105, 210] }),
        comparators: within({ tolerance: 0.1 }),
        testCases: [{ input: { id: 1 }, expected: [100, 200] }],
      });

      expect(result.testCases[0].passed).toBe(true);
    });

    it('auto-applies exact to root-level single primitive', async () => {
      const result = await evaluate<Input, number>({
        executor: async () => ({ output: 42 }),
        comparators: {},
        testCases: [{ input: { id: 1 }, expected: 42 }],
      });

      expect(result.testCases[0].passed).toBe(true);
      expect(result.testCases[0].totalFields).toBe(1);
    });

    it('fails when root-level single primitives differ', async () => {
      const result = await evaluate<Input, number>({
        executor: async () => ({ output: 999 }),
        comparators: {},
        testCases: [{ input: { id: 1 }, expected: 42 }],
      });

      expect(result.testCases[0].passed).toBe(false);
    });
  });

  describe('field key naming', () => {
    it('uses simple field names for flat objects', async () => {
      const result = await evaluate<Input, { name: string; age: number }>({
        executor: async () => ({ output: { name: 'John', age: 30 } }),
        comparators: { name: exact, age: exact },
        testCases: [{ input: { id: 1 }, expected: { name: 'John', age: 30 } }],
      });

      expect(result.testCases[0].fields).toHaveProperty('name');
      expect(result.testCases[0].fields).toHaveProperty('age');
    });

    it('uses dot notation for nested objects', async () => {
      type NestedOutput = { user: { name: string; profile: { bio: string } } };

      const result = await evaluate<Input, NestedOutput>({
        executor: async () => ({
          output: { user: { name: 'John', profile: { bio: 'Hello' } } },
        }),
        comparators: { name: exact, bio: exact },
        testCases: [{
          input: { id: 1 },
          expected: { user: { name: 'John', profile: { bio: 'Hello' } } },
        }],
      });

      expect(result.testCases[0].fields).toHaveProperty('user.name');
      expect(result.testCases[0].fields).toHaveProperty('user.profile.bio');
    });

    it('uses bracket notation for array indices', async () => {
      type ArrayOutput = { items: { id: number }[] };

      const result = await evaluate<Input, ArrayOutput>({
        executor: async () => ({
          output: { items: [{ id: 1 }, { id: 2 }] },
        }),
        comparators: { id: exact },
        testCases: [{
          input: { id: 1 },
          expected: { items: [{ id: 1 }, { id: 2 }] },
        }],
      });

      const fieldKeys = Object.keys(result.testCases[0].fields);
      expect(fieldKeys).toContain('items[0].id');
      expect(fieldKeys).toContain('items[1].id');
    });
  });
});
