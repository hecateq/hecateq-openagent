import { describe, expect, test } from "bun:test"
import {
  DryRunExecutionAdapter,
  ManualExecutionAdapter,
  TestExecutionAdapter,
  CallbackExecutionAdapter,
  DeferredExecutionAdapter,
  CompositeExecutionAdapter,
  createBatchExecutorFromAdapter,
  executeBatchViaAdapter,
} from "./execution-adapter"
import type {
  TaskNode,
  AgentSelectionEntry,
  ExecutionBatch,
  TaskExecutionResult,
  TaskBatchExecutor,
  RuntimeAdapterConfig,
} from "./types"

// ─── Fixtures ───────────────────────────────────────────────────────────────

const sampleTask = (overrides: Partial<TaskNode> = {}): TaskNode => ({
  id: "task_1",
  label: "Test task",
  prompt: "Do something",
  domain: "backend",
  action: "both",
  dependsOn: [],
  status: "pending",
  ...overrides,
})

const sampleAssignment = (overrides: Partial<AgentSelectionEntry> = {}): AgentSelectionEntry => ({
  taskId: "task_1",
  selectedAgent: "nodejs-backend-developer",
  exactMatch: true,
  ...overrides,
})

const sampleBatch = (overrides: Partial<ExecutionBatch> = {}): ExecutionBatch => ({
  index: 0,
  kind: "sequential",
  taskIds: ["task_1"],
  ...overrides,
})

// ─── DryRunExecutionAdapter ──────────────────────────────────────────────────

describe("DryRunExecutionAdapter", () => {
  test("#given any task #then returns completed with zero changes", () => {
    const adapter = new DryRunExecutionAdapter()
    const result = adapter.executeTask(sampleTask(), sampleAssignment())

    expect(result.status).toBe("completed")
    expect(result.taskId).toBe("task_1")
    expect(result.changedFiles).toHaveLength(0)
    expect(result.producedArtifacts).toHaveLength(0)
  })

  test("#given any agent #then canExecute returns true", () => {
    const adapter = new DryRunExecutionAdapter()
    expect(adapter.canExecute("any-agent")).toBe(true)
    expect(adapter.canExecute("")).toBe(true)
  })

  test("#given batch with multiple tasks #then returns completed for all", () => {
    const adapter = new DryRunExecutionAdapter()
    const tasks = [
      sampleTask({ id: "t1", label: "Task 1" }),
      sampleTask({ id: "t2", label: "Task 2" }),
    ]
    const assignments: AgentSelectionEntry[] = [
      sampleAssignment({ taskId: "t1", selectedAgent: "agent-a" }),
      sampleAssignment({ taskId: "t2", selectedAgent: "agent-b" }),
    ]
    const batch: ExecutionBatch = { index: 0, kind: "parallel_read", taskIds: ["t1", "t2"] }

    const results = adapter.executeBatch(batch, tasks, assignments)
    expect(results).toHaveLength(2)
    expect(results.every((r) => r.status === "completed")).toBe(true)
  })

  test("#given label #then returns dry-run", () => {
    const adapter = new DryRunExecutionAdapter()
    expect(adapter.label).toBe("dry-run")
  })
})

// ─── ManualExecutionAdapter ──────────────────────────────────────────────────

