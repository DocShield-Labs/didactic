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

import { didactic, name, date, numeric, within, exact, presence } from '../../src/index';
import { employmentStatus, presenceWithSentinels, retroactiveDateRDI } from './customComparators';
import { createTestCases } from './testCases';
import type { QuoteInput, QuoteOutput } from './types';

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
/**
 * HTTP endpoint executor that calls the quote extraction workflow API.
 */
const quoteExtractor = didactic.endpoint<QuoteInput, QuoteOutput>(
  'http://localhost:3000/api/v1/test-quote-workflow',
  {
    headers: {
      'x-api-key': process.env.API_KEY ?? '', 
    },
    mapResponse: (response: any) => response.data.testCases[0].results,
    timeout: 300000, // 2 minutes for LLM workflows
  }
);

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
  });

  const sep = '═'.repeat(60);

  // Print header
  console.log('\n' + sep);
  console.log('  EVALUATION RESULTS');
  console.log(sep);
  console.log(`  Tests:    ${result.passed}/${result.total} passed (${(result.successRate * 100).toFixed(0)}%)`);
  console.log(`  Fields:   ${result.correctFields}/${result.totalFields} correct (${(result.accuracy * 100).toFixed(1)}%)`);

  // Print each test case (already sorted by eval)
  for (const testCase of result.testCases) {
    console.log(sep);

    const status = testCase.passed ? '✓' : '✗';
    const emailId = (testCase.input as QuoteInput).emailId;
    const pct = (testCase.passRate * 100).toFixed(0);

    console.log(`${status} ${emailId}  [${testCase.passedFields}/${testCase.totalFields} fields, ${pct}%]`);

    if (testCase.error) {
      console.log(`\nERROR: ${testCase.error}`);
    }

    const failures = Object.entries(testCase.fields).filter(([, r]) => !r.passed);
    if (failures.length > 0) {
      // console.log('\nExpected:');
      // console.log(indent(JSON.stringify(testCase.expected, null, 2), 2));
      // console.log('\nActual:');
      // console.log(indent(JSON.stringify(testCase.actual, null, 2), 2));
      console.log('\nFailed:');
      for (const [field, fieldResult] of failures) {
        console.log(`  ${field}`);
        console.log(`    expected: ${formatValue(fieldResult.expected)}`);
        console.log(`    actual:   ${formatValue(fieldResult.actual)}`);
      }
    }
  }

  console.log(sep + '\n');
}

main().catch(console.error);
