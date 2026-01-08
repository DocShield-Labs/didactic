/**
 * Invoice Parser Workflow
 *
 * This file contains the user's LLM workflow code - the function that
 * extracts structured data from invoice OCR text. This is what you'd bring to didactic.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { InvoiceInput, Invoice } from './test-cases.js';

// JSON schema for invoice structured output
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

// Claude Haiku 4.5 pricing (per million tokens)
const HAIKU_INPUT_COST = 1.0;
const HAIKU_OUTPUT_COST = 5.0;

/** Result includes the parsed invoice and cost for tracking */
export interface ParseInvoiceResult extends Invoice {
  _cost: number; // Internal field for cost tracking
}

/**
 * Parse an invoice using Claude with structured outputs.
 * Returns the parsed invoice with cost information embedded.
 */
export async function parseInvoice(
  input: InvoiceInput
): Promise<ParseInvoiceResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY environment variable is required. ' +
        'Get your key from: https://console.anthropic.com/'
    );
  }

  const client = new Anthropic({ apiKey });

  const response = await client.beta.messages.create({
    model: 'claude-haiku-4-5-20251001',
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

  const content = response.content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected response type from LLM');
  }

  // Calculate cost from token usage
  const cost =
    (response.usage.input_tokens * HAIKU_INPUT_COST) / 1_000_000 +
    (response.usage.output_tokens * HAIKU_OUTPUT_COST) / 1_000_000;

  const invoice = JSON.parse(content.text) as Invoice;

  return {
    ...invoice,
    _cost: cost,
  };
}

/** Extract cost from the result */
export function mapCost(result: ParseInvoiceResult): number {
  return result._cost;
}
