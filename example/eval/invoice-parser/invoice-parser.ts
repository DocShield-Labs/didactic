/**
 * Invoice Parser Evaluation Example
 *
 * Tests an invoice extraction workflow using Claude with structured outputs.
 * Demonstrates:
 * - Real LLM calls with cost tracking
 * - Field-level comparison using exact, numeric, and name comparators
 * - Unordered list matching for line items
 * - Handling OCR variations in vendor names and payment terms
 *
 * Run with: ANTHROPIC_API_KEY=your_key npx tsx example/eval/invoice-parser/invoice-parser.ts
 */

// Load environment variables from .env file
import 'dotenv/config';

import Anthropic from '@anthropic-ai/sdk';
import {
  didactic,
  exact,
  llmCompare,
  LLMProviders,
  name,
  numeric,
  unordered,
} from '../../../src/index.js';
import { testCases, type InvoiceInput, type Invoice } from './test-cases.js';

// Run the evaluation
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
  console.log(`Total cost: $${result.cost.toFixed(4)}`);
  console.log('='.repeat(60));
}

/**
 * JSON schema for invoice structured output
 * This ensures the LLM returns data in the exact format we need
 */
const INVOICE_SCHEMA = {
  type: 'object',
  properties: {
    invoiceNumber: { type: 'string' },
    vendor: { type: 'string' },
    invoiceDate: { type: 'string' },
    dueDate: { type: 'string' },
    customerName: { type: 'string' },
    lineItems: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          description: { type: 'string' },
          quantity: { type: 'number' },
          unitPrice: { type: 'number' },
          total: { type: 'number' },
        },
        required: ['description', 'quantity', 'unitPrice', 'total'],
        additionalProperties: false,
      },
    },
    subtotal: { type: 'number' },
    tax: { type: 'number' },
    total: { type: 'number' },
    paymentTerms: { type: 'string' },
  },
  required: [
    'invoiceNumber',
    'vendor',
    'invoiceDate',
    'dueDate',
    'customerName',
    'lineItems',
    'subtotal',
    'tax',
    'total',
    'paymentTerms',
  ],
  additionalProperties: false,
};

/**
 * Invoice parser function - uses an LLM to extract structured data from OCR text. This is where you would replace our LLM call with your own LLM workflow logic.
 *
 * This demonstrates a real AI extraction workflow using Anthropic's SDK
 * with structured outputs to ensure reliable JSON parsing.
 */
async function parseInvoice(input: InvoiceInput): Promise<Invoice> {
  // Get API key from environment variable
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY environment variable is required. ' +
        'Get your key from: https://console.anthropic.com/'
    );
  }

  // Create Anthropic client
  const client = new Anthropic({ apiKey });

  // Call Claude with structured outputs
  const response = await client.beta.messages.create({
    model: 'claude-haiku-4-5-20251001', // Fast and cheap for extraction
    max_tokens: 4096,
    betas: ['structured-outputs-2025-11-13'],
    messages: [
      {
        role: 'user',
        content: `Extract structured information from this invoice OCR text. Convert dates to YYYY-MM-DD format. Extract monetary values as numbers (no $ or commas).
        
        Invoice text:
        ${input.ocrText}`,
      },
    ],
    output_format: {
      type: 'json_schema',
      schema: INVOICE_SCHEMA,
    },
  });

  // With structured outputs, the response is guaranteed to be valid JSON
  const content = response.content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected response type from LLM');
  }

  return JSON.parse(content.text) as Invoice;
}

// Create the executor using didactic.fn
const invoiceParserExecutor = didactic.fn({
  fn: parseInvoice,
});


main().catch(console.error);
