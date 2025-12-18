/**
 * Types for the quote ingestion example.
 * These mirror the structure of insurance quote data being extracted.
 */

export interface QuoteInput {
  emailId: string;
}

export type QuoteOutput = QuoteOutputItem[];

export interface QuoteOutputItem {
  additional_coverage?: string | null; // presence
  additional_coverage_add_ons?: string | null; // presence
  additional_insureds?: string | null; // presence
  aggregate_limit?: number | null; // numeric
  applicant_name?: string | null; // name
  carrier_id?: string | null; // exact
  deductible?: number | null; // numeric
  effective_date?: string | null; // date
  employment_status?: string | null; // exact
  endorsements?: string | null; // presence
  exclusions_limitations?: string | null; // presence
  execution_notes?: string | null; // presence
  fees?: number | null; // numeric (tolerance +- 20 absolute)
  medical_specialty?: string | null; // exact
  per_occurrence_limit?: number | null; // numeric
  policy_period_id?: string | null; // exact
  policy_structure?: string | null; // exact
  premium?: number | null; // numeric
  quote_level: string; // exact
  retroactive_date?: string | null; // date
  status?: string | null; // exact
  subjectivities?: string | null; // presence
  taxes?: number | null; // numeric
  underwriter_comments?: string | null; // presence
}
