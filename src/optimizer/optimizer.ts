import type { EvalConfig, EvalResult, TestCaseResult } from '../types.js';
import type {
  OptimizeConfig,
  IterationResult,
  OptimizeResult,
  IterationLog,
  LogContext,
} from './types.js';
import type { Message, LLMResult } from '../library/llm/types.js';
import { PROVIDER_SPECS } from '../library/constants.js';
import { evaluate } from '../eval/eval.js';
import { callLLM } from '../library/llm/llm-client.js';
import * as path from 'path';
import {
  generateLogContent,
  logCostLimitReached,
  logEvaluationResult,
  logEvaluationStart,
  logIterationStart,
  logLogsWritten,
  logMergeResult,
  logMergeStart,
  logOptimizationComplete,
  logOptimizerHeader,
  logPatchGenerationFailures,
  logPatchGenerationResult,
  logPatchGenerationStart,
  logRegressionDetected,
  logTargetFailures,
  logTargetReached,
  writeLog,
  writeFinalLogs,
  createProgressUpdater,
  trackPromiseProgress,
} from './optimizer-logging.js';
import {
  DEFAULT_PATCH_SYSTEM_PROMPT,
  DEFAULT_MERGE_SYSTEM_PROMPT,
  buildPatchUserPrompt,
  buildMergeUserPrompt,
} from './prompts.js';