describe("ManualExecutionAdapter", () => {
  test("#given confirmed batch #then delegates to inner adapter", async () => {
    const inner = new TestExecutionAdapter()
    const adapter = new ManualExecutionAdapter(inner, () => true)
    const result = await adapter.executeTask(sampleTask(), sampleAssignment())
    expect(result.status).toBe("completed")
    expect(inner.executedTaskIds).toContain("task_1")
  })

  test("#given denied batch #then marks tasks as blocked", async () => {
    const inner = new TestExecutionAdapter()
    const adapter = new ManualExecutionAdapter(inner, () => false)
    const tasks = [sampleTask()]
    const assignments = [sampleAssignment()]
    const batch = sampleBatch()

    const results = await adapter.executeBatch(batch, tasks, assignments)
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe("blocked")
    expect(results[0].errorSummary).toContain("Manual confirmation denied")
    expect(inner.executedTaskIds).toHaveLength(0)
  })

  test("#given inner adapter with restrictions #then canExecute reflects inner", () => {
    const inner = new TestExecutionAdapter(new Map(), "completed", ["restricted-agent"])
    const adapter = new ManualExecutionAdapter(inner, () => true)
    expect(adapter.canExecute("restricted-agent")).toBe(true)
    expect(adapter.canExecute("other-agent")).toBe(false)
  })

  test("#given label #then returns manual", () => {
    const adapter = new ManualExecutionAdapter(new DryRunExecutionAdapter(), () => true)
    expect(adapter.label).toBe("manual")
  })
})

// ─── TestExecutionAdapter ────────────────────────────────────────────────────

describe("TestExecutionAdapter", () => {
  test("#given no overrides #then returns default completed", () => {
    const adapter = new TestExecutionAdapter()
    const result = adapter.executeTask(sampleTask(), sampleAssignment())
    expect(result.status).toBe("completed")
    expect(adapter.executedTaskIds).toEqual(["task_1"])
  })

  test("#given result overrides #then returns customized results", () => {
    const overrides = new Map([
      ["task_1", { status: "failed" as const, errorSummary: "Intentional failure" }],
    ])
    const adapter = new TestExecutionAdapter(overrides)
    const result = adapter.executeTask(sampleTask({ id: "task_1" }), sampleAssignment())
    expect(result.status).toBe("failed")
    expect(result.errorSummary).toBe("Intentional failure")
  })

  test("#given agent allowlist #then canExecute respects it", () => {
    const adapter = new TestExecutionAdapter(new Map(), "completed", ["allowed-agent"])
    expect(adapter.canExecute("allowed-agent")).toBe(true)
    expect(adapter.canExecute("blocked-agent")).toBe(false)
  })

  test("#given no allowlist #then canExecute always true", () => {
    const adapter = new TestExecutionAdapter()
    expect(adapter.canExecute("anything")).toBe(true)
  })

  test("#executeBatch #then returns results for all tasks in batch", () => {
    const adapter = new TestExecutionAdapter()
    const tasks = [
      sampleTask({ id: "t1" }),
      sampleTask({ id: "t2" }),
    ]
    const assignments: AgentSelectionEntry[] = [
      sampleAssignment({ taskId: "t1" }),
      sampleAssignment({ taskId: "t2" }),
    ]
    const batch: ExecutionBatch = { index: 0, kind: "parallel_read", taskIds: ["t1", "t2"] }

    const results = adapter.executeBatch(batch, tasks, assignments)
    expect(results).toHaveLength(2)
    expect(adapter.executedBatchIndices).toEqual([0])
    expect(adapter.executedTaskIds).toEqual(["t1", "t2"])
  })

  test("#reset #then clears execution tracking", () => {
    const adapter = new TestExecutionAdapter()
    adapter.executeTask(sampleTask(), sampleAssignment())
    expect(adapter.executedTaskIds).toHaveLength(1)
    adapter.reset()
    expect(adapter.executedTaskIds).toHaveLength(0)
    expect(adapter.executedBatchIndices).toHaveLength(0)
  })

  test("#given handoffData override #then returns handoff data", () => {
    const overrides = new Map([
      ["task_1", {
        status: "completed" as const,
        handoffData: {
          status: "IN_PROGRESS",
          target: "hephaestus",
          signalCount: 2,
        },
      }],
    ])
    const adapter = new TestExecutionAdapter(overrides)
    const result = adapter.executeTask(sampleTask({ id: "task_1" }), sampleAssignment())
    expect(result.handoffData?.status).toBe("IN_PROGRESS")
    expect(result.handoffData?.target).toBe("hephaestus")
    expect(result.handoffData?.signalCount).toBe(2)
  })
})

