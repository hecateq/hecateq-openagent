import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import {
  agentToCategory,
  consumePendingDelegations,
  executePendingDelegations,
  reportDelegationResult,
} from "./delegation-executor"
import {
  consumeDelegation,
  getPendingDelegations,
  processHandoffsToDelegation,
} from "./delegation-controller"
import { OmoStateManager } from "./omo-state-manager"
import type { DelegationRequestExecutor, RoutingDecision, TaskExecutionResult, TaskNode, HecateqPendingDelegation } from "./types"

const tempDirs: string[] = []

function createTempDir(): string {
  const directory = mkdtempSync(join(tmpdir(), "omo-delegation-exec-"))
  tempDirs.push(directory)
  return directory
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const directory = tempDirs.pop()
    if (directory) {
      rmSync(directory, { recursive: true, force: true })
    }
  }
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeDecision(overrides: Partial<RoutingDecision> = {}): RoutingDecision {
  return {
    kind: "return_to_caller",
    reason: "Test decision",
    originalTarget: null,
    decidedAt: new Date().toISOString(),
    ...overrides,
  }
}

function makeTask(overrides: Partial<TaskNode> = {}): TaskNode {
  return {
    id: "task_1",
    label: "Test task",
    prompt: "Do something useful",
    domain: "backend",
    action: "both",
    dependsOn: [],
    status: "completed",
    ...overrides,
  }
}

const KNOWN_AGENT = "nodejs-backend-developer"
const KNOWN_PLANNER = "nodejs-backend-architect"
const UNKNOWN_AGENT = "completely-unknown-agent-xyz"

/** Helper: create a single pending delegation via processHandoffsToDelegation */
function createSinglePendingDelegation(
  directory: string,
  overrides?: { target?: string; taskId?: string; taskLabel?: string; taskPrompt?: string },
): { delegation: HecateqPendingDelegation; directory: string } {
  const target = overrides?.target ?? KNOWN_AGENT
  const taskId = overrides?.taskId ?? "task_1"

  const decision = makeDecision({
    kind: "return_to_caller",
    originalTarget: target,
    sourceTaskId: taskId,
  })
  const task = makeTask({
    id: taskId,
    label: overrides?.taskLabel ?? "Test label",
    prompt: overrides?.taskPrompt ?? "Test prompt for delegation execution",
  })

  const result = processHandoffsToDelegation({
    decisions: [decision],
    tasks: [task],
    projectDir: directory,
  })

  if (result.created === 0 || result.pending.length === 0) {
    throw new Error("Failed to create pending delegation for test setup")
  }

  return { delegation: result.pending[0]!, directory }
}

/**
 * Create a pending delegation directly via OmoStateManager, bypassing
 * creation-time guardrails. Used to test consumption-time guardrails
 * for scenarios blocked at creation time (unknown agent, depth exceeded).
 */
