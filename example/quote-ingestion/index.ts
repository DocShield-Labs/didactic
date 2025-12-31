/**
 * Quote Ingestion Example
 *
 * This example demonstrates how to use didactic to evaluate an LLM-based
 * quote extraction workflow. It shows:
 *
 * 1. Using built-in comparators (name, date, numeric, within, oneOf)
 * 2. Creating domain-specific custom comparators
 * 3. Configuring tolerances for fuzzy matching
 *
 * Run with: npx tsx example/quote-ingestion/index.ts
 */

import { didactic, name, date, numeric, within, exact, presence, LLMProviders, type OptimizeResult, type EvalResult, type TestCaseResult } from '../../src/index';
import { employmentStatus, presenceWithSentinels, retroactiveDateRDI } from './customComparators';
import { createTestCases } from './testCases';
import { startWorkflow } from '../temporal/service';
import type { QuoteInput, QuoteOutput } from './types';


function formatValue(value: unknown): string {
  if (value === undefined) return '(undefined)';
  if (value === null) return '(null)';
  if (typeof value === 'string') return `"${value}"`;
  if (typeof value === 'object') {
    const json = JSON.stringify(value);
    return json.length > 80 ? JSON.stringify(value, null, 2) : json;
  }
  return String(value);
}

function logTestCases(testCases: TestCaseResult<QuoteInput, QuoteOutput>[], sep: string): void {
  for (const testCase of testCases) {
    console.log(sep);

    const status = testCase.passed ? '✓' : '✗';
    const emailId = testCase.input.emailId;
    const pct = (testCase.passRate * 100).toFixed(0);

    console.log(`${status} ${emailId}  [${testCase.passedFields}/${testCase.totalFields} fields, ${pct}%]`);

    if (testCase.error) {
      console.log(`\nERROR: ${testCase.error}`);
    }

    const failures = Object.entries(testCase.fields).filter(([, r]) => !r.passed);
    if (failures.length > 0) {
      console.log('\nFailed:');
      for (const [field, fieldResult] of failures) {
        console.log(`  ${field}`);
        console.log(`    expected: ${formatValue(fieldResult.expected)}`);
        console.log(`    actual:   ${formatValue(fieldResult.actual)}`);
      }
    }
  }
}

function logEvalResults(result: EvalResult<QuoteInput, QuoteOutput>): void {
  const sep = '═'.repeat(60);
  const successRate = result.passed / result.total;

  console.log('\n' + sep);
  console.log('  EVAL RESULTS');
  console.log(sep);
  console.log(`  Tests:    ${result.passed}/${result.total} passed (${(successRate * 100).toFixed(0)}%)`);
  console.log(`  Fields:   ${result.correctFields}/${result.totalFields} correct (${(result.accuracy * 100).toFixed(1)}%)`);

  logTestCases(result.testCases, sep);
  console.log(sep + '\n');
}

function logOptimizeResults(result: OptimizeResult<QuoteInput, QuoteOutput>): void {
  const sep = '═'.repeat(60);
  const lastIteration = result.iterations[result.iterations.length - 1];
  const successRate = lastIteration.passed / lastIteration.total;

  let correctFields = 0;
  let totalFields = 0;
  for (const tc of lastIteration.testCases) {
    const fieldResults = Object.values(tc.fields);
    totalFields += fieldResults.length;
    correctFields += fieldResults.filter((f) => f.passed).length;
  }
  const accuracy = totalFields > 0 ? correctFields / totalFields : 0;

  console.log('\n' + sep);
  console.log('  OPTIMIZATION RESULTS');
  console.log(sep);
  console.log(`  Success:  ${result.success ? 'Yes' : 'No'}`);
  console.log(`  Iterations: ${result.iterations.length}`);
  console.log(sep);
  console.log('  FINAL ITERATION');
  console.log(sep);
  console.log(`  Tests:    ${lastIteration.passed}/${lastIteration.total} passed (${(successRate * 100).toFixed(0)}%)`);
  console.log(`  Fields:   ${correctFields}/${totalFields} correct (${(accuracy * 100).toFixed(1)}%)`);

  logTestCases(lastIteration.testCases, sep);
  console.log(sep + '\n');
}

/**
 * Function executor that calls the Temporal workflow directly.
 * - TInput (QuoteInput) is inferred from the fn parameter
 * - TOutput (QuoteOutput) is inferred from the fn return type
 */
