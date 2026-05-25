import type {
  DelegationExecutionRequest,
  TaskExecutionResult,
} from "../hecateq-orchestration/types"
import type { AutoSpawnConfig, SpawnRuntimeDispatch, SpawnState } from "./types"
import { canSpawn } from "./spawn-policy"

export interface SpawnExecutionCallbacks {
  getState: () => SpawnState
  recordFailure: () => void
}

export function createSpawnExecutor(
  config: AutoSpawnConfig,
  runtimeDispatch: SpawnRuntimeDispatch,
  callbacks: SpawnExecutionCallbacks,
): (request: DelegationExecutionRequest) => Promise<TaskExecutionResult> {
  return async (request: DelegationExecutionRequest): Promise<TaskExecutionResult> => {
    const state = callbacks.getState()

    const policyResult = canSpawn(config, state)

    if (!policyResult.allowed) {
      return {
        taskId: request.delegationId,
        agentId: request.targetAgent,
        status: "blocked",
        changedFiles: [],
        producedArtifacts: [],
        errorSummary: `Spawn policy blocked: ${policyResult.reason}`,
      }
    }

    if (request.routingDepth > config.maxSpawnDepth) {
      return {
        taskId: request.delegationId,
        agentId: request.targetAgent,
        status: "blocked",
        changedFiles: [],
        producedArtifacts: [],
        errorSummary: `Routing depth ${request.routingDepth} exceeds max spawn depth ${config.maxSpawnDepth}`,
      }
    }

    let timeoutId: ReturnType<typeof setTimeout> | undefined

    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`Spawn timeout after ${config.spawnTimeoutMs}ms for "${request.targetAgent}"`))
        }, config.spawnTimeoutMs)
      })

      const dispatchPromise = runtimeDispatch(request)

      const result = await Promise.race([dispatchPromise, timeoutPromise])

      clearTimeout(timeoutId)
      return result
    } catch (error) {
      if (timeoutId !== undefined) clearTimeout(timeoutId)

      callbacks.recordFailure()

      const errorMessage = error instanceof Error ? error.message : String(error)

      return {
        taskId: request.delegationId,
        agentId: request.targetAgent,
        status: "failed",
        changedFiles: [],
        producedArtifacts: [],
        errorSummary: `Spawn executor failed: ${errorMessage}`,
      }
    }
  }
}

export function createNoopSpawnExecutor(): (
  request: DelegationExecutionRequest,
) => Promise<TaskExecutionResult> {
  return async (request: DelegationExecutionRequest): Promise<TaskExecutionResult> => ({
    taskId: request.delegationId,
    agentId: request.targetAgent,
    status: "skipped",
    changedFiles: [],
    producedArtifacts: [],
    errorSummary: "Auto-spawn is disabled",
  })
}
