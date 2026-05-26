import { describe, expect, test } from "bun:test"
import {
  buildExecutionPlan,
  validateTaskContract,
  createContractNode,
  createPlanNode,
  createVerificationNode,
  CONTRACT_STAGE_PREFIX,
  PLAN_STAGE_PREFIX,
  VERIFY_STAGE_PREFIX,
} from "./execution-planner"
import type {
  TaskNode,
  DependencyPlan,
  AgentSelectorResult,
  ResolvedOrchestrationConfig,
} from "./types"

// ─── Fixtures ───────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<ResolvedOrchestrationConfig> = {}): ResolvedOrchestrationConfig {
  return {
    enabled: true,
    autoDecompose: true,
    autoExecuteLowRisk: true,
    requirePlanForHighRisk: true,
    maxRepairAttempts: 2,
    defaultTaskTimeoutMs: 300000,
    allowParallelReadonlyTasks: true,
    allowParallelWriteTasks: false,
    qualityGates: { typecheck: false, lint: false, test: false, build: false, doctor: false },
    stateDir: "/tmp/test",
    ...overrides,
  }
}

function makeTask(overrides: Partial<TaskNode> = {}): TaskNode {
  return {
    id: "task_1",
    label: "Test task",
    prompt: "Do something",
    domain: "backend",
    action: "both",
    dependsOn: [],
    status: "pending",
    complexity: 0.3,
    ...overrides,
  }
}

function makeDependencyPlan(nodes: TaskNode[]): DependencyPlan {
  return {
    nodes,
    batches: nodes.map((n) => [n.id]),
    cycle: { hasCycle: false, cycle: [], cycleNodeIds: [] },
    blockedTaskIds: [],
    readyTaskIds: nodes.map((n) => n.id),
    totalBatches: nodes.length,
  }
}

function makeAgentSelection(tasks: TaskNode[]): AgentSelectorResult {
  return {
    entries: tasks.map((t) => ({
      taskId: t.id,
      selectedAgent: "sisyphus",
      exactMatch: true,
    })),
    unassignedTasks: [],
    exactMatchCount: tasks.length,
    fallbackCount: 0,
  }
}

// ─── validateTaskContract ────────────────────────────────────────────────────

describe("validateTaskContract", () => {
  test("#given low-risk backend task #then no contract required", () => {
    const task = makeTask({ domain: "backend", action: "read", complexity: 0.2 })
    const result = validateTaskContract(task, makeConfig())
    expect(result.requiresContract).toBe(false)
    expect(result.requiresPlanStage).toBe(false)
    expect(result.requiresVerification).toBe(false)
  })

  test("#given database domain task #then contract required", () => {
    const task = makeTask({ domain: "database", action: "write" })
    const result = validateTaskContract(task, makeConfig())
    expect(result.requiresContract).toBe(true)
    expect(result.reason).toContain("inherently requires a contract")
  })

  test("#given security domain task #then contract and verification required", () => {
    const task = makeTask({ domain: "security", action: "write" })
    const result = validateTaskContract(task, makeConfig())
    expect(result.requiresContract).toBe(true)
    expect(result.requiresVerification).toBe(true)
  })

  test("#given devops domain task #then contract and verification required", () => {
    const task = makeTask({ domain: "devops", action: "write" })
    const result = validateTaskContract(task, makeConfig())
    expect(result.requiresContract).toBe(true)
    expect(result.requiresVerification).toBe(true)
  })

  test("#given high complexity task #then contract required", () => {
    const task = makeTask({ domain: "backend", action: "write", complexity: 0.8 })
    const result = validateTaskContract(task, makeConfig())
    expect(result.requiresContract).toBe(true)
    expect(result.requiresVerification).toBe(true)
  })

  test("#given configured require_contract_for domain #then contract required", () => {
    const task = makeTask({ domain: "qa", action: "write" })
    const config = makeConfig({ requireContractFor: ["qa"] })
    const result = validateTaskContract(task, config)
    expect(result.requiresContract).toBe(true)
    expect(result.reason).toContain("configured for mandatory contracts")
  })

  test("#given low-complexity read task #then no contract or verification", () => {
    const task = makeTask({ domain: "backend", action: "read", complexity: 0.2 })
    const result = validateTaskContract(task, makeConfig())
    expect(result.requiresContract).toBe(false)
    expect(result.requiresVerification).toBe(false)
  })

  test("#given architecture domain task #then contract required", () => {
    const task = makeTask({ domain: "architecture", action: "read" })
    const result = validateTaskContract(task, makeConfig())
    expect(result.requiresContract).toBe(true)
  })
})

// ─── createContractNode ──────────────────────────────────────────────────────

describe("createContractNode", () => {
  test("#given a task #then creates contract node with correct prefix", () => {
    const task = makeTask()
    const node = createContractNode(task, 0)
    expect(node.id).toBe(`${CONTRACT_STAGE_PREFIX}task_1`)
    expect(node.domain).toBe("planning")
    expect(node.action).toBe("read")
    expect(node.dependsOn).toEqual([])
    expect(node.metadata?.contractFor).toBe("task_1")
  })

  test("#given task with dependencies #then contract inherits them", () => {
    const task = makeTask({ dependsOn: ["task_0"] })
    const node = createContractNode(task, 0)
    expect(node.dependsOn).toEqual(["task_0"])
  })
})

// ─── createPlanNode ──────────────────────────────────────────────────────────

describe("createPlanNode", () => {
  test("#given a task #then creates plan node with correct prefix", () => {
    const task = makeTask()
    const node = createPlanNode(task, 0)
    expect(node.id).toBe(`${PLAN_STAGE_PREFIX}task_1`)
    expect(node.domain).toBe("planning")
    expect(node.prompt).toContain("implementation plan")
  })
})

