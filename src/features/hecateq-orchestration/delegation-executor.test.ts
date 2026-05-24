import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import {
  agentToCategory,
  consumePendingDelegations,
  reportDelegationResult,
} from "./delegation-executor"
import {
  consumeDelegation,
  getPendingDelegations,
  processHandoffsToDelegation,
} from "./delegation-controller"
import { OmoStateManager } from "./omo-state-manager"
import type { RoutingDecision, TaskNode, HecateqPendingDelegation } from "./types"

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