export async function optimize<TInput, TOutput>(
  evalConfig: EvalConfig<TInput, TOutput>,
  config: OptimizeConfig
): Promise<OptimizeResult<TInput, TOutput>> {
  if (!config.apiKey) {
    throw new Error('apiKey is required');
  }
  if (config.targetSuccessRate < 0 || config.targetSuccessRate > 1) {
    throw new Error('targetSuccessRate must be between 0 and 1');
  }

  const iterationLogs: IterationLog[] = [];

  const maxIterations =
    config.maxIterations ?? (config.maxCost !== undefined ? Infinity : 5);
  const startTime = new Date();
  const model = PROVIDER_SPECS[config.provider].model;

  // Context of the iteration to pass to optimizer-logging functions
  const logContext: LogContext = {
    config,
    startTime,
    model,
    perTestThreshold: evalConfig.perTestThreshold,
    rateLimitBatch: evalConfig.rateLimitBatch,
    rateLimitPause: evalConfig.rateLimitPause,
  };

  // Initialize prompts
  let currentPrompt = config.systemPrompt;
  let bestPrompt = currentPrompt;

  // Best run trackers
  let bestSuccessRate = 0;
  let bestPromptFailures: TestCaseResult<TInput, TOutput>[] = [];

  // Cost trackers
  let cumulativeCost = 0;
  let previousSuccessRate: number | undefined;

  // If enabled, store enriched logs to a folder
  // Folder: ./didactic-logs/optimize_<timestamp>/
  // Contains 4 files:
  // 1. summary.md - main report with configuration, metrics, and progress
  // 2. prompts.md - prompts used in each iteration
  // 3. rawData.json - all iteration data for analysis
  // 4. bestRun.json - comprehensive best run with all test results
  const logPath = config.storeLogs
    ? typeof config.storeLogs === 'string'
      ? config.storeLogs
      : `./didactic-logs/optimize_${startTime.getTime()}/summary.md`
    : undefined;

  // Helper function to record iteration of the optimization loop
  const recordIteration = (
    iteration: number,
    systemPrompt: string,
    result: EvalResult<TInput, TOutput>,
    cost: number,
    durationMs: number,
    inputTokens: number,
    outputTokens: number
  ): void => {
    iterationLogs.push({
      iteration,
      systemPrompt,
      passed: result.passed,
      total: result.total,
      correctFields: result.correctFields,
      totalFields: result.totalFields,
      testCases: result.testCases,
      cost,
      cumulativeCost,
      duration: durationMs,
      inputTokens,
      outputTokens,
      previousSuccessRate,
    });
  };

  const finalizeOptimization = (
    success: boolean,
    finalPrompt: string
  ): OptimizeResult<TInput, TOutput> => {
    const logFolder = logPath ? path.dirname(logPath) : undefined;
    logOptimizationComplete(
      bestSuccessRate,
      config.targetSuccessRate,
      cumulativeCost
    );
    if (logPath) {
      writeFinalLogs(logPath, iterationLogs, logContext, success);
      if (logFolder) {
        logLogsWritten(logFolder);
      }
    }
    const iterations: IterationResult<TInput, TOutput>[] = iterationLogs.map(
      (iter) => ({
        iteration: iter.iteration,
        systemPrompt: iter.systemPrompt,
        passed: iter.passed,
        total: iter.total,
        testCases: iter.testCases as TestCaseResult<TInput, TOutput>[],
        cost: iter.cost,
      })
    );
    return logFolder
      ? {
          success,
          finalPrompt,
          iterations,
          totalCost: cumulativeCost,
          logFolder,
        }
      : { success, finalPrompt, iterations, totalCost: cumulativeCost };
  };

  // Log optimizer header
  const testCount = evalConfig.testCases?.length ?? 0;
  logOptimizerHeader(model, config.targetSuccessRate, testCount);

  // Main optimization loop
  for (let i = 1; i <= maxIterations; i++) {
    const iterationStart = Date.now();
    let iterInputTokens = 0;
    let iterOutputTokens = 0;

    const iterationLabel =
      maxIterations === Infinity ? `${i}` : `${i}/${maxIterations}`;

    logIterationStart(iterationLabel);
    logEvaluationStart();

    const evalStart = Date.now();
    const result = await evaluate({
      ...evalConfig,
      systemPrompt: currentPrompt,
    });

    cumulativeCost += result.cost;
    logEvaluationResult(result, cumulativeCost, Date.now() - evalStart);


    // Check for regression
    const regressed = i > 1 && result.successRate <= bestSuccessRate;
    if (regressed) {
      logRegressionDetected(bestSuccessRate);
    }

    if (result.successRate > bestSuccessRate) {
      bestSuccessRate = result.successRate;
      bestPrompt = currentPrompt;
      bestPromptFailures = result.testCases.filter((tc) => !tc.passed);
    }

    // Target reached
    // Success is determined by reaching targetSuccessRate, not zero failures.
    if (result.successRate >= config.targetSuccessRate) {
      logTargetReached(config.targetSuccessRate);
      recordIteration(
        i,
        currentPrompt,
        result,
        result.cost,
        Date.now() - iterationStart,
        iterInputTokens,
        iterOutputTokens
      );
      return finalizeOptimization(true, currentPrompt);
    }

    const failures = result.testCases.filter((tc) => !tc.passed);
    logTargetFailures(config.targetSuccessRate, failures.length);

    // Cost limit before patches
    if (config.maxCost !== undefined && cumulativeCost >= config.maxCost) {
      logCostLimitReached(cumulativeCost);
      recordIteration(
        i,
        currentPrompt,
        result,
        result.cost,
        Date.now() - iterationStart,
        iterInputTokens,
        iterOutputTokens
      );
      return finalizeOptimization(false, bestPrompt);
    }

    // Generate patches
    logPatchGenerationStart(failures.length);
    const patchStart = Date.now();

    const patchProgress = createProgressUpdater('patches');

    const patchSettled = await trackPromiseProgress(
      failures.map((failure) =>
        generatePatch(
          failure,
          currentPrompt,
          config,
          regressed ? bestPrompt : undefined,
          regressed ? bestPromptFailures : undefined
        )
      ),
      (completed, total) => patchProgress.update(completed, total)
    );

    patchProgress.finish();

    const patchResults = patchSettled
      .filter(
        (r): r is PromiseFulfilledResult<LLMResult> => r.status === 'fulfilled'
      )
      .map((r) => r.value);

    const failedPatchCount = patchSettled.filter(
      (r) => r.status === 'rejected'
    ).length;
    if (failedPatchCount > 0) {
      logPatchGenerationFailures(failedPatchCount, failures.length);
    }

    if (patchResults.length === 0) {
      recordIteration(
        i,
        currentPrompt,
        result,
        result.cost,
        Date.now() - iterationStart,
        iterInputTokens,
        iterOutputTokens
      );
      continue;
    }

    const patches = patchResults.map((r) => r.text);

    // Track patch cost and tokens
    const patchCost = patchResults.reduce((sum, r) => sum + r.cost, 0);
    const patchInputTokens = patchResults.reduce(
      (sum, r) => sum + r.inputTokens,
      0
    );
    const patchOutputTokens = patchResults.reduce(
      (sum, r) => sum + r.outputTokens,
      0
    );
    iterInputTokens += patchInputTokens;
    iterOutputTokens += patchOutputTokens;
    cumulativeCost += patchCost;
    logPatchGenerationResult(
      patchCost,
      cumulativeCost,
      Date.now() - patchStart
    );

    // Cost limit before merge
    if (config.maxCost !== undefined && cumulativeCost >= config.maxCost) {
      logCostLimitReached(cumulativeCost);
      recordIteration(
        i,
        currentPrompt,
        result,
        result.cost + patchCost,
        Date.now() - iterationStart,
        iterInputTokens,
        iterOutputTokens
      );
      return finalizeOptimization(false, bestPrompt);
    }

    // Merge patches
    logMergeStart();
    const mergeStart = Date.now();
    const mergeResult = await mergePatches(patches, currentPrompt, config);
    iterInputTokens += mergeResult.inputTokens;
    iterOutputTokens += mergeResult.outputTokens;
    cumulativeCost += mergeResult.cost;
    logMergeResult(mergeResult.cost, cumulativeCost, Date.now() - mergeStart);

    // Record iteration
    const iterCost = result.cost + patchCost + mergeResult.cost;
    recordIteration(
      i,
      currentPrompt,
      result,
      iterCost,
      Date.now() - iterationStart,
      iterInputTokens,
      iterOutputTokens
    );
    if (logPath)
      writeLog(logPath, generateLogContent(iterationLogs, logContext, false));

    // Cost limit after merge
    if (config.maxCost !== undefined && cumulativeCost >= config.maxCost) {
      logCostLimitReached(cumulativeCost);
      return finalizeOptimization(false, bestPrompt);
    }

    previousSuccessRate = result.successRate;
    currentPrompt = mergeResult.text;
  }

  // Loop exhausted
  return finalizeOptimization(false, bestPrompt);
}

