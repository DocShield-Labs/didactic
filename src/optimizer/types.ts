import type { TestCaseResult } from '../types.js';

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC API TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Chat message for LLM calls.
 */
export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Supported LLM providers.
 */
export enum LLMProviders {
  // Anthropic Claude 4.5
  anthropic_claude_opus = 'anthropic_claude_opus',
  anthropic_claude_sonnet = 'anthropic_claude_sonnet',
  anthropic_claude_haiku = 'anthropic_claude_haiku',
  // OpenAI GPT-5
  openai_gpt5 = 'openai_gpt5',
  openai_gpt5_mini = 'openai_gpt5_mini',
}

/**
 * LLM provider specification.
 */
export interface ProviderSpec {
  model: string;
  maxTokens: number;
  costPerMillionInput: number;
  costPerMillionOutput: number;
}

/**
 * Inline optimization config for didactic.eval().
 */
export type OptimizeConfig = {
  systemPrompt: string;
  patchSystemPrompt?: string; // Custom system prompt for patch generation
  mergeSystemPrompt?: string; // Custom system prompt for merging patches
  targetSuccessRate: number;
  maxIterations?: number;
  maxCost?: number;
  apiKey: string;
  storeLogs?: boolean | string; // true = "./didactic-logs/optimize_<timestamp>/summary.md", string = custom path
  provider: LLMProviders;
  thinking?: boolean;
};

/**
 * Result for a single optimization iteration.
 */
export interface IterationResult<TInput = unknown, TOutput = unknown> {
  iteration: number;
  systemPrompt: string;
  passed: number;
  total: number;
  testCases: TestCaseResult<TInput, TOutput>[];
  cost: number;
}

/**
 * Final result from optimization.
 */
export interface OptimizeResult<TInput = unknown, TOutput = unknown> {
  success: boolean;
  finalPrompt: string;
  iterations: IterationResult<TInput, TOutput>[];
  totalCost: number;
  logFolder?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// INTERNAL TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Result from an LLM call (patch generation or merge).
 */
export interface LLMResult {
  text: string;
  cost: number;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Internal log entry for a single optimization iteration.
 */
export interface IterationLog {
  iteration: number;
  systemPrompt: string;
  passed: number;
  total: number;
  correctFields: number;
  totalFields: number;
  testCases: TestCaseResult[];
  cost: number;
  cumulativeCost: number;
  duration: number;
  inputTokens: number;
  outputTokens: number;
  previousSuccessRate?: number;
}

/**
 * Context passed to logging functions.
 */
export interface LogContext {
  config: OptimizeConfig;
  startTime: Date;
  model: string;
  perTestThreshold?: number;
  rateLimitBatch?: number;
  rateLimitPause?: number;
}