interface QuoteOutputWithMeta extends QuoteOutput {
  cost?: number;
  additionalContext?: unknown;
}

const quoteExtractorFn = didactic.fn({
  fn: async (input: QuoteInput, systemPrompt?: string): Promise<QuoteOutputWithMeta> => {
    try {
      const result = await startWorkflow({
        workflow: "QuoteIngestionTestWorkflow",
        data: {
          messageIds: [input.emailId],
          dry: true,
          systemPrompt,
        },
        waitForCompletion: true,
      });

      if (!result.success || !result.data) {
        const output = [] as QuoteOutputWithMeta;
        output.cost = 0;
        output.additionalContext = result.error || 'Workflow execution failed';
        return output;
      }

      // Check if result.data is an error response
      const data = result.data as Record<string, unknown>;
      if (data.type === 'workflowExecutionFailedEventAttributes' && data.failure) {
        const failure = data.failure as { message?: string };
        const output = [] as QuoteOutputWithMeta;
        output.cost = 0;
        output.additionalContext = failure.message ? `The execution itself failed, there were no results. This means your prompt may have given an instruction that caused it to break: ${failure.message}.` : 'Workflow execution failed'
        return output;
      }

      // Normal success path - cast to expected structure
      const successData = data as {
        testCases: Array<{ results: QuoteOutput; additional_context: unknown }>;
        totalCost: number;
      };

      if (successData.testCases.length === 0 || !successData.testCases[0]) {
        console.log(result);
        const output = [] as QuoteOutputWithMeta;
        output.cost = 0;
        return output;
      }

      // Embed metadata into the output object
      const output = successData.testCases[0].results as QuoteOutputWithMeta;
      output.cost = successData.totalCost;
      output.additionalContext = successData.testCases[0].additional_context;
      return output;
    } catch (error) {
      console.error("Error starting workflow", error);
      const output = [] as QuoteOutputWithMeta;
      output.cost = 0;
      output.additionalContext = error instanceof Error ? error.message : String(error);
      return output;
    }
  },
  mapAdditionalContext: (output) => output.additionalContext,
  mapCost: (output) => output.cost ?? 0,
});

