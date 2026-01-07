import { describe, it, expect } from 'vitest';
import {
  buildPatchUserPrompt,
  buildMergeUserPrompt,
  DEFAULT_PATCH_SYSTEM_PROMPT,
  DEFAULT_MERGE_SYSTEM_PROMPT,
} from '../prompts.js';
import type { TestCaseResult } from '../../types.js';

describe('prompts', () => {
  const mockFailure: TestCaseResult = {
    input: { id: 123 },
    expected: { status: 'active' },
    actual: { status: 'inactive' },
    passed: false,
    fields: {
      status: {
        passed: false,
        expected: 'active',
        actual: 'inactive',
      },
    },
    passedFields: 0,
    totalFields: 1,
    passRate: 0,
  };

  describe('DEFAULT_PATCH_SYSTEM_PROMPT', () => {
    it('exports a default patch system prompt', () => {
      expect(DEFAULT_PATCH_SYSTEM_PROMPT).toContain(
        'optimizing a system prompt'
      );
      expect(DEFAULT_PATCH_SYSTEM_PROMPT).toContain('Do NOT overfit');
    });
  });

  describe('DEFAULT_MERGE_SYSTEM_PROMPT', () => {
    it('exports a default merge system prompt', () => {
      expect(DEFAULT_MERGE_SYSTEM_PROMPT).toContain('prompt editor');
      expect(DEFAULT_MERGE_SYSTEM_PROMPT).toContain('merging improvements');
    });
  });

  describe('buildPatchUserPrompt', () => {
    it('builds basic patch prompt with failure context', () => {
      const prompt = buildPatchUserPrompt(
        mockFailure,
        'Extract user status from API response'
      );

      expect(prompt).toContain('Current system prompt');
      expect(prompt).toContain('Extract user status from API response');
      expect(prompt).toContain('A test case failed');
      expect(prompt).toContain('Suggest a specific change');
    });

    it('includes regression context when previous better prompt provided', () => {
      const previousFailures: TestCaseResult[] = [
        {
          ...mockFailure,
          input: { id: 456 },
          expected: { name: 'John' },
          actual: { name: 'Jane' },
        },
      ];

      const prompt = buildPatchUserPrompt(
        mockFailure,
        'New prompt',
        'Previous better prompt',
        previousFailures
      );

      expect(prompt).toContain('REGRESSION');
      expect(prompt).toContain('Previous (better) prompt');
      expect(prompt).toContain('Previous better prompt');
      expect(prompt).toContain('The failures the better prompt had');
      expect(prompt).toContain('patches contradict');
    });

    it('handles regression case with no previous failures', () => {
      const prompt = buildPatchUserPrompt(
        mockFailure,
        'New prompt',
        'Previous better prompt',
        []
      );

      expect(prompt).toContain('REGRESSION');
      expect(prompt).toContain('None recorded');
    });

    it('handles regression case with undefined previous failures', () => {
      const prompt = buildPatchUserPrompt(
        mockFailure,
        'New prompt',
        'Previous better prompt',
        undefined
      );

      expect(prompt).toContain('REGRESSION');
      expect(prompt).toContain('None recorded');
    });
  });

  describe('buildMergeUserPrompt', () => {
    it('builds merge prompt with current prompt and patches', () => {
      const patches = [
        'Add validation for status field',
        'Handle edge case for null values',
      ];

      const prompt = buildMergeUserPrompt(patches, 'Original system prompt');

      expect(prompt).toContain('Current prompt');
      expect(prompt).toContain('Original system prompt');
      expect(prompt).toContain('Suggested improvements');
      expect(prompt).toContain('1. Add validation for status field');
      expect(prompt).toContain('2. Handle edge case for null values');
      expect(prompt).toContain('Output ONLY the new system prompt');
      expect(prompt).toContain('Respect enums');
    });

    it('handles single patch', () => {
      const patches = ['Single improvement'];
      const prompt = buildMergeUserPrompt(patches, 'System prompt');

      expect(prompt).toContain('1. Single improvement');
      expect(prompt).not.toContain('2.');
    });

    it('handles multiple patches', () => {
      const patches = ['First', 'Second', 'Third', 'Fourth'];
      const prompt = buildMergeUserPrompt(patches, 'System prompt');

      expect(prompt).toContain('1. First');
      expect(prompt).toContain('2. Second');
      expect(prompt).toContain('3. Third');
      expect(prompt).toContain('4. Fourth');
    });
  });
});
