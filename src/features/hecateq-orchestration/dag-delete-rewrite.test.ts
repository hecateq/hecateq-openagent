import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { applyDeleteMutations, applyRewriteMutations } from "./signal-dag-executor"
import { DelegationCycleDetector } from "./cycle-detector"
import { OmoStateManager } from "./omo-state-manager"
import type { TaskNode, DagMutationBlock } from "./types"

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), "omo-delrew-"))
}

function makeStateMgr(dir: string): OmoStateManager {
  const mgr = new OmoStateManager(dir)
  mgr.readOrCreate()
  return mgr
}

function makeTask(overrides: Partial<TaskNode> & { id: string }): TaskNode {
  return { label: overrides.id, prompt: `Task ${overrides.id}`, domain: "backend", action: "both", dependsOn: [], status: "pending", ...overrides }
}

// ─── Delete mutations ────────────────────────────────────────────────────

describe("applyDeleteMutations", () => {
  test("removes pending dynamic node", () => {
    const dir = createTempDir()
    const stateMgr = makeStateMgr(dir)
    stateMgr.recordDynamicDagNode({ id: "dyn_1", label: "X", prompt: "x", domain: "backend", requiredSignals: [], emittedSignal: null, sourceAgent: "s", sourceTaskId: "t", createdAt: new Date().toISOString(), status: "pending" })

    const tasks: TaskNode[] = [makeTask({ id: "dyn_1", status: "pending", metadata: { dynamic: true } })]
    const mutation: DagMutationBlock = { removeNodes: ["dyn_1"] }

    const result = applyDeleteMutations(mutation, tasks, stateMgr)
    expect(result.nodesRemoved).toBe(1)
    expect(result.rejectedReasons).toHaveLength(0)
    expect(tasks[0]!.status).toBe("skipped")
  })

  test("rejects removal of non-dynamic node", () => {
    const dir = createTempDir()
    const stateMgr = makeStateMgr(dir)
    const tasks: TaskNode[] = [makeTask({ id: "static_task", status: "pending" })]
    const mutation: DagMutationBlock = { removeNodes: ["static_task"] }

    const result = applyDeleteMutations(mutation, tasks, stateMgr)
    expect(result.nodesRemoved).toBe(0)
    expect(result.rejectedReasons[0]).toContain("not a dynamic")
  })

  test("rejects removal of non-pending node", () => {
    const dir = createTempDir()
    const stateMgr = makeStateMgr(dir)
    stateMgr.recordDynamicDagNode({ id: "dyn_done", label: "X", prompt: "x", domain: "backend", requiredSignals: [], emittedSignal: null, sourceAgent: "s", sourceTaskId: "t", createdAt: new Date().toISOString(), status: "completed" })

    const tasks: TaskNode[] = [makeTask({ id: "dyn_done", status: "completed", metadata: { dynamic: true } })]
    const mutation: DagMutationBlock = { removeNodes: ["dyn_done"] }

    const result = applyDeleteMutations(mutation, tasks, stateMgr)
    expect(result.nodesRemoved).toBe(0)
    expect(result.rejectedReasons[0]).toContain("only pending")
  })

  test("rejects removal of nonexistent node", () => {
    const dir = createTempDir()
    const stateMgr = makeStateMgr(dir)
    const mutation: DagMutationBlock = { removeNodes: ["ghost_node"] }

    const result = applyDeleteMutations(mutation, [], stateMgr)
    expect(result.nodesRemoved).toBe(0)
    expect(result.rejectedReasons[0]).toContain("not found")
  })

  test("removes dynamic edges", () => {
    const dir = createTempDir()
    const stateMgr = makeStateMgr(dir)
    stateMgr.recordDynamicDagEdge({ from: "a", to: "b", signal: "s", sourceTaskId: "t", sourceAgent: "s", createdAt: new Date().toISOString() })

    const mutation: DagMutationBlock = { removeEdges: [{ from: "a", to: "b" }] }
    const result = applyDeleteMutations(mutation, [], stateMgr)
    expect(result.edgesRemoved).toBe(1)
    expect(stateMgr.getDynamicDagEdges()).toHaveLength(0)
  })

  test("rejects removal of nonexistent edge", () => {
    const dir = createTempDir()
    const stateMgr = makeStateMgr(dir)
    const mutation: DagMutationBlock = { removeEdges: [{ from: "x", to: "y" }] }
    const result = applyDeleteMutations(mutation, [], stateMgr)
    expect(result.edgesRemoved).toBe(0)
    expect(result.rejectedReasons[0]).toContain("not found")
  })

  test("handles empty remove lists gracefully", () => {
    const dir = createTempDir()
    const stateMgr = makeStateMgr(dir)
    const mutation: DagMutationBlock = {}
    const result = applyDeleteMutations(mutation, [], stateMgr)
    expect(result.nodesRemoved).toBe(0)
    expect(result.edgesRemoved).toBe(0)
  })
})

// ─── Rewrite mutations ───────────────────────────────────────────────────

