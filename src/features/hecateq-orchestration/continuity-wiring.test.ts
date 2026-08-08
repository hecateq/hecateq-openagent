import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { BackgroundManager } from "../background-agent"
import {
  clearBackgroundTaskRegistryForTesting,
  rememberBackgroundTask,
} from "../background-agent/task-registry"
import type { BackgroundTask } from "../background-agent/types"
import {
  _resetExecutionRegistryForTesting,
  getExecutionRecord,
} from "./execution-registry"
import {
  _setHandoffHistoryFilePathForTesting,
  loadRecentRuntimeEvents,
} from "./handoff-history"
import { probeBackgroundTaskLiveness } from "./resumption-channel"
import {
  _resetBackgroundManagerAccessorForTesting,
  attachParentWakeToExecution,
  defaultBackgroundTaskLivenessProbe,
  detachParentWakeFromExecution,
  getBackgroundManagerAccessorForHecateq,
  guardDuplicateDelegation,
  recordExecutionCompleted,
  registerExecutionAndRecord,
  setBackgroundManagerAccessorForHecateq,
} from "./runtime-continuity-wiring"

const tempDirs: string[] = []

function makeLedger(): string {
  const directory = mkdtempSync(join(tmpdir(), "omo-continuity-wiring-"))
  tempDirs.push(directory)
  return join(directory, "handoff-history.jsonl")
}

function makeBackgroundTask(overrides: Partial<BackgroundTask> = {}): BackgroundTask {
  return {
    id: "bg_task_1",
    parentSessionId: "ses_parent",
    parentMessageId: "msg_parent",
    description: "Test background task",
    prompt: "Do work",
    agent: "nodejs-backend-developer",
    status: "running",
    ...overrides,
  }
}

const TASK_GRAPH = "test-graph"
const TASK_ID = "task_1"
const AGENT = "nodejs-backend-developer"

function baseInput(overrides: Partial<Parameters<typeof registerExecutionAndRecord>[0]> = {}) {
  return { taskGraphId: TASK_GRAPH, taskId: TASK_ID, attempt: 1, agent: AGENT, ...overrides }
}

function latestEvents(limit = 20) {
  return loadRecentRuntimeEvents(limit)
}

beforeEach(() => {
  _setHandoffHistoryFilePathForTesting(makeLedger())
  _resetExecutionRegistryForTesting()
  _resetBackgroundManagerAccessorForTesting()
  clearBackgroundTaskRegistryForTesting()
})

afterEach(() => {
  _setHandoffHistoryFilePathForTesting(null)
  _resetExecutionRegistryForTesting()
  _resetBackgroundManagerAccessorForTesting()
  clearBackgroundTaskRegistryForTesting()
  while (tempDirs.length > 0) {
    const directory = tempDirs.pop()
    if (directory) {
      rmSync(directory, { recursive: true, force: true })
    }
  }
})

// ─── Duplicate delegation guard ───────────────────────────────────────────────

describe("guardDuplicateDelegation", () => {
  test("#given fresh task #then returns create_new_attempt", () => {
    const decision = guardDuplicateDelegation(baseInput())

    expect(decision.reused).toBe(false)
    expect(decision.blocked).toBeUndefined()
    expect(decision.executionId).not.toBe("")
  })

  test("#given live execution for same task+agent #then returns reuse_existing_execution", () => {
    const identity = registerExecutionAndRecord(baseInput())

    const decision = guardDuplicateDelegation(baseInput())

    expect(decision.reused).toBe(true)
    expect(decision.blocked).toBeUndefined()
    expect(decision.executionId).toBe(identity.executionId)
  })

  test("#given live execution bound to different agent #then returns blocked", () => {
    registerExecutionAndRecord(baseInput())

    const decision = guardDuplicateDelegation(baseInput({ agent: "security-architect" }))

    expect(decision.reused).toBe(false)
    expect(decision.executionId).toBe("")
    expect(decision.blocked).toContain("security-architect")
  })
})

// ─── Execution ledger events ──────────────────────────────────────────────────

describe("registerExecutionAndRecord", () => {
  test("#given fresh task #then emits execution_started event", () => {
    const identity = registerExecutionAndRecord(baseInput())

    const started = latestEvents().find((event) => event.event === "execution_started")

    expect(started).toBeDefined()
    expect(started!.execution_id).toBe(identity.executionId)
    expect(started!.task_graph_id).toBe(TASK_GRAPH)
    expect(started!.task_id).toBe(TASK_ID)
    expect(started!.attempt).toBe(1)
    expect(started!.agent).toBe(AGENT)
  })
})

