/**
 * Quote Ingestion Example
 *
 * This example demonstrates how to use didactic to evaluate an LLM-based
 * quote extraction workflow. It shows:
 *
 * 1. Using built-in comparators (name, date, numeric, within, oneOf)
 * 2. Creating domain-specific custom comparators
 * 3. Configuring tolerances for fuzzy matching
 *
 * Run with: npx tsx example/quote-ingestion/index.ts
 */

import { didactic, name, date, numeric, within, exact, presence, LLMProviders, type OptimizeResult, type EvalResult, type TestCaseResult } from '../../src/index';
import { employmentStatus, presenceWithSentinels, retroactiveDateRDI } from './customComparators';
import { createTestCases } from './testCases';
import type { QuoteInput, QuoteOutput } from './types';

/**
 * Shape of the API response from the quote extraction workflow.
 */
interface ApiResponse {
  data: {
    testCases: Array<{
      results: QuoteOutput;
      additional_context: unknown;
    }>;
    totalCost: number;
  };
}

function formatValue(value: unknown): string {
  if (value === undefined) return '(undefined)';
  if (value === null) return '(null)';
  if (typeof value === 'string') return `"${value}"`;
  if (typeof value === 'object') {
    const json = JSON.stringify(value);
    return json.length > 80 ? JSON.stringify(value, null, 2) : json;
  }
  return String(value);
}

function logTestCases(testCases: TestCaseResult<QuoteInput, QuoteOutput>[], sep: string): void {
  for (const testCase of testCases) {
    console.log(sep);

    const status = testCase.passed ? '✓' : '✗';
    const emailId = testCase.input.emailId;
    const pct = (testCase.passRate * 100).toFixed(0);

    console.log(`${status} ${emailId}  [${testCase.passedFields}/${testCase.totalFields} fields, ${pct}%]`);

    if (testCase.error) {
      console.log(`\nERROR: ${testCase.error}`);
    }

    const failures = Object.entries(testCase.fields).filter(([, r]) => !r.passed);
    if (failures.length > 0) {
      console.log('\nFailed:');
      for (const [field, fieldResult] of failures) {
        console.log(`  ${field}`);
        console.log(`    expected: ${formatValue(fieldResult.expected)}`);
        console.log(`    actual:   ${formatValue(fieldResult.actual)}`);
      }
    }
  }
}

function logEvalResults(result: EvalResult<QuoteInput, QuoteOutput>): void {
  const sep = '═'.repeat(60);
  const successRate = result.passed / result.total;

  console.log('\n' + sep);
  console.log('  EVAL RESULTS');
  console.log(sep);
  console.log(`  Tests:    ${result.passed}/${result.total} passed (${(successRate * 100).toFixed(0)}%)`);
  console.log(`  Fields:   ${result.correctFields}/${result.totalFields} correct (${(result.accuracy * 100).toFixed(1)}%)`);

  logTestCases(result.testCases, sep);
  console.log(sep + '\n');
}

function logOptimizeResults(result: OptimizeResult<QuoteInput, QuoteOutput>): void {
  const sep = '═'.repeat(60);
  const lastIteration = result.iterations[result.iterations.length - 1];
  const successRate = lastIteration.passed / lastIteration.total;

  let correctFields = 0;
  let totalFields = 0;
  for (const tc of lastIteration.testCases) {
    const fieldResults = Object.values(tc.fields);
    totalFields += fieldResults.length;
    correctFields += fieldResults.filter((f) => f.passed).length;
  }
  const accuracy = totalFields > 0 ? correctFields / totalFields : 0;

  console.log('\n' + sep);
  console.log('  OPTIMIZATION RESULTS');
  console.log(sep);
  console.log(`  Success:  ${result.success ? 'Yes' : 'No'}`);
  console.log(`  Iterations: ${result.iterations.length}`);
  console.log(sep);
  console.log('  FINAL ITERATION');
  console.log(sep);
  console.log(`  Tests:    ${lastIteration.passed}/${lastIteration.total} passed (${(successRate * 100).toFixed(0)}%)`);
  console.log(`  Fields:   ${correctFields}/${totalFields} correct (${(accuracy * 100).toFixed(1)}%)`);

  logTestCases(lastIteration.testCases, sep);
  console.log(sep + '\n');
}

/**
 * HTTP endpoint executor that calls the quote extraction workflow API.
 * Note: mapResponse receives 'any' so you can type it directly - no casting needed.
 */
const quoteExtractor = didactic.endpoint<QuoteInput, QuoteOutput>(
  'http://localhost:3000/api/v1/test-quote-workflow',
  {
    headers: {
      'x-api-key': process.env.API_KEY ?? '',
    },
    mapResponse: (response: ApiResponse) => response.data.testCases[0].results,
    mapAdditionalContext: (response: ApiResponse) => response.data.testCases[0].additional_context,
    mapCost: (response: ApiResponse) => response.data.totalCost,
    timeout: 300000, // 5 minutes for LLM workflows
  }
);

/**
 * Function executor that wraps the same API call with fully typed code.
 * This demonstrates the clean type story:
 * - TInput (QuoteInput) is inferred from the fn parameter
 * - TOutput (QuoteOutput) is inferred from the fn return type
 * - No 'unknown' anywhere - everything is typed
 */
const quoteExtractorFn = didactic.fn({
  fn: async (input: QuoteInput): Promise<QuoteOutput> => {
    const response = await fetch('http://localhost:3000/api/v1/test-quote-workflow', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.API_KEY ?? '',
      },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    const data: ApiResponse = await response.json();
    return data.data.testCases[0].results;
  },
  mapAdditionalContext: (output) => output, // fully typed - output is QuoteOutput
});

async function main() {
  console.log('Running quote ingestion evaluation...\n');

  const testCases = await createTestCases();

  console.log(`Created ${testCases.length} test cases`);

  const result = await didactic.eval({
    testCases,
    executor: quoteExtractor,
    comparators: {
      additional_coverage: presenceWithSentinels,
      additional_coverage_add_ons: presenceWithSentinels,
      additional_insureds: presenceWithSentinels,
      endorsements: presenceWithSentinels,
      exclusions_limitations: presenceWithSentinels,
      execution_notes: presenceWithSentinels,
      subjectivities: presenceWithSentinels,
      underwriter_comments: presenceWithSentinels,
      aggregate_limit: numeric.nullable,
      deductible: numeric.nullable,
      per_occurrence_limit: numeric.nullable,
      premium: numeric.nullable,
      taxes: within({ tolerance: 20, mode: 'absolute' }),
      fees: within({ tolerance: 20, mode: 'absolute' }),
      applicant_name: name,
      effective_date: date,
      retroactive_date: retroactiveDateRDI,
      carrier_id: exact,
      employment_status: employmentStatus,
      medical_specialty: exact,
      policy_period_id: exact,
      policy_structure: exact,
      quote_level: exact,
      status: exact,
    },
    perTestThreshold: 0.95,
    unorderedList: true,

    // optimize: {
    //   provider: LLMProviders.anthropic_claude_opus,
    //   systemPrompt: ``,
    //   targetSuccessRate: 0.95,
    //   // maxIterations: 10,
    //   maxCost: 40,
    //   apiKey: process.env.ANTHROPIC_API_KEY ?? '',
    //   storeLogs: true, 
    // },
  });

  // Hacky narrowing to print the correct results
  if ('iterations' in result) {
    logOptimizeResults(result);
  } else {
    logEvalResults(result);
  }
}

main().catch(console.error);
