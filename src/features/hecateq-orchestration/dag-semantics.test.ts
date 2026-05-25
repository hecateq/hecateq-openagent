import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { resolveReadyTasks, syncTaskStatuses, signalDagTick } from "./signal-dag-executor"
import { DelegationCycleDetector } from "./cycle-detector"
import { OmoStateManager } from "./omo-state-manager"
import type { TaskNode, TaskExecutionResult } from "./types"

const tempDirs: string[] = []

function createTempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "omo-semantic-"))
  tempDirs.push(d)
  return d
}

function makeTask(overrides: Partial<TaskNode> & { id: string }): TaskNode {
  return {
    label: overrides.id, prompt: `Task ${overrides.id}`, domain: "backend",
    action: "both", dependsOn: [], status: "pending", ...overrides,
  }
}

function makeResult(overrides: Partial<TaskExecutionResult> & { taskId: string; agentId: string }): TaskExecutionResult {
  return { status: "completed", changedFiles: [], producedArtifacts: [], ...overrides }
}

// ─── dependsOn readiness ─────────────────────────────────────────────────

describe("dependsOn readiness semantics", () => {
  test("blocks readiness when dependsOn task is not completed", () => {
    const consumed = new Set(["schema_ready"])
    const tasks: TaskNode[] = [
      makeTask({ id: "t_dep", status: "pending" }),
      makeTask({ id: "t_main", requiredSignals: ["schema_ready"], dependsOn: ["t_dep"], status: "pending" }),
    ]

    const ready = resolveReadyTasks(tasks, consumed)
    expect(ready).toHaveLength(0)
  })

  test("allows readiness when dependsOn task is completed", () => {
    const consumed = new Set(["schema_ready"])
    const tasks: TaskNode[] = [
      makeTask({ id: "t_dep", status: "completed" }),
      makeTask({ id: "t_main", requiredSignals: ["schema_ready"], dependsOn: ["t_dep"], status: "pending" }),
    ]

    const ready = resolveReadyTasks(tasks, consumed)
    expect(ready).toHaveLength(1)
    expect(ready[0]!.id).toBe("t_main")
  })

  test("blocks when one of multiple dependsOn is not completed", () => {
    const consumed = new Set(["backend_ready"])
    const tasks: TaskNode[] = [
      makeTask({ id: "t_dep1", status: "completed" }),
      makeTask({ id: "t_dep2", status: "pending" }),
      makeTask({ id: "t_main", requiredSignals: ["backend_ready"], dependsOn: ["t_dep1", "t_dep2"], status: "pending" }),
    ]

    const ready = resolveReadyTasks(tasks, consumed)
    expect(ready).toHaveLength(0)
  })
})

// ─── dynamic status sync from results ────────────────────────────────────

describe("syncTaskStatuses", () => {
  test("updates task status from execution results", () => {
    const dir = createTempDir()
    const stateMgr = new OmoStateManager(dir)
    stateMgr.readOrCreate()

    const tasks: TaskNode[] = [
      makeTask({ id: "t1", status: "pending" }),
      makeTask({ id: "t2", status: "pending" }),
    ]

    const results: TaskExecutionResult[] = [
      makeResult({ taskId: "t1", agentId: "oracle", status: "completed" }),
      makeResult({ taskId: "t2", agentId: "qa-test-engineer", status: "failed" }),
    ]

    const synced = syncTaskStatuses(tasks, results, stateMgr)
    expect(synced.updatedCount).toBe(2)
    expect(tasks.find((t) => t.id === "t1")!.status).toBe("completed")
    expect(tasks.find((t) => t.id === "t2")!.status).toBe("failed")
  })

  test("does not update already-completed tasks", () => {
    const dir = createTempDir()
    const stateMgr = new OmoStateManager(dir)
    stateMgr.readOrCreate()

    const tasks: TaskNode[] = [makeTask({ id: "t_done", status: "completed" })]
    const results: TaskExecutionResult[] = [
      makeResult({ taskId: "t_done", agentId: "oracle", status: "completed" }),
    ]

    const synced = syncTaskStatuses(tasks, results, stateMgr)
    expect(synced.updatedCount).toBe(0)
  })

  test("updates persisted dynamic node status", () => {
    const dir = createTempDir()
    const stateMgr = new OmoStateManager(dir)
    stateMgr.readOrCreate()

    stateMgr.recordDynamicDagNode({
      id: "dyn_test", label: "Test", prompt: "test", domain: "backend",
      requiredSignals: [], emittedSignal: null, sourceAgent: "s", sourceTaskId: "t",
      createdAt: new Date().toISOString(), status: "pending",
    })

    const tasks: TaskNode[] = [makeTask({ id: "dyn_test", status: "pending", metadata: { dynamic: true } })]
    const results: TaskExecutionResult[] = [
      makeResult({ taskId: "dyn_test", agentId: "oracle", status: "completed" }),
    ]

    syncTaskStatuses(tasks, results, stateMgr)

    const nodes = stateMgr.getDynamicDagNodes()
    expect(nodes[0]!.status).toBe("completed")
  })
})

// ─── edge-driven readiness ───────────────────────────────────────────────

describe("edge-driven readiness via dependsOn + requiredSignals", () => {
  test("dependsOn blocks even when signals are satisfied", () => {
    const consumed = new Set(["backend_ready"])
    const tasks: TaskNode[] = [
      makeTask({ id: "t_db", status: "pending" }),
      makeTask({ id: "t_be", requiredSignals: ["backend_ready"], dependsOn: ["t_db"], status: "pending" }),
    ]

    const ready = resolveReadyTasks(tasks, consumed)
    expect(ready).toHaveLength(0)
  })

  test("both signals and dependsOn satisfied → ready", () => {
    const consumed = new Set(["backend_ready"])
    const tasks: TaskNode[] = [
      makeTask({ id: "t_db", status: "completed" }),
      makeTask({ id: "t_be", requiredSignals: ["backend_ready"], dependsOn: ["t_db"], status: "pending" }),
    ]

    const ready = resolveReadyTasks(tasks, consumed)
    expect(ready).toHaveLength(1)
  })

  test("dynamic status sync unlocks downstream dependsOn", () => {
    const dir = createTempDir()
    const stateMgr = new OmoStateManager(dir)
    stateMgr.readOrCreate()

    const tasks: TaskNode[] = [
      makeTask({ id: "t_upstream", status: "pending", metadata: { dynamic: true } }),
      makeTask({ id: "t_downstream", requiredSignals: [], dependsOn: ["t_upstream"], status: "pending" }),
    ]

    const results: TaskExecutionResult[] = [
      makeResult({ taskId: "t_upstream", agentId: "oracle", status: "completed" }),
    ]

    syncTaskStatuses(tasks, results, stateMgr)
    expect(tasks.find((t) => t.id === "t_upstream")!.status).toBe("completed")

    const consumed = new Set<string>()
    const ready = resolveReadyTasks(tasks, consumed)
    expect(ready).toHaveLength(1)
    expect(ready[0]!.id).toBe("t_downstream")
  })
})
