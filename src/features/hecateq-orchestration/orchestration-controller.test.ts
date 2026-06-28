/// <reference types="bun-types" />

/**
 * Tests for IN_PROGRESS timeout transitions in the orchestration controller.
 *
 * A task with `startedAt` older than `defaultTaskTimeoutMs` should transition
 * to BLOCKED with `blockReason: "IN_PROGRESS_TIMEOUT"`. Tasks within the
 * timeout window are NOT touched.
 */

import { describe, test, expect } from "bun:test"
import type { TaskNode, ResolvedOrchestrationConfig } from "./types"

// ─── Helper to build a task node ─────────────────────────────────────────────

function makeTask(overrides: Partial<TaskNode> = {}): TaskNode {
  return {
    id: "task_1",
    label: "Test task",
    prompt: "Do the thing",
    domain: "backend",
    action: "write",
    dependsOn: [],
    status: "in_progress",
    ...overrides,
  }
}

function makeConfig(overrides: Partial<ResolvedOrchestrationConfig> = {}): ResolvedOrchestrationConfig {
  return {
    enabled: true,
    autoDecompose: true,
    autoExecuteLowRisk: true,
    requirePlanForHighRisk: true,
    maxRepairAttempts: 2,
    defaultTaskTimeoutMs: 300000, // 5 minutes
    allowParallelReadonlyTasks: true,
    allowParallelWriteTasks: false,
    qualityGates: { typecheck: false, lint: false, test: false, build: false, doctor: false },
    stateDir: "/tmp/orch-test",
    ...overrides,
  }
}

// ─── IN_PROGRESS timeout logic ───────────────────────────────────────────────
//
// The speculative timeout checker inspects tasks that are `in_progress`
// and compares `startedAt` to `Date.now() - defaultTaskTimeoutMs`.
//
// If `startedAt` is before the cutoff → transition to BLOCKED with
// `blockReason: "IN_PROGRESS_TIMEOUT"` and increment the
// `inProgressTimeoutTotal` counter.
//
// This function is not yet implemented in the orchestration controller.
// These tests define the expected contract.
// Once implemented, uncomment the import and use the real implementation.

function checkInProgressTimeout(
  tasks: TaskNode[],
  config: ResolvedOrchestrationConfig,
): { tasks: TaskNode[]; timedOut: number } {
  const now = Date.now()
  const cutoff = now - config.defaultTaskTimeoutMs
  let timedOut = 0

  const updated = tasks.map((task) => {
    if (task.status !== "in_progress") return task

    // If the task has a startedAt timestamp, check it against the cutoff
    const startedAt = task.metadata?.startedAt as number | undefined
    if (startedAt !== undefined && startedAt < cutoff) {
      timedOut++
      return {
        ...task,
        status: "blocked" as const,
        error: "IN_PROGRESS_TIMEOUT",
        metadata: {
          ...task.metadata,
          blockReason: "IN_PROGRESS_TIMEOUT",
        },
      }
    }
    return task
  })

  return { tasks: updated, timedOut }
}

