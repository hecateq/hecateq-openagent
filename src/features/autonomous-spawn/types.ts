/**
 * Autonomous Spawn — Stage 1 Core Types
 *
 * Phase 1 foundation: spawn configuration, session tracking, and the
 * canonical runtime spawn adapter contract. These types plug into the
 * Wave 4 delegation pipeline without adding a second execution surface.
 */

import type { DelegationExecutionRequest, TaskExecutionResult } from "../hecateq-orchestration/types"

// ─── Configuration ────────────────────────────────────────────────────────────

/**
 * Auto-spawn configuration block.
 *
 * Lives under `hecateq.auto_spawn` in the project/user config file.
 * All fields have safe defaults; `enabled` gates the entire feature.
 */
export interface AutoSpawnConfig {
  /** Master enable switch (default: false) */
  enabled: boolean
  /** Maximum concurrent spawns across all orchestration sessions (default: 5) */
  maxConcurrentSpawns: number
  /** Timeout per spawn in milliseconds (default: 300000 = 5 min) */
  spawnTimeoutMs: number
  /** Whether to auto-retry on spawn failure (default: true) */
  autoRetryOnFailure: boolean
  /** Max consecutive failures before pausing auto-spawn (default: 3) */
  maxFailuresBeforePause: number
  /** How long to pause auto-spawn after max failures exceeded (default: 60000 = 1 min) */
  pauseDurationMs: number
  /** Whether spawns use background-agent async dispatch (default: true) */
  allowBackgroundSpawn: boolean
  /** Maximum routing depth for auto-spawn decisions (default: 3) */
  maxSpawnDepth: number
  /** Rate limit — sliding-window spawn burst protection (default: true) */
  rateLimitEnabled: boolean
  /** Max spawns per sliding window (default: 20) */
  maxSpawnsPerWindow: number
  /** Sliding window duration in ms (default: 60000 = 1 minute) */
  spawnWindowMs: number
}

/** Default auto-spawn configuration — safe, all guards active */
export const DEFAULT_AUTO_SPAWN_CONFIG: AutoSpawnConfig = {
  enabled: false,
  maxConcurrentSpawns: 5,
  spawnTimeoutMs: 300000,
  autoRetryOnFailure: true,
  maxFailuresBeforePause: 3,
  pauseDurationMs: 60000,
  allowBackgroundSpawn: true,
  maxSpawnDepth: 3,
  rateLimitEnabled: true,
  maxSpawnsPerWindow: 20,
  spawnWindowMs: 60000,
}

// ─── Spawn Session Tracking ──────────────────────────────────────────────────

/** Runtime status of a spawned session */
export type SpawnSessionStatus =
  | "running"
  | "completed"
  | "failed"
  | "timeout"
  | "aborted"

/**
 * A single tracked spawn session — persisted in `.omo/hecateq/state.json`
 * under the `spawn` section.
 */
export interface SpawnSession {
  /** OpenCode session ID assigned to the spawned agent */
  sessionId: string
  /** Matching delegation request ID from the delegation pipeline */
  delegationId: string
  /** Target agent that was spawned */
  targetAgent: string
  /** ISO-8601 timestamp when the spawn was initiated */
  spawnedAt: string
  /** Current runtime status */
  status: SpawnSessionStatus
  /** Routing depth at the time of spawn */
  routingDepth: number
  /** Source task ID that triggered this spawn (if any) */
  sourceTaskId?: string
  /** ISO-8601 timestamp when the spawn completed/failed (set on terminal status) */
  completedAt?: string
  /** Error summary if the spawn failed or timed out */
  errorSummary?: string
}

/** Persisted spawn state section in `.omo/hecateq/state.json` */
export interface SpawnState {
  /** Currently active spawn sessions */
  activeSessions: SpawnSession[]
  /** Terminal spawn history (completed, failed, timeout, aborted) */
  history: SpawnSession[]
  /** Runtime spawn config snapshot */
  config: {
    maxConcurrent: number
    pausedUntil: string | null
  }
}

/** Default empty spawn state */
export function createDefaultSpawnState(): SpawnState {
  return {
    activeSessions: [],
    history: [],
    config: {
      maxConcurrent: 5,
      pausedUntil: null,
    },
  }
}

// ─── Spawn Policy Result ─────────────────────────────────────────────────────

export interface SpawnPolicyResult {
  /** Whether this spawn request is allowed */
  allowed: boolean
  /** Human-readable reason if blocked */
  reason?: string
}

// ─── Runtime Spawn Adapter Contract ──────────────────────────────────────────

/**
 * The canonical spawn dispatch function.
 *
 * This is the SINGLE execution surface for autonomous spawn — no second
 * spawn path exists. It receives a delegation execution request and
 * dispatches it through the existing runtime (the prompt-async gate).
 *
 * The implementation lives in spawn-executor.ts; the contract is
 * defined here so both the executor and its consumers agree on the
 * interface without circular dependencies.
 */
export type SpawnRuntimeDispatch = (
  request: DelegationExecutionRequest,
) => Promise<TaskExecutionResult>

/**
 * Factory for creating DelegationRequestExecutor instances.
 *
 * The controller calls this to wire up the canonical spawn adapter
 * with the runtime dispatch function. Every instance uses the same
 * adapter — there is exactly one execution surface.
 */
export type CreateSpawnExecutor = (
  runtimeDispatch: SpawnRuntimeDispatch,
) => (request: DelegationExecutionRequest) => Promise<TaskExecutionResult>