describe("applyRewriteMutations", () => {
  test("rewrites prompt on dynamic pending node", () => {
    const dir = createTempDir()
    const stateMgr = makeStateMgr(dir)
    stateMgr.recordDynamicDagNode({ id: "dyn_rw", label: "Old", prompt: "old prompt", domain: "backend", requiredSignals: [], emittedSignal: null, sourceAgent: "s", sourceTaskId: "t", createdAt: new Date().toISOString(), status: "pending" })

    const tasks: TaskNode[] = [makeTask({ id: "dyn_rw", status: "pending", prompt: "old prompt", metadata: { dynamic: true } })]
    const mutation: DagMutationBlock = { rewriteNodes: [{ id: "dyn_rw", prompt: "new prompt" }] }
    const cycleDetector = new DelegationCycleDetector()

    const result = applyRewriteMutations(mutation, tasks, "s", cycleDetector, stateMgr)
    expect(result.nodesRewritten).toBe(1)
    expect(tasks[0]!.prompt).toBe("new prompt")
    expect(stateMgr.getDynamicDagNodes()[0]!.prompt).toBe("new prompt")
  })

  test("rewrites requiredSignals and dependsOn", () => {
    const dir = createTempDir()
    const stateMgr = makeStateMgr(dir)
    stateMgr.recordDynamicDagNode({ id: "dyn_dep", label: "Dep", prompt: "p", domain: "backend", requiredSignals: ["old"], emittedSignal: null, sourceAgent: "s", sourceTaskId: "t", createdAt: new Date().toISOString(), status: "pending" })

    const tasks: TaskNode[] = [makeTask({ id: "dyn_dep", status: "pending", requiredSignals: ["old"], metadata: { dynamic: true } })]
    const mutation: DagMutationBlock = { rewriteNodes: [{ id: "dyn_dep", requiredSignals: ["new_signal"], dependsOn: ["other_task"] }] }
    const cycleDetector = new DelegationCycleDetector()

    const result = applyRewriteMutations(mutation, tasks, "s", cycleDetector, stateMgr)
    expect(result.nodesRewritten).toBe(1)
    expect(tasks[0]!.requiredSignals).toEqual(["new_signal"])
    expect(tasks[0]!.dependsOn).toEqual(["other_task"])
  })

  test("rejects rewrite on non-dynamic node", () => {
    const dir = createTempDir()
    const stateMgr = makeStateMgr(dir)
    const tasks: TaskNode[] = [makeTask({ id: "static_rw", status: "pending" })]
    const mutation: DagMutationBlock = { rewriteNodes: [{ id: "static_rw", prompt: "new" }] }
    const cycleDetector = new DelegationCycleDetector()

    const result = applyRewriteMutations(mutation, tasks, "s", cycleDetector, stateMgr)
    expect(result.nodesRewritten).toBe(0)
    expect(result.rejectedReasons[0]).toContain("not a dynamic")
  })

  test("rejects rewrite on non-pending node", () => {
    const dir = createTempDir()
    const stateMgr = makeStateMgr(dir)
    stateMgr.recordDynamicDagNode({ id: "dyn_done", label: "X", prompt: "x", domain: "backend", requiredSignals: [], emittedSignal: null, sourceAgent: "s", sourceTaskId: "t", createdAt: new Date().toISOString(), status: "completed" })

    const tasks: TaskNode[] = [makeTask({ id: "dyn_done", status: "completed", metadata: { dynamic: true } })]
    const mutation: DagMutationBlock = { rewriteNodes: [{ id: "dyn_done", prompt: "new" }] }
    const cycleDetector = new DelegationCycleDetector()

    const result = applyRewriteMutations(mutation, tasks, "s", cycleDetector, stateMgr)
    expect(result.nodesRewritten).toBe(0)
    expect(result.rejectedReasons[0]).toContain("only pending")
  })

  test("rejects rewrite with unknown assigned agent", () => {
    const dir = createTempDir()
    const stateMgr = makeStateMgr(dir)
    stateMgr.recordDynamicDagNode({ id: "dyn_ag", label: "Ag", prompt: "p", domain: "backend", requiredSignals: [], emittedSignal: null, sourceAgent: "s", sourceTaskId: "t", createdAt: new Date().toISOString(), status: "pending" })

    const tasks: TaskNode[] = [makeTask({ id: "dyn_ag", status: "pending", metadata: { dynamic: true } })]
    const mutation: DagMutationBlock = { rewriteNodes: [{ id: "dyn_ag", assignedAgent: "completely-fake-agent" }] }
    const cycleDetector = new DelegationCycleDetector()

    const result = applyRewriteMutations(mutation, tasks, "s", cycleDetector, stateMgr)
    expect(result.nodesRewritten).toBe(0)
    expect(result.rejectedReasons[0]).toContain("unknown agent")
  })

  test("handles empty rewrite list gracefully", () => {
    const dir = createTempDir()
    const stateMgr = makeStateMgr(dir)
    const mutation: DagMutationBlock = {}
    const cycleDetector = new DelegationCycleDetector()

    const result = applyRewriteMutations(mutation, [], "s", cycleDetector, stateMgr)
    expect(result.nodesRewritten).toBe(0)
  })
})
