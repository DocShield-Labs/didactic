import type { TestCaseResult, LLMProviders } from '../types.js';
import type { IterationLog, LogContext } from './types.js';
import * as fs from 'fs';
import * as path from 'path';
import {
  theme,
  spinner,
  createProgressTracker,
  formatCost,
  formatCostShort,
  formatDuration,
  formatPercentage,
  type ProgressTracker,
} from './ui.js';

// Re-export types for backward compatibility
export type { IterationLog, LogContext };

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

/** Metadata for JSON report */
interface OptimizationMetadata {
  timestamp: string;
  model: string;
  provider: LLMProviders;
  thinking: boolean;
  targetSuccessRate: number;
  maxIterations: number | null;
  maxCost: number | null;
  testCaseCount: number;
  perTestThreshold: number;
  rateLimitBatch?: number;
  rateLimitPause?: number;
}

/** Summary stats for JSON report */
interface OptimizationSummary {
  totalIterations: number;
  totalDurationMs: number;
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  startRate: number;
  endRate: number;
  targetMet: boolean;
}

/** Best run info for JSON report */
interface BestRun {
  iteration: number;
  successRate: number;
  passed: number;
  total: number;
  fieldAccuracy: number;
}

/** Full JSON report structure */
interface OptimizationReport {
  metadata: OptimizationMetadata;
  summary: OptimizationSummary;
  best: BestRun;
  iterations: IterationData[];
}

/** Per-iteration data for JSON report */
interface IterationData {
  iteration: number;
  successRate: number;
  passed: number;
  total: number;
  correctFields: number;
  totalFields: number;
  fieldAccuracy: number;
  cost: number;
  cumulativeCost: number;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  failures: FailureData[];
}

/** Failure data for JSON report */
interface FailureData {
  testIndex: number;
  input: unknown;
  expected: unknown;
  actual: unknown;
  additionalContext?: unknown;
  fields: Record<
    string,
    { expected: unknown; actual: unknown; passed: boolean }
  >;
}

// ───────────────────────────────────────────────────────────────────────────
// BestRun.json Types
// ───────────────────────────────────────────────────────────────────────────

interface BestRunMetadata {
  iteration: number;
  model: string;
  provider: LLMProviders;
  thinking: boolean;
  targetSuccessRate: number;
  perTestThreshold: number;
  rateLimitBatch?: number;
  rateLimitPause?: number;
}

interface BestRunResults {
  successRate: number;
  passed: number;
  total: number;
  fieldAccuracy: number;
  correctFields: number;
  totalFields: number;
}

interface BestRunCost {
  iteration: number;
  cumulative: number;
}

interface BestRunTiming {
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
}

interface BestRunFailure {
  testIndex: number;
  input: unknown;
  expected: unknown;
  actual: unknown;
  additionalContext?: unknown;
  failedFields: Record<string, { expected: unknown; actual: unknown }>;
}

interface BestRunPartialFailure {
  testIndex: number;
  passRate: number;
  input: unknown;
  expected: unknown;
  actual: unknown;
  additionalContext?: unknown;
  failedFields: Record<string, { expected: unknown; actual: unknown }>;
}

interface BestRunSuccess {
  testIndex: number;
  input: unknown;
  expected: unknown;
  actual: unknown;
  additionalContext?: unknown;
}

interface BestRunReport {
  metadata: BestRunMetadata;
  results: BestRunResults;
  cost: BestRunCost;
  timing: BestRunTiming;
  failures: BestRunFailure[];
  partialFailures: BestRunPartialFailure[];
  successes: BestRunSuccess[];
}

// ═══════════════════════════════════════════════════════════════════════════
// FORMATTERS
// ═══════════════════════════════════════════════════════════════════════════

