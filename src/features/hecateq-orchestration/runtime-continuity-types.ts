/**
 * Hecateq Runtime Continuity — pure type definitions.
 *
 * These types describe the runtime continuity contract between execution
 * records, resumption channels, progress transitions, and the event ledger.
 * This file contains ZERO runtime code: it only declares types and interfaces.
 */

/** Runtime progress state. Distinct from HandoffStatus which is for blocks. */
export type HecateqProgressState =
  | "active" // currently making progress (token streaming, tool calls)
  | "waiting" // paused but a live resumption channel exists
  | "blocked" // no live channel; external decision needed
  | "completed" // terminal success
  | "failed" // terminal failure

/** Immutable identity. Created exactly once per attempt. */
export interface HecateqExecutionIdentity {
  executionId: string
  taskGraphId: string
  taskId: string
  attempt: number
  agent: string
  startedAt: string // ISO-8601
}

/**
 * Mutable runtime correlation bindings. May be attached AFTER
 * registerExecution.
 */
export interface HecateqExecutionCorrelation {
  executionId: string
  sessionId?: string
  backgroundTaskId?: string
  parentSessionId?: string
}

/**
 * A live resumption channel. Existence + liveness is provable from
 * runtime state.
 */
export type ResumptionChannel =
  | { kind: "background_task"; id: string; alive: boolean }
  | { kind: "delegated_session"; id: string; alive: boolean }
  | { kind: "continuation"; id: string; alive: boolean }
  | { kind: "parent_wake"; id: string; alive: boolean }

/** Full execution record tracked by the registry. */
export interface HecateqExecutionRecord {
  identity: HecateqExecutionIdentity
  correlation: HecateqExecutionCorrelation
  progressState: HecateqProgressState
  channel?: ResumptionChannel
  updatedAt: string
}

/** Event types appended to the runtime event ledger. */
export type HecateqRuntimeEventKind =
  | "execution_started"
  | "execution_waiting"
  | "execution_resumed"
  | "execution_completed"
  | "execution_failed"
  | "handoff_created"
  | "resumption_channel_attached"
  | "resumption_channel_closed"
  | "evidence_recorded"

/** A single runtime event. NO prompts, NO model output, NO secrets. */
export interface HecateqRuntimeEvent {
  event: HecateqRuntimeEventKind
  timestamp: string
  task_graph_id?: string
  task_id?: string
  attempt?: number
  execution_id?: string
  agent?: string
  channel?: ResumptionChannel
  /** Free-form reason — short, e.g. "duplicate delegation rejected" */
  reason?: string
}

/** Typed result of duplicate-delegation guard. */
export type DuplicateDelegationDecision =
  | { action: "reuse_existing_execution"; executionId: string }
  | { action: "create_new_attempt"; executionId: string }
  | { action: "blocked"; reason: string }
