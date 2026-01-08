/**
 * Expense Categorizer Optimization Example
 *
 * Demonstrates how to use didactic.optimize() to iteratively improve a prompt.
 * The optimizer analyzes failures and generates improved prompts until the
 * target success rate is reached.
 *
 * Run with: ANTHROPIC_API_KEY=your_key npx tsx example/optimizer/expense-categorizer/index.ts
 */

import 'dotenv/config';

import { didactic, exact, LLMProviders } from '../../../src/index.js';
import { categorizeExpense, mapCost } from './expense-categorizer.js';
import { testCases } from './test-cases.js';

// Intentionally weak starting prompt - no guidance on business rules
const INITIAL_SYSTEM_PROMPT = '';

// Create an executor from the categorizeExpense function (could be any llm workflow)
const expenseCategorizerExecutor = didactic.fn({
  fn: categorizeExpense,
  mapCost, // Calculate cost from token usage
});

async function main() {
  console.log('💰 Expense Categorizer Optimization\n');
  console.log(
    'Starting with an empty prompt\n'
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


  // Show progression
  console.log('\nProgression:');
  result.iterations.forEach((iter) => {
    const rate = ((iter.passed / iter.total) * 100).toFixed(1);
    console.log(
      `  Iteration ${iter.iteration}: ${rate}% (${iter.passed}/${iter.total})`
    );
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

main().catch(console.error);

