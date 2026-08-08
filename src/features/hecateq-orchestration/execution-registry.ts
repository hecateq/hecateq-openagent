/**
 * Hecateq Execution Registry — in-memory runtime continuity cache.
 *
 * NOT persisted. Tracks live execution records for duplicate-delegation
 * guarding and idempotent progress transitions. The authoritative live-task
 * registry remains BackgroundManager; this registry only correlates logical
 * task attempts with runtime resumption channels.
 */

import { randomUUID } from "node:crypto"
import type {
  DuplicateDelegationDecision,
  HecateqExecutionCorrelation,
  HecateqExecutionIdentity,
  HecateqExecutionRecord,
  HecateqProgressState,
  ResumptionChannel,
} from "./runtime-continuity-types"

// ─── Constants ───────────────────────────────────────────────────────────────

const TERMINAL_STATES: ReadonlySet<HecateqProgressState> = new Set([
  "completed",
  "failed",
])

// ─── Module state ─────────────────────────────────────────────────────────────

/** Primary index: executionId -> record */
const records = new Map<string, HecateqExecutionRecord>()

/** Secondary index: `${taskGraphId}:${taskId}:${attempt}` -> executionId */
const secondaryIndex = new Map<string, string>()

// ─── Helpers ──────────────────────────────────────────────────────────────────

function taskKey(taskGraphId: string, taskId: string, attempt: number): string {
  return `${taskGraphId}:${taskId}:${attempt}`
}

function isTerminal(state: HecateqProgressState): boolean {
  return TERMINAL_STATES.has(state)
}

function nowIso(): string {
  return new Date().toISOString()
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Create a new execution attempt. Always returns a fresh identity
 * (`crypto.randomUUID`) — re-registering the same logical task inputs
 * intentionally yields a different executionId.
 */
export function registerExecution(input: {
  taskGraphId: string
  taskId: string
  attempt: number
  agent: string
}): HecateqExecutionIdentity {
  const executionId = randomUUID()
  const identity: HecateqExecutionIdentity = {
    executionId,
    taskGraphId: input.taskGraphId,
    taskId: input.taskId,
    attempt: input.attempt,
    agent: input.agent,
    startedAt: nowIso(),
  }
  const record: HecateqExecutionRecord = {
    identity,
    correlation: { executionId },
    progressState: "active",
    updatedAt: identity.startedAt,
  }
  records.set(executionId, record)
  secondaryIndex.set(taskKey(input.taskGraphId, input.taskId, input.attempt), executionId)
  return identity
}

/**
 * Attach mutable runtime correlation bindings. Merges into the existing
 * correlation — previously attached bindings are preserved.
 */
export function attachCorrelation(
  executionId: string,
  binding: Partial<
    Pick<
      HecateqExecutionCorrelation,
      "sessionId" | "backgroundTaskId" | "parentSessionId"
    >
  >,
): HecateqExecutionRecord | null {
  const record = records.get(executionId)
  if (!record) return null
  record.correlation = { ...record.correlation, ...binding }
  record.updatedAt = nowIso()
  return record
}

export function getExecutionRecord(
  executionId: string,
): HecateqExecutionRecord | null {
  return records.get(executionId) ?? null
}

export function findExecutionByTask(
  taskGraphId: string,
  taskId: string,
  attempt: number,
): HecateqExecutionRecord | null {
  const executionId = secondaryIndex.get(taskKey(taskGraphId, taskId, attempt))
  if (!executionId) return null
  return records.get(executionId) ?? null
}

export function findLatestExecutionForTask(
  taskGraphId: string,
  taskId: string,
): HecateqExecutionRecord | null {
  let latest: HecateqExecutionRecord | null = null
  for (const record of records.values()) {
    if (
      record.identity.taskGraphId !== taskGraphId ||
      record.identity.taskId !== taskId
    ) {
      continue
    }
    if (latest === null) {
      latest = record
      continue
    }
    if (record.identity.attempt > latest.identity.attempt) {
      latest = record
      continue
    }
    if (
      record.identity.attempt === latest.identity.attempt &&
      record.updatedAt > latest.updatedAt
    ) {
      latest = record
    }
  }
  return latest
}

/**
 * Duplicate delegation guard. Returns "reuse" when a non-terminal execution
 * already exists for (taskGraphId, taskId, attempt) — never silent spawn.
 * A live execution bound to a different agent is "blocked" (conflict).
 * A terminal execution requires a fresh attempt.
 */
export function checkDuplicateDelegation(input: {
  taskGraphId: string
  taskId: string
  attempt: number
  agent: string
}): DuplicateDelegationDecision {
  const key = taskKey(input.taskGraphId, input.taskId, input.attempt)
  const existingId = secondaryIndex.get(key)
  if (!existingId) {
    return { action: "create_new_attempt", executionId: randomUUID() }
  }
  const existing = records.get(existingId)
  if (!existing) {
    return { action: "create_new_attempt", executionId: randomUUID() }
  }
  if (!isTerminal(existing.progressState)) {
    if (existing.identity.agent !== input.agent) {
      return {
        action: "blocked",
        reason:
          `existing live execution ${existing.identity.executionId} uses agent ` +
          `${existing.identity.agent}, not ${input.agent}`,
      }
    }
    return {
      action: "reuse_existing_execution",
      executionId: existing.identity.executionId,
    }
  }
  return { action: "create_new_attempt", executionId: randomUUID() }
}

/**
 * Idempotent progress transition. Terminal states form a fixed point:
 *  - terminal -> same terminal: returns the same record unchanged (no event).
 *  - terminal -> different terminal: no-op, the first terminal wins.
 *  - terminal -> non-terminal: rejected (returns null).
 */
export function transitionProgress(
  executionId: string,
  nextState: HecateqProgressState,
): HecateqExecutionRecord | null {
  const record = records.get(executionId)
  if (!record) return null
  const current = record.progressState
  if (isTerminal(current)) {
    if (isTerminal(nextState)) {
      return record // fixed point / first-terminal-wins
    }
    return null // rejected: cannot leave a terminal state
  }
  record.progressState = nextState
  record.updatedAt = nowIso()
  return record
}

/**
 * Attach a live resumption channel. Only allowed while the execution is
 * "active" or "waiting"; terminal (and "blocked") executions reject with
 * null so a completed unit can never be duplicated by a late wake.
 */
export function attachChannel(
  executionId: string,
  channel: ResumptionChannel,
): HecateqExecutionRecord | null {
  const record = records.get(executionId)
  if (!record) return null
  if (record.progressState !== "active" && record.progressState !== "waiting") {
    return null
  }
  record.channel = channel
  record.updatedAt = nowIso()
  return record
}

/** Remove the resumption channel. Allowed in any state (cleanup). */
export function detachChannel(
  executionId: string,
): HecateqExecutionRecord | null {
  const record = records.get(executionId)
  if (!record) return null
  record.channel = undefined
  record.updatedAt = nowIso()
  return record
}

/**
 * @internal Test-only seam. Clears all in-memory execution records.
 */
export function _resetExecutionRegistryForTesting(): void {
  records.clear()
  secondaryIndex.clear()
}
