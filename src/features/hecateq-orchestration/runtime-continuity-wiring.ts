/**
 * Hecateq Runtime Continuity — production wiring seam.
 *
 * Bridges the pure execution-registry / resumption-channel / handoff-history
 * primitives with the real runtime:
 *  - BackgroundManager liveness accessor (default: task-registry backed)
 *  - parent_wake / background_task channel attach + ledger events
 *  - execution_started / execution_completed / execution_failed ledger events
 *  - duplicate-delegation guard + registerExecution composition
 *
 * Additive only: this module never changes the behavior of the primitives it
 * wraps. Every helper is safe to call before any BackgroundManager is wired;
 * liveness falls back to the shared task registry (fail closed).
 */

import type { BackgroundManager } from "../background-agent"
import { getRegisteredBackgroundTask } from "../background-agent/task-registry"
import {
  attachChannel,
  checkDuplicateDelegation,
  detachChannel,
  getExecutionRecord,
  registerExecution,
} from "./execution-registry"
import { appendRuntimeEvent } from "./handoff-history"
import type {
  DuplicateDelegationDecision,
  HecateqExecutionIdentity,
  HecateqExecutionRecord,
  HecateqRuntimeEvent,
  ResumptionChannel,
} from "./runtime-continuity-types"

// ─── BackgroundManager accessor ───────────────────────────────────────────────

let backgroundManagerAccessor: (() => BackgroundManager | null) | null = null

/**
 * Wire a real BackgroundManager provider. The orchestrator can run without
 * one: liveness falls back to the shared task registry (see
 * `defaultBackgroundTaskLivenessProbe`).
 */
export function setBackgroundManagerAccessorForHecateq(
  accessor: () => BackgroundManager | null,
): void {
  backgroundManagerAccessor = accessor
}

/**
 * Get the current accessor. Returns the default (no-op manager accessor)
 * until `setBackgroundManagerAccessorForHecateq` is called, so the
 * orchestrator can initialize without a real BackgroundManager.
 */
export function getBackgroundManagerAccessorForHecateq(): () => BackgroundManager | null {
  return backgroundManagerAccessor ?? defaultBackgroundManagerAccessor
}

function defaultBackgroundManagerAccessor(): BackgroundManager | null {
  return null
}

/**
 * @internal Test-only seam. Restores the default (no-op) accessor.
 */
export function _resetBackgroundManagerAccessorForTesting(): void {
  backgroundManagerAccessor = null
}

// ─── Liveness probe ───────────────────────────────────────────────────────────

/**
 * Default background-task liveness probe. Reads the shared task registry
 * (`globalThis.__omoBackgroundTaskRegistry`) — the same source
 * `BackgroundManager.getTask` falls back to — so it works before any real
 * manager is wired. Returns true only for pending/running tasks.
 */
export function defaultBackgroundTaskLivenessProbe(taskId: string): boolean {
  const task = getRegisteredBackgroundTask(taskId)
  if (!task) return false
  return task.status === "pending" || task.status === "running"
}

// ─── Resumption channels ──────────────────────────────────────────────────────

/**
 * Attach a `parent_wake` resumption channel to a live execution and record
 * the ledger event. Returns null when the execution does not exist or is in
 * a terminal/blocked state (same semantics as `attachChannel`).
 */
export function attachParentWakeToExecution(
  executionId: string,
  wakeId: string,
): HecateqExecutionRecord | null {
  const channel: ResumptionChannel = { kind: "parent_wake", id: wakeId, alive: true }
  const record = attachChannel(executionId, channel)
  if (!record) return null
  appendRuntimeEvent(toLedgerEvent("resumption_channel_attached", record, { channel }))
  return record
}

/**
 * Detach the resumption channel from an execution and record the ledger
 * event. Returns null when the execution does not exist.
 */
export function detachParentWakeFromExecution(
  executionId: string,
): HecateqExecutionRecord | null {
  const record = detachChannel(executionId)
  if (!record) return null
  appendRuntimeEvent(toLedgerEvent("resumption_channel_closed", record))
  return record
}

/**
 * Attach a `background_task` resumption channel. Used after a delegation
 * reports its spawned background task id, so later liveness checks can
 * resolve the execution against the real task registry.
 */
