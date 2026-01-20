import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      messages: {
        stream: vi.fn().mockImplementation(() => ({
          finalMessage: vi.fn().mockResolvedValue({
            content: [{ type: 'text', text: 'mocked patch response' }],
            usage: { input_tokens: 100, output_tokens: 50 },
          }),
        })),
      },
    })),
  };
});

// Mock the OpenAI SDK
vi.mock('openai', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: 'mocked patch response' } }],
            usage: { prompt_tokens: 100, completion_tokens: 50 },
          }),
        },
      },
    })),
  };
});

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
  // Providers
  LLMProviders,
} from '../index.js';


describe('index exports', () => {
  // Suppress console logs during tests
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  describe('optimize integration', () => {
    it('didactic.eval routes to optimizer when optimize config provided', async () => {
      const result = await didactic.eval({
        executor: mock([{ value: 1 }]),
        comparators: { value: exact },
        testCases: [{ input: { id: 1 }, expected: { value: 1 } }],
        optimize: {
          systemPrompt: 'test',
          targetSuccessRate: 1.0,
          apiKey: 'test-key',
          provider: LLMProviders.anthropic_claude_sonnet,
        },
      });
      // OptimizeResult has success, finalPrompt, iterations
      expect(result.success).toBe(true);
      expect(result.finalPrompt).toBeDefined();
      expect(result.iterations).toBeDefined();
    });

    it('didactic.optimize calls optimizer directly', async () => {
      const result = await didactic.optimize(
        {
          executor: mock([{ value: 1 }]),
          comparators: { value: exact },
          testCases: [{ input: { id: 1 }, expected: { value: 1 } }],
        },
        {
          systemPrompt: 'test',
          targetSuccessRate: 1.0,
          apiKey: 'test-key',
          provider: LLMProviders.anthropic_claude_sonnet,
        }
      );
      expect(result.success).toBe(true);
      expect(result.finalPrompt).toBeDefined();
    });
  });
});
