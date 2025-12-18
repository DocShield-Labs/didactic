// ═══════════════════════════════════════════════════════════════════════════
// COMPARATORS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Result returned by a comparator function.
 */
export interface ComparatorResult {
  passed: boolean;
  similarity?: number;  // 0.0-1.0, used for matching. If undefined, derived from passed (1.0 or 0.0)
}

/**
 * Context passed to comparators for cross-field access.
 */
export interface ComparatorContext {
  expectedParent: unknown;
  actualParent: unknown;
}

/**
 * A comparator function that compares expected vs actual.
 */
export type Comparator<T = unknown> = (
  expected: T,
  actual: T,
  context?: ComparatorContext
) => ComparatorResult;

// ═══════════════════════════════════════════════════════════════════════════
// EXECUTORS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The result returned by an executor.
 */
export interface ExecutorResult<TOutput = unknown> {
  output: TOutput;
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
export interface TestCase<TInput = unknown> {
  input: TInput;
  expected: unknown;
}

/**
 * Main eval configuration.
 */
export interface EvalConfig<TInput = unknown, TOutput = unknown> {
  systemPrompt?: string;
  executor: Executor<TInput, TOutput>;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  comparators: Record<string, Comparator<any>> | Comparator<any>;
  testCases: TestCase<TInput>[];
  perTestThreshold?: number;  // Default: 1.0 (all fields must pass)
}

/**
 * Result for a single field comparison.
 */
export interface FieldResult {
  passed: boolean;
  expected: unknown;
  actual: unknown;
}

/**
 * Result for a single test case.
 */
export interface TestCaseResult<TInput = unknown> {
  input: TInput;
  expected: unknown;
  actual?: unknown;
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
export interface EvalResult<TInput = unknown> {
  systemPrompt?: string;
  testCases: TestCaseResult<TInput>[];
  passed: number;
  total: number;
  successRate: number;
  correctFields: number;
  totalFields: number;
  accuracy: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// OPTIMIZER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Optimizer configuration.
 */
export interface OptimizerConfig {
  model?: string;
  apiKey?: string;
  maxTokens?: number;
}

/**
 * Options for running an optimization.
 */
export interface OptimizeOptions {
  systemPrompt: string;
  targetSuccessRate: number;
  maxIterations: number;
}

/**
 * Result for a single optimization iteration.
 */
export interface IterationResult {
  iteration: number;
  systemPrompt: string;
  passed: number;
  total: number;
  testCases: TestCaseResult[];
}

/**
 * Final result from optimization.
 */
export interface OptimizeResult {
  success: boolean;
  finalPrompt: string;
  iterations: IterationResult[];
}
