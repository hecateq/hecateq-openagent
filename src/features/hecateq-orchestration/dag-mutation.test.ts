import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { applyDagMutations, extractDagMutations } from "./signal-dag-executor"
import { DelegationCycleDetector } from "./cycle-detector"
import { OmoStateManager } from "./omo-state-manager"
import type { TaskExecutionResult, TaskNode, DagMutationBlock } from "./types"

const tempDirs: string[] = []

function createTempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "omo-applymut-"))
  tempDirs.push(d)
  return d
}

function makeStateMgr(): OmoStateManager {
  const dir = createTempDir()
  const mgr = new OmoStateManager(dir)
  mgr.readOrCreate()
  return mgr
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

function makeResult(overrides: Partial<TaskExecutionResult> & { taskId: string; agentId: string }): TaskExecutionResult {
  return {
    status: "completed",
    changedFiles: [],
    producedArtifacts: [],
    ...overrides,
  }
}

describe("applyDagMutations", () => {
  test("applies valid multi-node mutation", () => {
    const cycleDetector = new DelegationCycleDetector()
    const stateMgr = makeStateMgr()
    const mutation: DagMutationBlock = {
      addNodes: [
        { id: "mut_node_1", label: "Backend impl", prompt: "Implement backend API", assignedAgent: "nodejs-backend-developer" },
        { id: "mut_node_2", label: "QA tests", prompt: "Run QA tests", assignedAgent: "qa-test-engineer", requiredSignals: ["backend_ready"] },
      ],
    }

    const result = applyDagMutations(mutation, [], "task_src", "sisyphus", cycleDetector, stateMgr)
    expect(result.nodesAdded).toBe(2)
    expect(result.nodesRejected).toBe(0)
    expect(result.appliedNodes).toHaveLength(2)
  })

  test("rejects duplicate node IDs", () => {
    const cycleDetector = new DelegationCycleDetector()
    const stateMgr = makeStateMgr()
    const existing = [makeTask({ id: "existing_task" })]
    const mutation: DagMutationBlock = {
      addNodes: [{ id: "existing_task", label: "Dup", prompt: "duplicate", assignedAgent: "oracle" }],
    }

    const result = applyDagMutations(mutation, existing, "t1", "s", cycleDetector, stateMgr)
    expect(result.nodesAdded).toBe(0)
    expect(result.nodesRejected).toBe(1)
  })

  test("rejects unknown assigned agent", () => {
    const cycleDetector = new DelegationCycleDetector()
    const stateMgr = makeStateMgr()
    const mutation: DagMutationBlock = {
      addNodes: [{ id: "ghost", label: "Ghost", prompt: "unknown agent", assignedAgent: "completely-fake-agent" }],
    }

    const result = applyDagMutations(mutation, [], "t1", "s", cycleDetector, stateMgr)
    expect(result.nodesAdded).toBe(0)
    expect(result.nodesRejected).toBe(1)
    expect(result.rejectedReasons[0]).toContain("Unknown assigned agent")
  })

  test("rejects when total dynamic nodes would exceed cap", () => {
    const cycleDetector = new DelegationCycleDetector()
    const stateMgr = makeStateMgr()
    const existing: TaskNode[] = []
    for (let i = 0; i < 48; i++) {
      existing.push(makeTask({ id: `dyn_${i}`, metadata: { dynamic: true } }))
    }

    const mutation: DagMutationBlock = {
      addNodes: [
        { id: "n1", label: "N1", prompt: "p1", assignedAgent: "oracle" },
        { id: "n2", label: "N2", prompt: "p2", assignedAgent: "oracle" },
        { id: "n3", label: "N3", prompt: "p3", assignedAgent: "oracle" },
      ],
    }

    const result = applyDagMutations(mutation, existing, "t1", "s", cycleDetector, stateMgr)
    expect(result.nodesAdded).toBe(0)
    expect(result.rejectedReasons[0]).toContain("exceed max dynamic nodes")
  })

  test("persists applied mutation record in OmoState", () => {
    const cycleDetector = new DelegationCycleDetector()
    const stateMgr = makeStateMgr()
    const mutation: DagMutationBlock = {
      addNodes: [{ id: "persist_node", label: "Persist", prompt: "test", assignedAgent: "oracle" }],
      plannerNote: "Test persistence",
    }

    applyDagMutations(mutation, [], "task_src", "sisyphus", cycleDetector, stateMgr)

    const mutations = stateMgr.getAppliedMutations()
    expect(mutations.length).toBe(1)
    expect(mutations[0]!.sourceTaskId).toBe("task_src")
    expect(mutations[0]!.plannerNote).toBe("Test persistence")
    expect(mutations[0]!.nodesAdded).toBe(1)
  })

  test("persists dynamic edges in OmoState", () => {
    const cycleDetector = new DelegationCycleDetector()
    const stateMgr = makeStateMgr()
    const mutation: DagMutationBlock = {
      addEdges: [
        { from: "node_a", to: "node_b", signal: "schema_ready" },
        { from: "node_b", to: "node_c", signal: "backend_ready" },
      ],
    }

    applyDagMutations(mutation, [], "t1", "s", cycleDetector, stateMgr)

    const edges = stateMgr.getDynamicDagEdges()
    expect(edges.length).toBe(2)
    expect(edges[0]!.from).toBe("node_a")
    expect(edges[0]!.to).toBe("node_b")
    expect(edges[0]!.signal).toBe("schema_ready")
    expect(edges[1]!.from).toBe("node_b")
  })

  test("both nodes and edges are persisted together", () => {
    const cycleDetector = new DelegationCycleDetector()
    const stateMgr = makeStateMgr()
    const mutation: DagMutationBlock = {
      addNodes: [{ id: "edge_node", label: "E", prompt: "e", assignedAgent: "oracle" }],
      addEdges: [{ from: "edge_node", to: "target", signal: "backend_ready" }],
    }

    applyDagMutations(mutation, [], "t1", "s", cycleDetector, stateMgr)

    expect(stateMgr.getDynamicDagNodes().length).toBe(1)
    expect(stateMgr.getDynamicDagEdges().length).toBe(1)
    expect(stateMgr.getAppliedMutations().length).toBe(1)
    expect(stateMgr.getAppliedMutations()[0]!.edgesAdded).toBe(1)
    expect(stateMgr.getAppliedMutations()[0]!.nodesAdded).toBe(1)
  })

  test("accepts empty mutation block gracefully", () => {
    const cycleDetector = new DelegationCycleDetector()
    const stateMgr = makeStateMgr()
    const mutation: DagMutationBlock = {}

    const result = applyDagMutations(mutation, [], "t1", "s", cycleDetector, stateMgr)
    expect(result.nodesAdded).toBe(0)
    expect(result.nodesRejected).toBe(0)
  })
})

describe("extractDagMutations", () => {
  test("extracts mutations from completed results", () => {
    const result = makeResult({
      taskId: "task_planner",
      agentId: "sisyphus",
      status: "completed",
      handoffData: {
        status: "DONE",
        target: "return_to_caller",
        signalCount: 1,
        dagMutations: {
          addNodes: [{ id: "plan_1", label: "Step 1", prompt: "Do step 1", assignedAgent: "oracle" }],
        },
      },
    })

    const extracted = extractDagMutations([result])
    expect(extracted).toHaveLength(1)
    expect(extracted[0]!.mutations.addNodes).toHaveLength(1)
  })

  test("skips results without dagMutations", () => {
    const result = makeResult({
      taskId: "task_no_mut",
      agentId: "oracle",
      status: "completed",
      handoffData: { status: "DONE", target: "return_to_caller", signalCount: 0 },
    })

    const extracted = extractDagMutations([result])
    expect(extracted).toHaveLength(0)
  })

  test("skips failed results with mutations", () => {
    const result = makeResult({
      taskId: "task_failed",
      agentId: "oracle",
      status: "failed",
      handoffData: {
        status: "BLOCKED",
        target: null,
        signalCount: 0,
        dagMutations: { addNodes: [{ id: "should_not_apply", label: "X", prompt: "y" }] },
      },
    })

    const extracted = extractDagMutations([result])
    expect(extracted).toHaveLength(0)
  })
})
