# Comparator System Refactor - Implementation Brief

## Overview

This document outlines a comprehensive refactor of Didactic's comparator system to address two critical design issues that limit flexibility and cause ambiguity in complex evaluation scenarios.

## Background

Didactic is an evaluation framework for LLM workflows. Users define test cases with expected outputs and comparators that determine how to compare expected vs actual values. The current comparator system has two significant limitations that need to be addressed.

## Current State

### How Comparators Work Today

Users provide a flat map of field names to comparator functions:

```typescript
comparators: {
  invoiceNumber: exact,
  vendor: name,
  description: name,      // Applied to ALL fields named "description"
  price: numeric,         // Applied to ALL fields named "price"
}
```

When evaluating nested structures like:

```typescript
{
  lineItems: [{ description: 'Item 1', price: 100 }],
  orders: [{ description: 'Order 1', price: 200 }]
}
```

The system uses `getFieldName()` to extract the field name from paths like:

- `lineItems[0].description` → `"description"`
- `orders[0].description` → `"description"`

Both resolve to the same comparator key, causing collisions.

### Array Ordering Control

Array comparison has a global `unorderedList` boolean flag:

```typescript
didactic.eval({
  // ...
  unorderedList: true, // Applies to ALL arrays in the output
});
```

This means:

- All arrays are matched by similarity (Hungarian algorithm), or
- All arrays are matched by index position

There's no way to have fine-grained control per array.

## Problems with Current Design

### Problem 1: Field Name Collisions

**Issue:** Multiple arrays with same field names can't have different comparison logic.

**Example:**

```typescript
{
  lineItems: [{ description: 'X', price: 100 }],
  orders: [{ description: 'Y', price: 200 }]
}

comparators: {
  description: name,  // Applied to BOTH lineItems AND orders
  price: exact,       // Applied to BOTH - can't differentiate
}
```

**Impact:**

- Can't have `lineItems.price` use `within({ tolerance: 5 })` while `orders.price` uses `exact`
- Ambiguous which comparator applies where
- Doesn't match the shape of the data being compared

### Problem 2: Global Array Ordering Control

**Issue:** All arrays must use the same ordering strategy.

**Example:**

```typescript
{
  lineItems: [...],           // Want unordered (position doesn't matter)
  conversationHistory: [...], // Want ordered (chronological)
  tags: [...]                 // Want unordered
}
```

Currently impossible to express this - `unorderedList` applies to all three arrays.

**Impact:**

- Forces artificial constraints on data structure
- Can't properly test systems with mixed ordering requirements
- Poor developer experience

## Proposed Solution

### Change 1: Nested Comparator Structure

**Goal:** Make comparator structure match the shape of the data being compared.

**New Syntax:**

```typescript
comparators: {
  invoiceNumber: exact,
  vendor: name,
  lineItems: {  // Nested object for array items
    description: name,
    price: within({ tolerance: 5 }),
    quantity: exact,
  },
  orders: {  // Different comparators for same field names
    description: exact,
    price: within({ tolerance: 10 }),
    step: exact,
  },
  tags: exact,  // For primitive arrays
}
```

**Benefits:**

- No field name collisions
- Clear what comparator applies where
- Matches data structure visually
- More intuitive for developers

### Change 2: Per-Field Array Ordering Control

**Goal:** Allow fine-grained control over array matching strategy using an `unordered()` wrapper function.

**New Syntax:**

```typescript
import { unordered } from '@docshield/didactic';

comparators: {
  // Unordered array of objects - match by similarity
  lineItems: unordered({
    description: name,
    price: within({ tolerance: 5 })
  }),

  // Ordered array of objects - match by position
  conversationHistory: {
    role: exact,
    message: exact,
  },

  // Unordered array of primitives
  tags: unordered(exact),

  // Top-level fields
  invoiceNumber: exact,
  vendor: name,
}
```

**Special Case:** When the entire output is an array:

```typescript
// Output type: Quote[]
comparators: unordered({
  carrier: exact,
  premium: within({ tolerance: 0.05 }),
});
```

**Benefits:**

- Per-field control over ordering
- Composable with nested structure
- Works for both primitive and object arrays
- Backward compatible (ordered by default)

## Technical Implementation

### 1. Type Definitions

Add new types to `src/types.ts`:

```typescript
/**
 * Marker interface for comparators with ordering metadata
 */
export interface ComparatorWithOrdering {
  _unordered?: boolean;
}

/**
 * Recursive comparator configuration that matches data shape
 */
export type ComparatorConfig<T = unknown> =
  | Comparator<T>
  | (Comparator<T> & ComparatorWithOrdering)
  | { [K in keyof T]?: ComparatorConfig<T[K]> };

/**
 * Updated ComparatorsConfig to support nested structure
 */
export type ComparatorsConfig =
  | ComparatorConfig<unknown>
  | (ComparatorConfig<unknown> & ComparatorWithOrdering);
```

### 2. New `unordered()` Function

Add to `src/comparators.ts`:

```typescript
/**
 * Marks a comparator or comparator map as unordered.
 * When applied to an array field, items will be matched by similarity
 * rather than index position (using Hungarian algorithm).
 *
 * @example
 * // Unordered array of objects
 * lineItems: unordered({
 *   description: name,
 *   price: within({ tolerance: 5 })
 * })
 *
 * @example
 * // Unordered array of primitives
 * tags: unordered(exact)
 */
export function unordered<T>(
  comparator: Comparator<T> | ComparatorMap
): Comparator<T> & ComparatorWithOrdering {
  // Add ordering metadata without modifying original comparator
  return Object.assign(typeof comparator === 'function' ? comparator : exact, {
    _unordered: true,
    _nestedComparators: typeof comparator === 'object' ? comparator : undefined,
  });
}
```

