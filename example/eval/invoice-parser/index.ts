/**
 * Invoice Parser Evaluation Example
 *
 * Demonstrates how to use didactic.eval() to test an LLM extraction workflow.
 * Uses field-level comparators to handle real-world variations in extracted data.
 *
 * Run with: ANTHROPIC_API_KEY=your_key npx tsx example/eval/invoice-parser/index.ts
 */

import 'dotenv/config';

import {
  didactic,
  exact,
  llmCompare,
  LLMProviders,
  name,
  numeric,
  unordered,
} from '../../../src/index.js';
import { parseInvoice, mapCost } from './invoice-parser.js';
import { testCases } from './test-cases.js';

// Create an executor from the parseInvoice function (could be any LLM workflow)
const invoiceParserExecutor = didactic.fn({
  fn: parseInvoice,
  mapCost, // Calculate cost from token usage
});

async function main() {
  console.log('🧾 Invoice Parser Evaluation\n');
  console.log('Testing AI invoice extraction with real LLM calls...\n');
  console.log(`Running ${testCases.length} test cases...\n`);

  const result = await didactic.eval({
    executor: invoiceParserExecutor,
    testCases,
    // LLM config for all LLM-based comparators (llmCompare will use this)
    llmConfig: {
      apiKey: process.env.ANTHROPIC_API_KEY!,
      provider: LLMProviders.anthropic_claude_haiku,
    },
    comparators: {
      invoiceNumber: exact,
      vendor: name, // Handles OCR variations like "ACME SOFTWARE INC" vs "ACME SOFTWARE INC."
      invoiceDate: exact,
      dueDate: exact,
      customerName: name, // Handles minor spelling/format differences
      lineItems: unordered({
        // Unordered array of line item objects
        description: llmCompare({
          systemPrompt:
            'Compare the description of the invoice line item to the expected description, we want them to generally be the same and reference the same product or service.',
        }),
        quantity: exact,
        unitPrice: numeric,
        total: numeric,
      }),
      subtotal: numeric,
      tax: numeric,
      total: numeric,
      paymentTerms: name, // "Net 30" vs "NET 30" vs "Net30"
    },
  });

  // Show detailed results for each test case
  result.testCases.forEach((testCase, index) => {
    const status = testCase.passed ? '✅' : '❌';
    console.log(
      `${status} Test Case ${index + 1}: ${testCase.passed ? 'PASSED' : 'FAILED'}`
    );
    console.log(`   Pass Rate: ${(testCase.passRate * 100).toFixed(1)}%`);
    console.log(
      `   Fields: ${testCase.passedFields}/${testCase.totalFields} correct`
    );

    if (!testCase.passed) {
      console.log('   Failed fields:');
      Object.entries(testCase.fields).forEach(([field, fieldResult]) => {
        if (!fieldResult.passed) {
          console.log(`     - ${field}`);
          console.log(
            `       Expected: ${JSON.stringify(fieldResult.expected)}`
          );
          console.log(`       Got: ${JSON.stringify(fieldResult.actual)}`);
          if (fieldResult.rationale) {
            console.log(`       Rationale: ${fieldResult.rationale}`);
          }
        }
      });
    }
    console.log();
  });

  // Display overall results
  console.log('='.repeat(60));
  console.log(
    `Overall Success Rate: ${(result.successRate * 100).toFixed(1)}%`
  );
  console.log(`Tests Passed: ${result.passed}/${result.total}`);
  console.log(`Total workflow cost: $${result.cost.toFixed(4)}`);
  console.log(`Total comparator cost: $${result.comparatorCost.toFixed(4)}`);
  console.log(`Total cost: $${(result.cost + result.comparatorCost).toFixed(4)}`);
  console.log('='.repeat(60));
}

main().catch(console.error);

