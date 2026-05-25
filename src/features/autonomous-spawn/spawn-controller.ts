import type {
  DelegationExecutionRequest,
  DelegationRequestExecutor,
  TaskExecutionResult,
} from "../hecateq-orchestration/types"
import type { AutoSpawnConfig, SpawnRuntimeDispatch, SpawnState, SpawnSession } from "./types"
import { createDefaultSpawnState } from "./types"
import { canSpawn, computePauseUntil } from "./spawn-policy"
import { createSpawnExecutor, createNoopSpawnExecutor } from "./spawn-executor"

export interface SpawnControllerState {
  spawnState: SpawnState
  consecutiveFailures: number
}

export function createSpawnController(initialConfig: AutoSpawnConfig) {
  let controllerState: SpawnControllerState = {
    spawnState: createDefaultSpawnState(),
    consecutiveFailures: 0,
  }

  function getState(): SpawnState {
    const paused = controllerState.spawnState.config.pausedUntil
      ? new Date(controllerState.spawnState.config.pausedUntil).getTime() > Date.now()
      : false

    if (!paused) {
      return {
        ...controllerState.spawnState,
        config: { ...controllerState.spawnState.config, pausedUntil: null },
      }
    }

    return controllerState.spawnState
  }

  function recordFailure(): void {
    controllerState.consecutiveFailures++

    const pauseUntil = computePauseUntil(
      initialConfig,
      controllerState.consecutiveFailures,
    )

    if (pauseUntil) {
      controllerState.spawnState = {
        ...controllerState.spawnState,
        config: {
          ...controllerState.spawnState.config,
          pausedUntil: pauseUntil,
        },
      }
    }
  }

  function registerSpawnStart(session: SpawnSession): void {
    controllerState.spawnState = {
      ...controllerState.spawnState,
      activeSessions: [...controllerState.spawnState.activeSessions, session],
    }
  }

  function registerSpawnComplete(sessionId: string, status: SpawnSession["status"], errorSummary?: string): void {
    const session = controllerState.spawnState.activeSessions.find((s) => s.sessionId === sessionId)
    if (!session) return

    const terminalSession: SpawnSession = {
      ...session,
      status,
      completedAt: new Date().toISOString(),
      errorSummary,
    }

    controllerState.spawnState = {
      ...controllerState.spawnState,
      activeSessions: controllerState.spawnState.activeSessions.filter((s) => s.sessionId !== sessionId),
      history: [terminalSession, ...controllerState.spawnState.history].slice(0, 100),
    }
  }

  function createDelegationExecutor(
    runtimeDispatch: SpawnRuntimeDispatch,
  ): DelegationRequestExecutor {
    return createSpawnExecutor(initialConfig, runtimeDispatch, {
      getState: () => getState(),
      recordFailure: () => recordFailure(),
    })
  }

  function createDisabledExecutor(): DelegationRequestExecutor {
    return createNoopSpawnExecutor()
  }

  function isSpawnAllowed(): boolean {
    if (!initialConfig.enabled) return false
    const result = canSpawn(initialConfig, getState())
    return result.allowed
  }

  function resetFailures(): void {
    controllerState.consecutiveFailures = 0
    controllerState.spawnState = {
      ...controllerState.spawnState,
      config: {
        ...controllerState.spawnState.config,
        pausedUntil: null,
      },
    }
  }

  return {
    getState,
    registerSpawnStart,
    registerSpawnComplete,
    createDelegationExecutor,
    createDisabledExecutor,
    isSpawnAllowed,
    resetFailures,
    getSpawnState: () => controllerState.spawnState,
    getConsecutiveFailures: () => controllerState.consecutiveFailures,
  }
}

export type SpawnController = ReturnType<typeof createSpawnController>
