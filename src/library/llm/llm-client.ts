import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import {
  PROVIDER_SPECS,
  ANTHROPIC_THINKING_BUDGET_TOKENS,
  TOKENS_PER_MILLION,
} from '../constants.js';
import type {
  CallLLMConfig,
  LLMResult,
  CallStructuredLLMConfig,
  StructuredLLMResult,
} from './types.js';

/**
 * Call an LLM provider with the given messages.
 * Returns raw text output - caller is responsible for parsing if structured output is needed.
 */
export async function callLLM(config: CallLLMConfig): Promise<LLMResult> {
  const { provider, apiKey, messages, useThinking = false } = config;
  const spec = PROVIDER_SPECS[provider];

  try {
    // Anthropic
    if (provider.startsWith('anthropic')) {
      const client = new Anthropic({ apiKey });
      const streamOptions: Parameters<typeof client.messages.stream>[0] = {
        model: spec.model,
        max_tokens: spec.maxTokens,
        system: messages.find((m) => m.role === 'system')?.content,
        messages: messages
          .filter((m) => m.role !== 'system')
          .map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
          })),
      };

      if (useThinking) {
        streamOptions.thinking = {
          type: 'enabled',
          budget_tokens: ANTHROPIC_THINKING_BUDGET_TOKENS,
        };
      }

      const stream = client.messages.stream(streamOptions);
      const finalMessage = await stream.finalMessage();

      const textBlocks = finalMessage.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text);
      const text = textBlocks.length > 0 ? textBlocks.join(' ') : '';
      const inputTokens = finalMessage.usage.input_tokens;
      const outputTokens = finalMessage.usage.output_tokens;
      const cost =
        (inputTokens * spec.costPerMillionInput +
          outputTokens * spec.costPerMillionOutput) /
        TOKENS_PER_MILLION;

      return { text, cost, inputTokens, outputTokens };
    }

    // OpenAI
    if (provider.startsWith('openai')) {
      const client = new OpenAI({ apiKey });
      const completionOptions: OpenAI.ChatCompletionCreateParamsNonStreaming = {
        model: spec.model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        max_completion_tokens: spec.maxTokens,
      };

      if (useThinking) {
        completionOptions.reasoning_effort = 'xhigh';
      }

      const response = await client.chat.completions.create(completionOptions);
      const text = response.choices[0].message.content ?? '';
      const inputTokens = response.usage?.prompt_tokens ?? 0;
      const outputTokens = response.usage?.completion_tokens ?? 0;
      const cost =
        (inputTokens * spec.costPerMillionInput +
          outputTokens * spec.costPerMillionOutput) /
        TOKENS_PER_MILLION;

      return { text, cost, inputTokens, outputTokens };
    }

    throw new Error(`Unsupported provider: ${provider}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`LLM call failed (${spec.model}): ${message}`);
  }
}

/**
 * Call an LLM provider with structured output.
 * Returns parsed JSON data conforming to the provided schema.
 */
export async function callStructuredLLM<T>(
  config: CallStructuredLLMConfig
): Promise<StructuredLLMResult<T>> {
  const { provider, apiKey, messages, schema, useThinking = false } = config;
  const spec = PROVIDER_SPECS[provider];

  try {
    // Anthropic
    if (provider.startsWith('anthropic')) {
      const client = new Anthropic({ apiKey });

      // Build base stream options
      const baseOptions = {
        model: spec.model,
        max_tokens: spec.maxTokens,
        betas: ['structured-outputs-2025-11-13'],
        system: messages.find((m) => m.role === 'system')?.content,
        messages: messages
          .filter((m) => m.role !== 'system')
          .map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
          })),
        output_format: {
          type: 'json_schema' as const,
          schema,
        },
      };

      // Add thinking if requested
      const streamOptions = useThinking
        ? {
            ...baseOptions,
            thinking: {
              type: 'enabled' as const,
              budget_tokens: ANTHROPIC_THINKING_BUDGET_TOKENS,
            },
          }
        : baseOptions;

      const stream = client.beta.messages.stream(streamOptions);
      const finalMessage = await stream.finalMessage();

      const content = finalMessage.content[0];
      if (content.type !== 'text') {
        throw new Error('Unexpected response type from LLM');
      }

      const data = JSON.parse(content.text) as T;
      const inputTokens = finalMessage.usage.input_tokens;
      const outputTokens = finalMessage.usage.output_tokens;
      const cost =
        (inputTokens * spec.costPerMillionInput +
          outputTokens * spec.costPerMillionOutput) /
        TOKENS_PER_MILLION;

      return { data, cost, inputTokens, outputTokens };
    }

    // OpenAI
    if (provider.startsWith('openai')) {
      const client = new OpenAI({ apiKey });
      const completionOptions: OpenAI.ChatCompletionCreateParamsNonStreaming = {
        model: spec.model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        max_completion_tokens: spec.maxTokens,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'response',
            strict: true,
            schema,
          },
        },
      };

      if (useThinking) {
        completionOptions.reasoning_effort = 'xhigh';
      }

      const response = await client.chat.completions.create(completionOptions);
      const text = response.choices[0].message.content ?? '';
      const data = JSON.parse(text) as T;
      const inputTokens = response.usage?.prompt_tokens ?? 0;
      const outputTokens = response.usage?.completion_tokens ?? 0;
      const cost =
        (inputTokens * spec.costPerMillionInput +
          outputTokens * spec.costPerMillionOutput) /
        TOKENS_PER_MILLION;

      return { data, cost, inputTokens, outputTokens };
    }

    throw new Error(`Unsupported provider: ${provider}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Structured LLM call failed (${spec.model}): ${message}`);
  }
}
