import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { optimize } from '../src/optimizer/optimizer.js';
import { exact } from '../src/comparators.js';
import { mock } from '../src/executors.js';
import { LLMProviders } from '../src/types.js';
import type { EvalConfig, OptimizeConfig } from '../src/types.js';

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

// Suppress console logs during tests
beforeEach(() => {
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

    it('throws when systemPrompt is missing', async () => {
      await expect(
        optimize(baseEvalConfig, {
          systemPrompt: '',
          targetSuccessRate: 0.9,
          apiKey: 'test-key',
          provider: LLMProviders.anthropic_claude_sonnet,
        })
      ).rejects.toThrow('systemPrompt is required');
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
    it('works with Anthropic provider', async () => {
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

      expect(result.success).toBe(true);
    });

    it('works with OpenAI provider', async () => {
      const evalConfig: EvalConfig<Input, Output> = {
        executor: mock([{ value: 1 }]),
        comparators: { value: exact },
        testCases: [{ input: { id: 1 }, expected: { value: 1 } }],
      };

      const optimizeConfig: OptimizeConfig = {
        systemPrompt: 'test prompt',
        targetSuccessRate: 1.0,
        apiKey: 'test-key',
        provider: LLMProviders.openai_gpt5,
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
          // First call: 50% pass, Second call: 0% pass (regression)
          if (callCount === 1) {
            return { output: { value: 1 } };
          }
          return { output: { value: 999 } };
        },
        comparators: { value: exact },
        testCases: [{ input: { id: 1 }, expected: { value: 1 } }],
      };

      const optimizeConfig: OptimizeConfig = {
        systemPrompt: 'initial prompt',
        targetSuccessRate: 1.0,
        apiKey: 'test-key',
        provider: LLMProviders.anthropic_claude_sonnet,
        maxIterations: 2,
      };

      const result = await optimize(evalConfig, optimizeConfig);

      // Should return the initial prompt since it performed better
      expect(result.finalPrompt).toBe('initial prompt');
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
});
