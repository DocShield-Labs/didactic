import type { TemporalConfig } from "./types"

/**
 * Default Temporal configuration from environment variables
 */
export const DEFAULT_CONFIG: Required<TemporalConfig> = {
  serverUrl: process.env.TEMPORAL_SERVER_URL || "localhost:7233",
  apiKey: process.env.TEMPORAL_API_KEY || "",
  namespace: process.env.TEMPORAL_NAMESPACE || "workflows-dev",
  taskQueue: process.env.TEMPORAL_TASK_QUEUE || "docshield-workflows",
  connectTimeout: 20000,
}

/**
 * Merges provided config with defaults
 */
export function getConfig(config?: TemporalConfig): Required<TemporalConfig> {
  return { ...DEFAULT_CONFIG, ...config }
}

/**
 * Gets the configured task queue name
 */
export function getTaskQueue(config?: TemporalConfig): string {
  return config?.taskQueue || DEFAULT_CONFIG.taskQueue
}