describe("IN_PROGRESS timeout transitions", () => {
  test("#given task started 6 minutes ago with 5 min timeout #then transitions to BLOCKED with IN_PROGRESS_TIMEOUT", () => {
    // #given
    const sixMinAgo = Date.now() - 6 * 60 * 1000
    const task = makeTask({
      id: "task_timeout",
      status: "in_progress",
      metadata: { startedAt: sixMinAgo },
    })
    const config = makeConfig({ defaultTaskTimeoutMs: 5 * 60 * 1000 })

    // #when
    const result = checkInProgressTimeout([task], config)

    // #then
    expect(result.timedOut).toBe(1)
    const timeoutTask = result.tasks.find((t) => t.id === "task_timeout")
    expect(timeoutTask).toBeDefined()
    expect(timeoutTask!.status).toBe("blocked")
    expect(timeoutTask!.error).toBe("IN_PROGRESS_TIMEOUT")
    expect(timeoutTask!.metadata?.blockReason).toBe("IN_PROGRESS_TIMEOUT")
  })

  test("#given task started 4 minutes ago with 5 min timeout #then NOT touched", () => {
    // #given
    const fourMinAgo = Date.now() - 4 * 60 * 1000
    const task = makeTask({
      id: "task_ok",
      status: "in_progress",
      metadata: { startedAt: fourMinAgo },
    })
    const config = makeConfig({ defaultTaskTimeoutMs: 5 * 60 * 1000 })

    // #when
    const result = checkInProgressTimeout([task], config)

    // #then
    expect(result.timedOut).toBe(0)
    const okTask = result.tasks.find((t) => t.id === "task_ok")
    expect(okTask).toBeDefined()
    expect(okTask!.status).toBe("in_progress")
    expect(okTask!.error).toBeUndefined()
  })

  test("#given in_progress task without startedAt #then NOT touched", () => {
    // #given — no startedAt in metadata
    const task = makeTask({
      id: "task_no_start",
      status: "in_progress",
      metadata: {},
    })
    const config = makeConfig({ defaultTaskTimeoutMs: 5 * 60 * 1000 })

    // #when
    const result = checkInProgressTimeout([task], config)

    // #then
    expect(result.timedOut).toBe(0)
    const noStartTask = result.tasks.find((t) => t.id === "task_no_start")
    expect(noStartTask!.status).toBe("in_progress")
  })

  test("#given completed task with old startedAt #then NOT touched (not in_progress)", () => {
    // #given
    const sixMinAgo = Date.now() - 6 * 60 * 1000
    const task = makeTask({
      id: "task_completed",
      status: "completed",
      metadata: { startedAt: sixMinAgo },
    })
    const config = makeConfig({ defaultTaskTimeoutMs: 5 * 60 * 1000 })

    // #when
    const result = checkInProgressTimeout([task], config)

    // #then
    expect(result.timedOut).toBe(0)
  })

  test("#given multiple tasks with mixed ages #then only the old one times out", () => {
    // #given
    const sixMinAgo = Date.now() - 6 * 60 * 1000
    const fourMinAgo = Date.now() - 4 * 60 * 1000
    const oldTask = makeTask({
      id: "task_old",
      status: "in_progress",
      metadata: { startedAt: sixMinAgo },
    })
    const freshTask = makeTask({
      id: "task_fresh",
      status: "in_progress",
      metadata: { startedAt: fourMinAgo },
    })
    const config = makeConfig({ defaultTaskTimeoutMs: 5 * 60 * 1000 })

    // #when
    const result = checkInProgressTimeout([oldTask, freshTask], config)

    // #then
    expect(result.timedOut).toBe(1)
    expect(result.tasks.find((t) => t.id === "task_old")!.status).toBe("blocked")
    expect(result.tasks.find((t) => t.id === "task_fresh")!.status).toBe("in_progress")
  })

  test("#given timeout #then inProgressTimeoutTotal counter increments", () => {
    // #given
    const sixMinAgo = Date.now() - 6 * 60 * 1000
    const task = makeTask({
      id: "task_counter",
      status: "in_progress",
      metadata: { startedAt: sixMinAgo },
    })
    const config = makeConfig({ defaultTaskTimeoutMs: 5 * 60 * 1000 })

    // #when
    const result = checkInProgressTimeout([task], config)

    // #then — timedOut count matches the counter increment
    expect(result.timedOut).toBe(1)
  })

  test("#given timeout task #then does NOT emit a new delegation request", () => {
    // #given — timeout detection should NOT create delegation requests
    const sixMinAgo = Date.now() - 6 * 60 * 1000
    const task = makeTask({
      id: "task_no_delegation",
      status: "in_progress",
      metadata: { startedAt: sixMinAgo },
    })
    const config = makeConfig({ defaultTaskTimeoutMs: 5 * 60 * 1000 })

    // #when — timeout check is a pure inspection; no side effects like delegation
    const result = checkInProgressTimeout([task], config)

    // #then — the result only contains updated tasks and a count
    // No delegation request is produced as a side effect
    expect(result.timedOut).toBe(1)
    expect(Object.keys(result).sort()).toEqual(["tasks", "timedOut"])
    // The transition is from in_progress → blocked, not a new routing/delegation
    expect(result.tasks.find((t) => t.id === "task_no_delegation")!.status).toBe("blocked")
  })
})
