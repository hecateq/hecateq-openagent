/**
 * Hecateq Verifier Driver (Part F: Notification-Driven Verification).
 *
 * Spawns NO background task and performs NO polling. The driver registers a
 * verifier execution (Runtime Continuity V1), attaches a `parent_wake`
 * resumption channel, and returns a `wait()` promise that resolves only when
 * the completion callback (`completeVerifierExecution`) fires. No timers, no
 * sleeps, no background_output polling.
 *
 * The driver is a setup scaffold: production callers (e.g. a bounded repair
 * loop) provide the actual verifier execution through the callback seam, and
 * the runtime parent-wake event completes the wait via
 * `completeVerifierExecution(executionId, result)`.
 */

import { randomUUID } from "node:crypto"

import type { HecateqTaskEvidence } from "./evidence-types"
import type { ResumptionChannel } from "./runtime-continuity-types"
import {
  attachParentWakeToExecution,
  guardDuplicateDelegation,
  registerExecutionAndRecord,
} from "./runtime-continuity-wiring"
import type { HecateqVerificationResult } from "./verifier-routing"

/** Matches the bounded-verification-repair default (Part E). */
export const HECATEQ_MAX_VERIFIER_ATTEMPTS = 2

export interface HecateqVerifierDriverConfig {
  taskGraphId: string
  taskId: string
  /** The task execution id whose evidence is being verified. */
  executionId: string
  agent: "qa-test-engineer"
  /** Additive: attempt drives duplicate-guard keying and registry identity. */
  attempt: number
}

export interface HecateqVerifierDriverResult {
  verification: HecateqVerificationResult
  evidence: HecateqTaskEvidence
  resumptionChannel: ResumptionChannel
}

export interface HecateqVerifierDriverHandle {
  verifierExecutionId: string
  channel: ResumptionChannel
  wait: () => Promise<HecateqVerifierDriverResult>
}

export class VerifierDriverError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "VerifierDriverError"
  }
}

function createDeferred<T>(): { resolve: (value: T) => void; promise: Promise<T> } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { resolve, promise }
}

/** executionId -> resolve function for the pending wait() promise. */
const pendingWaiters = new Map<string, (result: HecateqVerifierDriverResult) => void>()

export function startVerifierExecution(
  input: HecateqVerifierDriverConfig,
): HecateqVerifierDriverHandle {
  const guarded = guardDuplicateDelegation({
    taskGraphId: input.taskGraphId,
    taskId: input.taskId,
    attempt: input.attempt,
    agent: input.agent,
  })
  if (guarded.blocked) {
    throw new VerifierDriverError(`verifier execution blocked: ${guarded.blocked}`)
  }
  if (guarded.reused) {
    throw new VerifierDriverError(
      `duplicate verifier execution for ${input.taskGraphId}:${input.taskId}:${input.attempt}`,
    )
  }

  const identity = registerExecutionAndRecord({
    taskGraphId: input.taskGraphId,
    taskId: input.taskId,
    attempt: input.attempt,
    agent: input.agent,
  })

  const wakeId = randomUUID()
  const record = attachParentWakeToExecution(identity.executionId, wakeId)
  const channel: ResumptionChannel =
    record?.channel ?? { kind: "parent_wake", id: wakeId, alive: true }

  const waiter = createDeferred<HecateqVerifierDriverResult>()
  pendingWaiters.set(identity.executionId, waiter.resolve)

  return {
    verifierExecutionId: identity.executionId,
    channel,
    wait: () => waiter.promise,
  }
}

/**
 * Complete a verifier execution with its result. Resolves the matching
 * `wait()` promise (no polling). Unknown execution ids are ignored so late
 * or duplicate completions are harmless.
 */
export function completeVerifierExecution(
  executionId: string,
  result: HecateqVerifierDriverResult,
): void {
  const resolve = pendingWaiters.get(executionId)
  if (!resolve) return
  pendingWaiters.delete(executionId)
  resolve(result)
}

/** @internal Test-only seam. Clears pending waiters between tests. */
export function _resetVerifierDriverWaitersForTesting(): void {
  pendingWaiters.clear()
}
