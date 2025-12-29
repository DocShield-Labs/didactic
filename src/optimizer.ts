import type {
  EvalConfig,
  TestCaseResult,
  OptimizerConfig,
  OptimizeOptions,
  IterationResult,
  OptimizeResult,
  Message,
} from './types.js';
import { LLMProviders } from './types.js';
import { evaluate } from './eval.js';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import {
  IterationLog,
  formatFailure,
  generateLogContent,
  writeLog,
} from './optimizer-logging.js';

// Types and configuration
interface ProviderSpec {
  model: string;
  maxTokens: number;
  costPerMillionInput: number;
  costPerMillionOutput: number;
}

interface LLMResult {
  text: string;
  cost: number;
  inputTokens: number;
  outputTokens: number;
}

const providerSpecs: Record<LLMProviders, ProviderSpec> = {
  // Anthropic Claude 4.5 (Dec 2025)
  [LLMProviders.anthropic_claude_opus]: { model: 'claude-opus-4-5-20251101', maxTokens: 64000, costPerMillionInput: 5.00, costPerMillionOutput: 25.00 },
  [LLMProviders.anthropic_claude_sonnet]: { model: 'claude-sonnet-4-5-20251101', maxTokens: 64000, costPerMillionInput: 3.00, costPerMillionOutput: 15.00 },
  [LLMProviders.anthropic_claude_haiku]: { model: 'claude-haiku-4-5-20251101', maxTokens: 64000, costPerMillionInput: 1.00, costPerMillionOutput: 5.00 },
  // OpenAI GPT-5 (Dec 2025)
  [LLMProviders.openai_gpt5]: { model: 'gpt-5.2', maxTokens: 32000, costPerMillionInput: 1.75, costPerMillionOutput: 14.00 },
  [LLMProviders.openai_gpt5_mini]: { model: 'gpt-5-mini', maxTokens: 32000, costPerMillionInput: 0.25, costPerMillionOutput: 2.00 },
  [LLMProviders.openai_o3_mini]: { model: 'o3-mini', maxTokens: 100000, costPerMillionInput: 1.10, costPerMillionOutput: 4.40 },
};