// ─── CallbackExecutionAdapter ────────────────────────────────────────────────

describe("CallbackExecutionAdapter", () => {
  test("#given batch executor callback #then delegates execution", async () => {
    const executor: TaskBatchExecutor = (_batch, _tasks, _assignments) => {
      return [{
        taskId: "task_1",
        agentId: "nodejs-backend-developer",
        status: "completed" as const,
        changedFiles: [{ path: "src/test.ts", changeType: "modified" as const }],
        producedArtifacts: [],
      }]
    }
    const config: RuntimeAdapterConfig = { batchExecutor: executor }
    const adapter = new CallbackExecutionAdapter(config)

    const result = await adapter.executeTask(sampleTask(), sampleAssignment())
    expect(result.status).toBe("completed")
    expect(result.changedFiles).toHaveLength(1)
  })

  test("#given allowedAgents #then canExecute checks agent list", () => {
    const config: RuntimeAdapterConfig = {
      batchExecutor: () => [],
      allowedAgents: ["sisyphus", "hephaestus"],
    }
    const adapter = new CallbackExecutionAdapter(config)
    expect(adapter.canExecute("sisyphus")).toBe(true)
    expect(adapter.canExecute("oracle")).toBe(false)
  })

  test("#given no allowedAgents #then canExecute always true", () => {
    const config: RuntimeAdapterConfig = {
      batchExecutor: () => [],
    }
    const adapter = new CallbackExecutionAdapter(config)
    expect(adapter.canExecute("any-agent")).toBe(true)
  })

  test("#given label #then returns runtime", () => {
    const config: RuntimeAdapterConfig = { batchExecutor: () => [] }
    const adapter = new CallbackExecutionAdapter(config)
    expect(adapter.label).toBe("runtime")
  })
})

// ─── DeferredExecutionAdapter ────────────────────────────────────────────────

describe("DeferredExecutionAdapter", () => {
  test("#given executeTask #then queues and returns pending", () => {
    const adapter = new DeferredExecutionAdapter()
    const result = adapter.executeTask(sampleTask(), sampleAssignment())

    expect(result.status).toBe("pending")
    expect(adapter.pendingExecutions).toHaveLength(1)
  })

  test("#given executeBatch with autoFlush=false #then queues all tasks", () => {
    const adapter = new DeferredExecutionAdapter(new DryRunExecutionAdapter(), false)
    const tasks = [sampleTask({ id: "t1" }), sampleTask({ id: "t2" })]
    const assignments: AgentSelectionEntry[] = [
      sampleAssignment({ taskId: "t1" }),
      sampleAssignment({ taskId: "t2" }),
    ]
    const batch: ExecutionBatch = { index: 0, kind: "sequential", taskIds: ["t1", "t2"] }

    adapter.executeBatch(batch, tasks, assignments)
    expect(adapter.pendingExecutions).toHaveLength(2)
  })

  test("#given flushAll #then executes queued and clears", async () => {
    const inner = new DryRunExecutionAdapter()
    const adapter = new DeferredExecutionAdapter(inner, false)
    adapter.executeTask(sampleTask({ id: "t1" }), sampleAssignment({ taskId: "t1" }))
    adapter.executeTask(sampleTask({ id: "t2" }), sampleAssignment({ taskId: "t2" }))

    const results = await adapter.flushAll()
    expect(results).toHaveLength(2)
    expect(results.every((r) => r.status === "completed")).toBe(true)
    expect(adapter.pendingExecutions).toHaveLength(0)
  })

  test("#given empty queue #then flushAll returns empty", async () => {
    const adapter = new DeferredExecutionAdapter()
    const results = await adapter.flushAll()
    expect(results).toHaveLength(0)
  })
})

// ─── CompositeExecutionAdapter ───────────────────────────────────────────────