// ─── createVerificationNode ───────────────────────────────────────────────────

describe("createVerificationNode", () => {
  test("#given a task #then creates verification node depending on task", () => {
    const task = makeTask()
    const node = createVerificationNode(task, 0)
    expect(node.id).toBe(`${VERIFY_STAGE_PREFIX}task_1`)
    expect(node.domain).toBe("qa")
    expect(node.dependsOn).toEqual(["task_1"])
  })
})

// ─── buildExecutionPlan (contract-first) ──────────────────────────────────────

describe("buildExecutionPlan with contract-first", () => {
  test("#given low-risk simple task #then no extra stages injected", () => {
    const task = makeTask({ domain: "backend", action: "read", complexity: 0.2 })
    const depPlan = makeDependencyPlan([task])
    const agentSel = makeAgentSelection([task])
    const config = makeConfig()

    const plan = buildExecutionPlan(depPlan, agentSel, config)
    const batchIds = plan.batches.flatMap((b) => b.taskIds)
    expect(batchIds).toEqual(["task_1"])
  })

  test("#given database task #then contract stage injected before", () => {
    const task = makeTask({ domain: "database", action: "write" })
    const depPlan = makeDependencyPlan([task])
    const agentSel = makeAgentSelection([task])
    const config = makeConfig()

    const plan = buildExecutionPlan(depPlan, agentSel, config)
    const batchIds = plan.batches.flatMap((b) => b.taskIds)
    expect(batchIds).toContain(`${CONTRACT_STAGE_PREFIX}task_1`)
    expect(batchIds).toContain("task_1")
    // Contract should come before implementation
    const contractIdx = batchIds.indexOf(`${CONTRACT_STAGE_PREFIX}task_1`)
    const implIdx = batchIds.indexOf("task_1")
    expect(contractIdx).toBeLessThan(implIdx)
  })

  test("#given security task #then contract and verification stages injected", () => {
    const task = makeTask({ domain: "security", action: "write" })
    const depPlan = makeDependencyPlan([task])
    const agentSel = makeAgentSelection([task])
    const config = makeConfig()

    const plan = buildExecutionPlan(depPlan, agentSel, config)
    const batchIds = plan.batches.flatMap((b) => b.taskIds)
    expect(batchIds).toContain(`${CONTRACT_STAGE_PREFIX}task_1`)
    expect(batchIds).toContain(`${VERIFY_STAGE_PREFIX}task_1`)
    expect(batchIds).toContain("task_1")

    const contractIdx = batchIds.indexOf(`${CONTRACT_STAGE_PREFIX}task_1`)
    const implIdx = batchIds.indexOf("task_1")
    const verifyIdx = batchIds.indexOf(`${VERIFY_STAGE_PREFIX}task_1`)
    expect(contractIdx).toBeLessThan(implIdx)
    expect(implIdx).toBeLessThan(verifyIdx)
  })

  test("#given high complexity task #then contract stage injected", () => {
    const task = makeTask({ domain: "backend", action: "write", complexity: 0.9 })
    const depPlan = makeDependencyPlan([task])
    const agentSel = makeAgentSelection([task])
    const config = makeConfig()

    const plan = buildExecutionPlan(depPlan, agentSel, config)
    const batchIds = plan.batches.flatMap((b) => b.taskIds)
    expect(batchIds).toContain(`${CONTRACT_STAGE_PREFIX}task_1`)
  })

  test("#given configured require_contract_for qa #then qa task gets contract", () => {
    const task = makeTask({ domain: "qa", action: "write" })
    const depPlan = makeDependencyPlan([task])
    const agentSel = makeAgentSelection([task])
    const config = makeConfig({ requireContractFor: ["qa"] })

    const plan = buildExecutionPlan(depPlan, agentSel, config)
    const batchIds = plan.batches.flatMap((b) => b.taskIds)
    expect(batchIds).toContain(`${CONTRACT_STAGE_PREFIX}task_1`)
  })

  test("#given mixed tasks #then only high-risk ones get contract stages", () => {
    const lowRisk = makeTask({ id: "task_low", domain: "frontend", action: "read", complexity: 0.1 })
    const dbTask = makeTask({ id: "task_db", domain: "database", action: "write", dependsOn: ["task_low"] })

    const depPlan = makeDependencyPlan([lowRisk, dbTask])
    const agentSel = makeAgentSelection([lowRisk, dbTask])
    const config = makeConfig()

    const plan = buildExecutionPlan(depPlan, agentSel, config)
    const batchIds = plan.batches.flatMap((b) => b.taskIds)
    // Low risk should not have contract
    expect(batchIds).not.toContain(`${CONTRACT_STAGE_PREFIX}task_low`)
    // Database task should have contract
    expect(batchIds).toContain(`${CONTRACT_STAGE_PREFIX}task_db`)
    expect(batchIds).toContain(`${VERIFY_STAGE_PREFIX}task_db`)
  })

  test("#given contract overrides #then uses provided validation results", () => {
    const task = makeTask({ domain: "frontend", action: "read", complexity: 0.1 })
    const depPlan = makeDependencyPlan([task])
    const agentSel = makeAgentSelection([task])
    const config = makeConfig()

    // Override: force contract for this otherwise low-risk task
    const overrides = new Map([
      ["task_1", {
        requiresContract: true,
        requiresVerification: false,
        requiresPlanStage: false,
        reason: "Override for testing",
      }],
    ])

    const plan = buildExecutionPlan(depPlan, agentSel, config, overrides)
    const batchIds = plan.batches.flatMap((b) => b.taskIds)
    expect(batchIds).toContain(`${CONTRACT_STAGE_PREFIX}task_1`)
  })
})