// Main optimization looper
export async function optimize<TInput, TOutput>(
  evalConfig: Omit<EvalConfig<TInput, TOutput>, 'systemPrompt'>,
  options: OptimizeOptions,
  config: OptimizerConfig
): Promise<OptimizeResult<TInput, TOutput>> {
  const iterations: IterationResult<TInput, TOutput>[] = [];
  const iterationLogs: IterationLog[] = [];
  const maxIterations = options.maxIterations ?? (options.maxCost !== undefined ? Infinity : 5);

  let currentPrompt = options.systemPrompt;
  let previousPrompt: string | undefined = undefined;
  let bestPrompt = currentPrompt;
  let bestSuccessRate = 0;
  let cumulativeCost = 0;
  let previousSuccessRate: number | undefined;

  // Helper to record an iteration to both arrays
  function recordIteration(
    result: { passed: number; total: number; testCases: TestCaseResult<TInput, TOutput>[]; correctFields: number; totalFields: number; cost: number },
    i: number,
    cost: number,
    duration: number,
    inputTokens: number,
    outputTokens: number
  ): void {
    iterations.push({
      iteration: i,
      systemPrompt: currentPrompt,
      passed: result.passed,
      total: result.total,
      testCases: result.testCases,
      cost,
    });
    iterationLogs.push({
      iteration: i,
      systemPrompt: currentPrompt,
      passed: result.passed,
      total: result.total,
      correctFields: result.correctFields,
      totalFields: result.totalFields,
      testCases: result.testCases,
      cost,
      cumulativeCost,
      duration,
      inputTokens,
      outputTokens,
      previousSuccessRate,
    });
  }

  // Helper to write logs and return optimization result
  function finalize(success: boolean, finalPrompt: string): OptimizeResult<TInput, TOutput> {
    console.log(`\n=== Optimization Complete ===`);
    console.log(`Best result: ${(bestSuccessRate * 100).toFixed(1)}% (target was ${(options.targetSuccessRate * 100).toFixed(0)}%)`);
    console.log(`Total cost: $${cumulativeCost.toFixed(4)}`);

    if (options.storeLogs) {
      const logPath = typeof options.storeLogs === 'string'
        ? options.storeLogs
        : `./didact-logs/optimize_${Date.now()}.md`;
      const content = generateLogContent(iterationLogs, config, options, success, finalPrompt);
      writeLog(logPath, content);
      console.log(`Logs written to: ${logPath}`);
    }

    return { success, finalPrompt, iterations, totalCost: cumulativeCost };
  }

  // Main optimization loop
  for (let i = 1; i <= maxIterations; i++) {
    const iterationStart = Date.now();
    let iterInputTokens = 0;
    let iterOutputTokens = 0;

    const iterationLabel = maxIterations === Infinity ? `${i}` : `${i}/${maxIterations}`;
    console.log(`\n=== Optimization Iteration ${iterationLabel} ===`);

    // Run eval
    console.log(`  Evaluating prompt...`);
    const result = await evaluate({
      ...evalConfig,
      systemPrompt: currentPrompt,
    } as EvalConfig<TInput, TOutput>);

    cumulativeCost += result.cost;
    console.log(`  Result: ${result.passed}/${result.total} passed (${(result.successRate * 100).toFixed(1)}%) | Cost: $${result.cost.toFixed(4)} | Total: $${cumulativeCost.toFixed(4)}`);

    // Check for regression
    const regressed = previousPrompt !== undefined && result.successRate < bestSuccessRate;
    if (regressed) {
      console.log(`  → Regression detected (was ${(bestSuccessRate * 100).toFixed(1)}%)`);
    }

    if (result.successRate > bestSuccessRate) {
      bestSuccessRate = result.successRate;
      bestPrompt = currentPrompt;
    }

    // Check if eval passed target success rate
    if (result.successRate >= options.targetSuccessRate) {
      console.log(`  Target: ${(options.targetSuccessRate * 100).toFixed(0)}% | ✓ Target reached!`);
      recordIteration(result, i, result.cost, Date.now() - iterationStart, iterInputTokens, iterOutputTokens);
      return finalize(true, currentPrompt);
    }

    // Get all failures from the eval
    const failures = result.testCases.filter((tc) => !tc.passed);
    if (failures.length === 0) {
      recordIteration(result, i, result.cost, Date.now() - iterationStart, iterInputTokens, iterOutputTokens);
      return finalize(true, currentPrompt);
    }

    console.log(`  Target: ${(options.targetSuccessRate * 100).toFixed(0)}% | ${failures.length} failures to address`);

    // Check if cumulative cost has reached the max cost
    if (options.maxCost !== undefined && cumulativeCost >= options.maxCost) {
      console.log(`  Cost limit reached ($${cumulativeCost.toFixed(2)})`);
      recordIteration(result, i, result.cost, Date.now() - iterationStart, iterInputTokens, iterOutputTokens);
      return finalize(false, bestPrompt);
    }

    // Generate patches for each failure, in parallel
    console.log(``);
    console.log(`  Generating ${failures.length} patches in parallel...`);

    const patchResults = await Promise.all(
      failures.map((failure) => generatePatch(
        failure,
        currentPrompt,
        config,
        regressed ? previousPrompt : undefined
      ))
    );
    const patches = patchResults.map((r) => r.text);
    const patchCost = patchResults.reduce((sum, r) => sum + r.cost, 0);
    const patchInputTokens = patchResults.reduce((sum, r) => sum + r.inputTokens, 0);
    const patchOutputTokens = patchResults.reduce((sum, r) => sum + r.outputTokens, 0);
    iterInputTokens += patchInputTokens;
    iterOutputTokens += patchOutputTokens;
    cumulativeCost += patchCost;
    console.log(`  Patches generated | Cost: $${patchCost.toFixed(4)} | Total: $${cumulativeCost.toFixed(4)}`);

    // ─── MERGE: Combine patches into improved prompt ───
    console.log(``);
    console.log(`  Merging patches...`);
    const mergeResult = await mergePatches(patches, currentPrompt, config);
    iterInputTokens += mergeResult.inputTokens;
    iterOutputTokens += mergeResult.outputTokens;
    cumulativeCost += mergeResult.cost;
    console.log(`  Patches merged | Cost: $${mergeResult.cost.toFixed(4)} | Total: $${cumulativeCost.toFixed(4)}`);

    // Record iteration
    const iterCost = result.cost + patchCost + mergeResult.cost;
    recordIteration(result, i, iterCost, Date.now() - iterationStart, iterInputTokens, iterOutputTokens);

    previousSuccessRate = result.successRate;
    previousPrompt = currentPrompt;
    currentPrompt = mergeResult.text;
  }

  return finalize(false, bestPrompt);
}