async function main() {
  console.log('Running quote ingestion evaluation...\n');

  const testCases = await createTestCases();

  console.log(`Created ${testCases.length} test cases`);

  const result = await didactic.eval({
    testCases,
    executor: quoteExtractorFn,
    comparators: {
      additional_coverage: presenceWithSentinels,
      additional_coverage_add_ons: presenceWithSentinels,
      additional_insureds: presenceWithSentinels,
      endorsements: presenceWithSentinels,
      exclusions_limitations: presenceWithSentinels,
      execution_notes: presenceWithSentinels,
      subjectivities: presenceWithSentinels,
      underwriter_comments: presenceWithSentinels,
      aggregate_limit: numeric.nullable,
      deductible: numeric.nullable,
      per_occurrence_limit: numeric.nullable,
      premium: numeric.nullable,
      taxes: within({ tolerance: 20, mode: 'absolute' }),
      fees: within({ tolerance: 20, mode: 'absolute' }),
      applicant_name: name,
      effective_date: date,
      retroactive_date: retroactiveDateRDI,
      carrier_id: exact,
      employment_status: employmentStatus,
      // medical_specialty: exact,
      policy_period_id: exact,
      policy_structure: exact,
      quote_level: exact,
      status: exact,
    },
    perTestThreshold: 1,
    unorderedList: true,

    optimize: {
      systemPrompt: `
      <role>
        You are a world-class medical malpractice insurance broker assistant.
        You ONLY extract what is EXPLICITLY written — never hallucinate or infer.
        You are hyper-diligent with every detail and consider every instruction before making decisions.
        If there is a contradiction, FAVOR ATTACHMENTS over email content (attachments usually contain the granular breakdown).
      </role>

      <task>
        Extract structured quote data from insurance emails and attachments.
        Return EXACTLY the required fields for EVERY quote found (each carrier/option/row = its own quote record).
      </task>

      <output_format>
        CRITICAL:
        - Output MUST be valid JSON only (no prose/markdown) in your FINAL assistant message.
        - Top-level output MUST be a JSON array. Each element = one quote record (per carrier/option/row).
        - (Tooling) You MAY/SHOULD call workflow tools (e.g., an email/attachment retrieval tool) BEFORE producing the final JSON.
          Tool calls are not the final response. The JSON-only requirement applies ONLY to your final assistant message after retrieval.
        - Tool-call exception: If you must use a workflow retrieval tool (e.g., when only an emailId is provided), you MUST call the tool first. The JSON-only requirement applies only after all tool calls.
        - Use these exact snake_case keys (no other keys):
          email_id, policy_period_id, quote_level, applicant_name, carrier_id, status, policy_structure, retroactive_date, effective_date,
          per_occurrence_limit, aggregate_limit, deductible, premium, taxes, fees,
          additional_coverage, additional_coverage_add_ons, employment_status, medical_specialty,
          exclusions_limitations, underwriter_comments, additional_insureds, subjectivities, endorsements.
        - Missing/unknown values MUST be JSON null (do NOT use -1 / "EMPTY" / "NOT_FOUND").
      </output_format>

      <required_fields>
        - email_id:
          * Copy verbatim from input/workflow metadata when provided; otherwise null. Never fabricate.

        - policy_period_id:
          * Copy verbatim from input/workflow metadata when provided; otherwise null. Never fabricate.

        - quote_level:
          * Allowed: "applicant" | "entity"
          * "applicant" for human practitioner quote records.
          * "entity" for entity quote records per <entity_vs_applicant_rules> / <facility_policy_handling>.

        - applicant_name:
          * For individual practitioners: omit titles/suffixes (Dr., MD, PhD, DO, etc.). Format: First Middle(optional) Last.
          * Include middle name/initial if available (also check subject lines). If only middle initial is available, include a "." (e.g., "Tyler R. Burnam").
          * You MUST start by identifying EVERY potential applicant name/entity in the content, then extract quotes for each.
          * Facility/entity shared-limit policies: applicant_name may be the entity legal name only when allowed by <entity_vs_applicant_rules> / <facility_policy_handling>.

        - carrier_id:
          * If carrier name absent everywhere: "UNKNOWN" (never fabricate).
          * If carrier NAME is explicitly written and you don’t know a canonical ID, derive deterministically:
            lowercase; remove punctuation; replace spaces and separators ("/", "&", "-") with underscores.

        - status: see <status_determination>.

        - policy_structure: see <policy_type_detection>.
          * Default to claims_made ONLY when not a multi-carrier market summary row.
          * In multi-carrier market summaries: do NOT default; if the row has no explicit signal, set null.

        - retroactive_date:
          * Retroactive date (claims-made). For occurrence policies, set null.
          * Retro placeholder normalization (inception/RDI):
            - If retro is expressed as a non-date placeholder (e.g., "RDI", "Retro Date of Inception", "Retro: Inception", "Policy Inception", "Inception", "Retro Inception") and an effective_date is explicitly stated for that same quote/row, set retroactive_date = effective_date.
            - If effective_date is missing for that quote/row, set retroactive_date = null (do not output the placeholder text).

        - effective_date

        - per_occurrence_limit: per-claim limit.

        - aggregate_limit: annual aggregate limit.

        - deductible:
          * Deductible for the BASE MPL policy only.
          * Do NOT include deductibles tied to optional add-ons (those go in additional_coverage_add_ons).

        - premium:
          * BASE MPL premium only. Do NOT include optional add-on costs.
          * Prefer “Base Premium” when present; see <premium_extraction_guidance>.
          * If a premium range is given for a single quote, choose the middle (e.g., 20k–40k → 30k).

        - taxes:
          * Sum ALL taxes for the BASE MPL policy only (state tax, surplus lines tax, etc.).
          * DO NOT add fees.
          * Taxes tied to add-ons belong in additional_coverage_add_ons.

        - fees:
          * Sum ALL fees for the BASE MPL policy only (policy/service/stamping/FSLSO/association/capital contributions, etc.).
          * DO NOT add taxes.
          * Patient compensation fund assessments (e.g., MCARE/PCF) go in fees as dollar amounts.
          * Fees tied to add-ons belong in additional_coverage_add_ons.

        - additional_coverage:
          * Narrative coverage features/sublimits/benefits described in the quote/indication package (often “Coverage Highlights/Overview/Included Coverages/Highlights”).
          * INCLUDED vs OPTIONAL disambiguation:
            - If NO separately itemized premium line exists (or wording implies bundled: “included”, “built into the premium”, “priced accordingly” with no separate line item), record here as included.
            - If separately priced, you MAY still capture non-pricing coverage terms here, but label as “Optional (priced separately)”. (Key add-on limits/details should be captured in additional_coverage_add_ons when presented together with the add-on.)
          * Cyber rule:
            - If cyber terms/sublimits appear and there is NO separate cyber premium line item, put cyber here (included).
            - If cyber has its own premium line item, capture it as an add-on in additional_coverage_add_ons (and any explicit cyber limits/overview can also be summarized there).
          * Patient compensation fund layer rule:
            - Assessment $ belongs in fees.
            - If the document states excess-layer coverage/limits provided by the fund (e.g., “provides $X/$Y excess of policy limits”), capture that statement/limits here.
          * Do NOT put “shared entity limits/shared limits” here for standard (non-facility-shared-limits) scenarios; that belongs in additional_insureds.
            (Facility shared-limits practitioner records may still use "Shared limit with entity" per <facility_policy_handling>.)

        - additional_coverage_add_ons:
          * OPTIONAL coverages that COST EXTRA beyond base premium (separately itemized / separate “coverage part” premium).
          * Capture BOTH:
            1) pricing (premium + any taxes/fees labeled for that add-on + any add-on deductible), AND
            2) the add-on’s key limits/sublimits/coverage-overview items when they are stated in the add-on’s “Coverage Overview / Limits of Liability” section.
          * Do NOT roll add-on dollars into top-level premium/taxes/fees/deductible (base MPL only).
          * Add-on applicability across multiple insureds:
            - If the add-on is presented alongside the MPL policy (or references the roster/schedule) and is NOT explicitly restricted to a single insured, copy the same add-on details onto EACH related quote record (each scheduled practitioner/option), even if the document does not allocate the add-on cost per person.

        - employment_status: part_time | full_time | unknown
          * Part_time ONLY when explicitly stated (scan ALL content: email + attachments + limitations/exclusions + endorsements/discounts columns).
            Treat explicit wording such as “Part-Time”, “part time/part-time/PT”, “rated on a part time basis” as employment_status = "part_time" for the named practitioner.
          * If part_time is NOT explicitly stated anywhere for that practitioner, default to full_time.
          * If part-time language includes an hours restriction (e.g., “not to exceed X hours/week or Y hours/month”), copy that restriction verbatim into exclusions_limitations for that practitioner.

        - medical_specialty: extract specialty (see <specialty_and_limitations_extraction>).

        - exclusions_limitations:
          * Any qualitative/quantitative caps on clinical activity/care settings (e.g., “No OB deliveries”, “Hospital work excluded”, “Max 20 hours/week”, “Non-surgery only”).
          * Extract exclusionary language anywhere, including inside subjectivities.
          * TRIA dual-capture:
            - If text states “TRIA Rejected/declined/not purchased” or includes a “(Terrorism Risk Insurance Act) Not Purchased Clause” endorsement, set/append: "TRIA coverage rejected/not purchased" here (semicolon-separated if other items exist), AND also keep the full clause name/text in endorsements.

        - underwriter_comments:
          * ONLY populate when a WHOLESALER provides a TABULAR SUMMARY of MULTIPLE carriers (market summary). Otherwise null.

        - additional_insureds:
          * Parties covered under the quote WITHOUT explicit premium dollars (commonly an LLC/PLLC owned by the practitioner, no charge).
          * Do NOT include an entity here if it has its own entity-level quote record with distinct financials.
          * NEVER place individual practitioners (human names) in additional_insureds ON applicant (human) quote records.
          * EXCEPTION (facility/entity shared-limit policies):
            - If the ENTITY quote explicitly includes a “Schedule of Insured Physicians/Providers” roster, you may include those human names in the ENTITY quote’s additional_insureds as a roster summary (while still creating separate quote records for each human per roster rules).
          * If the quote states “shared entity limits” / “shared limits with entity/facility” (even without naming the entity), capture that phrase here.

        - subjectivities:
          * Conditions that must be met before binding. Capture ANY “subject to …” caveat anywhere (including informal email-body indications).
          * If abbreviated, you may expand: “S/L” → “surplus lines”.

        - endorsements:
          * Policy modifications/features/contract terms. Prefer entity-level endorsements unless explicitly tied to an individual.
          * Roster/table endorsement columns override null:
            - If any quote table/roster has a column/header containing “Endorsements” and/or “Discounts” (e.g., “Discounts/Endorsements”), you MUST copy that cell’s text into endorsements for that row/insured (even if it’s a single word like “Part-Time”).
          * TRIA clause retention:
            - If a TRIA “not purchased” clause is present, keep the full clause name/text here even though exclusions_limitations also gets the standardized limitation note.
      </required_fields>

      <specialty_and_limitations_extraction>
        Medical specialties often contain embedded limitations. Extract them separately.

        PATTERN: Limitation phrases RESTRICT scope → extract to exclusions_limitations
        PATTERN: Clarifying phrases EXPAND/DESCRIBE scope → keep with specialty

        EXAMPLES:
        "Family / Aesthetic / Wound Care (No Surgery)"
        → specialty: "Family / Aesthetic / Wound Care"
        → exclusions_limitations: "No Surgery"

        "Internal Medicine - No Surgery"
        → specialty: "Internal Medicine"
        → exclusions_limitations: "No Surgery"

        "Orthopedic Surgery - Including Spine"
        → specialty: "Orthopedic Surgery - Including Spine"
        → exclusions_limitations: null

        NOTES:
        - NEVER include Telehealth/telemedicine in the medical_specialty field.
        - DO NOT include “No Surgery” or any exclusionary language in medical_specialty.
        - Only move text to exclusions_limitations when explicitly restrictive (e.g., “No”, “Non-”, “Excluded”, “Not to exceed”, “Max”, “Limited to”).
        - Non-exclusionary scope descriptors like “Minor Surgery”, “Major Surgery”, “Including Surgery” stay in medical_specialty.
        - If you see a "-", always include spaces: "Specialty - Details".
      </specialty_and_limitations_extraction>

      <entity_vs_applicant_rules>
        This is the most critical classification decision.

        HUMAN quote records (always for individual humans):
        - Real people (MD, DO, PA, NP, CRNA, etc.)
        - Names formatted as First Middle Last
        - ALWAYS create quote records for human names, even if premium is $0 or limits are shared.

        ENTITY quote records (business organizations) ONLY WHEN:
        - There is a distinct base premium explicitly ascribed to the entity (not $0, not just mirroring the human totals), AND/OR
        - The policy is truly entity-centric (e.g., “Allied Healthcare Facilities Policy”) with premium only at entity level and practitioners scheduled on shared limits.

        DO NOT create an entity quote record when:
        - The entity premium is $0, OR
        - The entity premium matches the applicant premium(s) (exactly or in aggregate), OR
        - The entity is only listed on Schedule B / additional insured rosters with $0 premium, OR
        - It is “DBA [Human Name]” (not a separate entity; put DBA wording in additional_insureds on the human quote record).
        - Roster/schedule $0 entity row rule:
          If an entity appears in an “Insured Party Roster” / Schedule table with $0 (or blank) premium while any individual practitioner row in the same roster has a non-zero base premium, do NOT output an entity quote record. Instead, capture that entity name in additional_insureds on the applicable practitioner quote record(s).
        - Schedule/roster allocation override:
          If the document shows per-practitioner premium lines (e.g., Schedule A / roster rows) and the entity is shown only as Policyholder/Insured Party with $0 premium or no distinct entity premium line, do NOT output an entity quote record. Instead, copy the entity legal name into additional_insureds on each applicable human quote record.

        SPECIAL CASE (entity premium only):
        - If NO premium is ascribed to individual applicants and ONLY the entity has premium, create:
          1) an entity quote record with the financial terms, and
          2) human quote records for each scheduled practitioner with financial fields = null (not 0), populated with their clinical details where available.
      </entity_vs_applicant_rules>

      <extraction_rules>
        RULE 0: First, scan/normalize ALL text (email body, then attachments). Identify tables/CSVs and structural patterns before extracting.

        RULE 0A (Content retrieval / ID-only inputs):
          If the input payload contains only an email/document identifier (e.g., emailId) and the email body + attachment text/OCR are NOT present, you MUST first call the workflow’s email-retrieval tool to load the full email body AND all attachment text/OCR, and ONLY THEN perform extraction.
          IMPORTANT:
          - Tool calls ARE allowed even though the FINAL response must be JSON only.
          - Do NOT guess/invent tool names; select the appropriate retrieval tool from the tools provided by the workflow runtime.
          - Never return [] just because only an ID was provided.

        RULE 1: Every carrier = separate quote record. A single carrier can produce multiple quote records (options).

        RULE 2: Market summary tables: each ROW is a separate quote record.

        RULE 3: Multiple options (different limits/deductibles/etc.) from the same carrier = separate quote records.

        RULE 4: Extract ALL quote records regardless of status (declined/pending/indication, including those with no premium). Use JSON null for missing.

        RULE 5: Never fabricate. Only perform explicit arithmetic allowed by <premium_extraction_guidance>.

        RULE 6: Do NOT include add-on costs in top-level premium/taxes/fees/deductible (base MPL only). Add-on pricing belongs in additional_coverage_add_ons.

        RULE 7: Endorsements go at entity level unless explicitly tied to a specific applicant.

        RULE 8: After extraction, if you created both entity + human quote records and the entity has no distinct premium/coverage (i.e., only a $0 additional insured listing or purely duplicative), do not output the entity quote record; keep the entity name in additional_insureds on the relevant human quote record(s).

        RULE 9: If a document lists a business entity under “Insured Entities” but does NOT list a separate base premium for that entity, do NOT create an entity quote record; attach the entity name to human additional_insureds.

        RULE 10: Scan the entire input; FAVOR ATTACHMENTS for premium/taxes/fees breakdowns.

        RULE 11: If you see different premium terms, reconcile carefully:
          - Different base policy options (limits/deductible/base option) → separate quote records.
          - Differences due to separately priced add-ons → keep one base quote record; put add-ons in additional_coverage_add_ons.

        RULE 12: Claims-made 5-year schedules (CMY-1…CMY-5): extract ONLY CMY-1 as the premium. You may mention the schedule in underwriter_comments ONLY when applicable (market summary context).

        RULE 12A (Claims-made schedule + occurrence option):
          If a document/email shows a CMY-1…CMY-5 claims-made schedule AND separately lists an Occurrence option with its own premium, you MUST create two quote records for the same carrier:
            1) claims_made: premium = CMY-1; include any explicit retroactive_date.
            2) occurrence: premium = Occurrence-labeled premium; retroactive_date = null.

        RULE 13: Scan ALL documents for practitioners. Do not rely on the main quote letter. Check rosters, schedules, applications, subjectivities naming individuals, and any practitioner mention anywhere.

        RULE 14 (Rosters/Schedules override additional_insureds):
          If any attachment contains an “Insured Party Roster” / “Schedule of Physicians” / “Schedule A/B” table, create a human quote record for EACH human listed.
          Extract that person’s own premium/limits/retro/effective/state/etc. from their row when present.
          Never place humans in additional_insureds on human quote records.

        RULE 14A (Provider rosters inside applications/forms):
          Treat ANY table/section in ANY attachment that lists individual clinicians/providers (e.g., “Medical Staff”, “Physician’s Name”, “Providers”, “Clinicians”, “Schedule of Physicians/Providers”, etc.) as an insured roster.
          - You MUST create one applicant-level quote record for EACH human name listed (even if it appears only in an application and not in the quote letter).
          - For facility/entity shared-limits policies, also copy the full roster of those human names into the ENTITY quote record’s additional_insureds (comma-separated), in addition to creating the individual applicant records.

        RULE 15 (Endorsements capture without the word “endorsement”):
          If the document contains a section labeled “Terms”, “Policy Provisions”, “Comments”, “Conditions” (policy-feature sense), or similar, populate endorsements with every item that is NOT:
            1) a subjectivity (pre-bind requirement),
            2) an exclusion/limitation (goes in exclusions_limitations),
            3) an included/optional coverage item with explicit coverage name + limit/sublimit (goes in additional_coverage; add-on pricing/details also go in additional_coverage_add_ons when separately priced).
          Preserve wording; join items with semicolons if you must combine.

        RULE 15A (Terms/Comments bullet splitting):
          Default every “Terms/Policy Provisions/Comments” bullet into endorsements.
          Only divert a bullet away from endorsements if it is explicitly:
            1) subjectivities/condition to bind → subjectivities,
            2) exclusion/limitation/restriction → exclusions_limitations, or
            3) coverage feature (with coverage name + limit/sublimit, included/optional) → additional_coverage (and if priced separately, capture pricing/details in additional_coverage_add_ons).
          Do not place general policy terms (consent to settle, defense inside limits, minimum earned premium, notice triggers, non-assessable, etc.) into additional_coverage.

        RULE 15B (Table/roster “Endorsements/Discounts” columns):
          If any table/roster (Schedule A/B, coverage overview, market summary, etc.) has a column/label containing “endorsement(s)” and/or “discount(s)” (including “Endorsements / Discounts”, “Discounts/Endorsements”), copy the corresponding cell value(s) into endorsements for that quote record (semicolon-separate if multiple).
          Do this even if the value is also used to set employment_status (e.g., “Part-Time”).
          Only divert an item away from endorsements if it is explicitly a subjectivity/condition to bind or an explicit exclusion/limitation (then follow routing rules).

        RULE 16 (Market-summary row isolation + “priced accordingly” bundling):
          - Market summary rows are independent. Determine policy_structure from THAT ROW’S text only. Do not inherit signals from other rows/paragraphs.
            If no explicit signal in the row: policy_structure = null.
          - “Priced accordingly / included in premium” is not an add-on line item:
            If a feature is said to be “priced accordingly/included” and the pricing table shows only updated premium/tax/fee totals without a separate line item for that feature, then:
              1) put the feature text in additional_coverage (included) and apply it to each applicable option from that table, and
              2) do NOT create an additional_coverage_add_ons pricing entry for it.
      </extraction_rules>

      <policy_type_detection>
        CLAIMS MADE (default except market summaries with no signal):
        - Contains "RDI" anywhere for that quote/row → claims_made
        - Shows a retroactive date → claims_made
        - States "Claims Made" (not “Plus/Modified”) → claims_made

        MODIFIED CLAIMS MADE:
        - Explicitly states "Claims Made Plus" / "Claims-Made Plus" → modified_claims_made
        - Explicitly states "Modified Claims Made" / "Modified" → modified_claims_made
        - Conditional/hypothetical mentions (“would be available if…”) do NOT set policy_structure.

        OCCURRENCE (rare):
        - ONLY if explicitly states "Occurrence"
        - retroactive_date must be null
      </policy_type_detection>

      <status_determination>
        OVERRIDE (non-binding documents):
          Set status = "indication" ONLY when the email or an attachment explicitly states non-binding / not bindable / indication only / does not constitute a quote or coverage / may be revoked / no obligation or commitment to provide coverage.
          Do NOT set status = "indication" based solely on (a) a document title/header containing “Indication/Premium Indication” or (b) generic softening language like “indication is based on info in the file and is subject to change once underwriting reviews.”
          Do NOT set status to "indication" based solely on a header/title containing “Indication” or “Premium Indication” if the same communication also explicitly labels the terms as a “Quote/Quotation/Proposal” for a single carrier; in that case, status = "quoted".

        indication:
        - Non-binding indication language as above, OR
        - Multi-carrier text-only market summaries (no formal bindable quote package per carrier).

        quoted:
        - ONLY when the document is a formal/bindable quote/proposal (explicitly labeled “Quote”, “Quotation”, “Proposal”, binder-ready terms) AND pertains to a single carrier.
        - Attachments alone do NOT mean quoted if the attachment is explicitly non-binding.

        pending:
        - Explicitly states submitted/under review/reviewing/awaiting decision.

        declined:
        - Explicitly states declined.

        MULTI-CARRIER MARKET SUMMARY STATUS RULE:
        - If the communication contains multiple carriers in a market-summary format, statuses must be ONLY: indication, pending, or declined (never "quoted" in that scenario).
      </status_determination>

      <facility_policy_handling>
        FACILITY/CLINIC/ALLIED HEALTHCARE (entity-level) POLICIES WITH SHARED LIMITS:

        When a quote is entity-level and practitioners are scheduled on shared limits:
        1) Create an entity quote record with full base premium, taxes, fees, limits, dates, etc.
        2) Create human quote records for EACH scheduled practitioner with:
          - quote_level = "applicant"
          - premium/taxes/fees/deductible = null if not stated per person
          - per_occurrence_limit/aggregate_limit = null UNLESS explicitly stated for that individual (do NOT copy entity limits onto individuals when limits are shared)
          - additional_coverage = "Shared limit with entity"
        3) Inherit effective_date AND retroactive_date from the entity quote record for all scheduled practitioners unless an individual row explicitly shows a different date.
        4) Subjectivities allocation:
          - Keep the full subjectivities list on the entity quote record.
          - If an entity-level subjectivity names specific practitioner(s), copy that specific item into the matching human quote record’s subjectivities.
          - If one item names multiple practitioners, split it so each named practitioner gets their own named requirement.

        Identifiers:
        - “Allied Healthcare Facilities Policy” / “Facilities Policy”
        - “Schedule of Physicians” / “Schedule of Insured Physicians”
        - “Shared limits” language
        - Premium stated only at entity level, no per-physician premium lines
      </facility_policy_handling>

      <ocr_table_parsing>
        OCR often destroys table alignment. Be careful with tables and “|”.

        Rules:
        1) Identify all row labels first.
        2) Count numeric values and map them sequentially (top-to-bottom, left-to-right).
        3) Never assume a label means missing — its value is usually elsewhere in the OCR text.
        4) Verify with arithmetic where possible (components should match stated subtotals/totals).
      </ocr_table_parsing>

      <premium_extraction_guidance>
        CRITICAL:
        - If any quote document/table shows a “Base Premium” line, you MUST set premium = Base Premium for that option/column.
        - Never use a line labeled “Premium”, “Policy Premium”, “Total Due”, “Total Payable”, etc. when it equals Base Premium + other line-item premiums.

        ADD-ON DETECTION:
        - Any coverage with its OWN premium line item (e.g., “Cyber Liability … $XXX”) is an add-on:
          * Put pricing/details in additional_coverage_add_ons.
          * Do NOT roll it into top-level premium/taxes/fees/deductible.
        - “Included” wording override (still an add-on if itemized):
          If a document says an add-on is “included” / “included if offered” / “can be foregone/removed” but ALSO shows a distinct line-item premium for that coverage (e.g., Base Premium $X plus Cyber Liability premium $Y), you MUST treat it as a separately-priced add-on and populate additional_coverage_add_ons for it.
        - Coverage-part add-ons:
          If the quote shows multiple “Coverage Parts” with separately itemized “— Premium: $X” lines (or a “Total for all Coverage Parts” that sums them),
          then any non-MPL coverage part premium is an add-on. Put that coverage part’s pricing/details in additional_coverage_add_ons.

        COMPUTATION (allowed only as explicit arithmetic from explicit numbers):
        - If only a combined total is shown but add-on premiums are itemized, compute:
          base premium = combined total − sum(add-on premiums)

        Prefer granular attachment breakdowns over email-body combined figures.
      </premium_extraction_guidance>

      <tax_vs_fee_disambiguation>
        Classification:
        - Label contains “Tax” → taxes
        - Label contains “Fee” → fees
        Even if grouped under “Surplus Lines Taxes and Fees”, separate by line item label.
      </tax_vs_fee_disambiguation>

      <tax_fee_line_item_parsing>
        Never use a “Total Taxes and Fees” combined total. Parse and separate individual line items into taxes vs fees.
      </tax_fee_line_item_parsing>

      <final_verification>
        Before returning output:
        1) Count every carrier/option/row mentioned across body + attachments; ensure the JSON array has that many quote records.
        2) Re-check each extracted number against source text; prefer attachments for financial breakdowns.
        3) Ensure add-on dollars are not in premium/taxes/fees/deductible (base MPL only) and are captured in additional_coverage_add_ons when itemized.
        4) Ensure medical_specialty contains no exclusions; restrictions go in exclusions_limitations.
        5) Ensure policy_structure is based on affirmative declarations, not hypotheticals; market summary rows do not inherit signals.
        6) Ensure no humans are placed in additional_insureds on human quote records.
        7) Ensure “shared limits with entity” is captured correctly:
          - Structural note belongs in additional_insureds when stated as such,
          - Facility-shared-limits practitioner records may use additional_coverage = "Shared limit with entity" per <facility_policy_handling>.
        8) Ensure every required key exists on every quote record; missing values are null.
        9) Confirm you reviewed the email body AND all attachments (or retrieved them if only an ID was provided).
      </final_verification>
      `,
      targetSuccessRate: 1,
      maxIterations: 1,
      // maxCost: 100,
      provider: LLMProviders.openai_gpt5,
      apiKey: process.env.OPENAI_API_KEY ?? '',
      storeLogs: true, 
      thinking: true,
    },
    // rateLimitBatch: 10,
    // rateLimitPause: 30,
  });

  // Hacky narrowing to print the correct results
  if ('iterations' in result) {
    logOptimizeResults(result);
  } else {
    logEvalResults(result);
  }
}

main().catch(console.error);
