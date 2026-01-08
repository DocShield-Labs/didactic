/**
 * Expense Categorizer Workflow
 *
 * This file contains the user's LLM workflow code - the function that
 * classifies expenses. This is what you'd bring to didactic.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { ExpenseInput, ExpenseOutput } from './test-cases.js';

// Categories the model must choose from
const CATEGORIES = [
  'travel',
  'meals',
  'client_entertainment',
  'software',
  'office',
  'equipment',
  'recruiting',
  'professional_services',
  'marketing',
] as const;

// JSON schema for structured output
const EXPENSE_SCHEMA = {
  type: 'object',
  properties: {
    category: {
      type: 'string',
      enum: CATEGORIES,
    },
  },
  required: ['category'],
  additionalProperties: false,
};

// Claude Haiku 4.5 pricing (per million tokens)
const HAIKU_INPUT_COST = 1.0;
const HAIKU_OUTPUT_COST = 5.0;

/** Result includes the expense category and cost for tracking */
export interface CategorizeExpenseResult extends ExpenseOutput {
  _cost: number; // Internal field for cost tracking
}

/**
 * Categorize an expense using Claude.
 * The system prompt is injected by the optimizer during iteration.
 * Returns the expense category with cost information embedded.
 */
export async function categorizeExpense(
  input: ExpenseInput,
  systemPrompt?: string
): Promise<CategorizeExpenseResult> {
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
    max_tokens: 256,
    betas: ['structured-outputs-2025-11-13'],
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: `Categorize this expense: ${input.description}`,
      },
    ],
    output_format: {
      type: 'json_schema',
      schema: EXPENSE_SCHEMA,
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

  const expenseOutput = JSON.parse(content.text) as ExpenseOutput;

  return {
    ...expenseOutput,
    _cost: cost,
  };
}

/** Extract cost from the result */
export function mapCost(result: CategorizeExpenseResult): number {
  return result._cost;
}
