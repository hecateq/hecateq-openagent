import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { deriveDynamicTasks } from "./signal-dag-executor"
import { OmoStateManager } from "./omo-state-manager"
import type { TaskExecutionResult, TaskNode } from "./types"

const tempDirs: string[] = []

function createTempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "omo-dyndag-"))
  tempDirs.push(d)
  return d
}

function makeResult(overrides: Partial<TaskExecutionResult> & { taskId: string; agentId: string }): TaskExecutionResult {
  return {
    status: "completed",
    changedFiles: [],
    producedArtifacts: [],
    ...overrides,
  }
}

function makeTask(overrides: Partial<TaskNode> & { id: string }): TaskNode {
  return {
    label: overrides.id,
    prompt: `Task ${overrides.id}`,
    domain: "backend",
    action: "both",
    dependsOn: [],
    status: "pending",
    ...overrides,
  }
}

describe("deriveDynamicTasks", () => {
  test("creates new DAG node from completed result with handoff target and signals", () => {
    const dir = createTempDir()
    const stateMgr = new OmoStateManager(dir)
    stateMgr.readOrCreate()

    const result = makeResult({
      taskId: "task_db",
      agentId: "database-specialist",
      status: "completed",
      handoffData: { status: "DONE", target: "security-architect", signalCount: 1 },
    })

    const existingTasks: TaskNode[] = [makeTask({ id: "task_db" })]

    const newNodes = deriveDynamicTasks([result], existingTasks, stateMgr)
    expect(newNodes.length).toBe(1)
    expect(newNodes[0]!.id).toContain("dyn_security-architect")
    expect(newNodes[0]!.label).toContain("security-architect")
    expect(newNodes[0]!.requiredSignals).toContain("schema_ready")
    expect(newNodes[0]!.assignedAgent).toBe("security-architect")
    expect(newNodes[0]!.metadata?.dynamic).toBe(true)

    const persisted = stateMgr.getDynamicDagNodes()
    expect(persisted.length).toBe(1)
    expect(persisted[0]!.sourceAgent).toBe("database-specialist")
  })

  test("does not create duplicate dynamic nodes for same target", () => {
    const dir = createTempDir()
    const stateMgr = new OmoStateManager(dir)
    stateMgr.readOrCreate()

    const result = makeResult({
      taskId: "task_db",
      agentId: "database-specialist",
      status: "completed",
      handoffData: { status: "DONE", target: "security-architect", signalCount: 1 },
    })

    const existingTasks: TaskNode[] = [makeTask({ id: "task_db" })]

    const first = deriveDynamicTasks([result], existingTasks, stateMgr)
    expect(first.length).toBe(1)

    const second = deriveDynamicTasks([result], [...existingTasks, ...first], stateMgr)
    expect(second.length).toBe(0)
  })

  test("skips results without handoff data", () => {
    const dir = createTempDir()
    const stateMgr = new OmoStateManager(dir)
    stateMgr.readOrCreate()

    const result = makeResult({
      taskId: "task_no_handoff",
      agentId: "oracle",
      status: "completed",
    })

    const nodes = deriveDynamicTasks([result], [], stateMgr)
    expect(nodes.length).toBe(0)
  })

  test("skips failed results", () => {
    const dir = createTempDir()
    const stateMgr = new OmoStateManager(dir)
    stateMgr.readOrCreate()

    const result = makeResult({
      taskId: "task_failed",
      agentId: "database-specialist",
      status: "failed",
      handoffData: { status: "BLOCKED", target: "security-architect", signalCount: 0 },
    })

    const nodes = deriveDynamicTasks([result], [], stateMgr)
    expect(nodes.length).toBe(0)
  })

  test("skips routing directive targets", () => {
    const dir = createTempDir()
    const stateMgr = new OmoStateManager(dir)
    stateMgr.readOrCreate()

    const result = makeResult({
      taskId: "task_routing",
      agentId: "database-specialist",
      status: "completed",
      handoffData: { status: "DONE", target: "return_to_caller", signalCount: 1 },
    })

    const nodes = deriveDynamicTasks([result], [], stateMgr)
    expect(nodes.length).toBe(0)
  })

  test("dynamic nodes are persisted in OmoState", () => {
    const dir = createTempDir()
    const stateMgr = new OmoStateManager(dir)
    stateMgr.readOrCreate()

    const result = makeResult({
      taskId: "t1",
      agentId: "database-specialist",
      status: "completed",
      handoffData: { status: "DONE", target: "nodejs-backend-developer", signalCount: 1 },
    })

    deriveDynamicTasks([result], [], stateMgr)

    const nodes = stateMgr.getDynamicDagNodes()
    expect(nodes.length).toBe(1)
    expect(nodes[0]!.emittedSignal).toBe("backend_ready")
    expect(nodes[0]!.sourceAgent).toBe("database-specialist")
    expect(nodes[0]!.status).toBe("pending")
  })
})
