import * as fs from 'fs';
import * as path from 'path';
import type { EvalResult, FieldResult } from '../types.js';
import { DEFAULT_PER_TEST_THRESHOLD } from '../library/constants.js';

/**
 * Structure for rawData.json output from evaluate()
 */
export interface EvalReport {
  metadata: {
    timestamp: string;
    systemPrompt?: string;
    testCaseCount: number;
    perTestThreshold: number;
  };
  summary: {
    passed: number;
    total: number;
    successRate: number;
    correctFields: number;
    totalFields: number;
    accuracy: number;
    executorCost: number;
    comparatorCost: number;
    totalCost: number;
    durationMs: number;
  };
  testCases: TestCaseData[];
}

interface TestCaseData {
  index: number;
  passed: boolean;
  passRate: number;
  input: unknown;
  expected: unknown;
  actual: unknown;
  additionalContext?: unknown;
  /** Executor cost. 0 indicates either zero cost or cost not tracked. */
  executorCost: number;
  /** Comparator cost. 0 indicates either zero cost or cost not tracked. */
  comparatorCost: number;
  error?: string;
  fields: Record<string, FieldResult>;
}

/**
 * Write evaluation results to rawData.json
 *
 * Synchronous writes are intentional - logging runs after evaluation completes
 * and errors are caught. This avoids async complexity in the calling code.
 */
export function writeEvalLogs<TInput, TOutput>(
  logPath: string,
  result: EvalResult<TInput, TOutput>,
  durationMs: number,
  perTestThreshold?: number
): void {
  try {
    const dir = path.dirname(logPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const report: EvalReport = {
      metadata: {
        timestamp: new Date().toISOString(),
        systemPrompt: result.systemPrompt,
        testCaseCount: result.total,
        perTestThreshold: perTestThreshold ?? DEFAULT_PER_TEST_THRESHOLD,
      },
      summary: {
        passed: result.passed,
        total: result.total,
        successRate: result.successRate,
        correctFields: result.correctFields,
        totalFields: result.totalFields,
        accuracy: result.accuracy,
        executorCost: result.cost,
        comparatorCost: result.comparatorCost,
        totalCost: result.cost + result.comparatorCost,
        durationMs,
      },
      testCases: result.testCases.map((tc, index) => ({
        index,
        passed: tc.passed,
        passRate: tc.passRate,
        input: tc.input,
        expected: tc.expected,
        actual: tc.actual,
        additionalContext: tc.additionalContext,
        executorCost: tc.cost ?? 0,
        comparatorCost: tc.comparatorCost ?? 0,
        error: tc.error,
        fields: tc.fields,
      })),
    };

    fs.writeFileSync(logPath, JSON.stringify(report, null, 2), 'utf-8');
  } catch (error) {
    console.error(
      `Failed to write eval logs to ${logPath}:`,
      error instanceof Error ? error.message : String(error)
    );
    // Don't throw - evaluation succeeded, just log persistence failed
  }
}