function formatMsCompact(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function formatProgressBar(rate: number, width = 20): string {
  const filled = Math.round(rate * width);
  const empty = width - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

function formatTokensCompact(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return String(tokens);
}

// ═══════════════════════════════════════════════════════════════════════════
// PROGRESS TRACKING
// ═══════════════════════════════════════════════════════════════════════════

/** Progress bar updater interface */
interface ProgressUpdater {
  update(completed: number, total: number): void;
  finish(): void;
  clear(): void;
}

/**
 * Clear any active progress line before logging
 * Call this before all console.log statements
 */
export function clearProgressLine(): void {
  const width = process.stdout.columns || 80;
  process.stdout.write('\r' + ' '.repeat(width) + '\r');
}

/**
 * Create a progress updater using cli-progress for beautiful output
 */
export function createProgressUpdater(label: string): ProgressUpdater {
  let tracker: ProgressTracker | null = null;
  let total = 0;

  return {
    update(completed: number, newTotal: number) {
      // Initialize on first call
      if (!tracker) {
        total = newTotal;
        tracker = createProgressTracker(label);
        tracker.start(total);
      }
      tracker.update(completed);
    },

    finish() {
      if (tracker) {
        tracker.stop();
        tracker = null;
      }
    },

    clear() {
      clearProgressLine();
    },
  };
}

/**
 * Track progress of Promise.allSettled with real-time updates
 *
 * @param promises Array of promises to track
 * @param onProgress Callback called when each promise settles
 * @returns Promise.allSettled result
 */
export async function trackPromiseProgress<T>(
  promises: Promise<T>[],
  onProgress: (completed: number, total: number) => void
): Promise<PromiseSettledResult<T>[]> {
  if (promises.length === 0) {
    return [];
  }

  let completed = 0;
  const total = promises.length;

  // Initial progress
  onProgress(0, total);

  // Wrap each promise to track completion
  const wrappedPromises = promises.map((promise) =>
    promise
      .then((value) => {
        completed++;
        onProgress(completed, total);
        return { status: 'fulfilled' as const, value };
      })
      .catch((reason) => {
        completed++;
        onProgress(completed, total);
        return { status: 'rejected' as const, reason };
      })
  );

  return Promise.all(wrappedPromises);
}

export function formatFailure(testCase: TestCaseResult): string {
  const lines: string[] = [];

  lines.push(`Input: ${JSON.stringify(testCase.input, null, 2)}`);
  lines.push(`Expected: ${JSON.stringify(testCase.expected, null, 2)}`);
  lines.push(`Actual: ${JSON.stringify(testCase.actual, null, 2)}`);

  if (testCase.additionalContext) {
    lines.push(
      `Additional Context: ${JSON.stringify(testCase.additionalContext, null, 2)}`
    );
  }

  lines.push('');
  lines.push('Field-level failures:');

  for (const [fieldPath, result] of Object.entries(testCase.fields)) {
    if (!result.passed) {
      lines.push(
        `  ${fieldPath || '(root)'}: expected ${JSON.stringify(result.expected)}, got ${JSON.stringify(result.actual)}`
      );
    }
  }

  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function findBestIteration(iterations: IterationLog[]): IterationLog {
  return iterations.reduce((best, curr) =>
    curr.passed / curr.total > best.passed / best.total ? curr : best
  );
}

function computeTotals(iterations: IterationLog[]): {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalDuration: number;
} {
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalDuration = 0;

  for (const iter of iterations) {
    totalInputTokens += iter.inputTokens;
    totalOutputTokens += iter.outputTokens;
    totalDuration += iter.duration;
  }

  return { totalInputTokens, totalOutputTokens, totalDuration };
}

// ═══════════════════════════════════════════════════════════════════════════
// CONSOLE LOGGING
// ═══════════════════════════════════════════════════════════════════════════

export function logOptimizerHeader(
  model: string,
  targetRate: number,
  testCount: number
): void {
  spinner.stop();
  console.log('');
  console.log(theme.bold('Didactic Optimizer'));
  console.log(
    `  ${theme.dim('Model:')} ${model}${theme.separator}${theme.dim('Target:')} ${formatPercentage(targetRate)}${theme.separator}${theme.dim('Tests:')} ${testCount}`
  );
}

export function logIterationStart(iterationLabel: string): void {
  spinner.stop();
  clearProgressLine();
  console.log('');
  console.log(theme.divider(`Iteration ${iterationLabel}`));
  console.log('');
}

export function logEvaluationStart(): void {
  spinner.stop();
  clearProgressLine();
  console.log(`  ${theme.bold('Evaluating prompt')}`);
  spinner.start('Running evals...');
}

export function logEvaluationResult(
  result: { passed: number; total: number; successRate: number; cost: number },
  cumulativeCost: number,
  durationMs: number
): void {
  spinner.stop();
  clearProgressLine();

  // Success rate line
  const successIcon =
    result.successRate >= 0.9
      ? theme.check
      : result.successRate >= 0.5
        ? theme.warn
        : theme.cross;
  console.log(
    `    ${successIcon} ${theme.bold(formatPercentage(result.successRate))} success rate  ${theme.dim(`(${result.passed}/${result.total} passed)`)}`
  );

  // Cost line
  console.log(
    `    ${theme.dim('Cost:')} ${formatCost(result.cost)}${theme.separator}${theme.dim('Total:')} ${formatCostShort(cumulativeCost)}${theme.separator}${theme.dim(formatDuration(durationMs))}`
  );
}

export function logRegressionDetected(bestSuccessRate: number): void {
  spinner.stop();
  clearProgressLine();
  console.log(
    `    ${theme.pointer} ${theme.warning('Regression')} ${theme.dim(`(was ${formatPercentage(bestSuccessRate)})`)}`
  );
}

export function logTargetReached(targetSuccessRate: number): void {
  spinner.stop();
  clearProgressLine();
  console.log(
    `    ${theme.check} ${theme.success('Target reached!')} ${theme.dim(`(${formatPercentage(targetSuccessRate)})`)}`
  );
}

export function logTargetFailures(
  targetSuccessRate: number,
  failureCount: number
): void {
  spinner.stop();
  clearProgressLine();
  console.log(
    `    ${theme.cross} ${theme.error(`${failureCount} failures`)} to address ${theme.dim(`(target: ${formatPercentage(targetSuccessRate)})`)}`
  );
}

export function logCostLimitReached(cumulativeCost: number): void {
  spinner.stop();
  clearProgressLine();
  console.log(
    `    ${theme.warn} ${theme.warning('Cost limit reached')} ${theme.dim(`($${cumulativeCost.toFixed(2)})`)}`
  );
}

export function logPatchGenerationStart(failureCount: number): void {
  spinner.stop();
  clearProgressLine();
  console.log('');
  console.log(`  ${theme.bold('Generating patches')}`);
  spinner.start(`Generating ${failureCount} patches in parallel...`);
}

export function logPatchGenerationResult(
  patchCost: number,
  cumulativeCost: number,
  durationMs: number
): void {
  spinner.stop();
  clearProgressLine();
  console.log(
    `    ${theme.check} Patches generated${theme.separator}${theme.dim('Cost:')} ${formatCost(patchCost)}${theme.separator}${theme.dim('Total:')} ${formatCostShort(cumulativeCost)}${theme.separator}${theme.dim(formatDuration(durationMs))}`
  );
}

export function logMergeStart(): void {
  spinner.stop();
  clearProgressLine();
  console.log('');
  console.log(`  ${theme.bold('Merging patches')}`);
  spinner.start('Merging patches...');
}

export function logMergeResult(
  mergeCost: number,
  cumulativeCost: number,
  durationMs: number
): void {
  spinner.stop();
  clearProgressLine();
  console.log(
    `    ${theme.check} Merged${theme.separator}${theme.dim('Cost:')} ${formatCost(mergeCost)}${theme.separator}${theme.dim('Total:')} ${formatCostShort(cumulativeCost)}${theme.separator}${theme.dim(formatDuration(durationMs))}`
  );
}

export function logPatchGenerationFailures(
  failedCount: number,
  totalCount: number
): void {
  spinner.stop();
  clearProgressLine();
  console.log(
    `    ${theme.warn} ${theme.warning(`${failedCount}/${totalCount} patch generations failed`)}`
  );
}

export function logOptimizationComplete(
  bestSuccessRate: number,
  targetSuccessRate: number,
  cumulativeCost: number
): void {
  spinner.stop();
  clearProgressLine();
  console.log('');
  console.log(theme.divider('Complete'));
  console.log('');

  const targetMet = bestSuccessRate >= targetSuccessRate;
  const icon = targetMet ? theme.check : theme.cross;
  const rateColor = targetMet ? theme.success : theme.error;

  console.log(
    `  ${icon} ${theme.bold('Best:')} ${rateColor(formatPercentage(bestSuccessRate))}`
  );
  console.log(
    `  ${theme.dim('Target:')} ${formatPercentage(targetSuccessRate)}${theme.separator}${theme.dim('Total Cost:')} ${formatCostShort(cumulativeCost)}`
  );
}

export function logLogsWritten(logPath: string): void {
  spinner.stop();
  clearProgressLine();
  console.log(`  ${theme.dim('Logs written to:')} ${logPath}`);
  console.log('');
}

// ═══════════════════════════════════════════════════════════════════════════
// MARKDOWN REPORT (One Sheet - No Prompts, No Failures)
// ═══════════════════════════════════════════════════════════════════════════

function generateConfigSection(
  ctx: LogContext,
  testCaseCount: number
): string[] {
  const lines: string[] = [];
  const maxIterLabel =
    ctx.config.maxIterations ??
    (ctx.config.maxCost !== undefined ? '∞ (cost-limited)' : '5');

  lines.push('## Configuration');
  lines.push('| Setting | Value |');
  lines.push('|---------|-------|');
  lines.push(`| Model | ${ctx.model} |`);
  lines.push(`| Provider | ${ctx.config.provider} |`);
  lines.push(`| Thinking | ${ctx.config.thinking ? 'Enabled' : 'Disabled'} |`);
  lines.push(
    `| Target | ${(ctx.config.targetSuccessRate * 100).toFixed(0)}% |`
  );
  lines.push(`| Max Iterations | ${maxIterLabel} |`);
  if (ctx.config.maxCost !== undefined) {
    lines.push(`| Max Cost | $${ctx.config.maxCost.toFixed(2)} |`);
  }
  lines.push(`| Test Cases | ${testCaseCount} |`);
  if (ctx.rateLimitBatch !== undefined || ctx.rateLimitPause !== undefined) {
    const batch = ctx.rateLimitBatch ?? 'all';
    const pause = ctx.rateLimitPause ?? 0;
    lines.push(`| Rate Limit | ${batch} cases/batch, ${pause}s pause |`);
  }
  lines.push(
    `| Per-Test Threshold | ${((ctx.perTestThreshold ?? 1.0) * 100).toFixed(0)}% |`
  );
  lines.push('');

  return lines;
}

function generateBestRunSection(bestIter: IterationLog): string[] {
  const lines: string[] = [];
  const rate = (bestIter.passed / bestIter.total) * 100;
  const fieldAccuracy =
    bestIter.totalFields > 0
      ? (bestIter.correctFields / bestIter.totalFields) * 100
      : 100;

  lines.push('## Best Run');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Iteration | ${bestIter.iteration} |`);
  lines.push(
    `| Success Rate | ${rate.toFixed(1)}% (${bestIter.passed}/${bestIter.total}) |`
  );
  lines.push(
    `| Field Accuracy | ${fieldAccuracy.toFixed(1)}% (${bestIter.correctFields}/${bestIter.totalFields}) |`
  );
  lines.push(`| Cost | $${bestIter.cost.toFixed(2)} |`);
  lines.push('');

  return lines;
}

function generateSummarySection(
  iterations: IterationLog[],
  success: boolean,
  totals: {
    totalInputTokens: number;
    totalOutputTokens: number;
    totalDuration: number;
  }
): string[] {
  const lines: string[] = [];
  const firstIter = iterations[0];
  const lastIter = iterations[iterations.length - 1];
  const startRate = firstIter ? (firstIter.passed / firstIter.total) * 100 : 0;
  const endRate = lastIter ? (lastIter.passed / lastIter.total) * 100 : 0;
  const totalCost = lastIter?.cumulativeCost ?? 0;

  lines.push('## Summary');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Total Iterations | ${iterations.length} |`);
  lines.push(`| Total Duration | ${formatMsCompact(totals.totalDuration)} |`);
  lines.push(
    `| Start -> End | ${startRate.toFixed(1)}% -> ${endRate.toFixed(1)}% |`
  );
  lines.push(`| Target Met | ${success ? '✓ Yes' : '✗ No'} |`);
  lines.push(
    `| Total Tokens | ${formatTokensCompact(totals.totalInputTokens)} in / ${formatTokensCompact(totals.totalOutputTokens)} out |`
  );
  lines.push(`| Total Cost | $${totalCost.toFixed(2)} |`);
  lines.push('');

  return lines;
}

function generateRunsTable(iterations: IterationLog[]): string[] {
  const lines: string[] = [];
  const bestRate = Math.max(...iterations.map((i) => i.passed / i.total));

  lines.push('## Runs');
  lines.push('| # | Rate | Fields | Cost | Duration | Tokens In/Out |');
  lines.push('|---|------|--------|------|----------|---------------|');

  for (let i = 0; i < iterations.length; i++) {
    const iter = iterations[i];
    const rate = iter.passed / iter.total;
    const ratePct = (rate * 100).toFixed(1);
    const fieldAccuracy =
      iter.totalFields > 0
        ? (iter.correctFields / iter.totalFields) * 100
        : 100;

    // Determine indicator: ★ for best, ↓ for regression
    let indicator = '';
    if (rate === bestRate) {
      indicator = ' ★';
    } else if (
      iter.previousSuccessRate !== undefined &&
      rate < iter.previousSuccessRate
    ) {
      indicator = ' ↓';
    }

    const tokens = `${formatTokensCompact(iter.inputTokens)} / ${formatTokensCompact(iter.outputTokens)}`;

    lines.push(
      `| ${iter.iteration} | ${ratePct}% (${iter.passed}/${iter.total})${indicator} | ${fieldAccuracy.toFixed(1)}% | $${iter.cost.toFixed(2)} | ${formatMsCompact(iter.duration)} | ${tokens} |`
    );
  }

  lines.push('');
  lines.push('★ = Best | ↓ = Regressed');
  lines.push('');

  return lines;
}

function generateProgressChart(
  iterations: IterationLog[],
  targetRate: number
): string[] {
  const lines: string[] = [];
  const bestRate = Math.max(...iterations.map((i) => i.passed / i.total));

  lines.push('## Progression');
  lines.push('```');
  for (const iter of iterations) {
    const rate = iter.total > 0 ? iter.passed / iter.total : 0;
    const pct = (rate * 100).toFixed(1);
    const bar = formatProgressBar(rate);
    let suffix = '';
    if (rate === bestRate) suffix += ' ★';
    if (rate >= targetRate) suffix += ' ✓';
    lines.push(
      `Iter ${iter.iteration}: ${bar} ${pct}%  ${formatMsCompact(iter.duration)}${suffix}`
    );
  }
  lines.push('```');
  lines.push('');

  return lines;
}

export function generateLogContent(
  iterations: IterationLog[],
  ctx: LogContext,
  success: boolean
): string {
  const lines: string[] = [];
  const startTimeStr = ctx.startTime.toLocaleString();
  const testCaseCount = iterations[0]?.total ?? 0;
  const bestIter = findBestIteration(iterations);
  const totals = computeTotals(iterations);

  // Header
  lines.push('# Optimization Report');
  lines.push(`**Run:** ${startTimeStr}`);
  lines.push('');

  // Sections
  lines.push(...generateConfigSection(ctx, testCaseCount));
  lines.push(...generateBestRunSection(bestIter));
  lines.push(...generateSummarySection(iterations, success, totals));
  lines.push(...generateRunsTable(iterations));
  lines.push(
    ...generateProgressChart(iterations, ctx.config.targetSuccessRate)
  );

  // Footer with links to companion files
  lines.push('---');
  lines.push('Prompts: `prompts.md`');
  lines.push('Raw data: `rawData.json`');
  lines.push('Best run: `bestRun.json`');

  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// FILE WRITERS
// ═══════════════════════════════════════════════════════════════════════════

export function writeLog(logPath: string, content: string): void {
  const dir = path.dirname(logPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(logPath, content, 'utf-8');
}

export function writeRawDataJson(
  folderPath: string,
  iterations: IterationLog[],
  ctx: LogContext,
  success: boolean
): void {
  const jsonPath = path.join(folderPath, 'rawData.json');
  const bestIter = findBestIteration(iterations);
  const totals = computeTotals(iterations);

  const firstIter = iterations[0];
  const lastIter = iterations[iterations.length - 1];

  const report: OptimizationReport = {
    metadata: {
      timestamp: ctx.startTime.toISOString(),
      model: ctx.model,
      provider: ctx.config.provider,
      thinking: ctx.config.thinking ?? false,
      targetSuccessRate: ctx.config.targetSuccessRate,
      maxIterations: ctx.config.maxIterations ?? null,
      maxCost: ctx.config.maxCost ?? null,
      testCaseCount: firstIter?.total ?? 0,
      perTestThreshold: ctx.perTestThreshold ?? 1.0,
      rateLimitBatch: ctx.rateLimitBatch,
      rateLimitPause: ctx.rateLimitPause,
    },
    summary: {
      totalIterations: iterations.length,
      totalDurationMs: totals.totalDuration,
      totalCost: lastIter?.cumulativeCost ?? 0,
      totalInputTokens: totals.totalInputTokens,
      totalOutputTokens: totals.totalOutputTokens,
      startRate: firstIter ? firstIter.passed / firstIter.total : 0,
      endRate: lastIter ? lastIter.passed / lastIter.total : 0,
      targetMet: success,
    },
    best: {
      iteration: bestIter.iteration,
      successRate: bestIter.passed / bestIter.total,
      passed: bestIter.passed,
      total: bestIter.total,
      fieldAccuracy:
        bestIter.totalFields > 0
          ? bestIter.correctFields / bestIter.totalFields
          : 1,
    },
    iterations: iterations.map((iter) => {
      const failures: FailureData[] = [];
      iter.testCases.forEach((tc, testIdx) => {
        if (!tc.passed) {
          failures.push({
            testIndex: testIdx,
            input: tc.input,
            expected: tc.expected,
            actual: tc.actual,
            additionalContext: tc.additionalContext,
            fields: tc.fields,
          });
        }
      });

      return {
        iteration: iter.iteration,
        successRate: iter.passed / iter.total,
        passed: iter.passed,
        total: iter.total,
        correctFields: iter.correctFields,
        totalFields: iter.totalFields,
        fieldAccuracy:
          iter.totalFields > 0 ? iter.correctFields / iter.totalFields : 1,
        cost: iter.cost,
        cumulativeCost: iter.cumulativeCost,
        durationMs: iter.duration,
        inputTokens: iter.inputTokens,
        outputTokens: iter.outputTokens,
        failures,
      };
    }),
  };

  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf-8');
}

export function writePromptsFile(
  folderPath: string,
  iterations: IterationLog[],
  ctx: LogContext
): void {
  const promptsPath = path.join(folderPath, 'prompts.md');
  const startTimeStr = ctx.startTime.toLocaleString();
  const bestIter = findBestIteration(iterations);
  const lines: string[] = [];

  lines.push('# Prompts Log');
  lines.push(`**Run:** ${startTimeStr}`);
  lines.push('');

  for (const iter of iterations) {
    const rate = iter.total > 0 ? (iter.passed / iter.total) * 100 : 0;
    lines.push(
      `## Iteration ${iter.iteration} | ${rate.toFixed(1)}% (${iter.passed}/${iter.total})`
    );
    lines.push('');
    lines.push('```');
    lines.push(iter.systemPrompt);
    lines.push('```');
    lines.push('');
    if (iter.iteration < iterations.length) {
      lines.push('---');
      lines.push('');
    }
  }

  // Add Best Prompt section at the end
  lines.push('---');
  lines.push('');
  const bestRate = (bestIter.passed / bestIter.total) * 100;
  lines.push(
    `## Best Prompt (Iteration ${bestIter.iteration}) | ${bestRate.toFixed(1)}% (${bestIter.passed}/${bestIter.total})`
  );
  lines.push('');
  lines.push('```');
  lines.push(bestIter.systemPrompt);
  lines.push('```');

  fs.writeFileSync(promptsPath, lines.join('\n'), 'utf-8');
}

export function writeBestRunJson(
  folderPath: string,
  iterations: IterationLog[],
  ctx: LogContext
): void {
  const bestRunPath = path.join(folderPath, 'bestRun.json');
  const bestIter = findBestIteration(iterations);

  // Extract only failed fields (not all fields)
  const extractFailedFields = (
    fields: Record<
      string,
      { passed: boolean; expected: unknown; actual: unknown }
    >
  ): Record<string, { expected: unknown; actual: unknown }> => {
    const failedFields: Record<string, { expected: unknown; actual: unknown }> =
      {};
    for (const [fieldPath, result] of Object.entries(fields)) {
      if (!result.passed) {
        failedFields[fieldPath] = {
          expected: result.expected,
          actual: result.actual,
        };
      }
    }
    return failedFields;
  };

  // Categorize test cases into three groups
  const failures: BestRunFailure[] = [];
  const partialFailures: BestRunPartialFailure[] = [];
  const successes: BestRunSuccess[] = [];

  bestIter.testCases.forEach((tc, testIdx) => {
    if (!tc.passed) {
      // Test failed overall (didn't meet perTestThreshold)
      failures.push({
        testIndex: testIdx,
        input: tc.input,
        expected: tc.expected,
        actual: tc.actual,
        additionalContext: tc.additionalContext,
        failedFields: extractFailedFields(tc.fields),
      });
    } else if (tc.passRate < 1) {
      // Test passed but has some failing fields
      partialFailures.push({
        testIndex: testIdx,
        passRate: tc.passRate,
        input: tc.input,
        expected: tc.expected,
        actual: tc.actual,
        additionalContext: tc.additionalContext,
        failedFields: extractFailedFields(tc.fields),
      });
    } else {
      // Test passed with 100% field accuracy
      successes.push({
        testIndex: testIdx,
        input: tc.input,
        expected: tc.expected,
        actual: tc.actual,
        additionalContext: tc.additionalContext,
      });
    }
  });

  const report: BestRunReport = {
    metadata: {
      iteration: bestIter.iteration,
      model: ctx.model,
      provider: ctx.config.provider,
      thinking: ctx.config.thinking ?? false,
      targetSuccessRate: ctx.config.targetSuccessRate,
      perTestThreshold: ctx.perTestThreshold ?? 1.0,
      rateLimitBatch: ctx.rateLimitBatch,
      rateLimitPause: ctx.rateLimitPause,
    },
    results: {
      successRate: bestIter.passed / bestIter.total,
      passed: bestIter.passed,
      total: bestIter.total,
      fieldAccuracy:
        bestIter.totalFields > 0
          ? bestIter.correctFields / bestIter.totalFields
          : 1,
      correctFields: bestIter.correctFields,
      totalFields: bestIter.totalFields,
    },
    cost: {
      iteration: bestIter.cost,
      cumulative: bestIter.cumulativeCost,
    },
    timing: {
      durationMs: bestIter.duration,
      inputTokens: bestIter.inputTokens,
      outputTokens: bestIter.outputTokens,
    },
    failures,
    partialFailures,
    successes,
  };

  fs.writeFileSync(bestRunPath, JSON.stringify(report, null, 2), 'utf-8');
}

export function writeFinalLogs(
  logPath: string,
  iterationLogs: IterationLog[],
  logContext: LogContext,
  success: boolean
): void {
  // logPath is expected to be like: ./didactic-logs/optimize_<timestamp>/summary.md
  const folderPath = path.dirname(logPath);

  // Create folder if it doesn't exist
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
  }

  // Write summary.md
  const content = generateLogContent(iterationLogs, logContext, success);
  fs.writeFileSync(path.join(folderPath, 'summary.md'), content, 'utf-8');

  // Write prompts.md
  writePromptsFile(folderPath, iterationLogs, logContext);

  // Write rawData.json
  writeRawDataJson(folderPath, iterationLogs, logContext, success);

  // Write bestRun.json
  writeBestRunJson(folderPath, iterationLogs, logContext);
}
