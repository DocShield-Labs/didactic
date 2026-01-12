import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { optimize } from '../optimizer.js';
import { exact } from '../../eval/comparators/comparators.js';
import { mock } from '../../eval/executors.js';
import { LLMProviders } from '../../types.js';
import type { EvalConfig, OptimizeConfig } from '../../types.js';
import * as fs from 'fs';

// External mock references (can be controlled per-test)
const mockAnthropicStream = vi.fn();
const mockOpenAICreate = vi.fn();

// Mock the Anthropic SDK (class-based pattern matching llm-client.test.ts)
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { stream: mockAnthropicStream };
  },
}));

// Mock the OpenAI SDK (class-based pattern)
vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = { completions: { create: mockOpenAICreate } };
  },
}));

// Mock fs module for storeLogs tests
vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();

  // Default Anthropic mock - returns successful LLM response
  mockAnthropicStream.mockReturnValue({
    finalMessage: () =>
      Promise.resolve({
        content: [{ type: 'text', text: 'mocked patch response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
  });

  // Default OpenAI mock
  mockOpenAICreate.mockResolvedValue({
    choices: [{ message: { content: 'mocked patch response' } }],
    usage: { prompt_tokens: 100, completion_tokens: 50 },
  });

  // Suppress console logs
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

type Input = { id: number };
type Output = { value: number };

describe('optimize', () => {
  describe('validation', () => {
    const baseEvalConfig: EvalConfig<Input, Output> = {
      executor: mock([{ value: 1 }]),
      comparators: { value: exact },
      testCases: [{ input: { id: 1 }, expected: { value: 1 } }],
    };

    it('throws when apiKey is missing', async () => {
      await expect(
        optimize(baseEvalConfig, {
          systemPrompt: 'test prompt',
          targetSuccessRate: 0.9,
          apiKey: '',
          provider: LLMProviders.anthropic_claude_sonnet,
        })
      ).rejects.toThrow('apiKey is required');
    });

    it('throws when targetSuccessRate is below 0', async () => {
      await expect(
        optimize(baseEvalConfig, {
          systemPrompt: 'test prompt',
          targetSuccessRate: -0.1,
          apiKey: 'test-key',
          provider: LLMProviders.anthropic_claude_sonnet,
        })
      ).rejects.toThrow('targetSuccessRate must be between 0 and 1');
    });

    it('throws when targetSuccessRate is above 1', async () => {
      await expect(
        optimize(baseEvalConfig, {
          systemPrompt: 'test prompt',
          targetSuccessRate: 1.5,
          apiKey: 'test-key',
          provider: LLMProviders.anthropic_claude_sonnet,
        })
      ).rejects.toThrow('targetSuccessRate must be between 0 and 1');
    });
  });

  describe('successful optimization', () => {
    it('returns success immediately when target is already met', async () => {
      const evalConfig: EvalConfig<Input, Output> = {
        executor: mock([{ value: 1 }]),
        comparators: { value: exact },
        testCases: [{ input: { id: 1 }, expected: { value: 1 } }],
      };

      const optimizeConfig: OptimizeConfig = {
        systemPrompt: 'test prompt',
        targetSuccessRate: 1.0,
        apiKey: 'test-key',
        provider: LLMProviders.anthropic_claude_sonnet,
        maxIterations: 5,
      };

      const result = await optimize(evalConfig, optimizeConfig);

      expect(result.success).toBe(true);
      expect(result.finalPrompt).toBe('test prompt');
      expect(result.iterations.length).toBe(1);
    });

    it('returns success when no failures exist', async () => {
      const evalConfig: EvalConfig<Input, Output> = {
        executor: mock([{ value: 1 }, { value: 2 }]),
        comparators: { value: exact },
        testCases: [
          { input: { id: 1 }, expected: { value: 1 } },
          { input: { id: 2 }, expected: { value: 2 } },
        ],
      };

      const optimizeConfig: OptimizeConfig = {
        systemPrompt: 'test prompt',
        targetSuccessRate: 1.0,
        apiKey: 'test-key',
        provider: LLMProviders.anthropic_claude_sonnet,
        maxIterations: 5,
      };

      const result = await optimize(evalConfig, optimizeConfig);

      expect(result.success).toBe(true);
      expect(result.iterations.length).toBe(1);
    });
  });

  describe('iteration limits', () => {
    it('stops at maxIterations', async () => {
      // Executor always returns wrong value, so optimization keeps trying
      const evalConfig: EvalConfig<Input, Output> = {
        executor: mock([{ value: 999 }]),
        comparators: { value: exact },
        testCases: [{ input: { id: 1 }, expected: { value: 1 } }],
      };

      const optimizeConfig: OptimizeConfig = {
        systemPrompt: 'test prompt',
        targetSuccessRate: 1.0,
        apiKey: 'test-key',
        provider: LLMProviders.anthropic_claude_sonnet,
        maxIterations: 3,
      };

      const result = await optimize(evalConfig, optimizeConfig);

      expect(result.success).toBe(false);
      expect(result.iterations.length).toBe(3);
    });

    it('defaults to 5 iterations when no limits set', async () => {
      const evalConfig: EvalConfig<Input, Output> = {
        executor: mock([{ value: 999 }]),
        comparators: { value: exact },
        testCases: [{ input: { id: 1 }, expected: { value: 1 } }],
      };

      const optimizeConfig: OptimizeConfig = {
        systemPrompt: 'test prompt',
        targetSuccessRate: 1.0,
        apiKey: 'test-key',
        provider: LLMProviders.anthropic_claude_sonnet,
        // maxIterations not set, maxCost not set
      };

      const result = await optimize(evalConfig, optimizeConfig);

      expect(result.success).toBe(false);
      expect(result.iterations.length).toBe(5);
    });
  });

  describe('cost tracking', () => {
    it('stops when maxCost is exceeded', async () => {
      // Executor always returns wrong value
      const evalConfig: EvalConfig<Input, Output> = {
        executor: async () => ({ output: { value: 999 }, cost: 0.5 }), // High eval cost
        comparators: { value: exact },
        testCases: [{ input: { id: 1 }, expected: { value: 1 } }],
      };

      const optimizeConfig: OptimizeConfig = {
        systemPrompt: 'test prompt',
        targetSuccessRate: 1.0,
        apiKey: 'test-key',
        provider: LLMProviders.anthropic_claude_sonnet,
        maxCost: 0.01, // Very low cost limit
      };

      const result = await optimize(evalConfig, optimizeConfig);

      expect(result.success).toBe(false);
      // Should stop early due to cost limit
      expect(result.iterations.length).toBeLessThanOrEqual(2);
    });

    it('tracks totalCost across iterations', async () => {
      const evalConfig: EvalConfig<Input, Output> = {
        executor: mock([{ value: 1 }]),
        comparators: { value: exact },
        testCases: [{ input: { id: 1 }, expected: { value: 1 } }],
      };

      const optimizeConfig: OptimizeConfig = {
        systemPrompt: 'test prompt',
        targetSuccessRate: 1.0,
        apiKey: 'test-key',
        provider: LLMProviders.anthropic_claude_sonnet,
        maxIterations: 1,
      };

      const result = await optimize(evalConfig, optimizeConfig);

      expect(result.totalCost).toBeGreaterThanOrEqual(0);
    });
  });

  describe('result structure', () => {
    it('returns finalPrompt as best performing prompt', async () => {
      const evalConfig: EvalConfig<Input, Output> = {
        executor: mock([{ value: 1 }]),
        comparators: { value: exact },
        testCases: [{ input: { id: 1 }, expected: { value: 1 } }],
      };

      const optimizeConfig: OptimizeConfig = {
        systemPrompt: 'initial prompt',
        targetSuccessRate: 1.0,
        apiKey: 'test-key',
        provider: LLMProviders.anthropic_claude_sonnet,
      };

      const result = await optimize(evalConfig, optimizeConfig);

      expect(result.finalPrompt).toBeDefined();
      expect(typeof result.finalPrompt).toBe('string');
    });

    it('includes iteration details with test case results', async () => {
      const evalConfig: EvalConfig<Input, Output> = {
        executor: mock([{ value: 1 }]),
        comparators: { value: exact },
        testCases: [{ input: { id: 1 }, expected: { value: 1 } }],
      };

      const optimizeConfig: OptimizeConfig = {
        systemPrompt: 'test prompt',
        targetSuccessRate: 1.0,
        apiKey: 'test-key',
        provider: LLMProviders.anthropic_claude_sonnet,
      };

      const result = await optimize(evalConfig, optimizeConfig);

      expect(result.iterations.length).toBeGreaterThan(0);
      const firstIteration = result.iterations[0];
      expect(firstIteration.iteration).toBe(1);
      expect(firstIteration.systemPrompt).toBeDefined();
      expect(firstIteration.passed).toBeDefined();
      expect(firstIteration.total).toBeDefined();
      expect(firstIteration.testCases).toBeDefined();
      expect(firstIteration.cost).toBeDefined();
    });
  });

  describe('provider support', () => {
    it.each([
      ['Anthropic', LLMProviders.anthropic_claude_sonnet],
      ['OpenAI', LLMProviders.openai_gpt5],
    ])('works with %s provider', async (_name, provider) => {
      const evalConfig: EvalConfig<Input, Output> = {
        executor: mock([{ value: 1 }]),
        comparators: { value: exact },
        testCases: [{ input: { id: 1 }, expected: { value: 1 } }],
      };

      const optimizeConfig: OptimizeConfig = {
        systemPrompt: 'test prompt',
        targetSuccessRate: 1.0,
        apiKey: 'test-key',
        provider,
      };

      const result = await optimize(evalConfig, optimizeConfig);

      expect(result.success).toBe(true);
    });
  });

  describe('regression handling', () => {
    it('keeps best prompt when regression occurs', async () => {
      let callCount = 0;
      const evalConfig: EvalConfig<Input, Output> = {
        executor: async () => {
          callCount++;
          // Iteration 1: calls 1-2 -> first passes, second fails (50%)
          // Iteration 2: calls 3-4 -> both fail (0% - regression!)
          if (callCount <= 2) {
            return { output: { value: callCount === 1 ? 1 : 999 } };
          }
          return { output: { value: 999 } };
        },
        comparators: { value: exact },
        testCases: [
          { input: { id: 1 }, expected: { value: 1 } },
          { input: { id: 2 }, expected: { value: 2 } },
        ],
      };

      const optimizeConfig: OptimizeConfig = {
        systemPrompt: 'initial prompt',
        targetSuccessRate: 1.0,
        apiKey: 'test-key',
        provider: LLMProviders.anthropic_claude_sonnet,
        maxIterations: 2,
      };

      const result = await optimize(evalConfig, optimizeConfig);

      // Should return the initial prompt since iteration 1 (50%) performed better than iteration 2 (0%)
      expect(result.finalPrompt).toBe('initial prompt');
      expect(result.iterations.length).toBe(2);
    });
  });

  describe('custom system prompts', () => {
    it('accepts custom patchSystemPrompt in config', async () => {
      const evalConfig: EvalConfig<Input, Output> = {
        executor: mock([{ value: 1 }]), // Passes immediately
        comparators: { value: exact },
        testCases: [{ input: { id: 1 }, expected: { value: 1 } }],
      };

      const customPatchPrompt = 'Custom patch generation instructions';
      const optimizeConfig: OptimizeConfig = {
        systemPrompt: 'test prompt',
        targetSuccessRate: 1.0,
        apiKey: 'test-key',
        provider: LLMProviders.anthropic_claude_sonnet,
        maxIterations: 1,
        patchSystemPrompt: customPatchPrompt,
      };

      const result = await optimize(evalConfig, optimizeConfig);

      // Should complete successfully with custom prompt in config
      expect(result.success).toBe(true);
    });

    it('accepts custom mergeSystemPrompt in config', async () => {
      const evalConfig: EvalConfig<Input, Output> = {
        executor: mock([{ value: 1 }]), // Passes immediately
        comparators: { value: exact },
        testCases: [{ input: { id: 1 }, expected: { value: 1 } }],
      };

      const customMergePrompt = 'Custom merge instructions';
      const optimizeConfig: OptimizeConfig = {
        systemPrompt: 'test prompt',
        targetSuccessRate: 1.0,
        apiKey: 'test-key',
        provider: LLMProviders.anthropic_claude_sonnet,
        maxIterations: 1,
        mergeSystemPrompt: customMergePrompt,
      };

      const result = await optimize(evalConfig, optimizeConfig);

      // Should complete successfully with custom prompt in config
      expect(result.success).toBe(true);
    });

    it('accepts both custom prompts in config', async () => {
      const evalConfig: EvalConfig<Input, Output> = {
        executor: mock([{ value: 1 }]), // Passes immediately
        comparators: { value: exact },
        testCases: [{ input: { id: 1 }, expected: { value: 1 } }],
      };

      const customPatchPrompt = 'Custom patch generation';
      const customMergePrompt = 'Custom merge logic';
      const optimizeConfig: OptimizeConfig = {
        systemPrompt: 'test prompt',
        targetSuccessRate: 1.0,
        apiKey: 'test-key',
        provider: LLMProviders.anthropic_claude_sonnet,
        maxIterations: 1,
        patchSystemPrompt: customPatchPrompt,
        mergeSystemPrompt: customMergePrompt,
      };

      const result = await optimize(evalConfig, optimizeConfig);

      // Should complete successfully with both custom prompts in config
      expect(result.success).toBe(true);
    });
  });

  describe('patch and merge pipeline', () => {
    it('runs multiple iterations when failures occur', async () => {
      const evalConfig: EvalConfig<Input, Output> = {
        executor: async () => ({ output: { value: 999 } }), // Always fails
        comparators: { value: exact },
        testCases: [
          { input: { id: 1 }, expected: { value: 1 } },
          { input: { id: 2 }, expected: { value: 2 } },
        ],
      };

      const optimizeConfig: OptimizeConfig = {
        systemPrompt: 'initial prompt',
        targetSuccessRate: 1.0,
        apiKey: 'test-key',
        provider: LLMProviders.anthropic_claude_sonnet,
        maxIterations: 2,
      };

      const result = await optimize(evalConfig, optimizeConfig);

      expect(result.success).toBe(false);
      expect(result.iterations.length).toBe(2);
      // First iteration uses initial prompt
      expect(result.iterations[0].systemPrompt).toBe('initial prompt');
    });

    it('accumulates cost from LLM calls during optimization', async () => {
      const evalConfig: EvalConfig<Input, Output> = {
        executor: async () => ({ output: { value: 999 }, cost: 0.0001 }),
        comparators: { value: exact },
        testCases: [{ input: { id: 1 }, expected: { value: 1 } }],
      };

      const optimizeConfig: OptimizeConfig = {
        systemPrompt: 'test prompt',
        targetSuccessRate: 1.0,
        apiKey: 'test-key',
        provider: LLMProviders.anthropic_claude_sonnet,
        maxIterations: 2,
      };

      const result = await optimize(evalConfig, optimizeConfig);

      // Total cost should include eval cost from each iteration
      // With 2 iterations at 0.0001 each, minimum is 0.0002
      expect(result.totalCost).toBeGreaterThanOrEqual(0.0002);
    });

    it('stops early when cost limit is reached before completing all iterations', async () => {
      const evalConfig: EvalConfig<Input, Output> = {
        executor: async () => ({ output: { value: 999 }, cost: 0.5 }), // High cost per eval
        comparators: { value: exact },
        testCases: [{ input: { id: 1 }, expected: { value: 1 } }],
      };

      const optimizeConfig: OptimizeConfig = {
        systemPrompt: 'test prompt',
        targetSuccessRate: 1.0,
        apiKey: 'test-key',
        provider: LLMProviders.anthropic_claude_sonnet,
        maxCost: 0.6, // Allows 1 eval, but not much more
        maxIterations: 10,
      };

      const result = await optimize(evalConfig, optimizeConfig);

      expect(result.success).toBe(false);
      // Should stop before all 10 iterations due to cost limit
      expect(result.iterations.length).toBeLessThan(10);
    });

    it('handles multiple failures in a single iteration', async () => {
      const evalConfig: EvalConfig<Input, Output> = {
        executor: async () => ({ output: { value: 999 } }), // All fail
        comparators: { value: exact },
        testCases: [
          { input: { id: 1 }, expected: { value: 1 } },
          { input: { id: 2 }, expected: { value: 2 } },
          { input: { id: 3 }, expected: { value: 3 } },
        ],
      };

      const optimizeConfig: OptimizeConfig = {
        systemPrompt: 'test prompt',
        targetSuccessRate: 1.0,
        apiKey: 'test-key',
        provider: LLMProviders.anthropic_claude_sonnet,
        maxIterations: 1,
      };

      const result = await optimize(evalConfig, optimizeConfig);

      expect(result.success).toBe(false);
      expect(result.iterations.length).toBe(1);
      // All 3 test cases should be recorded
      expect(result.iterations[0].testCases.length).toBe(3);
      expect(result.iterations[0].passed).toBe(0);
      expect(result.iterations[0].total).toBe(3);
    });
  });

  describe('storeLogs', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('writes logs to disk when storeLogs is true', async () => {
      const evalConfig: EvalConfig<Input, Output> = {
        executor: mock([{ value: 1 }]),
        comparators: { value: exact },
        testCases: [{ input: { id: 1 }, expected: { value: 1 } }],
      };

      const optimizeConfig: OptimizeConfig = {
        systemPrompt: 'test prompt',
        targetSuccessRate: 1.0,
        apiKey: 'test-key',
        provider: LLMProviders.anthropic_claude_sonnet,
        storeLogs: true,
      };

      const result = await optimize(evalConfig, optimizeConfig);

      expect(result.success).toBe(true);
      expect(result.logFolder).toBeDefined();
      expect(result.logFolder).toContain('didactic-logs');
      expect(fs.mkdirSync).toHaveBeenCalled();
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('writes logs to custom path when storeLogs is a string', async () => {
      const evalConfig: EvalConfig<Input, Output> = {
        executor: mock([{ value: 1 }]),
        comparators: { value: exact },
        testCases: [{ input: { id: 1 }, expected: { value: 1 } }],
      };

      const customPath = './custom-logs/my-report.md';
      const optimizeConfig: OptimizeConfig = {
        systemPrompt: 'test prompt',
        targetSuccessRate: 1.0,
        apiKey: 'test-key',
        provider: LLMProviders.anthropic_claude_sonnet,
        storeLogs: customPath,
      };

      const result = await optimize(evalConfig, optimizeConfig);

      expect(result.success).toBe(true);
      expect(result.logFolder).toBe('./custom-logs');
    });

    it('does not write logs when storeLogs is not set', async () => {
      const evalConfig: EvalConfig<Input, Output> = {
        executor: mock([{ value: 1 }]),
        comparators: { value: exact },
        testCases: [{ input: { id: 1 }, expected: { value: 1 } }],
      };

      const optimizeConfig: OptimizeConfig = {
        systemPrompt: 'test prompt',
        targetSuccessRate: 1.0,
        apiKey: 'test-key',
        provider: LLMProviders.anthropic_claude_sonnet,
        // storeLogs not set
      };

      const result = await optimize(evalConfig, optimizeConfig);

      expect(result.success).toBe(true);
      expect(result.logFolder).toBeUndefined();
    });

    it('writes intermediate logs during iteration when storeLogs enabled and tests fail', async () => {
      const evalConfig: EvalConfig<Input, Output> = {
        executor: async () => ({ output: { value: 999 } }), // Always fails
        comparators: { value: exact },
        testCases: [{ input: { id: 1 }, expected: { value: 1 } }],
      };

      const optimizeConfig: OptimizeConfig = {
        systemPrompt: 'test prompt',
        targetSuccessRate: 1.0,
        apiKey: 'test-key',
        provider: LLMProviders.anthropic_claude_sonnet,
        maxIterations: 2,
        storeLogs: true,
      };

      const result = await optimize(evalConfig, optimizeConfig);

      expect(result.success).toBe(false);
      expect(result.logFolder).toBeDefined();
      // writeFileSync should be called multiple times (intermediate + final logs)
      expect(fs.writeFileSync).toHaveBeenCalled();
    });
  });

  describe('patch generation failures', () => {
    it('continues to next iteration when all patches fail', async () => {
      // Configure LLM to reject (fail patch generation)
      mockAnthropicStream.mockReturnValue({
        finalMessage: () => Promise.reject(new Error('LLM call failed')),
      });

      const evalConfig: EvalConfig<Input, Output> = {
        executor: async () => ({ output: { value: 999 } }), // Always fails
        comparators: { value: exact },
        testCases: [{ input: { id: 1 }, expected: { value: 1 } }],
      };

      const optimizeConfig: OptimizeConfig = {
        systemPrompt: 'test',
        targetSuccessRate: 1.0,
        apiKey: 'test-key',
        provider: LLMProviders.anthropic_claude_sonnet,
        maxIterations: 2,
      };

      const result = await optimize(evalConfig, optimizeConfig);

      expect(result.success).toBe(false);
      // Should complete both iterations even though patches failed
      expect(result.iterations.length).toBe(2);
    });

    it('logs failures when some patches fail but others succeed', async () => {
      let callCount = 0;
      // First call fails, subsequent calls succeed
      mockAnthropicStream.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return {
            finalMessage: () => Promise.reject(new Error('First patch failed')),
          };
        }
        return {
          finalMessage: () =>
            Promise.resolve({
              content: [{ type: 'text', text: 'successful patch' }],
              usage: { input_tokens: 100, output_tokens: 50 },
            }),
        };
      });

      const evalConfig: EvalConfig<Input, Output> = {
        executor: async () => ({ output: { value: 999 } }), // Always fails
        comparators: { value: exact },
        testCases: [
          { input: { id: 1 }, expected: { value: 1 } },
          { input: { id: 2 }, expected: { value: 2 } },
        ],
      };

      const optimizeConfig: OptimizeConfig = {
        systemPrompt: 'test',
        targetSuccessRate: 1.0,
        apiKey: 'test-key',
        provider: LLMProviders.anthropic_claude_sonnet,
        maxIterations: 1,
      };

      const result = await optimize(evalConfig, optimizeConfig);

      expect(result.success).toBe(false);
      expect(result.iterations.length).toBe(1);
    });
  });

  describe('cost limit edge cases', () => {
    it('stops after patches when cost limit reached before merge', async () => {
      // Configure high-cost LLM responses to hit limit after patches
      mockAnthropicStream.mockReturnValue({
        finalMessage: () =>
          Promise.resolve({
            content: [{ type: 'text', text: 'expensive patch' }],
            usage: { input_tokens: 100000, output_tokens: 50000 }, // Very high tokens
          }),
      });

      const evalConfig: EvalConfig<Input, Output> = {
        executor: async () => ({ output: { value: 999 }, cost: 0.01 }),
        comparators: { value: exact },
        testCases: [{ input: { id: 1 }, expected: { value: 1 } }],
      };

      const optimizeConfig: OptimizeConfig = {
        systemPrompt: 'test',
        targetSuccessRate: 1.0,
        apiKey: 'test-key',
        provider: LLMProviders.anthropic_claude_sonnet,
        maxCost: 1.0, // Will be exceeded by expensive patches
        maxIterations: 10,
      };

      const result = await optimize(evalConfig, optimizeConfig);

      expect(result.success).toBe(false);
      // Should stop in first iteration due to cost
      expect(result.iterations.length).toBe(1);
    });

    it('stops after merge when cost limit reached', async () => {
      // Configure moderate-cost LLM responses
      mockAnthropicStream.mockReturnValue({
        finalMessage: () =>
          Promise.resolve({
            content: [{ type: 'text', text: 'moderate patch' }],
            usage: { input_tokens: 10000, output_tokens: 5000 },
          }),
      });

      const evalConfig: EvalConfig<Input, Output> = {
        executor: async () => ({ output: { value: 999 }, cost: 0.001 }),
        comparators: { value: exact },
        testCases: [{ input: { id: 1 }, expected: { value: 1 } }],
      };

      const optimizeConfig: OptimizeConfig = {
        systemPrompt: 'test',
        targetSuccessRate: 1.0,
        apiKey: 'test-key',
        provider: LLMProviders.anthropic_claude_sonnet,
        maxCost: 0.15, // Will be exceeded after merge completes
        maxIterations: 10,
      };

      const result = await optimize(evalConfig, optimizeConfig);

      expect(result.success).toBe(false);
      // Should stop after first full iteration (including merge)
      expect(result.iterations.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('merge failure handling', () => {
    it('throws when merge fails (current behavior - potential improvement area)', async () => {
      let llmCallCount = 0;
      // First calls succeed (for patches), then merge fails
      mockAnthropicStream.mockImplementation(() => {
        llmCallCount++;
        // Fail on the 2nd call (merge call after 1 patch)
        if (llmCallCount === 2) {
          return {
            finalMessage: () => Promise.reject(new Error('Merge LLM call failed')),
          };
        }
        return {
          finalMessage: () =>
            Promise.resolve({
              content: [{ type: 'text', text: 'patch response' }],
              usage: { input_tokens: 100, output_tokens: 50 },
            }),
        };
      });

      const evalConfig: EvalConfig<Input, Output> = {
        executor: async () => ({ output: { value: 999 } }), // Always fails
        comparators: { value: exact },
        testCases: [{ input: { id: 1 }, expected: { value: 1 } }],
      };

      const optimizeConfig: OptimizeConfig = {
        systemPrompt: 'test',
        targetSuccessRate: 1.0,
        apiKey: 'test-key',
        provider: LLMProviders.anthropic_claude_sonnet,
        maxIterations: 2,
      };

      // Currently, merge failures throw instead of being handled gracefully
      // This documents current behavior - could be improved to handle gracefully
      await expect(optimize(evalConfig, optimizeConfig)).rejects.toThrow(
        'Merge LLM call failed'
      );
    });
  });

  describe('regression context', () => {
    it('tracks best prompt across iterations', async () => {
      let callCount = 0;
      const evalConfig: EvalConfig<Input, Output> = {
        executor: async () => {
          callCount++;
          // First iteration: 50% pass (1 of 2)
          // Second iteration: 0% pass (0 of 2) - regression
          if (callCount <= 2) {
            return { output: { value: callCount === 1 ? 1 : 999 } };
          }
          return { output: { value: 999 } };
        },
        comparators: { value: exact },
        testCases: [
          { input: { id: 1 }, expected: { value: 1 } },
          { input: { id: 2 }, expected: { value: 2 } },
        ],
      };

      const optimizeConfig: OptimizeConfig = {
        systemPrompt: 'initial prompt',
        targetSuccessRate: 1.0,
        apiKey: 'test-key',
        provider: LLMProviders.anthropic_claude_sonnet,
        maxIterations: 2,
      };

      const result = await optimize(evalConfig, optimizeConfig);

      // Should return initial prompt since it performed better (50% > 0%)
      expect(result.finalPrompt).toBe('initial prompt');
      expect(result.iterations.length).toBe(2);
      // First iteration should have 1 pass, second should have 0
      expect(result.iterations[0].passed).toBe(1);
    });
  });
});
