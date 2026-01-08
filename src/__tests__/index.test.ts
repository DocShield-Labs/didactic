import { describe, it, expect } from 'vitest';

// Import everything from the package
import {
  // Namespace
  didactic,
  // Comparators
  within,
  oneOf,
  presence,
  custom,
  exact,
  contains,
  numeric,
  date,
  name,
  // Executors
  endpoint,
  fn,
  mock,
  // Eval
  evaluate,
} from '../index.js';

// Import types to verify they're exported
import type {
  Comparator,
  ComparatorContext,
  ComparatorResult,
  Executor,
  ExecutorResult,
  TestCase,
  EvalConfig,
  EvalResult,
  OptimizeResult,
  EndpointConfig,
  FnConfig,
} from '../index.js';

describe('index exports', () => {
  describe('comparators', () => {
    it('exports within comparator', () => {
      expect(typeof within).toBe('function');
      const comparator = within({ tolerance: 0.1 });
      expect(typeof comparator).toBe('function');
    });

    it('exports oneOf comparator', () => {
      expect(typeof oneOf).toBe('function');
      const comparator = oneOf(['a', 'b', 'c']);
      expect(typeof comparator).toBe('function');
    });

    it('exports presence comparator', () => {
      expect(typeof presence).toBe('function');
      expect(presence('value', 'value').passed).toBe(true);
    });

    it('exports custom comparator factory', () => {
      expect(typeof custom).toBe('function');
      const comparator = custom({ compare: (a, b) => a === b });
      expect(typeof comparator).toBe('function');
    });

    it('exports exact comparator', () => {
      expect(typeof exact).toBe('function');
      expect(exact(1, 1).passed).toBe(true);
    });

    it('exports contains comparator', () => {
      expect(typeof contains).toBe('function');
      const comparator = contains('hello');
      expect(typeof comparator).toBe('function');
    });

    it('exports numeric comparator with nullable variant', () => {
      expect(typeof numeric).toBe('function');
      expect(typeof numeric.nullable).toBe('function');
      expect(numeric('$100', '$100').passed).toBe(true);
    });

    it('exports date comparator', () => {
      expect(typeof date).toBe('function');
      expect(date('2024-01-15', 'January 15, 2024').passed).toBe(true);
    });

    it('exports name comparator', () => {
      expect(typeof name).toBe('function');
      expect(name('John Smith', 'john smith').passed).toBe(true);
    });
  });

  describe('executors', () => {
    it('exports endpoint executor factory', () => {
      expect(typeof endpoint).toBe('function');
    });

    it('exports fn executor factory', () => {
      expect(typeof fn).toBe('function');
    });

    it('exports mock executor factory', () => {
      expect(typeof mock).toBe('function');
    });
  });

  describe('evaluate function', () => {
    it('exports evaluate function', () => {
      expect(typeof evaluate).toBe('function');
    });
  });

  describe('didactic namespace', () => {
    it('provides eval method', () => {
      expect(typeof didactic.eval).toBe('function');
    });

    it('provides endpoint method', () => {
      expect(typeof didactic.endpoint).toBe('function');
    });

    it('provides fn method', () => {
      expect(typeof didactic.fn).toBe('function');
    });

    it('eval method calls evaluate with config', async () => {
      const mockExecutor = async () => ({ output: { value: 1 } });

      const result = await didactic.eval({
        executor: mockExecutor,
        comparators: { value: exact },
        testCases: [{ input: {}, expected: { value: 1 } }],
      });

      expect(result.passed).toBe(1);
      expect(result.total).toBe(1);
    });

    it('endpoint method creates HTTP executor', () => {
      const executor = didactic.endpoint('https://example.com/api');
      expect(typeof executor).toBe('function');
    });

    it('fn method wraps async function', () => {
      const executor = didactic.fn({
        fn: async (input) => ({ result: input }),
      });
      expect(typeof executor).toBe('function');
    });
  });

  describe('type exports', () => {
    // These tests verify types are exported correctly at compile time
    // The actual type checking happens during TypeScript compilation

    it('allows creating typed comparators', async () => {
      const myComparator: Comparator<number> = (expected, actual) => ({
        passed: expected === actual,
        similarity: expected === actual ? 1.0 : 0.0,
      });
      expect((await myComparator(1, 1)).passed).toBe(true);
    });

    it('allows using ComparatorContext', async () => {
      const contextAwareComparator: Comparator<number> = (
        expected,
        actual,
        _context?: ComparatorContext
      ) => {
        // context is optional
        return { passed: expected === actual };
      };
      expect((await contextAwareComparator(1, 1)).passed).toBe(true);
    });

    it('allows creating typed executors', () => {
      const myExecutor: Executor<{ id: number }, { name: string }> = async (
        input
      ) => ({
        output: { name: `User ${input.id}` },
      });
      expect(typeof myExecutor).toBe('function');
    });

    it('allows creating typed test cases', () => {
      const testCase: TestCase<{ id: number }> = {
        input: { id: 1 },
        expected: { name: 'John' },
      };
      expect(testCase.input.id).toBe(1);
    });
  });
});