describe("recordExecutionCompleted", () => {
  test("#given execution #then appends execution_completed", () => {
    const identity = registerExecutionAndRecord(baseInput())

    recordExecutionCompleted(identity.executionId, "completed")

    const completed = latestEvents().find((event) => event.event === "execution_completed")
    expect(completed).toBeDefined()
    expect(completed!.execution_id).toBe(identity.executionId)
  })

  test("#given execution #then appends execution_failed with reason", () => {
    const identity = registerExecutionAndRecord(baseInput())

    recordExecutionCompleted(identity.executionId, "failed", "boom")

    const failed = latestEvents().find((event) => event.event === "execution_failed")
    expect(failed).toBeDefined()
    expect(failed!.execution_id).toBe(identity.executionId)
    expect(failed!.reason).toBe("boom")
  })
})

// ─── Resumption channel helpers ───────────────────────────────────────────────

describe("attachParentWakeToExecution", () => {
  test("#given live execution #then attaches parent_wake channel and appends event", () => {
    const identity = registerExecutionAndRecord(baseInput())

    const record = attachParentWakeToExecution(identity.executionId, "wake_parent_1")

    expect(record).not.toBeNull()
    expect(record!.channel).toEqual({ kind: "parent_wake", id: "wake_parent_1", alive: true })

    const attached = latestEvents().find((event) => event.event === "resumption_channel_attached")
    expect(attached).toBeDefined()
    expect(attached!.channel?.kind).toBe("parent_wake")
    expect(attached!.channel?.id).toBe("wake_parent_1")
    expect(attached!.execution_id).toBe(identity.executionId)
  })

  test("#given unknown execution #then returns null without event", () => {
    const record = attachParentWakeToExecution("missing-execution", "wake_parent_1")

    expect(record).toBeNull()
    expect(latestEvents()).toHaveLength(0)
  })
})

describe("detachParentWakeFromExecution", () => {
  test("#given attached execution #then detaches channel and appends event", () => {
    const identity = registerExecutionAndRecord(baseInput())
    attachParentWakeToExecution(identity.executionId, "wake_parent_1")

    const record = detachParentWakeFromExecution(identity.executionId)

    expect(record).not.toBeNull()
    expect(record!.channel).toBeUndefined()
    expect(getExecutionRecord(identity.executionId)!.channel).toBeUndefined()

    const closed = latestEvents().find((event) => event.event === "resumption_channel_closed")
    expect(closed).toBeDefined()
    expect(closed!.execution_id).toBe(identity.executionId)
  })
})

// ─── Liveness probe ───────────────────────────────────────────────────────────

describe("defaultBackgroundTaskLivenessProbe", () => {
  test("#given missing task #then returns false", () => {
    expect(defaultBackgroundTaskLivenessProbe("does-not-exist")).toBe(false)
  })

  test("#given pending or running task #then returns true", () => {
    rememberBackgroundTask(makeBackgroundTask({ id: "bg_running", status: "running" }))
    rememberBackgroundTask(makeBackgroundTask({ id: "bg_pending", status: "pending" }))

    expect(defaultBackgroundTaskLivenessProbe("bg_running")).toBe(true)
    expect(defaultBackgroundTaskLivenessProbe("bg_pending")).toBe(true)
  })

  test("#given terminal task #then returns false", () => {
    rememberBackgroundTask(makeBackgroundTask({ id: "bg_done", status: "completed" }))

    expect(defaultBackgroundTaskLivenessProbe("bg_done")).toBe(false)
  })
})

// ─── Production seam ──────────────────────────────────────────────────────────

describe("BackgroundManager accessor seam", () => {
  test("#given no manager wired #then accessor returns a callable default", () => {
    const accessor = getBackgroundManagerAccessorForHecateq()

    expect(typeof accessor).toBe("function")
    expect(accessor()).toBeNull()
  })

  test("#given manager accessor wired #then getter returns it", () => {
    const wired: () => BackgroundManager | null = () => null
    setBackgroundManagerAccessorForHecateq(wired)

    expect(getBackgroundManagerAccessorForHecateq()).toBe(wired)
  })

  test("#given registered background task #then probeBackgroundTaskLiveness with default probe returns true", () => {
    rememberBackgroundTask(makeBackgroundTask({ id: "bg_seam", status: "running" }))

    expect(probeBackgroundTaskLiveness("bg_seam", defaultBackgroundTaskLivenessProbe)).toBe(true)
    expect(probeBackgroundTaskLiveness("bg_missing", defaultBackgroundTaskLivenessProbe)).toBe(false)
  })
})