describe("CompositeExecutionAdapter", () => {
  test("#given matching adapter #then delegates to first capable", () => {
    const denyAll = new TestExecutionAdapter(new Map(), "completed", [])
    const allowAll = new TestExecutionAdapter()
    const composite = new CompositeExecutionAdapter([denyAll, allowAll])

    expect(composite.canExecute("agent-x")).toBe(true)

    const result = composite.executeTask(
      sampleTask({ id: "t1" }),
      sampleAssignment({ taskId: "t1", selectedAgent: "agent-x" }),
    ) as TaskExecutionResult
    expect(result.status).toBe("completed")
  })

  test("#given no matching adapter #then blocks task", () => {
    const denyAll = new TestExecutionAdapter(new Map(), "completed", [])
    const composite = new CompositeExecutionAdapter([denyAll])

    expect(composite.canExecute("agent-x")).toBe(false)

    const result = composite.executeTask(
      sampleTask({ id: "t1" }),
      sampleAssignment({ taskId: "t1", selectedAgent: "agent-x" }),
    ) as TaskExecutionResult
    expect(result.status).toBe("blocked")
    expect(result.errorSummary).toContain("No adapter available")
  })

  test("#given batch with mixed agents #then routes to respective adapters", () => {
    const adapterA = new TestExecutionAdapter(new Map(), "completed", ["agent-a"])
    const adapterB = new TestExecutionAdapter(new Map(), "completed", ["agent-b"])
    const composite = new CompositeExecutionAdapter([adapterA, adapterB])

    const tasks = [
      sampleTask({ id: "t1" }),
      sampleTask({ id: "t2" }),
    ]
    const assignments: AgentSelectionEntry[] = [
      sampleAssignment({ taskId: "t1", selectedAgent: "agent-a" }),
      sampleAssignment({ taskId: "t2", selectedAgent: "agent-b" }),
    ]
    const batch: ExecutionBatch = { index: 0, kind: "sequential", taskIds: ["t1", "t2"] }

    const results = composite.executeBatch(batch, tasks, assignments)
    expect(Array.isArray(results) ? results : []).toHaveLength(2)
  })
})

// ─── Bridge Helpers ──────────────────────────────────────────────────────────

describe("createBatchExecutorFromAdapter", () => {
  test("#given adapter #then returns TaskBatchExecutor that delegates", () => {
    const adapter = new TestExecutionAdapter()
    const executor = createBatchExecutorFromAdapter(adapter)

    const tasks = [sampleTask()]
    const assignments = [sampleAssignment()]
    const batch = sampleBatch()

    const results = executor(batch, tasks, assignments)
    expect(Array.isArray(results) ? results : []).toHaveLength(1)
    expect(adapter.executedTaskIds).toEqual(["task_1"])
  })
})

describe("executeBatchViaAdapter", () => {
  test("#given adapter #then uses it", () => {
    const adapter = new TestExecutionAdapter()
    const tasks = [sampleTask()]
    const assignments = [sampleAssignment()]

    const results = executeBatchViaAdapter(adapter, sampleBatch(), tasks, assignments) as TaskExecutionResult[]
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe("completed")
  })

  test("#given no adapter but default executor #then falls back", () => {
    const fallback: TaskBatchExecutor = () => [{
      taskId: "task_1",
      agentId: "fallback-agent",
      status: "failed" as const,
      changedFiles: [],
      producedArtifacts: [],
      errorSummary: "Used fallback executor",
    }]
    const tasks = [sampleTask()]
    const assignments = [sampleAssignment()]

    const results = executeBatchViaAdapter(null, sampleBatch(), tasks, assignments, fallback) as TaskExecutionResult[]
    expect(results).toHaveLength(1)
    expect(results[0].agentId).toBe("fallback-agent")
    expect(results[0].status).toBe("failed")
  })

  test("#given no adapter and no fallback #then marks all blocked", () => {
    const tasks = [sampleTask()]
    const assignments = [sampleAssignment()]

    const results = executeBatchViaAdapter(undefined, sampleBatch(), tasks, assignments) as TaskExecutionResult[]
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe("blocked")
    expect(results[0].errorSummary).toContain("No executor or adapter")
  })
})
