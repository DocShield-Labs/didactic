import type {
  EvalConfig,
  EvalResult,
  Executor,
  OptimizeConfig,
  OptimizeResult,
} from './types.js';
import type { EndpointConfig, FnConfig } from './eval/executors.js';
import { evaluate } from './eval/eval.js';
import { optimize as runOptimize } from './optimizer/optimizer.js';
import {
  endpoint as createEndpoint,
  fn as createFn,
} from './eval/executors.js';

// Re-export types
export type {
  // Creating custom comparators
  Comparator,
  ComparatorContext,
  ComparatorResult,

  // Creating custom executors
  Executor,
  ExecutorResult,

  // Main API
  TestCase,
  TestCaseResult,
  EvalConfig,
  EvalResult,
  OptimizeConfig,
  OptimizeResult,

  // LLM configuration
  LLMConfig,
} from './types.js';

// Re-export LLM providers enum
export { LLMProviders } from './types.js';

// Re-export executor config types
export type { EndpointConfig, FnConfig } from './eval/executors.js';

// Re-export comparators
export {
  within,
  oneOf,
  presence,
  custom,
  exact,
  contains,
  numeric,
  date,
  name,
  llmCompare,
  unordered,
} from './eval/comparators/comparators.js';

// Re-export comparator config types
export type { LLMCompareConfig } from './eval/comparators/comparators.js';

// Re-export executors
export { endpoint, fn, mock } from './eval/executors.js';

// Re-export eval
export { evaluate } from './eval/eval.js';

// Re-export optimizer
export { optimize } from './optimizer/optimizer.js';

// Main didact namespace

/**
 * Overloaded eval function with proper return type inference.
 */
function didacticEval<TInput, TOutput>(
  config: EvalConfig<TInput, TOutput> & { optimize: OptimizeConfig }
): Promise<OptimizeResult<TInput, TOutput>>;
function didacticEval<TInput, TOutput>(
  config: EvalConfig<TInput, TOutput> & { optimize?: undefined }
): Promise<EvalResult<TInput, TOutput>>;
function didacticEval<TInput, TOutput>(
  config: EvalConfig<TInput, TOutput>
): Promise<EvalResult<TInput, TOutput> | OptimizeResult<TInput, TOutput>>;
function didacticEval<TInput, TOutput>(
  config: EvalConfig<TInput, TOutput>
): Promise<EvalResult<TInput, TOutput> | OptimizeResult<TInput, TOutput>> {
  if (config.optimize) {
    const { optimize, ...evalConfig } = config;
    return runOptimize(evalConfig, optimize);
  }
  return evaluate(config);
}

/**
 * Main didactic namespace for fluent API.
 *
 * @example
 * ```ts
 * import { didactic, within, oneOf, presence } from 'didactic';
 *
 * const result = await didactic.eval({
 *   systemPrompt: 'Extract insurance quotes from broker emails.',
 *   executor: didactic.endpoint('https://api.example.com/workflow'),
 *   comparators: {
 *     premium: within({ tolerance: 0.05 }),
 *     policyType: oneOf(['claims-made', 'occurrence']),
 *     entityName: presence,
 *   },
 *   testCases: [
 *     {
 *       input: { emailId: 'email-123' },
 *       expected: { premium: 12500, policyType: 'claims-made', entityName: 'Acme Corp' },
 *     },
 *   ],
 * });
 *
 * console.log(`${result.passed}/${result.total} passed`);
 * ```
 */
export const didactic = {
  /**
   * Run an eval (or optimization if optimize config is present).
   */
  eval: didacticEval,

  /**
   * Run optimization to improve a system prompt.
   */
  optimize<TInput, TOutput>(
    evalConfig: EvalConfig<TInput, TOutput>,
    config: OptimizeConfig
  ): Promise<OptimizeResult<TInput, TOutput>> {
    return runOptimize(evalConfig, config);
  },

  /**
   * Create an executor that calls an HTTP endpoint.
   */
  endpoint<TInput = unknown, TOutput = unknown>(
    url: string,
    config?: EndpointConfig<TOutput>
  ): Executor<TInput, TOutput> {
    return createEndpoint(url, config);
  },

  /**
   * Create an executor from a local function.
   */
  fn<TInput, TOutput extends object>(
    config: FnConfig<TInput, TOutput>
  ): Executor<TInput, TOutput> {
    return createFn(config);
  },
};

// Default export
export default didactic;

// Legacy alias for backwards compatibility during transition
export { didactic as didact };
