/**
 * Expense Categorizer Optimization Example
 *
 * Demonstrates prompt optimization for expense classification.
 * The challenge: same merchant can map to different categories based on context.
 * - "Uber ride to airport" → travel
 * - "Uber ride for client meeting" → client_entertainment
 * - "Coffee for office" → office
 * - "Coffee with candidate" → recruiting
 *
 * The optimizer learns these contextual rules through iteration.
 *
 * Run with: ANTHROPIC_API_KEY=your_key npx tsx example/optimizer/expense-categorizer/expense-categorizer.ts
 */

import 'dotenv/config';

import Anthropic from '@anthropic-ai/sdk';
import { didactic, exact, LLMProviders } from '../../../src/index.js';
import {
  testCases,
  type ExpenseInput,
  type ExpenseOutput,
} from './test-cases.js';

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

// Intentionally weak starting prompt - no guidance on business rules
const INITIAL_SYSTEM_PROMPT = "";

async function main() {
  console.log('💰 Expense Categorizer Optimization\n');
  console.log(
    'Starting with a naive prompt that fails on context-dependent cases...\n'
  );
  console.log(`Test cases: ${testCases.length}`);
  console.log(`Target: 90% accuracy\n`);

  const result = await didactic.optimize(
    {
      executor: expenseCategorizerExecutor,
      testCases,
      comparators: { category: exact },
    },
    {
      systemPrompt: INITIAL_SYSTEM_PROMPT,
      targetSuccessRate: 0.9,
      maxIterations: 5,
      provider: LLMProviders.anthropic_claude_haiku,
      apiKey: process.env.ANTHROPIC_API_KEY!,
      storeLogs: true,
    }
  );

  // Show results
  console.log('\n' + '='.repeat(60));
  console.log(`Optimization ${result.success ? 'SUCCEEDED' : 'FAILED'}`);
  console.log(`Total cost: $${result.totalCost.toFixed(4)}`);
  console.log(`Iterations: ${result.iterations.length}`);
  console.log('='.repeat(60));

  // Show progression
  console.log('\nProgression:');
  result.iterations.forEach((iter) => {
    const rate = ((iter.passed / iter.total) * 100).toFixed(1);
    console.log(`  Iteration ${iter.iteration}: ${rate}% (${iter.passed}/${iter.total})`);
  });

  // Show final prompt
  console.log('\n📝 Final Optimized Prompt:');
  console.log('-'.repeat(60));
  console.log(result.finalPrompt);
  console.log('-'.repeat(60));

  if (result.logFolder) {
    console.log(`\n📁 Logs written to: ${result.logFolder}`);
  }
}

/**
 * JSON schema for expense categorization output
 */
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

/**
 * Expense categorizer - uses an LLM to classify expenses.
 * The system prompt is injected by the optimizer during iteration.
 */
async function categorizeExpense(
  input: ExpenseInput,
  systemPrompt?: string
): Promise<ExpenseOutput> {
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

  return JSON.parse(content.text) as ExpenseOutput;
}

// Create the executor
const expenseCategorizerExecutor = didactic.fn({
  fn: categorizeExpense,
});

main().catch(console.error);