async function callLLM(messages: Message[], config: OptimizerConfig): Promise<LLMResult> {
  const spec = providerSpecs[config.provider];
  const maxTokens = config.maxTokens ?? 4096;

  if (config.provider.startsWith('anthropic')) {
    const client = new Anthropic({ apiKey: config.apiKey });
    const response = await client.messages.create({
      model: spec.model,
      max_tokens: maxTokens,
      system: messages.find((m) => m.role === 'system')?.content,
      messages: messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    });
    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;
    const cost = (inputTokens * spec.costPerMillionInput + outputTokens * spec.costPerMillionOutput) / 1_000_000;
    return { text, cost, inputTokens, outputTokens };
  }

  // OpenAI
  const client = new OpenAI({ apiKey: config.apiKey });
  const response = await client.chat.completions.create({
    model: spec.model,
    max_tokens: maxTokens,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  });
  const text = response.choices[0].message.content ?? '';
  const inputTokens = response.usage?.prompt_tokens ?? 0;
  const outputTokens = response.usage?.completion_tokens ?? 0;
  const cost = (inputTokens * spec.costPerMillionInput + outputTokens * spec.costPerMillionOutput) / 1_000_000;
  return { text, cost, inputTokens, outputTokens };
}

// Helper to generate a patch fiven a failure, current prompt, and optionally previous prompt (for regression context)
// TODO: Ensure that all errors for a given test case are addressed in the patch.
async function generatePatch(
  failure: TestCaseResult,
  currentPrompt: string,
  config: OptimizerConfig,
  previousPrompt?: string
): Promise<LLMResult> {
  let userContent = 
  `
    Current system prompt:
    ---
    ${currentPrompt}
    ---

    A test case failed:
    ${formatFailure(failure)}`;

      if (previousPrompt) {
        userContent += `

    Note: The current prompt is a REGRESSION from a better-performing version.
    Previous (better) prompt for reference:
    ---
    ${previousPrompt}
    ---

    Analyze what changed between the two prompts that might have caused this failure.`;
      }

      userContent += `

    Suggest a specific change to the system prompt that would fix this failure.
    Be concise. Output ONLY the suggested patch/change, not the full prompt.
    DO NOT overfit the prompt to the test case.
    Generalize examples if you choose to use them.
  `;

  const messages: Message[] = [
    {
      role: 'system',
      content: 'You are optimizing a system prompt for an LLM workflow. Analyze the failure and suggest a specific, focused change to improve the prompt.',
    },
    {
      role: 'user',
      content: userContent,
    },
  ];

  return callLLM(messages, config);
}

async function mergePatches(
  patches: string[],
  currentPrompt: string,
  config: OptimizerConfig
): Promise<LLMResult> {
  const messages: Message[] = [
    {
      role: 'system',
      content: 'You are merging improvements into a system prompt. Incorporate the suggestions while keeping the prompt clear and coherent.',
    },
    {
      role: 'user',
      content: `Current prompt:
        ---
        ${currentPrompt}
        ---

        Suggested improvements:
        ${patches.map((p, i) => `${i + 1}. ${p}`).join('\n\n')}

        Create a single improved system prompt that incorporates these suggestions.
        Be mindful of the size of the new prompt. Use discretion when merging the patches, if you see duplicate information, emphasize it but don't repeat it.
        Output ONLY the new system prompt, nothing else.
      `,
    },
  ];

  return callLLM(messages, config);
}
