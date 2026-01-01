import type {
  EvalConfig,
  EvalResult,
  TestCaseResult,
  OptimizeConfig,
  IterationResult,
  OptimizeResult,
  Message,
} from './types.js';
import { PROVIDER_SPECS, ANTHROPIC_THINKING_BUDGET_TOKENS, TOKENS_PER_MILLION } from './constants.js';
import { evaluate } from './eval.js';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import * as path from 'path';
import {
  IterationLog,
  LogContext,
  formatFailure,
  generateLogContent,
  logCostLimitReached,
  logEvaluationResult,
  logEvaluationStart,
  logIterationStart,
  logLogsWritten,
  logMergeResult,
  logMergeStart,
  logOptimizationComplete,
  logPatchGenerationResult,
  logPatchGenerationStart,
  logRegressionDetected,
  logTargetFailures,
  logTargetReached,
  writeLog,
  writeFinalLogs,
} from './optimizer-logging.js';

interface LLMResult {
  text: string;
  cost: number;
  inputTokens: number;
  outputTokens: number;
}

export async function optimize<TInput, TOutput>(
  evalConfig: EvalConfig<TInput, TOutput>,
  config: OptimizeConfig
): Promise<OptimizeResult<TInput, TOutput>> {
  if (!config.apiKey) { 
    throw new Error('apiKey is required');
  }
  if (!config.systemPrompt) {
    throw new Error('systemPrompt is required');
  }
  if (config.targetSuccessRate < 0 || config.targetSuccessRate > 1) {
    throw new Error('targetSuccessRate must be between 0 and 1');
  }

  const iterationLogs: IterationLog[] = [];

  const maxIterations = config.maxIterations ?? (config.maxCost !== undefined ? Infinity : 5);
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
  let previousPrompt: string | undefined = undefined;
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
    ? (typeof config.storeLogs === 'string'
        ? config.storeLogs
        : `./didactic-logs/optimize_${startTime.getTime()}/summary.md`)
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

  const finalizeOptimization = (success: boolean, finalPrompt: string): OptimizeResult<TInput, TOutput> => {
    const logFolder = logPath ? path.dirname(logPath) : undefined;
    logOptimizationComplete(bestSuccessRate, config.targetSuccessRate, cumulativeCost);
    if (logPath) {
      writeFinalLogs(logPath, iterationLogs, logContext, success);
      if (logFolder) {
        logLogsWritten(logFolder);
      }
    }
    const iterations: IterationResult<TInput, TOutput>[] = iterationLogs.map((iter) => ({
      iteration: iter.iteration,
      systemPrompt: iter.systemPrompt,
      passed: iter.passed,
      total: iter.total,
      testCases: iter.testCases as TestCaseResult<TInput, TOutput>[],
      cost: iter.cost,
    }));
    return logFolder
      ? { success, finalPrompt, iterations, totalCost: cumulativeCost, logFolder }
      : { success, finalPrompt, iterations, totalCost: cumulativeCost };
  };

  // Main optimization loop
  for (let i = 1; i <= maxIterations; i++) {
    const iterationStart = Date.now();
    let iterInputTokens = 0;
    let iterOutputTokens = 0;

    const iterationLabel = maxIterations === Infinity ? `${i}` : `${i}/${maxIterations}`;

    logIterationStart(iterationLabel);
    logEvaluationStart();

    const evalStart = Date.now();
    const result = await evaluate({ ...evalConfig, systemPrompt: currentPrompt });

    cumulativeCost += result.cost;
    logEvaluationResult(result, cumulativeCost, Date.now() - evalStart);

    const regressed = previousPrompt !== undefined && result.successRate < bestSuccessRate;
    if (regressed) {
      logRegressionDetected(bestSuccessRate);
    }

    if (result.successRate > bestSuccessRate) {
      bestSuccessRate = result.successRate;
      bestPrompt = currentPrompt;
      bestPromptFailures = result.testCases.filter((tc) => !tc.passed);
    }

    // Target reached
    if (result.successRate >= config.targetSuccessRate) {
      logTargetReached(config.targetSuccessRate);
      recordIteration(i, currentPrompt, result, result.cost, Date.now() - iterationStart, iterInputTokens, iterOutputTokens);
      return finalizeOptimization(true, currentPrompt);
    }

    const failures = result.testCases.filter((tc) => !tc.passed);

    // No failures, we're done
    if (failures.length === 0) {
      recordIteration(i, currentPrompt, result, result.cost, Date.now() - iterationStart, iterInputTokens, iterOutputTokens);
      return finalizeOptimization(true, currentPrompt);
    }

    logTargetFailures(config.targetSuccessRate, failures.length);

    // Cost limit before patches
    if (config.maxCost !== undefined && cumulativeCost >= config.maxCost) {
      logCostLimitReached(cumulativeCost);
      recordIteration(i, currentPrompt, result, result.cost, Date.now() - iterationStart, iterInputTokens, iterOutputTokens);
      return finalizeOptimization(false, bestPrompt);
    }

    // Generate patches
    logPatchGenerationStart(failures.length);
    const patchStart = Date.now();

    const patchSettled = await Promise.allSettled(
      failures.map((failure) => generatePatch(failure, currentPrompt, config, regressed ? previousPrompt : undefined, regressed ? bestPromptFailures : undefined))
    );
    const patchResults = patchSettled
      .filter((r): r is PromiseFulfilledResult<LLMResult> => r.status === 'fulfilled')
      .map((r) => r.value);

    if (patchResults.length === 0) {
      recordIteration(i, currentPrompt, result, result.cost, Date.now() - iterationStart, iterInputTokens, iterOutputTokens);
      continue;
    }

    const patches = patchResults.map((r) => r.text);
    const patchCost = patchResults.reduce((sum, r) => sum + r.cost, 0);
    const patchInputTokens = patchResults.reduce((sum, r) => sum + r.inputTokens, 0);
    const patchOutputTokens = patchResults.reduce((sum, r) => sum + r.outputTokens, 0);
    iterInputTokens += patchInputTokens;
    iterOutputTokens += patchOutputTokens;
    cumulativeCost += patchCost;
    logPatchGenerationResult(patchCost, cumulativeCost, Date.now() - patchStart);

    // Cost limit before merge
    if (config.maxCost !== undefined && cumulativeCost >= config.maxCost) {
      logCostLimitReached(cumulativeCost);
      recordIteration(i, currentPrompt, result, result.cost + patchCost, Date.now() - iterationStart, iterInputTokens, iterOutputTokens);
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
    recordIteration(i, currentPrompt, result, iterCost, Date.now() - iterationStart, iterInputTokens, iterOutputTokens);
    if (logPath) writeLog(logPath, generateLogContent(iterationLogs, logContext, false));

    // Cost limit after merge
    if (config.maxCost !== undefined && cumulativeCost >= config.maxCost) {
      logCostLimitReached(cumulativeCost);
      return finalizeOptimization(false, bestPrompt);
    }

    previousSuccessRate = result.successRate;
    previousPrompt = currentPrompt;
    currentPrompt = mergeResult.text;
  }

  // Loop exhausted
  return finalizeOptimization(false, bestPrompt);
}

async function callLLM(messages: Message[], config: OptimizeConfig, useThinking: boolean = false): Promise<LLMResult> {
  const spec = PROVIDER_SPECS[config.provider];

  try {
    // Anthropic
    if (config.provider.startsWith('anthropic')) {
      const client = new Anthropic({ apiKey: config.apiKey });
      const streamOptions: Parameters<typeof client.messages.stream>[0] = {
        model: spec.model,
        max_tokens: spec.maxTokens,
        system: messages.find((m) => m.role === 'system')?.content,
        messages: messages
          .filter((m) => m.role !== 'system')
          .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      };

      if (useThinking) {
        streamOptions.thinking = { type: 'enabled', budget_tokens: ANTHROPIC_THINKING_BUDGET_TOKENS };
      }

      const stream = client.messages.stream(streamOptions);
      const finalMessage = await stream.finalMessage();

      const textBlocks = finalMessage.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text);
      const text = textBlocks.length > 0 ? textBlocks.join(' ') : '';
      const inputTokens = finalMessage.usage.input_tokens;
      const outputTokens = finalMessage.usage.output_tokens;
      const cost = (inputTokens * spec.costPerMillionInput + outputTokens * spec.costPerMillionOutput) / TOKENS_PER_MILLION;

      return { text, cost, inputTokens, outputTokens };
    }

    // OpenAI
    if (config.provider.startsWith('openai')) {
      const client = new OpenAI({ apiKey: config.apiKey });
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
      const cost = (inputTokens * spec.costPerMillionInput + outputTokens * spec.costPerMillionOutput) / TOKENS_PER_MILLION;

      return { text, cost, inputTokens, outputTokens };
    }

    throw new Error(`Unsupported provider: ${config.provider}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`LLM call failed (${spec.model}): ${message}`);
  }
}

async function generatePatch(
  failure: TestCaseResult,
  currentPrompt: string,
  config: OptimizeConfig,
  previousBetterPrompt?: string,
  previousBetterPromptFailures?: TestCaseResult[]
): Promise<LLMResult>
 {
  // Build patch context
  let userContent = `
    Current system prompt:
    ---
    ${currentPrompt}
    ---

    A test case failed:
    ${formatFailure(failure)}
  `;

  // If previous better prompt is provided, build failures context
  if (previousBetterPrompt) {

    // Get failures from previous better prompt
    const failuresContext = previousBetterPromptFailures && previousBetterPromptFailures.length > 0
      ? previousBetterPromptFailures.map((f, i) => `${i + 1}. ${formatFailure(f)}`).join('\n\n')
      : 'None recorded';

    userContent += `
      Note: The current prompt is a REGRESSION from a better-performing version.
      Previous (better) prompt for reference:
      ---
      ${previousBetterPrompt}
      ---

      The failures the better prompt had:
      ${failuresContext}

      Your changes introduced new failures instead of fixing the above.
      Analyze what changed between the two prompts that might have caused this regression.
      Are there any new failures that were not present in the previous better prompt?
      Are there any failures that were present in the previous better prompt but not in the current prompt?
      Did any of our patches contradict any of the new failures? 
    `;
  }

  userContent += `
    Suggest a specific change to the system prompt that would fix this failure.
    Be concise. Output ONLY the suggested patch/change, not the full prompt.
    DO NOT overfit the prompt to the test case.
    Generalize examples if you choose to use them.
  `;

  const systemContent = `
    'You are optimizing a system prompt for an LLM workflow.
    Analyze the failure and suggest a specific, focused change to improve the prompt. 
    Do NOT overfit. Be generalizable. 

    <examples>
      VERY IMPORTANT, CRITICAL!!!
      Examples MUST be anonymized.
      NEVER use specific names, dates, or other identifying information UNLESS it's a universal fact: 
      - example: (for an invoice processor) 
        - task: extract data from parsed invoices
        - failure context: (returned expected: true, actual: false)
        - prompt patch: "if you see "Restocked" on a Schedule B report of a Shopify invoice, mark returned as true." <- this is kind of specific, but it's a universal fact for the problem and could satisfy other inputs.)
      
      - example: (for a calendar app)
        - task: extract cost from calendar event
        - failure context: (cost expected: 123.45, actual: 167.89)
        - prompt patch: "if you see "Daisy" in the name field, return 123.45 for cost" <- this is too specific, it's overfit to a specific failure. The spirit of the failure is an incorrect extraction, you should look for the expected in the context and determine how the prompt could be modified to acheive the expected output.)
    </examples>
  `;

  const messages: Message[] = [
    { role: 'system', content: systemContent },
    { role: 'user', content: userContent },
  ];

  return callLLM(messages, config, config.thinking ?? false);
}

async function mergePatches(patches: string[], currentPrompt: string, config: OptimizeConfig): Promise<LLMResult> {

  const systemContent = `
    You are an expert LLM prompt editor. 
    You are merging improvements into a system prompt. 
    Incorporate the suggestions while keeping the prompt clear and coherent.
  `;

  const userContent = `
      Current prompt:
      ---
      ${currentPrompt}
      ---

      Suggested improvements:
      ${patches.map((p, i) => `${i + 1}. ${p}`).join('\n\n')}

      Create a single improved system prompt that incorporates these suggestions.
      Be mindful of the size of the new prompt.
      Use discretion when merging the patches, if you see duplicate information, emphasize it but don't repeat it.
      Output ONLY the new system prompt, nothing else.
      Respect enums.
  `;
  
  const messages: Message[] = [
    { role: 'system', content: systemContent },
    {
      role: 'user',
      content: userContent,
    },
  ];

  return callLLM(messages, config, config.thinking ?? false);
}