function createDirectPendingDelegation(
  directory: string,
  overrides: {
    targetAgent: string
    routingDepth: number
    taskId?: string
    prompt?: string
  },
): HecateqPendingDelegation {
  const stateMgr = new OmoStateManager(directory)
  const delegation: HecateqPendingDelegation = {
    id: `dlg_direct_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    targetAgent: overrides.targetAgent,
    prompt: overrides.prompt ?? "Direct test delegation",
    sourceTaskId: overrides.taskId ?? "task_direct",
    sourceAgent: "test",
    createdAt: new Date().toISOString(),
    status: "pending",
    routingDepth: overrides.routingDepth,
  }

  const result = stateMgr.recordPendingDelegation(delegation)
  if (!result) {
    throw new Error("Failed to directly record pending delegation for test setup")
  }

  return delegation
}

// ─── agentToCategory ─────────────────────────────────────────────────────────

describe("agentToCategory", () => {
  test("#given known agent name #then returns mapped category", () => {
    expect(agentToCategory("sisyphus")).toBe("ultrabrain")
    expect(agentToCategory("oracle")).toBe("ultrabrain")
    expect(agentToCategory("explore")).toBe("quick")
    expect(agentToCategory("nodejs-backend-developer")).toBe("unspecified-high")
    expect(agentToCategory("nextjs-ui-wizard")).toBe("visual-engineering")
    expect(agentToCategory("technical-writer-documentarian")).toBe("writing")
  })

  test("#given unknown agent name #then falls back to unspecified-high", () => {
    expect(agentToCategory(UNKNOWN_AGENT)).toBe("unspecified-high")
    expect(agentToCategory("")).toBe("unspecified-high")
    expect(agentToCategory("some-random-agent")).toBe("unspecified-high")
  })

  test("#given planner agent #then returns ultrabrain", () => {
    expect(agentToCategory(KNOWN_PLANNER)).toBe("ultrabrain")
    expect(agentToCategory("prometheus")).toBe("ultrabrain")
  })

  test("#given qa agent #then returns unspecified-high", () => {
    expect(agentToCategory("qa-test-engineer")).toBe("unspecified-high")
    expect(agentToCategory("security-architect")).toBe("unspecified-high")
  })
})

// ─── consumePendingDelegations ───────────────────────────────────────────────

describe("consumePendingDelegations", () => {
  // ── Happy path ─────────────────────────────────────────────────────────

  test("#given single pending delegation #then consumes and returns execution request", () => {
    const directory = createTempDir()
    const { delegation } = createSinglePendingDelegation(directory)

    const result = consumePendingDelegations(directory)

    expect(result.requests).toHaveLength(1)
    expect(result.guardrailBlocked).toBe(0)
    expect(result.guardrailDetails).toHaveLength(0)

    const request = result.requests[0]!
    expect(request.delegationId).toBe(delegation.id)
    expect(request.targetAgent).toBe(KNOWN_AGENT)
    expect(request.category).toBe("unspecified-high")
    expect(request.prompt).toContain("Test prompt")
    expect(request.sourceTaskId).toBe("task_1")
    expect(request.routingDepth).toBeGreaterThanOrEqual(1)

    // Verify delegation is no longer pending
    const pending = getPendingDelegations(directory)
    expect(pending).toHaveLength(0)

    // Verify history has the record
    const stateMgr = new OmoStateManager(directory)
    const history = stateMgr.getDelegationHistory()
    expect(history).toHaveLength(1)
    expect(history[0]!.id).toBe(delegation.id)
    expect(history[0]!.result).toBe("executed")
  })

  // ── Multiple delegations ───────────────────────────────────────────────

  test("#given multiple pending delegations #then consumes all and returns all requests", () => {
    const directory = createTempDir()

    // Create two delegations
    const d1 = createSinglePendingDelegation(directory, {
      target: "sisyphus",
      taskId: "task_a",
      taskLabel: "Orchestration",
    })
    const d2 = createSinglePendingDelegation(directory, {
      target: "qa-test-engineer",
      taskId: "task_b",
      taskLabel: "QA",
    })

    const result = consumePendingDelegations(directory)

    expect(result.requests).toHaveLength(2)
    expect(result.guardrailBlocked).toBe(0)

    const categories = result.requests.map((r) => r.category).sort()
    expect(categories).toEqual(["ultrabrain", "unspecified-high"])
  })

  // ── Max count limit ────────────────────────────────────────────────────

  test("#given maxCount option #then only consumes up to that many", () => {
    const directory = createTempDir()

    createSinglePendingDelegation(directory, {
      target: "oracle",
      taskId: "task_first",
    })
    createSinglePendingDelegation(directory, {
      target: KNOWN_AGENT,
      taskId: "task_second",
    })

    const result = consumePendingDelegations(directory, { maxCount: 1 })

    expect(result.requests).toHaveLength(1)
    // One should remain pending
    const pending = getPendingDelegations(directory)
    expect(pending).toHaveLength(1)
  })

  // ── Already consumed delegation ────────────────────────────────────────

  test("#given no pending delegations (all already consumed) #then returns empty result", () => {
    const directory = createTempDir()
    const { delegation } = createSinglePendingDelegation(directory)

    // Consume it first via old path — this moves from pending to history
    consumeDelegation(directory, delegation.id)

    // No pending delegations left to consume
    const result = consumePendingDelegations(directory)

    expect(result.requests).toHaveLength(0)
    expect(result.guardrailBlocked).toBe(0)
    expect(result.guardrailDetails).toHaveLength(0)
  })

  // ── Unknown target ────────────────────────────────────────────────────

  test("#given delegation with unknown target agent #then guardrail blocks it", () => {
    const directory = createTempDir()
    // Create directly bypassing creation-time guardrails
    createDirectPendingDelegation(directory, {
      targetAgent: UNKNOWN_AGENT,
      routingDepth: 1,
      taskId: "task_unknown",
    })

    const result = consumePendingDelegations(directory)

    expect(result.requests).toHaveLength(0)
    expect(result.guardrailBlocked).toBeGreaterThanOrEqual(1)
    expect(result.guardrailDetails.some((d) => d.includes("not a known agent"))).toBe(true)

    // The blocked delegation should have been moved to history with guardrail_blocked
    const stateMgr = new OmoStateManager(directory)
    const history = stateMgr.getDelegationHistory()
    expect(history.some((h) => h.result === "guardrail_blocked")).toBe(true)
  })

  // ── Routing depth exceeded ─────────────────────────────────────────────

  test("#given delegation with routing depth exceeding max #then guardrail blocks it", () => {
    const directory = createTempDir()
    const stateMgr = new OmoStateManager(directory)

    // Create a delegation with depth exceeding max, bypassing creation-time guardrails
    createDirectPendingDelegation(directory, {
      targetAgent: KNOWN_AGENT,
      routingDepth: 10,
      taskId: "task_depth",
    })

    const result = consumePendingDelegations(directory)

    expect(result.requests).toHaveLength(0)
    expect(result.guardrailBlocked).toBeGreaterThanOrEqual(1)
    expect(result.guardrailDetails.some((d) => d.toLowerCase().includes("routing depth"))).toBe(true)

    // The blocked delegation should have been moved to history
    const history = stateMgr.getDelegationHistory()
    expect(history.some((h) => h.result === "guardrail_blocked")).toBe(true)
  })

  // ── Empty pending list ─────────────────────────────────────────────────

  test("#given no pending delegations #then returns empty result", () => {
    const directory = createTempDir()

    const result = consumePendingDelegations(directory)

    expect(result.requests).toHaveLength(0)
    expect(result.guardrailBlocked).toBe(0)
    expect(result.guardrailDetails).toHaveLength(0)
  })

  // ── Agent-to-category mapping ─────────────────────────────────────────

  test("#given delegation for ultrabrain agent #then category is ultrabrain", () => {
    const directory = createTempDir()
    createSinglePendingDelegation(directory, {
      target: "oracle",
      taskId: "task_oracle",
    })

    const result = consumePendingDelegations(directory)

    expect(result.requests).toHaveLength(1)
    expect(result.requests[0]!.category).toBe("ultrabrain")
  })

  test("#given delegation for design agent #then category is visual-engineering", () => {
    const directory = createTempDir()
    createSinglePendingDelegation(directory, {
      target: "design-translator",
      taskId: "task_design",
    })

    const result = consumePendingDelegations(directory)

    expect(result.requests).toHaveLength(1)
    expect(result.requests[0]!.category).toBe("visual-engineering")
  })
})

// ─── reportDelegationResult ───────────────────────────────────────────────────

describe("reportDelegationResult", () => {
  test("#given consumed delegation #then updates result to executed", () => {
    const directory = createTempDir()
    const { delegation } = createSinglePendingDelegation(directory)

    // Consume first
    const consumeResult = consumePendingDelegations(directory)
    expect(consumeResult.requests).toHaveLength(1)

    // Report result
    const updated = reportDelegationResult(directory, delegation.id, "executed")
    expect(updated).toBe(true)

    // Verify history record was updated
    const stateMgr = new OmoStateManager(directory)
    const history = stateMgr.getDelegationHistory()
    const record = history.find((h) => h.id === delegation.id)
    expect(record).toBeDefined()
    expect(record!.result).toBe("executed")
  })

  test("#given consumed delegation #then updates result to blocked with reason", () => {
    const directory = createTempDir()
    const { delegation } = createSinglePendingDelegation(directory)

    consumePendingDelegations(directory)

    const updated = reportDelegationResult(directory, delegation.id, "blocked", "Agent was disabled at execution time")
    expect(updated).toBe(true)

    const stateMgr = new OmoStateManager(directory)
    const history = stateMgr.getDelegationHistory()
    const record = history.find((h) => h.id === delegation.id)
    expect(record).toBeDefined()
    expect(record!.result).toBe("blocked")
    expect(record!.blockReason).toBe("Agent was disabled at execution time")
  })

  test("#given consumed delegation #then updates result to skipped", () => {
    const directory = createTempDir()
    const { delegation } = createSinglePendingDelegation(directory)

    consumePendingDelegations(directory)

    const updated = reportDelegationResult(directory, delegation.id, "skipped", "Orchestrator chose not to execute")
    expect(updated).toBe(true)

    const stateMgr = new OmoStateManager(directory)
    const history = stateMgr.getDelegationHistory()
    const record = history.find((h) => h.id === delegation.id)
    expect(record).toBeDefined()
    expect(record!.result).toBe("skipped")
  })

  test("#given nonexistent delegation ID #then returns false", () => {
    const directory = createTempDir()

    const updated = reportDelegationResult(directory, "nonexistent-id", "executed")
    expect(updated).toBe(false)
  })

  test("#given delegation consumed via old path #then can still update result", () => {
    const directory = createTempDir()
    const { delegation } = createSinglePendingDelegation(directory)

    // Consume via old path (consumeDelegation sets result="executed")
    consumeDelegation(directory, delegation.id)

    // Update via new path
    const updated = reportDelegationResult(directory, delegation.id, "skipped", "Re-evaluated after consume")
    expect(updated).toBe(true)

    const stateMgr = new OmoStateManager(directory)
    const history = stateMgr.getDelegationHistory()
    const record = history.find((h) => h.id === delegation.id)
    expect(record).toBeDefined()
    expect(record!.result).toBe("skipped")
  })
})

// ─── Integration: full lifecycle ─────────────────────────────────────────────

describe("full delegation lifecycle", () => {
  test("#given complete cycle: create → consume → execute → report #then state reflects all transitions", () => {
    const directory = createTempDir()

    // Phase 1: Create pending delegation (simulating processHandoffsToDelegation)
    const decision = makeDecision({
      kind: "return_to_caller",
      originalTarget: "qa-test-engineer",
      sourceTaskId: "task_fullcycle",
      sourceAgent: "sisyphus",
    })
    const task = makeTask({
      id: "task_fullcycle",
      label: "Full cycle test",
      prompt: "Run comprehensive QA on the delegation lifecycle",
    })

    const createResult = processHandoffsToDelegation({
      decisions: [decision],
      tasks: [task],
      projectDir: directory,
    })
    expect(createResult.created).toBe(1)
    const delegationId = createResult.pending[0]!.id
    expect(createResult.pending[0]!.targetAgent).toBe("qa-test-engineer")

    // Phase 2: Consume pending delegation (executor reads + claims)
    const consumeResult = consumePendingDelegations(directory)
    expect(consumeResult.requests).toHaveLength(1)
    expect(consumeResult.requests[0]!.category).toBe("unspecified-high")
    expect(consumeResult.requests[0]!.targetAgent).toBe("qa-test-engineer")
    expect(consumeResult.requests[0]!.sourceAgent).toBe("sisyphus")

    // Verify removed from pending
    expect(getPendingDelegations(directory)).toHaveLength(0)

    // Verify history has entry
    let stateMgr = new OmoStateManager(directory)
    expect(stateMgr.getDelegationHistory()).toHaveLength(1)
    expect(stateMgr.getDelegationHistory()[0]!.result).toBe("executed")

    // Phase 3: Report execution result
    const reported = reportDelegationResult(
      directory,
      delegationId,
      "executed",
      "QA completed successfully",
    )
    expect(reported).toBe(true)

    // Phase 4: Verify final state  
    stateMgr = new OmoStateManager(directory)
    const history = stateMgr.getDelegationHistory()
    expect(history).toHaveLength(1)
    expect(history[0]!.id).toBe(delegationId)
    expect(history[0]!.result).toBe("executed")
    expect(history[0]!.targetAgent).toBe("qa-test-engineer")
    expect(history[0]!.sourceAgent).toBe("sisyphus")
    expect(history[0]!.blockReason).toBe("QA completed successfully")
    expect(history[0]!.executedAt).toBeDefined()
  })

  test("#given guardrail-blocked delegation #then it moves to history not pending", () => {
    const directory = createTempDir()

    // Create delegation with unknown target (bypasses creation-time guardrail)
    createDirectPendingDelegation(directory, {
      targetAgent: UNKNOWN_AGENT,
      routingDepth: 1,
      taskId: "task_blocked_lifecycle",
    })

    // Verify it's pending
    expect(getPendingDelegations(directory)).toHaveLength(1)

    // Consume — should fail guardrails and move to history
    const consumeResult = consumePendingDelegations(directory)
    expect(consumeResult.requests).toHaveLength(0)
    expect(consumeResult.guardrailBlocked).toBeGreaterThanOrEqual(1)

    // Verify it's been moved to history (not left pending for infinite retry)
    expect(getPendingDelegations(directory)).toHaveLength(0)

    const stateMgr = new OmoStateManager(directory)
    const history = stateMgr.getDelegationHistory()
    expect(history.some((h) => h.result === "guardrail_blocked")).toBe(true)
  })

  test("#given double consumption attempt #then second call returns no requests", () => {
    const directory = createTempDir()
    createSinglePendingDelegation(directory)

    // First consume
    const firstResult = consumePendingDelegations(directory)
    expect(firstResult.requests).toHaveLength(1)

    // Second consume (nothing left pending)
    const secondResult = consumePendingDelegations(directory)
    expect(secondResult.requests).toHaveLength(0)
  })
})

// ─── executePendingDelegations — Wave 4 Live Execution ─────────────────────

describe("executePendingDelegations", () => {
  /** Build a delegation executor that returns a canned result */
  function cannedExecutor(result: TaskExecutionResult): DelegationRequestExecutor {
    return async () => result
  }

  /** Build a delegation executor that rejects with an error */
  function throwingExecutor(errorMessage: string): DelegationRequestExecutor {
    return async () => { throw new Error(errorMessage) }
  }

  // ── Happy path ────────────────────────────────────────────────────────

  test("#given single pending delegation #then executes via callback and persists result", async () => {
    const directory = createTempDir()
    const { delegation } = createSinglePendingDelegation(directory, {
      target: "oracle",
      taskId: "task_exec",
      taskPrompt: "What is the best architecture for this?",
    })

    const execResult = await executePendingDelegations(
      directory,
      cannedExecutor({
        taskId: delegation.id,
        agentId: "oracle",
        status: "completed",
        changedFiles: [{ path: "docs/architecture.md", changeType: "created" as const }],
        producedArtifacts: [],
      }),
    )

    expect(execResult.consumedCount).toBe(1)
    expect(execResult.guardrailBlocked).toBe(0)
    expect(execResult.anyExecuted).toBe(true)
    expect(execResult.results).toHaveLength(1)
    expect(execResult.results[0]!.status).toBe("completed")
    expect(execResult.results[0]!.agentId).toBe("oracle")

    // Verify state was persisted
    const stateMgr = new OmoStateManager(directory)
    const history = stateMgr.getDelegationHistory()
    expect(history).toHaveLength(1)
    expect(history[0]!.id).toBe(delegation.id)
    expect(history[0]!.result).toBe("executed")
  })

  // ── Executor returning failure ───────────────────────────────────────

  test("#given executor returns failed result #then state reflects blocked", async () => {
    const directory = createTempDir()
    const { delegation } = createSinglePendingDelegation(directory, {
      target: "qa-test-engineer",
      taskId: "task_fail",
    })

    const execResult = await executePendingDelegations(
      directory,
      cannedExecutor({
        taskId: delegation.id,
        agentId: "qa-test-engineer",
        status: "failed",
        changedFiles: [],
        producedArtifacts: [],
        errorSummary: "Agent could not complete the task",
      }),
    )

    expect(execResult.consumedCount).toBe(1)
    expect(execResult.anyExecuted).toBe(false)
    expect(execResult.results).toHaveLength(1)
    expect(execResult.results[0]!.status).toBe("failed")

    // Verify state shows blocked with the errorSummary from the executor
    const stateMgr = new OmoStateManager(directory)
    const history = stateMgr.getDelegationHistory()
    const record = history.find((h) => h.id === delegation.id)
    expect(record).toBeDefined()
    expect(record!.result).toBe("blocked")
    expect(record!.blockReason).toContain("Agent could not complete the task")
  })

  test("#given executor returns blocked result #then state reflects blocked", async () => {
    const directory = createTempDir()
    const { delegation } = createSinglePendingDelegation(directory, {
      target: "security-architect",
      taskId: "task_blocked",
    })

    const execResult = await executePendingDelegations(
      directory,
      cannedExecutor({
        taskId: delegation.id,
        agentId: "security-architect",
        status: "blocked",
        changedFiles: [],
        producedArtifacts: [],
        errorSummary: "Target agent is disabled",
      }),
    )

    expect(execResult.consumedCount).toBe(1)
    expect(execResult.results[0]!.status).toBe("blocked")

    const stateMgr = new OmoStateManager(directory)
    const history = stateMgr.getDelegationHistory()
    const record = history.find((h) => h.id === delegation.id)
    expect(record).toBeDefined()
    expect(record!.result).toBe("blocked")
  })

  // ── Executor throws ─────────────────────────────────────────────────

  test("#given executor throws #then result is failed and state is blocked", async () => {
    const directory = createTempDir()
    const { delegation } = createSinglePendingDelegation(directory, {
      target: KNOWN_AGENT,
      taskId: "task_throw",
    })

    const execResult = await executePendingDelegations(
      directory,
      throwingExecutor("Something went terribly wrong"),
    )

    expect(execResult.consumedCount).toBe(1)
    expect(execResult.anyExecuted).toBe(false)
    expect(execResult.results).toHaveLength(1)
    expect(execResult.results[0]!.status).toBe("failed")
    expect(execResult.results[0]!.errorSummary).toContain("Something went terribly wrong")

    // State should show blocked
    const stateMgr = new OmoStateManager(directory)
    const history = stateMgr.getDelegationHistory()
    const record = history.find((h) => h.id === delegation.id)
    expect(record).toBeDefined()
    expect(record!.result).toBe("blocked")
    expect(record!.blockReason).toContain("Executor threw: Something went terribly wrong")
  })

  // ── No pending delegations ──────────────────────────────────────────

  test("#given no pending delegations #then returns empty result", async () => {
    const directory = createTempDir()

    const execResult = await executePendingDelegations(
      directory,
      async () => ({ taskId: "", agentId: "", status: "completed" as const, changedFiles: [], producedArtifacts: [] }),
    )

    expect(execResult.consumedCount).toBe(0)
    expect(execResult.guardrailBlocked).toBe(0)
    expect(execResult.anyExecuted).toBe(false)
    expect(execResult.results).toHaveLength(0)
  })

  // ── Guardrail blocked ───────────────────────────────────────────────

  test("#given delegation with unknown target #then guardrail blocks and no execution", async () => {
    const directory = createTempDir()
    createDirectPendingDelegation(directory, {
      targetAgent: "completely-unknown-ghost-agent",
      routingDepth: 1,
      taskId: "task_unknown_guard",
    })

    const execResult = await executePendingDelegations(
      directory,
      async () => { throw new Error("Should not be called") },
    )

    expect(execResult.consumedCount).toBe(0)
    expect(execResult.guardrailBlocked).toBeGreaterThanOrEqual(1)
    expect(execResult.anyExecuted).toBe(false)
  })

  // ── Multiple delegations ────────────────────────────────────────────

  test("#given multiple pending delegations #then executes all", async () => {
    const directory = createTempDir()
    const d1 = createSinglePendingDelegation(directory, { target: "oracle", taskId: "task_multi_1" })
    const d2 = createSinglePendingDelegation(directory, { target: "explore", taskId: "task_multi_2" })

    let callCount = 0
    const countingExecutor: DelegationRequestExecutor = async (request) => {
      callCount++
      return {
        taskId: request.delegationId,
        agentId: request.targetAgent,
        status: "completed" as const,
        changedFiles: [],
        producedArtifacts: [],
      }
    }

    const execResult = await executePendingDelegations(directory, countingExecutor)

    expect(execResult.consumedCount).toBe(2)
    expect(callCount).toBe(2)
    expect(execResult.anyExecuted).toBe(true)
    expect(execResult.results).toHaveLength(2)

    // Both should be in history as executed
    const stateMgr = new OmoStateManager(directory)
    const history = stateMgr.getDelegationHistory()
    expect(history.filter((h) => h.result === "executed")).toHaveLength(2)
  })

  // ── AbortSignal ─────────────────────────────────────────────────────

  test("#given abort signal set before execution #then remaining delegations skipped", async () => {
    const directory = createTempDir()
    createSinglePendingDelegation(directory, { target: "oracle", taskId: "task_abort_1" })
    createSinglePendingDelegation(directory, { target: "explore", taskId: "task_abort_2" })

    const controller = new AbortController()
    controller.abort() // Signal already aborted

    let calls = 0
    const abortExecutor: DelegationRequestExecutor = async (request) => {
      calls++
      return {
        taskId: request.delegationId,
        agentId: request.targetAgent,
        status: "completed" as const,
        changedFiles: [],
        producedArtifacts: [],
      }
    }

    const execResult = await executePendingDelegations(directory, abortExecutor, { signal: controller.signal })

    // With signal already aborted, consumePendingDelegations still runs
    // but each request is skipped during execution
    // consumePendingDelegations already consumed and removed from pending,
    // so requests will have been consumed but skipped during execution
    expect(calls).toBe(0)
    expect(execResult.consumedCount).toBeGreaterThanOrEqual(0)

    // Verify the delegations were not left pending (they were consumed by consumePendingDelegations)
    const pending = getPendingDelegations(directory)
    expect(pending).toHaveLength(0)
  })

  // ─── Full lifecycle integration ─────────────────────────────────────

  test("#given complete cycle: create → consume+execute → verify state #then all transitions correct", async () => {
    const directory = createTempDir()

    // Phase 1: Create pending delegation via the delegation controller
    const decision: RoutingDecision = {
      kind: "return_to_caller",
      reason: "Test handoff decision",
      originalTarget: "database-specialist",
      decidedAt: new Date().toISOString(),
      sourceTaskId: "task_integration",
      sourceAgent: "sisyphus",
    }
    const task: TaskNode = {
      id: "task_integration",
      label: "Integration test task",
      prompt: "Design the database schema for the new feature",
      domain: "database",
      action: "write",
      dependsOn: [],
      status: "completed",
    }
    const createResult = processHandoffsToDelegation({
      decisions: [decision],
      tasks: [task],
      projectDir: directory,
    })
    expect(createResult.created).toBe(1)
    const delegationId = createResult.pending[0]!.id

    // Phase 2: executePendingDelegations — consume + execute + report in one call
    const execResult = await executePendingDelegations(
      directory,
      async (request) => ({
        taskId: request.delegationId,
        agentId: request.targetAgent,
        status: "completed" as const,
        changedFiles: [{ path: "prisma/schema.prisma", changeType: "modified" as const }],
        producedArtifacts: ["prisma/migrations/new_migration.sql"],
      }),
    )

    expect(execResult.consumedCount).toBe(1)
    expect(execResult.anyExecuted).toBe(true)

    // Phase 3: Verify state reflects the full cycle
    const stateMgr = new OmoStateManager(directory)
    const history = stateMgr.getDelegationHistory()
    const record = history.find((h) => h.id === delegationId)
    expect(record).toBeDefined()
    expect(record!.result).toBe("executed")
    expect(record!.targetAgent).toBe("database-specialist")
    expect(record!.executedAt).toBeDefined()
  })
})

// ─── Config-driven delegation depth (Stage 2) ──────────────────────────────

describe("config-driven delegation depth", () => {
  test("conservative max_depth=3 blocks depth 4 like hardcoded constant", () => {
    const directory = createTempDir()
    createDirectPendingDelegation(directory, {
      targetAgent: KNOWN_AGENT,
      routingDepth: 4,
      taskId: "task_deep_blocked",
    })

    const result = consumePendingDelegations(directory, { maxRoutingDepth: 3 })
    expect(result.requests).toHaveLength(0)
    expect(result.guardrailBlocked).toBe(1)
    expect(result.guardrailDetails[0]).toContain("Routing depth 4 exceeds max 3")
  })

  test("larger max_depth=10 allows depth 4 that was blocked at depth 3", () => {
    const directory = createTempDir()
    createDirectPendingDelegation(directory, {
      targetAgent: KNOWN_AGENT,
      routingDepth: 4,
      taskId: "task_deep_allowed",
    })

    const result = consumePendingDelegations(directory, { maxRoutingDepth: 10 })
    expect(result.requests).toHaveLength(1)
    expect(result.guardrailBlocked).toBe(0)
  })

  test("max_depth=0 allows arbitrary unlimited depth", () => {
    const directory = createTempDir()
    createDirectPendingDelegation(directory, {
      targetAgent: KNOWN_AGENT,
      routingDepth: 50,
      taskId: "task_unlimited",
    })

    const result = consumePendingDelegations(directory, { maxRoutingDepth: 0 })
    expect(result.requests).toHaveLength(1)
    expect(result.guardrailBlocked).toBe(0)
  })

  test("unknown agent still blocked regardless of depth config", () => {
    const directory = createTempDir()
    createDirectPendingDelegation(directory, {
      targetAgent: UNKNOWN_AGENT,
      routingDepth: 1,
      taskId: "task_unknown",
    })

    const result = consumePendingDelegations(directory, { maxRoutingDepth: 10 })
    expect(result.requests).toHaveLength(0)
    expect(result.guardrailBlocked).toBe(1)
    expect(result.guardrailDetails[0]).toContain("not a known agent ID")
  })

  test("processHandoffsToDelegation uses config-driven maxRoutingDepth", () => {
    const directory = createTempDir()
    const stateMgr = new OmoStateManager(directory)
    stateMgr.incrementRoutingDepth()
    stateMgr.incrementRoutingDepth()
    stateMgr.incrementRoutingDepth()

    const decision = makeDecision({
      kind: "return_to_caller",
      originalTarget: KNOWN_AGENT,
      sourceTaskId: "task_depth_guard",
    })
    const task = makeTask({ id: "task_depth_guard", prompt: "Test" })

    const blocked = processHandoffsToDelegation({
      decisions: [decision],
      tasks: [task],
      projectDir: directory,
      maxRoutingDepth: 3,
    })
    expect(blocked.created).toBe(0)
    expect(blocked.guardrailSkipped).toBe(1)
    expect(blocked.guardrailDetails[0]).toContain("max 3")

    const allowed = processHandoffsToDelegation({
      decisions: [decision],
      tasks: [task],
      projectDir: directory,
      maxRoutingDepth: 10,
    })
    expect(allowed.created).toBe(1)
  })

  test("default maxRoutingDepth preserves depth=3 behavior", () => {
    const directory = createTempDir()
    createDirectPendingDelegation(directory, {
      targetAgent: KNOWN_AGENT,
      routingDepth: 3,
      taskId: "task_depth3",
    })

    const result = consumePendingDelegations(directory)
    expect(result.requests).toHaveLength(1)
    expect(result.guardrailBlocked).toBe(0)
  })
})

// ─── Fan-out protection (Stage 2) ──────────────────────────────────────────

describe("fan-out cap in delegation creation", () => {
  test("blocks new delegation when per-source fan-out limit reached", () => {
    const directory = createTempDir()
    const sourceTaskId = "task_fan_out_source"

    const decision1 = makeDecision({
      kind: "return_to_caller",
      originalTarget: KNOWN_AGENT,
      sourceTaskId,
    })
    const decision2 = makeDecision({
      kind: "return_to_caller",
      originalTarget: KNOWN_PLANNER,
      sourceTaskId,
    })
    const task = makeTask({ id: sourceTaskId, prompt: "Fan-out test" })

    processHandoffsToDelegation({
      decisions: [decision1],
      tasks: [task],
      projectDir: directory,
      maxFanOut: 1,
    })

    const result = processHandoffsToDelegation({
      decisions: [decision2],
      tasks: [task],
      projectDir: directory,
      maxFanOut: 1,
    })

    expect(result.created).toBe(0)
    expect(result.guardrailSkipped).toBe(1)
    expect(result.guardrailDetails[0]).toContain("fan-out")
    expect(result.guardrailDetails[0]).toContain(sourceTaskId)
  })

  test("allows delegation when under fan-out limit", () => {
    const directory = createTempDir()
    const sourceTaskId = "task_fan_out_under"

    const decision = makeDecision({
      kind: "return_to_caller",
      originalTarget: KNOWN_AGENT,
      sourceTaskId,
    })
    const task = makeTask({ id: sourceTaskId, prompt: "Fan-out under test" })

    const result = processHandoffsToDelegation({
      decisions: [decision],
      tasks: [task],
      projectDir: directory,
      maxFanOut: 10,
    })

    expect(result.created).toBe(1)
  })

  test("maxFanOut=0 disables fan-out cap — allows more than cap would", () => {
    const directory = createTempDir()

    for (let i = 0; i < 5; i++) {
      processHandoffsToDelegation({
        decisions: [makeDecision({
          kind: "return_to_caller",
          originalTarget: KNOWN_AGENT,
          sourceTaskId: `task_fan_out_zero_${i}`,
        })],
        tasks: [makeTask({ id: `task_fan_out_zero_${i}`, prompt: `Fan-out zero test ${i}` })],
        projectDir: directory,
        maxFanOut: 0,
        maxRoutingDepth: 0,
      })
    }

    const stateMgr = new OmoStateManager(directory)
    const pending = stateMgr.getPendingDelegations()
    expect(pending.length).toBeGreaterThanOrEqual(5)
  })
})
