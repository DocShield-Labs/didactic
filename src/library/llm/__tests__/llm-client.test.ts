import { describe, it, expect, vi, beforeEach } from 'vitest';
import { callLLM, callStructuredLLM } from '../llm-client.js';
import { LLMProviders } from '../../../types.js';

// Create mock functions that will be controlled in tests
const mockAnthropicStream = vi.fn();
const mockAnthropicBetaStream = vi.fn();
const mockOpenAICreate = vi.fn();

// Mock Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = {
        stream: mockAnthropicStream,
      };
      beta = {
        messages: {
          stream: mockAnthropicBetaStream,
        },
      };
    },
  };
});

// Mock OpenAI SDK
vi.mock('openai', () => {
  return {
    default: class MockOpenAI {
      chat = {
        completions: {
          create: mockOpenAICreate,
        },
      };
    },
  };
});

describe('callLLM', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Anthropic provider', () => {
    it('calls Anthropic API with correct parameters', async () => {
      mockAnthropicStream.mockReturnValue({
        finalMessage: () =>
          Promise.resolve({
            content: [{ type: 'text', text: 'Test response' }],
            usage: { input_tokens: 100, output_tokens: 50 },
          }),
      });

      const result = await callLLM({
        provider: LLMProviders.anthropic_claude_haiku,
        apiKey: 'test-key',
        messages: [
          { role: 'system', content: 'You are helpful' },
          { role: 'user', content: 'Hello' },
        ],
      });

      expect(mockAnthropicStream).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 64000,
          system: 'You are helpful',
          messages: [{ role: 'user', content: 'Hello' }],
        })
      );
      expect(result.text).toBe('Test response');
      expect(result.inputTokens).toBe(100);
      expect(result.outputTokens).toBe(50);
      expect(result.cost).toBeGreaterThan(0);
    });

    it('handles messages without system prompt', async () => {
      mockAnthropicStream.mockReturnValue({
        finalMessage: () =>
          Promise.resolve({
            content: [{ type: 'text', text: 'Response' }],
            usage: { input_tokens: 50, output_tokens: 25 },
          }),
      });

      await callLLM({
        provider: LLMProviders.anthropic_claude_haiku,
        apiKey: 'test-key',
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(mockAnthropicStream).toHaveBeenCalledWith(
        expect.objectContaining({
          system: undefined,
          messages: [{ role: 'user', content: 'Hello' }],
        })
      );
    });

    it('enables thinking mode when useThinking is true', async () => {
      mockAnthropicStream.mockReturnValue({
        finalMessage: () =>
          Promise.resolve({
            content: [{ type: 'text', text: 'Thoughtful response' }],
            usage: { input_tokens: 200, output_tokens: 100 },
          }),
      });

      await callLLM({
        provider: LLMProviders.anthropic_claude_sonnet,
        apiKey: 'test-key',
        messages: [{ role: 'user', content: 'Think deeply' }],
        useThinking: true,
      });

      expect(mockAnthropicStream).toHaveBeenCalledWith(
        expect.objectContaining({
          thinking: {
            type: 'enabled',
            budget_tokens: 31999,
          },
        })
      );
    });

    it('joins multiple text blocks', async () => {
      mockAnthropicStream.mockReturnValue({
        finalMessage: () =>
          Promise.resolve({
            content: [
              { type: 'text', text: 'First block' },
              { type: 'text', text: 'Second block' },
            ],
            usage: { input_tokens: 100, output_tokens: 50 },
          }),
      });

      const result = await callLLM({
        provider: LLMProviders.anthropic_claude_haiku,
        apiKey: 'test-key',
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(result.text).toBe('First block Second block');
    });

    it('returns empty string when no text blocks', async () => {
      mockAnthropicStream.mockReturnValue({
        finalMessage: () =>
          Promise.resolve({
            content: [{ type: 'other', data: 'something' }],
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
      });

      const result = await callLLM({
        provider: LLMProviders.anthropic_claude_haiku,
        apiKey: 'test-key',
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(result.text).toBe('');
    });

    it('throws error when Anthropic API fails', async () => {
      mockAnthropicStream.mockReturnValue({
        finalMessage: () => Promise.reject(new Error('API Error')),
      });

      await expect(
        callLLM({
          provider: LLMProviders.anthropic_claude_haiku,
          apiKey: 'test-key',
          messages: [{ role: 'user', content: 'Hello' }],
        })
      ).rejects.toThrow('LLM call failed');
    });
  });

  describe('OpenAI provider', () => {
    it('calls OpenAI API with correct parameters', async () => {
      mockOpenAICreate.mockResolvedValue({
        choices: [{ message: { content: 'OpenAI response' } }],
        usage: { prompt_tokens: 80, completion_tokens: 40 },
      });

      const result = await callLLM({
        provider: LLMProviders.openai_gpt5_mini,
        apiKey: 'test-openai-key',
        messages: [
          { role: 'system', content: 'You are helpful' },
          { role: 'user', content: 'Hello' },
        ],
      });

      expect(mockOpenAICreate).toHaveBeenCalledWith({
        model: 'gpt-5-mini',
        messages: [
          { role: 'system', content: 'You are helpful' },
          { role: 'user', content: 'Hello' },
        ],
        max_completion_tokens: 32000,
      });
      expect(result.text).toBe('OpenAI response');
      expect(result.inputTokens).toBe(80);
      expect(result.outputTokens).toBe(40);
      expect(result.cost).toBeGreaterThan(0);
    });

    it('enables reasoning effort when useThinking is true', async () => {
      mockOpenAICreate.mockResolvedValue({
        choices: [{ message: { content: 'Thoughtful response' } }],
        usage: { prompt_tokens: 150, completion_tokens: 75 },
      });

      await callLLM({
        provider: LLMProviders.openai_gpt5,
        apiKey: 'test-openai-key',
        messages: [{ role: 'user', content: 'Think deeply' }],
        useThinking: true,
      });

      expect(mockOpenAICreate).toHaveBeenCalledWith(
        expect.objectContaining({
          reasoning_effort: 'xhigh',
        })
      );
    });

    it('handles empty response content', async () => {
      mockOpenAICreate.mockResolvedValue({
        choices: [{ message: { content: null } }],
        usage: { prompt_tokens: 10, completion_tokens: 0 },
      });

      const result = await callLLM({
        provider: LLMProviders.openai_gpt5_mini,
        apiKey: 'test-openai-key',
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(result.text).toBe('');
    });

    it('handles missing usage data', async () => {
      mockOpenAICreate.mockResolvedValue({
        choices: [{ message: { content: 'Response' } }],
        usage: undefined,
      });

      const result = await callLLM({
        provider: LLMProviders.openai_gpt5_mini,
        apiKey: 'test-openai-key',
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(result.inputTokens).toBe(0);
      expect(result.outputTokens).toBe(0);
    });

    it('throws error when OpenAI API fails', async () => {
      mockOpenAICreate.mockRejectedValue(new Error('Rate limit exceeded'));

      await expect(
        callLLM({
          provider: LLMProviders.openai_gpt5,
          apiKey: 'test-openai-key',
          messages: [{ role: 'user', content: 'Hello' }],
        })
      ).rejects.toThrow('LLM call failed');
    });
  });

  describe('error handling', () => {
    it('throws error for unsupported provider', async () => {
      await expect(
        callLLM({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          provider: 'unsupported_provider' as any,
          apiKey: 'test-key',
          messages: [{ role: 'user', content: 'Hello' }],
        })
      ).rejects.toThrow();
    });

    it('includes model name in error message', async () => {
      mockAnthropicStream.mockReturnValue({
        finalMessage: () => Promise.reject(new Error('Network error')),
      });

      await expect(
        callLLM({
          provider: LLMProviders.anthropic_claude_opus,
          apiKey: 'test-key',
          messages: [{ role: 'user', content: 'Hello' }],
        })
      ).rejects.toThrow('claude-opus-4-5-20251101');
    });
  });

  describe('cost calculation', () => {
    it('calculates cost correctly for Anthropic', async () => {
      mockAnthropicStream.mockReturnValue({
        finalMessage: () =>
          Promise.resolve({
            content: [{ type: 'text', text: 'Response' }],
            usage: { input_tokens: 1000, output_tokens: 500 },
          }),
      });

      const result = await callLLM({
        provider: LLMProviders.anthropic_claude_haiku,
        apiKey: 'test-key',
        messages: [{ role: 'user', content: 'Hello' }],
      });

      // Haiku: $1 per million input, $5 per million output
      // (1000 * 1 + 500 * 5) / 1,000,000 = 0.0035
      expect(result.cost).toBeCloseTo(0.0035, 6);
    });

    it('calculates cost correctly for OpenAI', async () => {
      mockOpenAICreate.mockResolvedValue({
        choices: [{ message: { content: 'Response' } }],
        usage: { prompt_tokens: 1000, completion_tokens: 500 },
      });

      const result = await callLLM({
        provider: LLMProviders.openai_gpt5_mini,
        apiKey: 'test-openai-key',
        messages: [{ role: 'user', content: 'Hello' }],
      });

      // GPT-5-mini: $0.25 per million input, $2 per million output
      // (1000 * 0.25 + 500 * 2) / 1,000,000 = 0.00125
      expect(result.cost).toBeCloseTo(0.00125, 6);
    });
  });
});

describe('callStructuredLLM', () => {
  const testSchema = {
    type: 'object',
    properties: {
      name: { type: 'string' },
      age: { type: 'number' },
    },
    required: ['name', 'age'],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Anthropic provider', () => {
    it('calls Anthropic beta API with correct parameters for structured output', async () => {
      mockAnthropicBetaStream.mockReturnValue({
        finalMessage: () =>
          Promise.resolve({
            content: [{ type: 'text', text: '{"name": "John", "age": 30}' }],
            usage: { input_tokens: 100, output_tokens: 50 },
          }),
      });

      const result = await callStructuredLLM<{ name: string; age: number }>({
        provider: LLMProviders.anthropic_claude_haiku,
        apiKey: 'test-key',
        messages: [
          { role: 'system', content: 'Extract person info' },
          { role: 'user', content: 'John is 30 years old' },
        ],
        schema: testSchema,
      });

      expect(mockAnthropicBetaStream).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 64000,
          betas: ['structured-outputs-2025-11-13'],
          system: 'Extract person info',
          messages: [{ role: 'user', content: 'John is 30 years old' }],
          output_format: {
            type: 'json_schema',
            schema: testSchema,
          },
        })
      );
      expect(result.data).toEqual({ name: 'John', age: 30 });
      expect(result.inputTokens).toBe(100);
      expect(result.outputTokens).toBe(50);
      expect(result.cost).toBeGreaterThan(0);
    });

    it('handles messages without system prompt', async () => {
      mockAnthropicBetaStream.mockReturnValue({
        finalMessage: () =>
          Promise.resolve({
            content: [{ type: 'text', text: '{"name": "Jane", "age": 25}' }],
            usage: { input_tokens: 50, output_tokens: 25 },
          }),
      });

      await callStructuredLLM<{ name: string; age: number }>({
        provider: LLMProviders.anthropic_claude_haiku,
        apiKey: 'test-key',
        messages: [{ role: 'user', content: 'Jane is 25' }],
        schema: testSchema,
      });

      expect(mockAnthropicBetaStream).toHaveBeenCalledWith(
        expect.objectContaining({
          system: undefined,
          messages: [{ role: 'user', content: 'Jane is 25' }],
        })
      );
    });

    it('enables thinking mode when useThinking is true', async () => {
      mockAnthropicBetaStream.mockReturnValue({
        finalMessage: () =>
          Promise.resolve({
            content: [{ type: 'text', text: '{"name": "Bob", "age": 40}' }],
            usage: { input_tokens: 200, output_tokens: 100 },
          }),
      });

      await callStructuredLLM<{ name: string; age: number }>({
        provider: LLMProviders.anthropic_claude_sonnet,
        apiKey: 'test-key',
        messages: [{ role: 'user', content: 'Bob is 40' }],
        schema: testSchema,
        useThinking: true,
      });

      expect(mockAnthropicBetaStream).toHaveBeenCalledWith(
        expect.objectContaining({
          thinking: {
            type: 'enabled',
            budget_tokens: 31999,
          },
        })
      );
    });

    it('throws error when response is not text type', async () => {
      mockAnthropicBetaStream.mockReturnValue({
        finalMessage: () =>
          Promise.resolve({
            content: [{ type: 'tool_use', id: 'tool1' }],
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
      });

      await expect(
        callStructuredLLM<{ name: string; age: number }>({
          provider: LLMProviders.anthropic_claude_haiku,
          apiKey: 'test-key',
          messages: [{ role: 'user', content: 'Hello' }],
          schema: testSchema,
        })
      ).rejects.toThrow('Structured LLM call failed');
    });

    it('throws error when Anthropic API fails', async () => {
      mockAnthropicBetaStream.mockReturnValue({
        finalMessage: () => Promise.reject(new Error('API Error')),
      });

      await expect(
        callStructuredLLM<{ name: string; age: number }>({
          provider: LLMProviders.anthropic_claude_haiku,
          apiKey: 'test-key',
          messages: [{ role: 'user', content: 'Hello' }],
          schema: testSchema,
        })
      ).rejects.toThrow('Structured LLM call failed');
    });

    it('throws error when JSON parsing fails', async () => {
      mockAnthropicBetaStream.mockReturnValue({
        finalMessage: () =>
          Promise.resolve({
            content: [{ type: 'text', text: 'invalid json' }],
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
      });

      await expect(
        callStructuredLLM<{ name: string; age: number }>({
          provider: LLMProviders.anthropic_claude_haiku,
          apiKey: 'test-key',
          messages: [{ role: 'user', content: 'Hello' }],
          schema: testSchema,
        })
      ).rejects.toThrow('Structured LLM call failed');
    });
  });

  describe('OpenAI provider', () => {
    it('calls OpenAI API with correct parameters for structured output', async () => {
      mockOpenAICreate.mockResolvedValue({
        choices: [{ message: { content: '{"name": "Alice", "age": 28}' } }],
        usage: { prompt_tokens: 80, completion_tokens: 40 },
      });

      const result = await callStructuredLLM<{ name: string; age: number }>({
        provider: LLMProviders.openai_gpt5_mini,
        apiKey: 'test-openai-key',
        messages: [
          { role: 'system', content: 'Extract person info' },
          { role: 'user', content: 'Alice is 28 years old' },
        ],
        schema: testSchema,
      });

      expect(mockOpenAICreate).toHaveBeenCalledWith({
        model: 'gpt-5-mini',
        messages: [
          { role: 'system', content: 'Extract person info' },
          { role: 'user', content: 'Alice is 28 years old' },
        ],
        max_completion_tokens: 32000,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'response',
            strict: true,
            schema: testSchema,
          },
        },
      });
      expect(result.data).toEqual({ name: 'Alice', age: 28 });
      expect(result.inputTokens).toBe(80);
      expect(result.outputTokens).toBe(40);
      expect(result.cost).toBeGreaterThan(0);
    });

    it('enables reasoning effort when useThinking is true', async () => {
      mockOpenAICreate.mockResolvedValue({
        choices: [{ message: { content: '{"name": "Charlie", "age": 35}' } }],
        usage: { prompt_tokens: 150, completion_tokens: 75 },
      });

      await callStructuredLLM<{ name: string; age: number }>({
        provider: LLMProviders.openai_gpt5,
        apiKey: 'test-openai-key',
        messages: [{ role: 'user', content: 'Charlie is 35' }],
        schema: testSchema,
        useThinking: true,
      });

      expect(mockOpenAICreate).toHaveBeenCalledWith(
        expect.objectContaining({
          reasoning_effort: 'xhigh',
        })
      );
    });

    it('handles empty response content', async () => {
      mockOpenAICreate.mockResolvedValue({
        choices: [{ message: { content: '' } }],
        usage: { prompt_tokens: 10, completion_tokens: 0 },
      });

      await expect(
        callStructuredLLM<{ name: string; age: number }>({
          provider: LLMProviders.openai_gpt5_mini,
          apiKey: 'test-openai-key',
          messages: [{ role: 'user', content: 'Hello' }],
          schema: testSchema,
        })
      ).rejects.toThrow('Structured LLM call failed');
    });

    it('handles null response content', async () => {
      mockOpenAICreate.mockResolvedValue({
        choices: [{ message: { content: null } }],
        usage: { prompt_tokens: 10, completion_tokens: 0 },
      });

      await expect(
        callStructuredLLM<{ name: string; age: number }>({
          provider: LLMProviders.openai_gpt5_mini,
          apiKey: 'test-openai-key',
          messages: [{ role: 'user', content: 'Hello' }],
          schema: testSchema,
        })
      ).rejects.toThrow('Structured LLM call failed');
    });

    it('handles missing usage data', async () => {
      mockOpenAICreate.mockResolvedValue({
        choices: [{ message: { content: '{"name": "Test", "age": 1}' } }],
        usage: undefined,
      });

      const result = await callStructuredLLM<{ name: string; age: number }>({
        provider: LLMProviders.openai_gpt5_mini,
        apiKey: 'test-openai-key',
        messages: [{ role: 'user', content: 'Hello' }],
        schema: testSchema,
      });

      expect(result.inputTokens).toBe(0);
      expect(result.outputTokens).toBe(0);
    });

    it('throws error when OpenAI API fails', async () => {
      mockOpenAICreate.mockRejectedValue(new Error('Rate limit exceeded'));

      await expect(
        callStructuredLLM<{ name: string; age: number }>({
          provider: LLMProviders.openai_gpt5,
          apiKey: 'test-openai-key',
          messages: [{ role: 'user', content: 'Hello' }],
          schema: testSchema,
        })
      ).rejects.toThrow('Structured LLM call failed');
    });
  });

  describe('error handling', () => {
    it('throws error for unsupported provider', async () => {
      await expect(
        callStructuredLLM<{ name: string; age: number }>({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          provider: 'unsupported_provider' as any,
          apiKey: 'test-key',
          messages: [{ role: 'user', content: 'Hello' }],
          schema: testSchema,
        })
      ).rejects.toThrow();
    });

    it('includes model name in error message', async () => {
      mockAnthropicBetaStream.mockReturnValue({
        finalMessage: () => Promise.reject(new Error('Network error')),
      });

      await expect(
        callStructuredLLM<{ name: string; age: number }>({
          provider: LLMProviders.anthropic_claude_opus,
          apiKey: 'test-key',
          messages: [{ role: 'user', content: 'Hello' }],
          schema: testSchema,
        })
      ).rejects.toThrow('claude-opus-4-5-20251101');
    });
  });

  describe('cost calculation', () => {
    it('calculates cost correctly for Anthropic structured output', async () => {
      mockAnthropicBetaStream.mockReturnValue({
        finalMessage: () =>
          Promise.resolve({
            content: [{ type: 'text', text: '{"name": "Test", "age": 1}' }],
            usage: { input_tokens: 1000, output_tokens: 500 },
          }),
      });

      const result = await callStructuredLLM<{ name: string; age: number }>({
        provider: LLMProviders.anthropic_claude_haiku,
        apiKey: 'test-key',
        messages: [{ role: 'user', content: 'Hello' }],
        schema: testSchema,
      });

      // Haiku: $1 per million input, $5 per million output
      // (1000 * 1 + 500 * 5) / 1,000,000 = 0.0035
      expect(result.cost).toBeCloseTo(0.0035, 6);
    });

    it('calculates cost correctly for OpenAI structured output', async () => {
      mockOpenAICreate.mockResolvedValue({
        choices: [{ message: { content: '{"name": "Test", "age": 1}' } }],
        usage: { prompt_tokens: 1000, completion_tokens: 500 },
      });

      const result = await callStructuredLLM<{ name: string; age: number }>({
        provider: LLMProviders.openai_gpt5_mini,
        apiKey: 'test-openai-key',
        messages: [{ role: 'user', content: 'Hello' }],
        schema: testSchema,
      });

      // GPT-5-mini: $0.25 per million input, $2 per million output
      // (1000 * 0.25 + 500 * 2) / 1,000,000 = 0.00125
      expect(result.cost).toBeCloseTo(0.00125, 6);
    });
  });
});
