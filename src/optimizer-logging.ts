import type { TestCaseResult, OptimizerConfig, OptimizeOptions } from './types.js';
import { formatDuration, intervalToDuration } from 'date-fns';
import * as fs from 'fs';
import * as path from 'path';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════
// FORMATTERS
// ═══════════════════════════════════════════════════════════════════════════

export function formatMs(ms: number): string {
  const duration = intervalToDuration({ start: 0, end: ms });
  return formatDuration(duration, { format: ['hours', 'minutes', 'seconds'] }) || '0s';
}

function formatProgressBar(rate: number, width = 20): string {
  const filled = Math.round(rate * width);
  const empty = width - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

function truncateInput(input: unknown, maxLen = 50): string {
  const str = typeof input === 'string' ? input : JSON.stringify(input);
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

export function formatFailure(testCase: TestCaseResult): string {
  const lines: string[] = [];

  lines.push(`Input: ${JSON.stringify(testCase.input, null, 2)}`);
  lines.push(`Expected: ${JSON.stringify(testCase.expected, null, 2)}`);
  lines.push(`Actual: ${JSON.stringify(testCase.actual, null, 2)}`);

  if (testCase.additionalContext) {
    lines.push(`Context: ${JSON.stringify(testCase.additionalContext, null, 2)}`);
  }

  lines.push('');
  lines.push('Field-level failures:');

  for (const [path, result] of Object.entries(testCase.fields)) {
    if (!result.passed) {
      lines.push(`  ${path || '(root)'}: expected ${JSON.stringify(result.expected)}, got ${JSON.stringify(result.actual)}`);
    }
  }

  return lines.join('\n');
}

function formatFailedTestsTable(testCases: TestCaseResult[]): string {
  const failures = testCases.filter((tc) => !tc.passed);
  if (failures.length === 0) return '*All tests passed*\n';

  const lines: string[] = [];
  lines.push('| Test | Input (truncated) | Failed Fields |');
  lines.push('|------|-------------------|---------------|');

  testCases.forEach((tc, idx) => {
    if (!tc.passed) {
      const inputStr = truncateInput(tc.input);
      const failedFields = Object.entries(tc.fields)
        .filter(([, r]) => !r.passed)
        .map(([p, r]) => `\`${p || '(root)'}\`: ${JSON.stringify(r.expected)} → ${JSON.stringify(r.actual)}`)
        .join(', ');
      lines.push(`| #${idx + 1} | "${inputStr}" | ${failedFields} |`);
    }
  });

  return lines.join('\n') + '\n';
}

// ═══════════════════════════════════════════════════════════════════════════
// LOG GENERATION
// ═══════════════════════════════════════════════════════════════════════════

function generateIterationSection(iter: IterationLog): string[] {
  const lines: string[] = [];

  lines.push('');
  lines.push(`## Iteration ${iter.iteration}`);
  lines.push(`**Duration:** ${formatMs(iter.duration)}`);

  const rate = iter.total > 0 ? (iter.passed / iter.total) * 100 : 0;
  const fieldAccuracy = iter.totalFields > 0 ? (iter.correctFields / iter.totalFields) * 100 : 0;
  let resultLine = `**Result:** ${iter.passed}/${iter.total} passed (${rate.toFixed(1)}%)`;

  if (iter.previousSuccessRate !== undefined) {
    const delta = rate - iter.previousSuccessRate * 100;
    const arrow = delta >= 0 ? '▲' : '▼';
    resultLine += ` ${arrow} ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`;
  }

  resultLine += ` | **Field Accuracy:** ${iter.correctFields}/${iter.totalFields} (${fieldAccuracy.toFixed(1)}%)`;
  lines.push(resultLine);

  lines.push(`**Tokens:** ${iter.inputTokens.toLocaleString()} in / ${iter.outputTokens.toLocaleString()} out | **Cost:** $${iter.cost.toFixed(4)} | **Cumulative:** $${iter.cumulativeCost.toFixed(4)}`);
  lines.push('');
  lines.push('### System Prompt');
  lines.push('```');
  lines.push(iter.systemPrompt);
  lines.push('```');
  lines.push('');
  lines.push('### Failed Tests');
  lines.push(formatFailedTestsTable(iter.testCases));
  lines.push('---');

  return lines;
}

function generateSummarySection(
  iterations: IterationLog[],
  _options: OptimizeOptions,
  success: boolean,
  totalInputTokens: number,
  totalOutputTokens: number,
  totalDuration: number
): string[] {
  const lines: string[] = [];

  const firstIter = iterations[0];
  const lastIter = iterations[iterations.length - 1];
  const startRate = firstIter ? (firstIter.passed / firstIter.total) * 100 : 0;
  const endRate = lastIter ? (lastIter.passed / lastIter.total) * 100 : 0;
  const bestIter = iterations.reduce((best, curr) =>
    (curr.passed / curr.total) > (best.passed / best.total) ? curr : best
  );
  const bestRate = (bestIter.passed / bestIter.total) * 100;
  const totalCost = lastIter?.cumulativeCost ?? 0;

  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| **Iterations** | ${iterations.length} |`);
  lines.push(`| **Total Duration** | ${formatMs(totalDuration)} |`);
  lines.push(`| **Start → End** | ${startRate.toFixed(1)}% → ${endRate.toFixed(1)}% |`);
  lines.push(`| **Best Rate** | ${bestRate.toFixed(1)}% (${bestIter.passed}/${bestIter.total}) |`);
  lines.push(`| **Target Met** | ${success ? '✓ Yes' : '✗ No'} |`);
  lines.push(`| **Total Tokens** | ${totalInputTokens.toLocaleString()} in / ${totalOutputTokens.toLocaleString()} out |`);
  lines.push(`| **Total Cost** | $${totalCost.toFixed(4)} |`);
  lines.push('');

  return lines;
}

function generateProgressChart(iterations: IterationLog[], options: OptimizeOptions): string[] {
  const lines: string[] = [];

  lines.push('### Progression');
  lines.push('```');
  for (const iter of iterations) {
    const rate = iter.total > 0 ? iter.passed / iter.total : 0;
    const pct = (rate * 100).toFixed(1);
    const bar = formatProgressBar(rate);
    const targetMet = rate >= options.targetSuccessRate ? ' ✓' : '';
    lines.push(`Iter ${iter.iteration}: ${bar} ${pct}%${targetMet}  (${formatMs(iter.duration)})`);
  }
  lines.push('```');
  lines.push('');

  return lines;
}

export function generateLogContent(
  iterations: IterationLog[],
  config: OptimizerConfig,
  options: OptimizeOptions,
  success: boolean,
  finalPrompt: string
): string {
  const lines: string[] = [];
  const startTime = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const providerName = config.provider;
  const maxIterLabel = options.maxIterations ?? (options.maxCost !== undefined ? '∞' : '5');

  // Header
  lines.push('# Optimization Run');
  lines.push(`**Started:** ${startTime}`);
  lines.push(`**Provider:** ${providerName}`);
  lines.push(`**Target:** ${(options.targetSuccessRate * 100).toFixed(0)}% | **Max Iterations:** ${maxIterLabel} | **Test Cases:** ${iterations[0]?.total ?? 0}`);
  lines.push('');
  lines.push('---');

  // Accumulate totals while generating iteration sections
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalDuration = 0;

  for (const iter of iterations) {
    totalInputTokens += iter.inputTokens;
    totalOutputTokens += iter.outputTokens;
    totalDuration += iter.duration;
    lines.push(...generateIterationSection(iter));
  }

  // Summary and progression
  lines.push(...generateSummarySection(iterations, options, success, totalInputTokens, totalOutputTokens, totalDuration));
  lines.push(...generateProgressChart(iterations, options));

  // Final prompt
  lines.push('## Final Prompt');
  lines.push('```');
  lines.push(finalPrompt);
  lines.push('```');

  return lines.join('\n');
}

export async function writeLog(logPath: string, content: string): Promise<void> {
  const dir = path.dirname(logPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(logPath, content, 'utf-8');
}
