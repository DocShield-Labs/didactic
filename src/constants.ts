import { LLMProviders, ProviderSpec } from './optimizer/types.js';

export const PROVIDER_SPECS: Record<LLMProviders, ProviderSpec> = {
  [LLMProviders.anthropic_claude_opus]: {
    model: 'claude-opus-4-5-20251101',
    maxTokens: 64000,
    costPerMillionInput: 5.0,
    costPerMillionOutput: 25.0,
  },
  [LLMProviders.anthropic_claude_sonnet]: {
    model: 'claude-sonnet-4-5-20251101',
    maxTokens: 64000,
    costPerMillionInput: 3.0,
    costPerMillionOutput: 15.0,
  },
  [LLMProviders.anthropic_claude_haiku]: {
    model: 'claude-haiku-4-5-20251101',
    maxTokens: 64000,
    costPerMillionInput: 1.0,
    costPerMillionOutput: 5.0,
  },
  [LLMProviders.openai_gpt5]: {
    model: 'gpt-5.2',
    maxTokens: 32000,
    costPerMillionInput: 1.75,
    costPerMillionOutput: 14.0,
  },
  [LLMProviders.openai_gpt5_mini]: {
    model: 'gpt-5-mini',
    maxTokens: 32000,
    costPerMillionInput: 0.25,
    costPerMillionOutput: 2.0,
  },
};

// Optimizer constants
export const ANTHROPIC_THINKING_BUDGET_TOKENS = 31999;
export const TOKENS_PER_MILLION = 1_000_000;

// Executor constants
export const DEFAULT_ENDPOINT_TIMEOUT_MS = 30000;

// Eval constants
export const DEFAULT_PER_TEST_THRESHOLD = 1.0;

// Comparator constants
export const NAME_SUFFIXES =
  /(?<=\S)\s*,?\s*(inc\.?|llc\.?|ltd\.?|l\.l\.c\.?|corp\.?|corporation|company|co\.?)$/i;
