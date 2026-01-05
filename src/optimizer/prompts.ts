import type { TestCaseResult } from '../types.js';
import { formatFailure } from './optimizer-logging.js';

/**
 * Default system prompt for patch generation.
 * Analyzes failures and suggests specific, focused changes to improve the prompt.
 */
export const DEFAULT_PATCH_SYSTEM_PROMPT = `
  'You are optimizing a system prompt for an LLM workflow.
  Analyze the failure and suggest a specific, focused change to improve the prompt. 
  Do NOT overfit. Be generalizable. 

  <examples>
    VERY IMPORTANT, CRITICAL!!!
    Examples MUST be anonymized.
    NEVER use specific names, dates, or other identifying information UNLESS it's a universal fact: 
    - example: (for an invoice processor) 
      - task: extract data from parsed invoices
      - failure context: (returned expected: true, actual: false)
      - prompt patch: "if you see "Restocked" on a Schedule B report of a Shopify invoice, mark returned as true." <- this is kind of specific, but it's a universal fact for the problem and could satisfy other inputs.)
    
    - example: (for a calendar app)
      - task: extract cost from calendar event
      - failure context: (cost expected: 123.45, actual: 167.89)
      - prompt patch: "if you see "Daisy" in the name field, return 123.45 for cost" <- this is too specific, it's overfit to a specific failure. The spirit of the failure is an incorrect extraction, you should look for the expected in the context and determine how the prompt could be modified to acheive the expected output.)
  </examples>
`;

/**
 * Default system prompt for merging patches.
 * Combines multiple patches into a coherent system prompt.
 */
export const DEFAULT_MERGE_SYSTEM_PROMPT = `
  You are an expert LLM prompt editor. 
  You are merging improvements into a system prompt. 
  Incorporate the suggestions while keeping the prompt clear and coherent.
`;

/**
 * Builds the user prompt for patch generation.
 * Formats the failure context and current prompt for the LLM.
 */
export function buildPatchUserPrompt(
  failure: TestCaseResult,
  currentPrompt: string,
  previousBetterPrompt?: string,
  previousBetterPromptFailures?: TestCaseResult[]
): string {
  let userContent = `
    Current system prompt:
    ---
    ${currentPrompt}
    ---

    A test case failed:
    ${formatFailure(failure)}
  `;

  // If previous better prompt is provided, build failures context
  if (previousBetterPrompt) {
    // Get failures from previous better prompt
    const failuresContext =
      previousBetterPromptFailures && previousBetterPromptFailures.length > 0
        ? previousBetterPromptFailures
            .map((f, i) => `${i + 1}. ${formatFailure(f)}`)
            .join('\n\n')
        : 'None recorded';

    userContent += `
      Note: The current prompt is a REGRESSION from a better-performing version.
      Previous (better) prompt for reference:
      ---
      ${previousBetterPrompt}
      ---

      The failures the better prompt had:
      ${failuresContext}

      Your changes introduced new failures instead of fixing the above.
      Analyze what changed between the two prompts that might have caused this regression.
      Are there any new failures that were not present in the previous better prompt?
      Are there any failures that were present in the previous better prompt but not in the current prompt?
      Did any of our patches contradict any of the new failures? 
    `;
  }

  userContent += `
    Suggest a specific change to the system prompt that would fix this failure.
    Be concise. Output ONLY the suggested patch/change, not the full prompt.
    DO NOT overfit the prompt to the test case.
    Generalize examples if you choose to use them.
  `;

  return userContent;
}

/**
 * Builds the user prompt for merging patches.
 * Formats the current prompt and suggested patches for the LLM.
 */
export function buildMergeUserPrompt(
  patches: string[],
  currentPrompt: string
): string {
  return `
      Current prompt:
      ---
      ${currentPrompt}
      ---

      Suggested improvements:
      ${patches.map((p, i) => `${i + 1}. ${p}`).join('\n\n')}

      Create a single improved system prompt that incorporates these suggestions.
      Be mindful of the size of the new prompt.
      Use discretion when merging the patches, if you see duplicate information, emphasize it but don't repeat it.
      Output ONLY the new system prompt, nothing else.
      Respect enums.
  `;
}
