# Didactic

Eval and optimization framework for LLM workflows.

## Installation

```bash
# Build and publish locally
npm run build && yalc publish

# In your project
yalc add didactic
```

## Quick Start

```typescript
import { didactic, within, oneOf, exact } from 'didactic';

const result = await didactic.eval({
  executor: didactic.endpoint('https://api.example.com/extract'),
  comparators: {
    premium: within({ tolerance: 0.05 }),
    policyType: oneOf(['claims-made', 'occurrence']),
    carrier: exact,
  },
  testCases: [
    {
      input: { emailId: 'email-123' },
      expected: { premium: 12500, policyType: 'claims-made', carrier: 'Acme Insurance' },
    },
  ],
});

console.log(`${result.passed}/${result.total} passed (${result.accuracy * 100}% field accuracy)`);
```

---

## Core Concepts

Didactic has three core components:

1. **Executors** — Abstraction for running your LLM workflow (local function, HTTP endpoint, or Temporal workflow)
2. **Comparators** — Field-level comparison logic that handles real-world data messiness
3. **Optimization** — Iterative prompt improvement loop to hit target success rates

---

## API

### `didactic.eval(config)`

The main entry point. Runs your executor over test cases and reports field-level pass/fail results. When `optimize` is provided, it enters optimization mode and iteratively improves the system prompt.

```typescript
const result = await didactic.eval(config);
```

#### EvalConfig

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `executor` | `Executor<TInput, TOutput>` | **Yes** | — | Function that executes your LLM workflow. Receives input and optional system prompt, returns structured output. |
| `testCases` | `TestCase<TInput, TOutput>[]` | **Yes** | — | Array of `{ input, expected }` pairs. Each test case runs through the executor and compares output to expected. |
| `comparators` | `ComparatorMap` | **One of** | — | Record of field names to comparators. Use when you want different comparison logic per field. |
| `comparator` | `Comparator<TOutput>` | **One of** | — | Single comparator for the entire output object. Use when you need custom whole-object comparison logic. |
| `systemPrompt` | `string` | No | — | System prompt passed to the executor. Required if using optimization. |
| `perTestThreshold` | `number` | No | `1.0` | Minimum field pass rate for a test case to pass (0.0–1.0). At default 1.0, all fields must pass. Set to 0.8 to pass if 80% of fields match. |
| `unorderedList` | `boolean` | No | `false` | Enable Hungarian matching for array comparison. When true, arrays are matched by similarity rather than index position. |
| `rateLimitBatch` | `number` | No | — | Number of test cases to run concurrently. Use with `rateLimitPause` for rate-limited APIs. |
| `rateLimitPause` | `number` | No | — | Seconds to wait between batches. Pairs with `rateLimitBatch`. |
| `optimize` | `OptimizeConfig` | No | — | Inline optimization config. When provided, triggers optimization mode instead of single eval. |

#### `comparators` vs `comparator`

Use **`comparators`** (field-level) when your output is an object and you want different comparison logic per field:

```typescript
const result = await didactic.eval({
  executor: myExecutor,
  comparators: {
    premium: within({ tolerance: 0.05 }),  // 5% tolerance for numbers
    carrier: exact,                         // Exact string match
    effectiveDate: date,                    // Flexible date parsing
  },
  testCases: [
    {
      input: { emailId: 'email-123' },
      expected: { premium: 12500, carrier: 'Acme Insurance', effectiveDate: '2024-01-15' },
    },
  ],
});
```

Use **`comparator`** (whole-object) when:
- Your output is a **primitive value** (string, number, boolean)
- You need **custom comparison logic** for the entire output
- You want a **single comparator** applied uniformly

```typescript
// Primitive output
const result = await didactic.eval({
  executor: myNumberExtractor,
  comparator: exact,
  testCases: [
    { input: 'twenty-three', expected: 23 },
    { input: 'one hundred', expected: 100 },
  ],
});

// Custom whole-object comparison
const result = await didactic.eval({
  executor: myExecutor,
  comparator: custom({
    compare: (expected, actual) => {
      return expected.id === actual.id && expected.status === actual.status;
    },
  }),
  testCases: [...],
});
```

---

### `didactic.optimize(evalConfig, optimizeConfig)`

Run optimization as a separate call instead of inline.

```typescript
const result = await didactic.optimize(evalConfig, optimizeConfig);
```