### 3. Update `compareFields()` in `src/eval.ts`

**Key Changes:**

A. **Remove global `unorderedList` parameter** - check per-field instead

B. **Match comparator structure to data structure** - when encountering an object/array, check if the comparator for that path is also an object (nested comparators) or has ordering metadata

C. **Check for `_unordered` flag** when processing arrays:

```typescript
// At array processing (current line ~225)
if (Array.isArray(expected)) {
  const fieldName = getFieldName(path);
  const fieldComparator = comparators[fieldName];

  // Check if this specific array should use unordered matching
  const useUnordered = fieldComparator?._unordered ?? false;

  if (useUnordered) {
    // Use Hungarian algorithm matching
    matchedPairs = (await matchArrays(expected, actual, comparators))
      .assignments;
  } else {
    // Use index-based matching
    matchedPairs = expected.map((_, i) => [i, i]);
  }
}
```

D. **Handle nested comparator objects:**

```typescript
// When processing object fields (current line ~303)
for (const [field, expValue] of Object.entries(expected)) {
  const fieldPath = path ? `${path}.${field}` : field;

  // Check if we have a nested comparator structure
  let fieldComparators = comparators;
  if (
    path === '' &&
    comparators[field] &&
    typeof comparators[field] === 'object'
  ) {
    // This field has nested comparators
    fieldComparators =
      comparators[field]._nestedComparators || comparators[field];
  }

  Object.assign(
    results,
    await compareFields({
      expected: expValue,
      actual: actual[field],
      comparators: fieldComparators,
      path: fieldPath,
      // ... rest
    })
  );
}
```

### 4. Deprecate Global `unorderedList`

Do not keep for backward compatibility, remove this functionality altogether

## Migration Path

### Phase 1: Add New Functionality (Non-Breaking)

1. Implement `unordered()` function
2. Update `compareFields()` to support nested comparator structures
3. Maintain backward compatibility with flat comparator maps
4. Add deprecation warnings for `unorderedList`

### Phase 2: Update Documentation & Examples

1. Update README with new patterns
2. Update all examples to use nested structure
3. Add migration guide

### Phase 3: Breaking Change (v2.0)

1. Remove global `unorderedList` parameter
2. Remove flat comparator map support (require nested structure)
3. Update all tests

## Testing Requirements

### Unit Tests

1. **Nested structure tests:**
   - Multiple arrays with same field names but different comparators
   - Deeply nested structures (3+ levels)
   - Mixed primitive and object arrays

2. **Unordered tests:**
   - `unordered(exact)` for primitive arrays
   - `unordered({ ... })` for object arrays
   - Mixed ordered and unordered arrays in same output
   - Entire output as unordered array

### Integration Tests

Update example evaluations:

- `invoice-parser` - use nested structure with `unordered()`
- `business-email-extractor` - verify nested arrays work correctly

## Example Before/After

### Before (Current - Limited)

```typescript
await didactic.eval({
  executor: invoiceParserExecutor,
  testCases,
  comparators: {
    invoiceNumber: exact,
    description: name, // Ambiguous - which description?
    quantity: exact,
    unitPrice: numeric,
    total: numeric,
  },
  unorderedList: true, // Applies to ALL arrays
});
```

### After (Proposed - Clear & Flexible)

```typescript
await didactic.eval({
  executor: invoiceParserExecutor,
  testCases,
  comparators: {
    invoiceNumber: exact,
    vendor: name,
    lineItems: unordered({
      // Clear structure
      description: name,
      quantity: exact,
      unitPrice: within({ tolerance: 5 }),
      total: numeric,
    }),
    subtotal: numeric,
    tax: numeric,
    total: numeric,
  },
});
```

## Success Criteria

1. ✅ Can have multiple arrays with same field names using different comparators
2. ✅ Can mix ordered and unordered arrays in same output
3. ✅ Comparator structure visually matches data structure
4. ✅ Backward compatible with existing code (Phase 1)
5. ✅ All existing tests pass
6. ✅ Documentation updated with clear examples
7. ✅ Migration path is clear and well-documented

## Open Questions

1. **Partial comparator maps:** Should users be required to specify comparators for all fields, or can they be partial?
   - Current: Partial is allowed (unspecified fields are ignored)
   - Proposal: Keep partial support for flexibility

2. **Array of arrays:** How to handle `number[][]`?
   - Proposal: Nested `unordered()`: `unordered(unordered(exact))`

3. **TypeScript inference:** Can we infer comparator structure from output type?
   - Future enhancement: Type-safe comparator builder

## References

- Current implementation: `src/eval.ts` (lines 199-351)
- Comparator definitions: `src/comparators.ts`
- Type definitions: `src/types.ts`
- Relevant tests: `test/eval.test.ts`, `test/matching.test.ts`

## Timeline Estimate

- **Phase 1 (Implementation):** 2-3 days
  - Day 1: Type definitions, `unordered()` function, basic nested structure support
  - Day 2: Update `compareFields()` logic, handle edge cases
  - Day 3: Unit tests, fix bugs
- **Phase 2 (Documentation):** 1 day
  - Update README, examples, add migration guide
- **Phase 3 (Breaking Changes):** Future major version

**Total for backward-compatible implementation: 3-4 days**
