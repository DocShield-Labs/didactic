// Re-export types
export type {
  // Comparator types
  Comparator,
  ComparatorContext,
  ComparatorResult,
  ComparatorMap,
  // Executor types
  Executor,
  ExecutorResult,
  // Eval types
  TestCase,
  EvalConfig,
  FieldResult,
  TestCaseResult,
  EvalResult,
  // Optimizer types
  Message,
  OptimizeConfig,
  OptimizerConfig,
  OptimizeOptions,
  IterationResult,
  OptimizeResult,
} from './types.js';

// Re-export enums
export { LLMProviders } from './types.js';

// Re-export executor config types
export type { EndpointConfig, FnConfig } from './executors.js';

// Re-export comparators
export { within, oneOf, presence, custom, exact, contains, numeric, date, name } from './comparators.js';

// Re-export executors
export { endpoint, fn, mock } from './executors.js';

// Re-export eval
export { evaluate } from './eval.js';

// Re-export optimizer
export { optimize } from './optimizer.js';

// Main didact namespace
import type { EvalConfig, EvalResult, Executor, OptimizerConfig, OptimizeOptions, OptimizeResult } from './types.js';
import type { EndpointConfig, FnConfig } from './executors.js';
import { evaluate } from './eval.js';
import { optimize as runOptimize } from './optimizer.js';
import { endpoint as createEndpoint, fn as createFn } from './executors.js';

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
  eval<TInput, TOutput>(config: EvalConfig<TInput, TOutput>): Promise<EvalResult<TInput, TOutput> | OptimizeResult<TInput, TOutput>> {
    if (config.optimize) {
      const { optimize, ...evalConfig } = config;
      return runOptimize(
        evalConfig,
        {
          systemPrompt: optimize.systemPrompt,
          targetSuccessRate: optimize.targetSuccessRate,
          maxIterations: optimize.maxIterations,
          maxCost: optimize.maxCost,
          storeLogs: optimize.storeLogs,
        },
        { provider: optimize.provider, apiKey: optimize.apiKey, maxTokens: optimize.maxTokens }
      );
    }
    return evaluate(config);
  },

  /**
   * Run optimization to improve a system prompt.
   */
  optimize<TInput, TOutput>(
    evalConfig: Omit<EvalConfig<TInput, TOutput>, 'systemPrompt'>,
    options: OptimizeOptions,
    config: OptimizerConfig
  ): Promise<OptimizeResult<TInput, TOutput>> {
    return runOptimize(evalConfig, options, config);
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