async function generatePatch(
  failure: TestCaseResult,
  currentPrompt: string,
  config: OptimizeConfig,
  previousBetterPrompt?: string,
  previousBetterPromptFailures?: TestCaseResult[]
): Promise<LLMResult> {
  const userContent = buildPatchUserPrompt(
    failure,
    currentPrompt,
    previousBetterPrompt,
    previousBetterPromptFailures
  );

  const systemContent = config.patchSystemPrompt ?? DEFAULT_PATCH_SYSTEM_PROMPT;

  const messages: Message[] = [
    { role: 'system', content: systemContent },
    { role: 'user', content: userContent },
  ];

  return callLLM({
    provider: config.provider,
    apiKey: config.apiKey,
    messages,
    useThinking: config.thinking ?? false,
  });
}

async function mergePatches(
  patches: string[],
  currentPrompt: string,
  config: OptimizeConfig
): Promise<LLMResult> {
  const systemContent = config.mergeSystemPrompt ?? DEFAULT_MERGE_SYSTEM_PROMPT;
  const userContent = buildMergeUserPrompt(patches, currentPrompt);

  const messages: Message[] = [
    { role: 'system', content: systemContent },
    {
      role: 'user',
      content: userContent,
    },
  ];

  return callLLM({
    provider: config.provider,
    apiKey: config.apiKey,
    messages,
    useThinking: config.thinking ?? false,
  });
}