export function attachBackgroundTaskChannelToExecution(input: {
  executionId: string
  backgroundTaskId: string
}): HecateqExecutionRecord | null {
  const channel: ResumptionChannel = {
    kind: "background_task",
    id: input.backgroundTaskId,
    alive: true,
  }
  const record = attachChannel(input.executionId, channel)
  if (!record) return null
  appendRuntimeEvent(toLedgerEvent("resumption_channel_attached", record, { channel }))
  return record
}

// ─── Execution ledger events ──────────────────────────────────────────────────

/** Record an `execution_started` ledger event. */
export function recordExecutionStarted(input: {
  taskGraphId: string
  taskId: string
  attempt: number
  executionId: string
  agent: string
}): void {
  appendRuntimeEvent({
    event: "execution_started",
    timestamp: new Date().toISOString(),
    task_graph_id: input.taskGraphId,
    task_id: input.taskId,
    attempt: input.attempt,
    execution_id: input.executionId,
    agent: input.agent,
  })
}

/**
 * Record an `execution_completed` / `execution_failed` ledger event.
 * Deliberately does NOT transition the registry state: terminal transitions
 * remain the responsibility of the progress resolver / evidence layer via
 * `transitionProgress`, keeping this seam additive.
 */
export function recordExecutionCompleted(
  executionId: string,
  status: "completed" | "failed",
  reason?: string,
): void {
  const record = getExecutionRecord(executionId)
  const event: HecateqRuntimeEvent = {
    event: status === "completed" ? "execution_completed" : "execution_failed",
    timestamp: new Date().toISOString(),
    execution_id: executionId,
  }
  if (record) {
    event.task_graph_id = record.identity.taskGraphId
    event.task_id = record.identity.taskId
    event.attempt = record.identity.attempt
    event.agent = record.identity.agent
  }
  if (reason) event.reason = reason
  appendRuntimeEvent(event)
}

// ─── Duplicate guard + register composition ───────────────────────────────────

/**
 * Duplicate-delegation guard. Returns the existing execution id when a
 * non-terminal execution already exists (reused=true), a fresh id for a new
 * attempt, or a `blocked` reason when a live execution is bound to a
 * different agent.
 */
export function guardDuplicateDelegation(input: {
  taskGraphId: string
  taskId: string
  attempt: number
  agent: string
}): { executionId: string; reused: boolean; blocked?: string } {
  const decision: DuplicateDelegationDecision = checkDuplicateDelegation(input)
  switch (decision.action) {
    case "reuse_existing_execution":
      return { executionId: decision.executionId, reused: true }
    case "create_new_attempt":
      return { executionId: decision.executionId, reused: false }
    case "blocked":
      return { executionId: "", reused: false, blocked: decision.reason }
  }
}

/**
 * Register a new execution attempt and immediately record the
 * `execution_started` ledger event. Returns the identity so callers can
 * correlate the result (e.g. attach a resumption channel later).
 */
export function registerExecutionAndRecord(input: {
  taskGraphId: string
  taskId: string
  attempt: number
  agent: string
}): HecateqExecutionIdentity {
  const identity = registerExecution(input)
  recordExecutionStarted({
    taskGraphId: identity.taskGraphId,
    taskId: identity.taskId,
    attempt: identity.attempt,
    executionId: identity.executionId,
    agent: identity.agent,
  })
  return identity
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Derive a stable delegation task-graph id from a project dir. Used as the
 * duplicate-guard scope for consumed delegations.
 */
export function deriveDelegationTaskGraphId(projectDir: string): string {
  const slug = projectDir
    .replace(/\\/g, "/")
    .split("/")
    .filter((segment) => segment.length > 0)
    .join("-")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
  return `hecateq-delegation-${slug}`
}

function toLedgerEvent(
  event: "resumption_channel_attached" | "resumption_channel_closed",
  record: HecateqExecutionRecord,
  extra: { channel?: ResumptionChannel; reason?: string } = {},
): HecateqRuntimeEvent {
  const ledgerEvent: HecateqRuntimeEvent = {
    event,
    timestamp: new Date().toISOString(),
    task_graph_id: record.identity.taskGraphId,
    task_id: record.identity.taskId,
    attempt: record.identity.attempt,
    execution_id: record.identity.executionId,
    agent: record.identity.agent,
  }
  if (extra.channel) ledgerEvent.channel = extra.channel
  if (extra.reason) ledgerEvent.reason = extra.reason
  return ledgerEvent
}