#### OptimizeConfig

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `systemPrompt` | `string` | **Yes** | — | Initial system prompt to optimize. This is the starting point that the optimizer will iteratively improve. |
| `targetSuccessRate` | `number` | **Yes** | — | Target success rate to achieve (0.0–1.0). Optimization stops when this rate is reached. |
| `apiKey` | `string` | **Yes** | — | API key for the LLM provider used by the optimizer (not your workflow's LLM). |
| `provider` | `LLMProviders` | **Yes** | — | LLM provider the optimizer uses to analyze failures and generate improved prompts. |
| `maxIterations` | `number` | No | `5` | Maximum optimization iterations before stopping, even if target not reached. |
| `maxCost` | `number` | No | — | Maximum cost budget in dollars. Optimization stops if cumulative cost exceeds this. |
| `storeLogs` | `boolean \| string` | No | — | Save optimization logs. `true` uses default path (`./didact-logs/optimize_<timestamp>/summary.md`), or provide custom summary path. |
| `thinking` | `boolean` | No | — | Enable extended thinking mode for deeper analysis (provider must support it). |

---

## Executors

Executors abstract your LLM workflow from the evaluation harness. Whether your workflow runs locally, calls a remote API, or orchestrates Temporal activities, executors provide a consistent interface: take input + optional system prompt, return structured output.

This separation enables:
- **Swap execution strategies** — Switch between local/remote without changing tests
- **Dynamic prompt injection** — System prompts flow through for optimization
- **Cost tracking** — Aggregate execution costs across test runs

### `endpoint(url, config?)`

Create an executor that calls an HTTP endpoint. The executor sends input + systemPrompt as the request body and expects structured JSON back.

```typescript
import { endpoint } from 'didactic';

const executor = endpoint('https://api.example.com/workflow', {
  headers: { Authorization: 'Bearer token' },
  timeout: 60000,
});
```

#### EndpointConfig

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `method` | `'POST' \| 'GET'` | No | `'POST'` | HTTP method for the request. |
| `headers` | `Record<string, string>` | No | `{}` | Headers to include (auth tokens, content-type overrides, etc). |
| `mapResponse` | `(response: any) => TOutput` | No | — | Transform the raw response to your expected output shape. Use when your API wraps results. |
| `mapAdditionalContext` | `(response: any) => unknown` | No | — | Extract metadata (logs, debug info) from response for inspection. |
| `mapCost` | `(response: any) => number` | No | — | Extract execution cost from response (e.g., token counts in headers). |
| `timeout` | `number` | No | `30000` | Request timeout in milliseconds. |

---

### `fn(config)`

Create an executor from a local async function. Use this for direct LLM SDK calls, Temporal workflows, or any custom execution logic.

```typescript
import { fn } from 'didactic';

const executor = fn({
  fn: async (input, systemPrompt) => {
    return await myLLMCall(input, systemPrompt);
  },
});
```

#### FnConfig

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `fn` | `(input: TInput, systemPrompt?: string) => Promise<TOutput>` | **Yes** | — | Async function that executes your workflow. Receives test input and optional system prompt. |
| `mapAdditionalContext` | `(result: TOutput) => unknown` | No | — | Extract metadata from the result for debugging. |
| `mapCost` | `(result: TOutput) => number` | No | — | Extract cost from the result (if your function tracks it). |

---

## Comparators

Comparators bridge the gap between messy LLM output and semantic correctness. Rather than requiring exact string matches, comparators handle real-world data variations—currency formatting, date formats, name suffixes, numeric tolerance—while maintaining semantic accuracy.

Each comparator returns a `passed` boolean and a `similarity` score (0.0–1.0). The pass/fail determines test results, while similarity enables Hungarian matching for unordered array comparison.

| Comparator | Signature | Description |
|------------|-----------|-------------|
| `exact` | `(expected, actual)` | Deep equality with cycle detection. Default when no comparator specified. |
| `within` | `({ tolerance, mode? })` | Numeric tolerance. `mode: 'percentage'` (default) or `'absolute'`. |
| `oneOf` | `(allowedValues)` | Enum validation. Passes if actual equals expected AND both are in the allowed set. |
| `contains` | `(substring)` | String contains check. Passes if actual includes the substring. |
| `presence` | `(expected, actual)` | Existence check. Passes if expected is absent, or if actual has any value when expected does. |
| `numeric` | `(expected, actual)` | Numeric comparison after stripping currency symbols, commas, accounting notation. |
| `numeric.nullable` | `(expected, actual)` | Same as `numeric`, but treats null/undefined/empty as 0. |
| `date` | `(expected, actual)` | Date comparison after normalizing formats (ISO, US MM/DD, EU DD/MM, written). |
| `name` | `(expected, actual)` | Name comparison with case normalization, suffix removal (Inc, LLC), fuzzy matching. |
| `custom` | `({ compare })` | User-defined logic. `compare(expected, actual, context?) => boolean`. Context provides access to parent objects for cross-field logic. |

### Examples

```typescript
import { within, oneOf, exact, contains, presence, numeric, date, name, custom } from 'didactic';

const comparators = {
  premium: within({ tolerance: 0.05 }),                      // 5% tolerance
  deductible: within({ tolerance: 100, mode: 'absolute' }),  // $100 tolerance
  policyType: oneOf(['claims-made', 'occurrence', 'entity']),
  carrier: exact,
  notes: contains('approved'),
  entityName: name,
  effectiveDate: date,
  amount: numeric,
  optionalField: presence,
  customField: custom({
    compare: (expected, actual, context) => {
      // Access sibling fields via context.actualParent
      return actual.toLowerCase() === expected.toLowerCase();
    },
  }),
};
```

---

## LLMProviders

Supported LLM providers for the optimizer:

```typescript
import { LLMProviders } from 'didactic';
```

| Value | Description |
|-------|-------------|
| `LLMProviders.anthropic_claude_opus` | Claude Opus 4.5 — Most capable, highest cost |
| `LLMProviders.anthropic_claude_sonnet` | Claude Sonnet 4.5 — Balanced performance/cost |
| `LLMProviders.anthropic_claude_haiku` | Claude Haiku 4.5 — Fastest, lowest cost |
| `LLMProviders.openai_gpt5` | GPT-5.2 — OpenAI flagship |
| `LLMProviders.openai_gpt5_mini` | GPT-5 Mini — OpenAI lightweight |

---

## Output Types

### EvalResult

Returned by `didactic.eval()` when no optimization is configured.

| Property | Type | Description |
|----------|------|-------------|
| `systemPrompt` | `string \| undefined` | System prompt that was used for this eval run. |
| `testCases` | `TestCaseResult[]` | Detailed results for each test case. Inspect for field-level failure details. |
| `passed` | `number` | Count of test cases that passed (met `perTestThreshold`). |
| `total` | `number` | Total number of test cases run. |
| `successRate` | `number` | Pass rate (0.0–1.0). `passed / total`. |
| `correctFields` | `number` | Total correct fields across all test cases. |
| `totalFields` | `number` | Total fields evaluated across all test cases. |
| `accuracy` | `number` | Field-level accuracy (0.0–1.0). `correctFields / totalFields`. |
| `cost` | `number` | Total execution cost aggregated from executor results. |

### TestCaseResult

Per-test-case detail, accessible via `EvalResult.testCases`.

| Property | Type | Description |
|----------|------|-------------|
| `input` | `TInput` | The input that was passed to the executor. |
| `expected` | `TOutput` | The expected output from the test case. |
| `actual` | `TOutput \| undefined` | Actual output returned by executor. Undefined if execution failed. |
| `passed` | `boolean` | Whether this test case passed (met `perTestThreshold`). |
| `fields` | `Record<string, FieldResult>` | Per-field comparison results. Key is field path (e.g., `"address.city"`). |
| `passedFields` | `number` | Count of fields that passed comparison. |
| `totalFields` | `number` | Total fields compared. |
| `passRate` | `number` | Field pass rate for this test case (0.0–1.0). |
| `cost` | `number \| undefined` | Execution cost for this test case, if reported by executor. |
| `additionalContext` | `unknown \| undefined` | Extra context extracted by executor (logs, debug info). |
| `error` | `string \| undefined` | Error message if executor threw an exception. |

### OptimizeResult

Returned by `didactic.optimize()` or `didactic.eval()` with optimization configured.

| Property | Type | Description |
|----------|------|-------------|
| `success` | `boolean` | Whether the target success rate was achieved. |
| `finalPrompt` | `string` | The final optimized system prompt. Use this in production. |
| `iterations` | `IterationResult[]` | Results from each optimization iteration. Inspect to see how the prompt evolved. |
| `totalCost` | `number` | Total cost across all iterations (optimizer + executor costs). |
| `logFolder` | `string \| undefined` | Folder path where optimization logs were written (only when `storeLogs` is enabled). |

### IterationResult

Per-iteration detail, accessible via `OptimizeResult.iterations`.

| Property | Type | Description |
|----------|------|-------------|
| `iteration` | `number` | Iteration number (1-indexed). |
| `systemPrompt` | `string` | System prompt used for this iteration. |
| `passed` | `number` | Test cases passed in this iteration. |
| `total` | `number` | Total test cases in this iteration. |
| `testCases` | `TestCaseResult[]` | Detailed test case results for this iteration. |
| `cost` | `number` | Cost for this iteration. |

---

## Exports

```typescript
// Namespace
import { didactic } from 'didactic';
import didactic from 'didactic';  // default export

// Comparators
import { exact, within, oneOf, contains, presence, numeric, date, name, custom } from 'didactic';

// Executors
import { endpoint, fn } from 'didactic';

// Functions
import { evaluate, optimize } from 'didactic';

// Types
import type {
  Comparator,
  ComparatorMap,
  ComparatorResult,
  ComparatorContext,
  Executor,
  ExecutorResult,
  TestCase,
  EvalConfig,
  EvalResult,
  TestCaseResult,
  FieldResult,
  OptimizeConfig,
  OptimizeResult,
  IterationResult,
  EndpointConfig,
  FnConfig,
} from 'didactic';

// Enum
import { LLMProviders } from 'didactic';
```
