import { Client, Connection } from "@temporalio/client"

import { getConfig } from "./config"
import type { TemporalConfig } from "./types"

import { randomUUID } from "crypto"

/**
 * Generates a unique workflow ID with UUID
 *
 * @param workflowName - Name of the workflow
 * @returns Unique workflow ID
 */
export function generateWorkflowId(workflowName: string): string {
  return `${workflowName}-${randomUUID()}`
}

/**
 * Creates a Temporal client with the provided or default configuration
 *
 * @param config - Optional configuration overrides
 * @returns Configured Temporal client instance
 */
export async function createTemporalClient(
  config?: TemporalConfig
): Promise<Client> {
  const mergedConfig = getConfig(config)

  const connection = await Connection.connect({
    address: mergedConfig.serverUrl,
    connectTimeout: mergedConfig.connectTimeout,
    tls: true,
    apiKey: mergedConfig.apiKey,
  })

  return new Client({
    connection,
    namespace: mergedConfig.namespace,
  })
}
