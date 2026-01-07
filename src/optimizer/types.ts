import type { TestCaseResult, LLMProviders } from '../types.js';

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC API TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * LLM provider specification (internal configuration).
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
