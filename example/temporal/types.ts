// =============================================================================
// CONFIGURATION TYPES
// =============================================================================

export interface TemporalConfig {
  serverUrl?: string
  apiKey?: string
  namespace?: string
  taskQueue?: string
  connectTimeout?: number
}

// =============================================================================
// WORKFLOW TYPES
// =============================================================================

export type WorkflowName = "QuoteIngestionTestWorkflow"

// =============================================================================
// WORKFLOW QUERY TYPES
// =============================================================================

export type QueryResultMap = {
  getStatus: {
    status: string
    message?: string
  }
}

export type QueryName = keyof QueryResultMap

// =============================================================================
// WORKFLOW LISTING TYPES
// =============================================================================

export interface ListWorkflowExecutionsInput {
  query: string
  namespace?: string
}

export interface WorkflowExecution {
  workflowId?: string
  status?: number | string
}

export interface ListWorkflowExecutionsResponse {
  success: boolean
  workflows?: WorkflowExecution[]
  error?: string
}

// =============================================================================
// WORKFLOW INPUT TYPES
// =============================================================================

export interface QuoteIngestionTestWorkflowInput {
  messageIds?: string[]
  dry?: boolean
  systemPrompt?: string
  options?: {
    retries?: number
    timeout?: string
  }
}

// =============================================================================
// WORKFLOW RESULT TYPES
// =============================================================================

export interface QuoteIngestionTestWorkflowResult {
  [key: string]: unknown
}

// =============================================================================
// DISCRIMINATED UNION INPUT TYPE
// =============================================================================

export type TemporalServiceInput = {
  workflow: "QuoteIngestionTestWorkflow"
  data: QuoteIngestionTestWorkflowInput
  waitForCompletion?: boolean
}

// =============================================================================
// DISCRIMINATED UNION RESPONSE TYPE
// =============================================================================

export type TemporalServiceResponse = {
  success: boolean
  workflow: "QuoteIngestionTestWorkflow"
  workflowId: string
  runId: string
  data?: QuoteIngestionTestWorkflowResult
  error?: string
}
