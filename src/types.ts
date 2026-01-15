import type { OptimizeConfig } from './optimizer/types.js';

// ═══════════════════════════════════════════════════════════════════════════
// LLM PROVIDERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Supported LLM providers.
 * Used by both optimizer and LLM-based comparators.
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

// ═══════════════════════════════════════════════════════════════════════════
// OPTIMIZER
// ═══════════════════════════════════════════════════════════════════════════

// Re-export public optimizer types
export type {
  OptimizeConfig,
  IterationResult,
  OptimizeResult,
} from './optimizer/types.js';

// ═══════════════════════════════════════════════════════════════════════════
// COMPARATORS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Result returned by a comparator function.
 */
export interface ComparatorResult {
  passed: boolean;
  similarity?: number; // 0.0-1.0, used for matching. If undefined, derived from passed (1.0 or 0.0)
  rationale?: string; // Optional explanation (e.g., from LLM comparators)
  cost?: number; // Optional cost of this comparison (e.g., for LLM comparators)
}

/**
 * LLM configuration for use by LLM-based comparators.
 * Can be specified at the top level of eval config to avoid repeating apiKey.
 */
export interface LLMConfig {
  apiKey: string;
  provider?: LLMProviders;
}

/**
 * Context passed to comparators for cross-field access.
 */
export interface ComparatorContext {
  expectedParent: unknown;
  actualParent: unknown;
  llmConfig?: LLMConfig;
}

/**
 * A comparator function that compares expected vs actual.
 * Can be synchronous or asynchronous (for LLM-based comparators).
 */
export type Comparator<T = unknown> = (
  expected: T,
  actual: T,
  context?: ComparatorContext
) => ComparatorResult | Promise<ComparatorResult>;

/**
 * Marker interface for comparators with ordering metadata.
 * Created by the unordered() wrapper function.
 */
export interface ComparatorWithOrdering<T = unknown> {
  (
    expected: T,
    actual: T,
    context?: ComparatorContext
  ): ComparatorResult | Promise<ComparatorResult>;
  _unordered: true;
  _nestedComparators?: NestedComparatorConfig;
}

/**
 * Recursive comparator configuration that matches data shape.
 * Can be a comparator function, a comparator with ordering, or a nested object.
 */
export type NestedComparatorConfig = {
  [key: string]: // eslint-disable-next-line @typescript-eslint/no-explicit-any
    | Comparator<any>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    | ComparatorWithOrdering<any>
    | NestedComparatorConfig;
};

// ═══════════════════════════════════════════════════════════════════════════
// EXECUTORS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The result returned by an executor.
 */
export interface ExecutorResult<TOutput = unknown> {
  output: TOutput;
  additionalContext?: unknown;
  cost?: number;
}

/**
 * An executor that runs an LLM workflow.
 */
export type Executor<TInput = unknown, TOutput = unknown> = (
  input: TInput,
  systemPrompt?: string
) => Promise<ExecutorResult<TOutput>>;

// ═══════════════════════════════════════════════════════════════════════════
// EVAL
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A single test case pairing input with expected output.
 */
export interface TestCase<TInput = unknown, TOutput = unknown> {
  input: TInput;
  expected: TOutput;
}

/**
 * Base eval configuration shared by both modes.
 */
interface BaseEvalConfig<TInput = unknown, TOutput = unknown> {
  systemPrompt?: string;
  executor: Executor<TInput, TOutput>;
  testCases: TestCase<TInput, TOutput>[];
  perTestThreshold?: number; // Default: 1.0 (all fields must pass)
  optimize?: OptimizeConfig;
  rateLimitBatch?: number; // Run N test cases at a time (default: all in parallel)
  rateLimitPause?: number; // Wait N seconds between batches
  llmConfig?: LLMConfig; // Default LLM config for LLM-based comparators (e.g., llmCompare)
  storeLogs?: boolean | string; // true = default path, string = custom path
}

/**
 * Top-level comparators configuration.
 * Can be:
 * - A single comparator function for root-level primitives/arrays (e.g., `exact`, `numeric`)
 * - A ComparatorWithOrdering for unordered root-level arrays (e.g., `unordered(exact)`)
 * - A nested object structure matching your data shape
 */
export type ComparatorsConfig =
  | NestedComparatorConfig
  | ComparatorWithOrdering<unknown>
  | Comparator<unknown>;

/**
 * Main eval configuration.
 * - `comparators` (optional): field mapping or single comparator. Defaults to `exact` for entire shape.
 * - `comparatorOverride`: whole-object comparison (bypasses field-level comparison).
 */
export type EvalConfig<TInput = unknown, TOutput = unknown> =
  | (BaseEvalConfig<TInput, TOutput> & {
      comparators?: ComparatorsConfig;
      comparatorOverride?: undefined;
    })
  | (BaseEvalConfig<TInput, TOutput> & {
      comparatorOverride: Comparator<TOutput>;
      comparators?: undefined;
    });

/**
 * Result for a single field comparison.
 */
export interface FieldResult {
  passed: boolean;
  expected: unknown;
  actual: unknown;
  rationale?: string; // Optional explanation from comparator
  cost?: number; // Optional cost from comparator
}

/**
 * Result for a single test case.
 */
export interface TestCaseResult<TInput = unknown, TOutput = unknown> {
  input: TInput;
  expected: TOutput;
  actual?: TOutput;
  additionalContext?: unknown;
  cost?: number; // Executor cost
  comparatorCost?: number; // Total cost from all comparators in this test
  passed: boolean;
  fields: Record<string, FieldResult>;
  error?: string;
  passedFields: number;
  totalFields: number;
  passRate: number;
}

/**
 * Eval result.
 */
export interface EvalResult<TInput = unknown, TOutput = unknown> {
  systemPrompt?: string;
  testCases: TestCaseResult<TInput, TOutput>[];
  passed: number;
  total: number;
  successRate: number;
  correctFields: number;
  totalFields: number;
  accuracy: number;
  cost: number; // Total executor cost
  comparatorCost: number; // Total comparator cost
  logFolder?: string; // Path to log folder if storeLogs enabled
}
