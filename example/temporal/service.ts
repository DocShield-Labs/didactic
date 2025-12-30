/**
 * Temporal Service
 *
 * Provides a unified interface for executing Temporal workflows with
 * type-safe inputs and outputs. Handles workflow orchestration including
 * connection management, workflow execution, and result retrieval.
 */

"use server"

import type { Client } from "@temporalio/client"

import { createTemporalClient, generateWorkflowId } from "./client"
import { getTaskQueue } from "./config"
import type {
  ListWorkflowExecutionsInput,
  ListWorkflowExecutionsResponse,
  QueryName,
  QueryResultMap,
  QuoteIngestionTestWorkflowResult,
  TemporalServiceInput,
  TemporalServiceResponse,
} from "./types"

/**
 * Executes a Temporal workflow with type-safe input and output.
 */
export async function startWorkflow(
  input: TemporalServiceInput
): Promise<TemporalServiceResponse> {
  let client: Client | null = null
  let workflowId = ""
  let runId = ""

  try {
    if (!input.workflow) {
      throw new Error("TemporalService: workflow parameter is required")
    }

    if (!input.data) {
      throw new Error("TemporalService: data parameter is required")
    }

    client = await createTemporalClient()
    workflowId = generateWorkflowId(input.workflow)

    const handle = await client.workflow.start(input.workflow, {
      args: [input.data],
      taskQueue: getTaskQueue(),
      workflowId,
    })

    runId = handle.firstExecutionRunId
    const waitForCompletion = input.waitForCompletion ?? true

    if (!waitForCompletion) {
      return {
        success: true,
        workflow: input.workflow,
        workflowId,
        runId,
      }
    }

    const result = await handle.result()

    interface WorkflowResult {
      success: boolean
      result?: unknown
      data?: unknown
      message?: string
      status?: string
    }

    const typedResult = result as WorkflowResult
    const isSuccess = typedResult.success === true
    const resultData = typedResult.result || typedResult.data

    if (isSuccess && resultData) {
      return {
        success: true,
        workflow: input.workflow,
        workflowId,
        runId,
        data: resultData as QuoteIngestionTestWorkflowResult,
      }
    }

    return {
      success: false,
      workflow: input.workflow,
      workflowId,
      runId,
      error: typedResult.message || "Workflow execution failed",
    }
  } catch (error) {
    return {
      success: false,
      workflow: input.workflow,
      workflowId: workflowId || "unknown",
      runId: runId || "unknown",
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    if (client) {
      try {
        await client.connection.close()
      } catch (closeError) {
        console.error(`TemporalService: Error closing connection: ${closeError}`)
      }
    }
  }
}

/**
 * Queries a workflow for status or custom query handlers
 */
export async function queryWorkflow<Q extends QueryName>(input: {
  workflowId: string
  queryName: Q
}): Promise<{
  success: boolean
  queryResult?: QueryResultMap[Q]
  error?: string
}>

export async function queryWorkflow(input: { workflowId: string }): Promise<{
  success: boolean
  status?: string
  isRunning?: boolean
  error?: string
}>

export async function queryWorkflow(input: {
  workflowId: string
  queryName?: QueryName
}): Promise<{
  success: boolean
  status?: string
  isRunning?: boolean
  queryResult?: unknown
  error?: string
}> {
  let client: Client | null = null

  try {
    client = await createTemporalClient()
    const handle = client.workflow.getHandle(input.workflowId)

    if (input.queryName) {
      try {
        const queryResult = await handle.query(input.queryName)
        return { success: true, queryResult }
      } catch (queryError) {
        console.error(
          `Custom query '${input.queryName}' failed for workflow ${input.workflowId}: ${queryError}`
        )
      }
    }

    const description = await handle.describe()
    return {
      success: true,
      status: description.status.name,
      isRunning: description.status.name === "RUNNING",
    }
  } catch (error) {
    return {
      success: false,
      status: "UNKNOWN",
      isRunning: false,
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    if (client) {
      try {
        await client.connection.close()
      } catch (closeError) {
        console.error(`queryWorkflow: Error closing connection: ${closeError}`)
      }
    }
  }
}

/**
 * Cancels a running workflow
 */
export async function cancelWorkflow(input: { workflowId: string }): Promise<{
  success: boolean
  error?: string
}> {
  let client: Client | null = null

  try {
    client = await createTemporalClient()
    const handle = client.workflow.getHandle(input.workflowId)
    await handle.cancel()
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    if (client) {
      try {
        await client.connection.close()
      } catch (closeError) {
        console.error(`cancelWorkflow: Error closing connection: ${closeError}`)
      }
    }
  }
}

/**
 * Lists workflow executions based on a query
 */
export async function listWorkflowExecutions(
  input: ListWorkflowExecutionsInput
): Promise<ListWorkflowExecutionsResponse> {
  let client: Client | null = null

  try {
    client = await createTemporalClient()
    const { connection } = client

    const namespace =
      input.namespace || process.env.TEMPORAL_NAMESPACE || "workflows-dev"

    const response = await connection.workflowService.listWorkflowExecutions({
      namespace,
      query: input.query,
    })

    const workflows =
      response.executions?.map((execution) => ({
        workflowId: execution.execution?.workflowId || undefined,
        status: execution.status || undefined,
      })) || []

    return { success: true, workflows }
  } catch (error) {
    console.error(`TemporalService listWorkflowExecutions Error: ${error}`)
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    if (client) {
      try {
        await client.connection.close()
      } catch (closeError) {
        console.error(
          `listWorkflowExecutions: Error closing connection: ${closeError}`
        )
      }
    }
  }
}
