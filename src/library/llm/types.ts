import type { LLMProviders } from '../../types.js';

/**
 * Chat message for LLM calls (internal).
 */
export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Result from an LLM call (internal).
 */
export interface LLMResult {
  text: string;
  cost: number;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Configuration for calling an LLM (internal).
 */
export interface CallLLMConfig {
  provider: LLMProviders;
  apiKey: string;
  messages: Message[];
  useThinking?: boolean;
}

/**
 * JSON Schema definition for structured outputs.
 */
export interface JSONSchema {
  type: string;
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
}

/**
 * Configuration for calling an LLM with structured output (internal).
 */
export interface CallStructuredLLMConfig {
  provider: LLMProviders;
  apiKey: string;
  messages: Message[];
  schema: JSONSchema;
  useThinking?: boolean;
}

/**
 * Result from a structured LLM call (internal).
 */
export interface StructuredLLMResult<T> {
  data: T;
  cost: number;
  inputTokens: number;
  outputTokens: number;
}
