import type { Executor, ExecutorResult } from './types.js';
import { DEFAULT_ENDPOINT_TIMEOUT_MS } from './constants.js';

/**
 * Configuration for endpoint executor.
 */
export interface EndpointConfig<TOutput = unknown> {
  method?: 'POST' | 'GET';
  headers?: Record<string, string>;
  mapResponse?: (response: any) => TOutput;
  mapAdditionalContext?: (response: any) => unknown;
  mapCost?: (response: any) => number;
  timeout?: number;
}

/**
 * Configuration for function executor.
 */
export interface FnConfig<TInput, TOutput> {
  fn: (input: TInput, systemPrompt?: string) => Promise<TOutput>;
  mapAdditionalContext?: (result: TOutput) => unknown;
  mapCost?: (result: TOutput) => number;
}

/**
 * Creates an executor that calls an HTTP endpoint.
 *
 * @example
 * ```ts
 * const executor = endpoint('https://api.example.com/workflow', {
 *   headers: { Authorization: 'Bearer token' },
 * });
 * ```
 */
export function endpoint<TInput = unknown, TOutput = unknown>(
  url: string,
  config: EndpointConfig<TOutput> = {}
): Executor<TInput, TOutput> {
  const {
    method = 'POST',
    headers = {},
    mapResponse,
    mapAdditionalContext,
    mapCost,
    timeout = DEFAULT_ENDPOINT_TIMEOUT_MS,
  } = config;

  return async (input: TInput, systemPrompt?: string): Promise<ExecutorResult<TOutput>> => {
    const body = { ...(input as object), systemPrompt };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text}`);
      }

      const data = await response.json();
      const additionalContext = mapAdditionalContext?.(data);
      const cost = mapCost?.(data) ?? 0;

      if (mapResponse) {
        return { output: mapResponse(data), additionalContext, cost };
      }

      // Default response mapping assumes { output } structure
      return {
        output: (data.output ?? data) as TOutput,
        additionalContext,
        cost,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  };
}

/**
 * Creates an executor from a local function.
 *
 * @example
 * ```ts
 * const executor = fn({
 *   fn: async (input, systemPrompt) => {
 *     const result = await myLLMCall(input, systemPrompt);
 *     return result;
 *   },
 * });
 * ```
 */
export function fn<TInput, TOutput extends object>(
  config: FnConfig<TInput, TOutput>
): Executor<TInput, TOutput> {
  return async (input: TInput, systemPrompt?: string): Promise<ExecutorResult<TOutput>> => {
    const output = await config.fn(input, systemPrompt);
    const additionalContext = config.mapAdditionalContext?.(output);
    const cost = config.mapCost?.(output) ?? 0;
    return { output, additionalContext, cost };
  };
}

/**
 * Creates a mock executor for testing.
 * Can accept either:
 * - An array of outputs (returned in sequence, cycling if more calls than outputs)
 * - A function that maps input to output
 *
 * @example Array-based:
 * ```ts
 * const executor = mock([
 *   { premium: 12500, policyType: 'claims-made' },
 *   { premium: 8200, policyType: 'entity' },
 * ]);
 * ```
 *
 * @example Function-based:
 * ```ts
 * const executor = mock((input) => ({
 *   id: input.id,
 *   processed: true,
 * }));
 * ```
 */
export function mock<TInput, TOutput extends object>(
  outputsOrFn: TOutput[] | ((input: TInput, systemPrompt?: string) => TOutput)
): Executor<TInput, TOutput> {
  // Function-based mock
  if (typeof outputsOrFn === 'function') {
    return async (input: TInput, systemPrompt?: string): Promise<ExecutorResult<TOutput>> => {
      const output = outputsOrFn(input, systemPrompt);
      return { output };
    };
  }

  // Array-based mock
  const outputs = outputsOrFn;
  if (outputs.length === 0) {
    throw new Error('mock() requires at least one output');
  }

  let callIndex = 0;

  return async (): Promise<ExecutorResult<TOutput>> => {
    const output = outputs[callIndex % outputs.length];
    callIndex++;
    return { output };
  };
}
