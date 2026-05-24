import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import {
  consumeDelegation,
  getPendingDelegations,
  processHandoffsToDelegation,
} from "./delegation-controller"
import { OmoStateManager } from "./omo-state-manager"
import type { RoutingDecision, TaskNode } from "./types"

const tempDirs: string[] = []

function createTempDir(): string {
  const directory = mkdtempSync(join(tmpdir(), "omo-delegation-ctrl-"))
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
const KNOWN_CORE_AGENT = "oracle"
const UNKNOWN_AGENT = "completely-unknown-agent-xyz"

// ─── processHandoffsToDelegation ─────────────────────────────────────────────

describe("processHandoffsToDelegation", () => {
  // ── Happy path: valid delegation ────────────────────────────────────────

  test("#given return_to_caller decision with known agent target #then creates pending delegation", () => {
    const directory = createTempDir()

    const decision = makeDecision({
      kind: "return_to_caller",
      originalTarget: KNOWN_AGENT,
      sourceTaskId: "task_1",
      sourceAgent: "nodejs-backend-architect",
    })

    const task = makeTask({
      id: "task_1",
      label: "Implement API endpoint",
      prompt: "Create a REST endpoint for user authentication",
      status: "completed",
    })

    const result = processHandoffsToDelegation({
      decisions: [decision],
      tasks: [task],
      projectDir: directory,
    })

    expect(result.created).toBe(1)
    expect(result.guardrailSkipped).toBe(0)
    expect(result.pending).toHaveLength(1)

    const pending = result.pending[0]!
    expect(pending.targetAgent).toBe(KNOWN_AGENT)
    expect(pending.sourceTaskId).toBe("task_1")
    expect(pending.sourceAgent).toBe("nodejs-backend-architect")
    expect(pending.status).toBe("pending")
    expect(pending.prompt).toContain("Implement API endpoint")
    expect(pending.prompt).toContain("Create a REST endpoint")
    expect(pending.routingDepth).toBe(1)
    expect(pending.guardrailChecks).toBeDefined()
    expect(pending.guardrailChecks!.length).toBeGreaterThanOrEqual(4)
  })

  // ── Known core agent ────────────────────────────────────────────────────

  test("#given return_to_caller decision with known core agent target #then creates pending delegation", () => {
    const directory = createTempDir()

    const decision = makeDecision({
      kind: "return_to_caller",
      originalTarget: KNOWN_CORE_AGENT,
      sourceTaskId: "task_2",
    })

    const task = makeTask({ id: "task_2", label: "Analyze code" })

    const result = processHandoffsToDelegation({
      decisions: [decision],
      tasks: [task],
      projectDir: directory,
    })

    expect(result.created).toBe(1)
    expect(result.pending[0]!.targetAgent).toBe(KNOWN_CORE_AGENT)
  })

  // ── Routing directive NOT delegatable ───────────────────────────────────

  test("#given return_to_caller target is routing directive #then not delegated", () => {
    const directory = createTempDir()

    const decision = makeDecision({
      kind: "return_to_caller",
      originalTarget: "return_to_caller", // This is a directive, not an agent
      sourceTaskId: "task_3",
    })

    const task = makeTask({ id: "task_3", label: "Generic task" })

    const result = processHandoffsToDelegation({
      decisions: [decision],
      tasks: [task],
      projectDir: directory,
    })

    expect(result.created).toBe(0)
    expect(result.guardrailSkipped).toBeGreaterThanOrEqual(1)
    expect(result.guardrailDetails.some((d) => d.includes("routing directive"))).toBe(true)
  })

  test("#given return_to_parent_for_routing target #then not delegated", () => {
    const directory = createTempDir()

    const decision = makeDecision({
      kind: "return_to_caller",
      originalTarget: "return_to_parent_for_routing",
      sourceTaskId: "task_4",
    })

    const task = makeTask({ id: "task_4", label: "Needs routing" })

    const result = processHandoffsToDelegation({
      decisions: [decision],
      tasks: [task],
      projectDir: directory,
    })

    expect(result.created).toBe(0)
    expect(result.guardrailSkipped).toBeGreaterThanOrEqual(1)
  })

  // ── Unknown target → skipped ────────────────────────────────────────────

  test("#given return_to_caller decision with unknown target #then skipped", () => {
    const directory = createTempDir()

    const decision = makeDecision({
      kind: "return_to_caller",
      originalTarget: UNKNOWN_AGENT,
      sourceTaskId: "task_5",
    })

    const task = makeTask({ id: "task_5", label: "Unknown target" })

    const result = processHandoffsToDelegation({
      decisions: [decision],
      tasks: [task],
      projectDir: directory,
    })

    expect(result.created).toBe(0)
    expect(result.guardrailSkipped).toBeGreaterThanOrEqual(1)
    expect(result.guardrailDetails.some((d) => d.includes("not in known agent IDs"))).toBe(true)
  })

  // ── Non-return_to_caller decisions → skipped ────────────────────────────

  test("#given unknown_target_fallback decision #then skipped (not delegatable kind)", () => {
    const directory = createTempDir()

    const decision = makeDecision({
      kind: "unknown_target_fallback",
      originalTarget: UNKNOWN_AGENT,
      sourceTaskId: "task_6",
    })

    const task = makeTask({ id: "task_6", label: "Fallback" })

    const result = processHandoffsToDelegation({
      decisions: [decision],
      tasks: [task],
      projectDir: directory,
    })

    expect(result.created).toBe(0)
    // unknown_target_fallback is terminal; silent skip (not guardrailSkipped)
    expect(result.guardrailSkipped).toBe(0)
  })

  test("#given invalid_target_blocked decision #then silently skipped (terminal)", () => {
    const directory = createTempDir()

    const decision = makeDecision({
      kind: "invalid_target_blocked",
      originalTarget: "oracle",
      sourceTaskId: "task_7",
    })

    const task = makeTask({ id: "task_7", label: "Blocked source" })

    const result = processHandoffsToDelegation({
      decisions: [decision],
      tasks: [task],
      projectDir: directory,
    })

    expect(result.created).toBe(0)
  })

  test("#given no_handoff_data decision #then silently skipped (terminal)", () => {
    const directory = createTempDir()

    const decision = makeDecision({
      kind: "no_handoff_data",
      originalTarget: null,
      sourceTaskId: "task_8",
    })

    const task = makeTask({ id: "task_8", label: "No handoff" })

    const result = processHandoffsToDelegation({
      decisions: [decision],
      tasks: [task],
      projectDir: directory,
    })

    expect(result.created).toBe(0)
  })

  // ── BLOCKED source task → skipped ───────────────────────────────────────

  test("#given valid target but source task is BLOCKED #then skipped", () => {
    const directory = createTempDir()

    const decision = makeDecision({
      kind: "return_to_caller",
      originalTarget: KNOWN_AGENT,
      sourceTaskId: "task_blocked",
    })

    const task = makeTask({
      id: "task_blocked",
      label: "Sensitive task",
      prompt: "Read .env file",
      status: "blocked",
    })

    const result = processHandoffsToDelegation({
      decisions: [decision],
      tasks: [task],
      projectDir: directory,
    })

    expect(result.created).toBe(0)
    expect(result.guardrailSkipped).toBeGreaterThanOrEqual(1)
    expect(result.guardrailDetails.some((d) => d.includes("BLOCKED"))).toBe(true)
  })

  // ── Max routing depth guardrail ─────────────────────────────────────────

  test("#given routing depth at max #then skipped", () => {
    const directory = createTempDir()
    const stateMgr = new OmoStateManager(directory)

    // Pre-set routing depth to max
    for (let i = 0; i < 3; i++) {
      stateMgr.incrementRoutingDepth()
    }

    const decision = makeDecision({
      kind: "return_to_caller",
      originalTarget: KNOWN_AGENT,
      sourceTaskId: "task_depth",
    })

    const task = makeTask({ id: "task_depth", label: "Deep delegation" })

    const result = processHandoffsToDelegation({
      decisions: [decision],
      tasks: [task],
      projectDir: directory,
    })

    expect(result.created).toBe(0)
    expect(result.guardrailSkipped).toBeGreaterThanOrEqual(1)
    expect(result.guardrailDetails.some((d) => d.includes("routing depth"))).toBe(true)
  })

  // ── Dedup: same target + same task → only one pending ───────────────────

  test("#given duplicate delegation request #then deduped (only one pending)", () => {
    const directory = createTempDir()

    const decision = makeDecision({
      kind: "return_to_caller",
      originalTarget: KNOWN_AGENT,
      sourceTaskId: "task_dedup",
    })

    const task = makeTask({
      id: "task_dedup",
      label: "Dedup test",
      prompt: "Test dedup scenario",
    })

    // First delegation
    const result1 = processHandoffsToDelegation({
      decisions: [decision],
      tasks: [task],
      projectDir: directory,
    })
    expect(result1.created).toBe(1)

    // Second delegation with same data — should dedup
    const result2 = processHandoffsToDelegation({
      decisions: [decision],
      tasks: [task],
      projectDir: directory,
    })

    expect(result2.created).toBe(0)
    expect(result2.guardrailSkipped).toBeGreaterThanOrEqual(1)
    expect(result2.guardrailDetails.some((d) => d.includes("already pending"))).toBe(true)
    // Only one total pending
    expect(result2.pending).toHaveLength(1)
  })

  // ── Multiple different delegations ──────────────────────────────────────

  test("#given multiple different valid decisions #then creates multiple pending delegations", () => {
    const directory = createTempDir()

    const decision1 = makeDecision({
      kind: "return_to_caller",
      originalTarget: KNOWN_AGENT,
      sourceTaskId: "task_a",
    })

    const decision2 = makeDecision({
      kind: "return_to_caller",
      originalTarget: "qa-test-engineer",
      sourceTaskId: "task_b",
    })

    const task1 = makeTask({ id: "task_a", label: "Backend implementation" })
    const task2 = makeTask({ id: "task_b", label: "Write tests" })

    const result = processHandoffsToDelegation({
      decisions: [decision1, decision2],
      tasks: [task1, task2],
      projectDir: directory,
    })

    expect(result.created).toBe(2)
    expect(result.pending).toHaveLength(2)
    expect(result.pending.map((d) => d.targetAgent).sort()).toEqual(
      [KNOWN_AGENT, "qa-test-engineer"].sort(),
    )
  })

  // ── Mixed decisions (some delegatable, some not) ────────────────────────

  test("#given mixed decisions #then only valid ones delegated", () => {
    const directory = createTempDir()

    const validDecision = makeDecision({
      kind: "return_to_caller",
      originalTarget: KNOWN_AGENT,
      sourceTaskId: "task_valid",
    })

    const blockedDecision = makeDecision({
      kind: "invalid_target_blocked",
      originalTarget: "oracle",
      sourceTaskId: "task_blocked",
    })

    const fallbackDecision = makeDecision({
      kind: "unknown_target_fallback",
      originalTarget: UNKNOWN_AGENT,
      sourceTaskId: "task_fallback",
    })

    const task = makeTask({ id: "task_valid", label: "Valid task" })

    const result = processHandoffsToDelegation({
      decisions: [validDecision, blockedDecision, fallbackDecision],
      tasks: [task],
      projectDir: directory,
    })

    expect(result.created).toBe(1)
    expect(result.pending).toHaveLength(1)
    expect(result.pending[0]!.targetAgent).toBe(KNOWN_AGENT)
  })

  // ── Decision without sourceTaskId ───────────────────────────────────────

  test("#given decision without sourceTaskId #then creates delegation with prompt from target", () => {
    const directory = createTempDir()

    const decision = makeDecision({
      kind: "return_to_caller",
      originalTarget: KNOWN_AGENT,
      sourceTaskId: undefined,
    })

    const result = processHandoffsToDelegation({
      decisions: [decision],
      tasks: [],
      projectDir: directory,
    })

    expect(result.created).toBe(1)
    const pending = result.pending[0]!
    expect(pending.targetAgent).toBe(KNOWN_AGENT)
    expect(pending.sourceTaskId).toBeUndefined()
    expect(pending.prompt).toBeTruthy()
  })

  // ── Persistence: delegations survive across calls ───────────────────────

  test("#given delegation created #then getPendingDelegations returns it", () => {
    const directory = createTempDir()

    const decision = makeDecision({
      kind: "return_to_caller",
      originalTarget: KNOWN_AGENT,
      sourceTaskId: "task_persist",
    })

    const task = makeTask({ id: "task_persist", label: "Persist test" })

    processHandoffsToDelegation({
      decisions: [decision],
      tasks: [task],
      projectDir: directory,
    })

    const pending = getPendingDelegations(directory)
    expect(pending).toHaveLength(1)
    expect(pending[0]!.targetAgent).toBe(KNOWN_AGENT)
    expect(pending[0]!.status).toBe("pending")
  })
})

// ─── consumeDelegation ───────────────────────────────────────────────────────

describe("consumeDelegation", () => {
  test("#given pending delegation #then consume removes it from pending and adds to history", () => {
    const directory = createTempDir()

    const decision = makeDecision({
      kind: "return_to_caller",
      originalTarget: KNOWN_AGENT,
      sourceTaskId: "task_consume",
    })

    const task = makeTask({ id: "task_consume", label: "Consume test" })

    const createResult = processHandoffsToDelegation({
      decisions: [decision],
      tasks: [task],
      projectDir: directory,
    })

    expect(createResult.created).toBe(1)
    const delegationId = createResult.pending[0]!.id

    // Consume it
    const consumed = consumeDelegation(directory, delegationId)
    expect(consumed).toBe(true)

    // Pending should be empty
    const pending = getPendingDelegations(directory)
    expect(pending).toHaveLength(0)

    // History should have the record
    const stateMgr = new OmoStateManager(directory)
    const history = stateMgr.getDelegationHistory()
    expect(history).toHaveLength(1)
    expect(history[0]!.id).toBe(delegationId)
    expect(history[0]!.result).toBe("executed")
  })

  test("#given consumed with block reason #then history records it", () => {
    const directory = createTempDir()

    const decision = makeDecision({
      kind: "return_to_caller",
      originalTarget: KNOWN_AGENT,
      sourceTaskId: "task_blocked_reason",
    })

    const task = makeTask({ id: "task_blocked_reason", label: "Block reason" })

    const createResult = processHandoffsToDelegation({
      decisions: [decision],
      tasks: [task],
      projectDir: directory,
    })

    const delegationId = createResult.pending[0]!.id

    const consumed = consumeDelegation(directory, delegationId, "blocked", "Agent disabled in config")
    expect(consumed).toBe(true)

    const stateMgr = new OmoStateManager(directory)
    const history = stateMgr.getDelegationHistory()
    expect(history[0]!.result).toBe("blocked")
    expect(history[0]!.blockReason).toBe("Agent disabled in config")
  })

  test("#given nonexistent delegation ID #then consume returns false", () => {
    const directory = createTempDir()

    const consumed = consumeDelegation(directory, "nonexistent_id")
    expect(consumed).toBe(false)
  })

  test("#given consume same delegation twice #then second call returns false", () => {
    const directory = createTempDir()

    const decision = makeDecision({
      kind: "return_to_caller",
      originalTarget: KNOWN_AGENT,
      sourceTaskId: "task_double_consume",
    })

    const task = makeTask({ id: "task_double_consume", label: "Double consume" })

    const createResult = processHandoffsToDelegation({
      decisions: [decision],
      tasks: [task],
      projectDir: directory,
    })

    const delegationId = createResult.pending[0]!.id

    expect(consumeDelegation(directory, delegationId)).toBe(true)
    expect(consumeDelegation(directory, delegationId)).toBe(false)
  })
})

// ─── Empty inputs ────────────────────────────────────────────────────────────

describe("processHandoffsToDelegation edge cases", () => {
  test("#given empty decisions #then returns zero created", () => {
    const directory = createTempDir()

    const result = processHandoffsToDelegation({
      decisions: [],
      tasks: [],
      projectDir: directory,
    })

    expect(result.created).toBe(0)
    expect(result.guardrailSkipped).toBe(0)
    expect(result.pending).toHaveLength(0)
  })

  test("#given all non-delegatable decisions #then returns zero created and zero guardrail skipped", () => {
    const directory = createTempDir()

    const terminalDecisions: RoutingDecision[] = [
      makeDecision({ kind: "invalid_target_blocked", originalTarget: "oracle" }),
      makeDecision({ kind: "no_handoff_data", originalTarget: null }),
      makeDecision({ kind: "unknown_target_fallback", originalTarget: UNKNOWN_AGENT }),
    ]

    const result = processHandoffsToDelegation({
      decisions: terminalDecisions,
      tasks: [],
      projectDir: directory,
    })

    expect(result.created).toBe(0)
    expect(result.guardrailSkipped).toBe(0)
  })

  test("#given IN_PROGRESS source task #then still delegates (not blocked)", () => {
    const directory = createTempDir()

    const decision = makeDecision({
      kind: "return_to_caller",
      originalTarget: KNOWN_AGENT,
      sourceTaskId: "task_progress",
    })

    const task = makeTask({
      id: "task_progress",
      label: "In progress task",
      status: "in_progress",
    })

    const result = processHandoffsToDelegation({
      decisions: [decision],
      tasks: [task],
      projectDir: directory,
    })

    // IN_PROGRESS is not BLOCKED, so delegation should proceed
    expect(result.created).toBe(1)
  })

  test("#given pending source task #then still delegates (not blocked)", () => {
    const directory = createTempDir()

    const decision = makeDecision({
      kind: "return_to_caller",
      originalTarget: KNOWN_AGENT,
      sourceTaskId: "task_pending",
    })

    const task = makeTask({
      id: "task_pending",
      label: "Pending task",
      status: "pending",
    })

    const result = processHandoffsToDelegation({
      decisions: [decision],
      tasks: [task],
      projectDir: directory,
    })

    expect(result.created).toBe(1)
  })

  test("#given failed source task #then still delegates (not blocked)", () => {
    const directory = createTempDir()

    const decision = makeDecision({
      kind: "return_to_caller",
      originalTarget: KNOWN_AGENT,
      sourceTaskId: "task_failed",
    })

    const task = makeTask({
      id: "task_failed",
      label: "Failed task",
      status: "failed",
    })

    const result = processHandoffsToDelegation({
      decisions: [decision],
      tasks: [task],
      projectDir: directory,
    })

    expect(result.created).toBe(1)
  })
})
