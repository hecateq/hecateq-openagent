import { describe, expect, test } from "bun:test"

import type { HandoffBlock } from "./handoff-parser"
import {
  decideRouting,
  decideRoutingFromTaskHandoff,
  isTerminalDecision,
  isUserVisibleDecision,
} from "./routing-policy-engine"
import type { RoutingDecision, RoutingDecisionKind } from "./types"

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeHandoff(overrides: Partial<HandoffBlock> = {}): HandoffBlock {
  return {
    status: null,
    signals: [],
    handoff: null,
    validationIssues: [],
    raw: "",
    ...overrides,
  }
}

// ─── decideRouting ──────────────────────────────────────────────────────────

describe("decideRouting", () => {
  // ── return_to_caller ────────────────────────────────────────────────────

  test("#given handoff with return_to_caller target #then return_to_caller decision", () => {
    const handoff = makeHandoff({
      status: "DONE",
      handoff: "return_to_caller",
    })
    const decision = decideRouting(handoff)
    expect(decision.kind).toBe("return_to_caller")
    expect(decision.originalTarget).toBe("return_to_caller")
  })

  test("#given handoff with known agent-id target #then return_to_caller decision", () => {
    const handoff = makeHandoff({
      status: "DONE",
      handoff: "nodejs-backend-developer",
    })
    const decision = decideRouting(handoff)
    expect(decision.kind).toBe("return_to_caller")
    expect(decision.originalTarget).toBe("nodejs-backend-developer")
    expect(decision.reason).toContain("known agent ID")
  })

  test("#given handoff with known core agent target #then return_to_caller decision", () => {
    const handoff = makeHandoff({
      status: "DONE",
      handoff: "oracle",
    })
    const decision = decideRouting(handoff)
    expect(decision.kind).toBe("return_to_caller")
    expect(decision.originalTarget).toBe("oracle")
  })

  // ── return_to_parent_for_routing ────────────────────────────────────────

  test("#given handoff with return_to_parent_for_routing target #then return_to_parent_for_routing decision", () => {
    const handoff = makeHandoff({
      status: "DONE",
      handoff: "return_to_parent_for_routing",
    })
    const decision = decideRouting(handoff)
    expect(decision.kind).toBe("return_to_parent_for_routing")
    expect(decision.originalTarget).toBe("return_to_parent_for_routing")
    expect(decision.reason).toContain("parent-level routing")
  })

  // ── invalid_target_blocked ──────────────────────────────────────────────

  test("#given BLOCKED status with valid target #then invalid_target_blocked decision", () => {
    const handoff = makeHandoff({
      status: "BLOCKED",
      handoff: "return_to_caller",
    })
    const decision = decideRouting(handoff)
    expect(decision.kind).toBe("invalid_target_blocked")
    expect(decision.originalTarget).toBe("return_to_caller")
    expect(decision.reason).toContain("BLOCKED")
  })

  test("#given BLOCKED status with return_to_parent_for_routing #then invalid_target_blocked decision", () => {
    const handoff = makeHandoff({
      status: "BLOCKED",
      handoff: "return_to_parent_for_routing",
    })
    const decision = decideRouting(handoff)
    expect(decision.kind).toBe("invalid_target_blocked")
  })

  test("#given BLOCKED status with known agent-id target #then invalid_target_blocked decision", () => {
    const handoff = makeHandoff({
      status: "BLOCKED",
      handoff: "sisyphus",
    })
    const decision = decideRouting(handoff)
    expect(decision.kind).toBe("invalid_target_blocked")
  })

  // ── no_handoff_data ─────────────────────────────────────────────────────

  test("#given handoff with no status and no target #then no_handoff_data decision", () => {
    const handoff = makeHandoff({
      status: null,
      handoff: null,
      signals: [],
    })
    const decision = decideRouting(handoff)
    expect(decision.kind).toBe("no_handoff_data")
  })

  test("#given handoff with status but no target #then no_handoff_data decision", () => {
    const handoff = makeHandoff({
      status: "DONE",
      handoff: null,
    })
    const decision = decideRouting(handoff)
    expect(decision.kind).toBe("no_handoff_data")
    expect(decision.reason).toContain("no target was specified")
  })

  // ── unknown_target_fallback ─────────────────────────────────────────────

  test("#given handoff with unknown target string #then unknown_target_fallback decision", () => {
    const handoff = makeHandoff({
      status: "DONE",
      handoff: "completely-unknown-agent-xyz",
    })
    const decision = decideRouting(handoff)
    expect(decision.kind).toBe("unknown_target_fallback")
    expect(decision.originalTarget).toBe("completely-unknown-agent-xyz")
    expect(decision.reason).toContain("not a known agent ID")
  })

  test("#given handoff with arbitrary string target #then unknown_target_fallback decision", () => {
    const handoff = makeHandoff({
      status: "IN_PROGRESS",
      handoff: "foobar-123",
    })
    const decision = decideRouting(handoff)
    expect(decision.kind).toBe("unknown_target_fallback")
  })

  // ── Source metadata passthrough ─────────────────────────────────────────

  test("#given sourceTaskId and sourceAgent opts #then decision carries them", () => {
    const handoff = makeHandoff({
      status: "DONE",
      handoff: "return_to_caller",
    })
    const decision = decideRouting(handoff, {
      sourceTaskId: "task_42",
      sourceAgent: "nodejs-backend-developer",
    })
    expect(decision.sourceTaskId).toBe("task_42")
    expect(decision.sourceAgent).toBe("nodejs-backend-developer")
  })

  // ── Timestamp ───────────────────────────────────────────────────────────

  test("#given any valid handoff #then decision has ISO timestamp", () => {
    const handoff = makeHandoff({
      status: "DONE",
      handoff: "return_to_caller",
    })
    const decision = decideRouting(handoff)
    expect(decision.decidedAt).toBeTruthy()
    expect(() => new Date(decision.decidedAt).toISOString()).not.toThrow()
  })

  // ── Priority: BLOCKED beats valid target ────────────────────────────────

  test("#given BLOCKED status #then any target is blocked regardless of validity", () => {
    const handoff = makeHandoff({
      status: "BLOCKED",
      handoff: "oracle",
    })
    const decision = decideRouting(handoff)
    expect(decision.kind).toBe("invalid_target_blocked")
    // NOT return_to_caller — BLOCKED overrides
    expect(decision.kind).not.toBe("return_to_caller")
  })
})

// ── Wave 3: role_policy_violation ──────────────────────────────────────────

  describe("decideRouting — role policy enforcement", () => {
    test("#given reviewer-auditor handoff to implementer with sourceAgent #then role_policy_violation", () => {
      const handoff = makeHandoff({
        status: "DONE",
        handoff: "nodejs-backend-developer",
      })
      const decision = decideRouting(handoff, {
        sourceAgent: "qa-test-engineer",
      })
      expect(decision.kind).toBe("role_policy_violation")
      expect(decision.originalTarget).toBe("nodejs-backend-developer")
      expect(decision.reason).toContain("reviewer-auditor")
      expect(decision.roleViolation).toBeDefined()
      expect(decision.roleViolation!.sourceRole).toBe("reviewer-auditor")
      expect(decision.roleViolation!.targetRole).toBe("implementer")
    })

    test("#given architect-builder handoff to another architect-builder #then role_policy_violation", () => {
      const handoff = makeHandoff({
        status: "DONE",
        handoff: "security-architect",
      })
      const decision = decideRouting(handoff, {
        sourceAgent: "nodejs-backend-architect",
      })
      expect(decision.kind).toBe("role_policy_violation")
      expect(decision.originalTarget).toBe("security-architect")
      expect(decision.roleViolation!.sourceRole).toBe("architect-builder")
      expect(decision.roleViolation!.targetRole).toBe("architect-builder")
    })

    test("#given docs-research handoff to implementer #then role_policy_violation", () => {
      const handoff = makeHandoff({
        status: "DONE",
        handoff: "flutter-dart-master",
      })
      const decision = decideRouting(handoff, {
        sourceAgent: "librarian",
      })
      expect(decision.kind).toBe("role_policy_violation")
      expect(decision.reason).toContain("docs-research")
    })

    test("#given reviewer-auditor handoff to orchestrator #then return_to_caller (allowed)", () => {
      const handoff = makeHandoff({
        status: "DONE",
        handoff: "sisyphus",
      })
      const decision = decideRouting(handoff, {
        sourceAgent: "qa-test-engineer",
      })
      expect(decision.kind).toBe("return_to_caller")
      expect(decision.originalTarget).toBe("sisyphus")
    })

    test("#given architect-builder handoff to implementer #then return_to_caller (allowed)", () => {
      const handoff = makeHandoff({
        status: "DONE",
        handoff: "nodejs-backend-developer",
      })
      const decision = decideRouting(handoff, {
        sourceAgent: "security-architect",
      })
      expect(decision.kind).toBe("return_to_caller")
    })

    test("#given implementer handoff to any agent #then return_to_caller (allowed)", () => {
      const handoff = makeHandoff({
        status: "DONE",
        handoff: "qa-test-engineer",
      })
      const decision = decideRouting(handoff, {
        sourceAgent: "nodejs-backend-developer",
      })
      expect(decision.kind).toBe("return_to_caller")
    })

    test("#given orchestrator handoff to any agent #then return_to_caller (allowed)", () => {
      const handoff = makeHandoff({
        status: "DONE",
        handoff: "database-specialist",
      })
      const decision = decideRouting(handoff, {
        sourceAgent: "sisyphus",
      })
      expect(decision.kind).toBe("return_to_caller")
    })

    test("#given role violation without sourceAgent #then falls back to return_to_caller (no enforcement)", () => {
      // Without sourceAgent, role policy cannot be checked — no violation
      const handoff = makeHandoff({
        status: "DONE",
        handoff: "nodejs-backend-developer",
      })
      const decision = decideRouting(handoff) // no sourceAgent
      expect(decision.kind).toBe("return_to_caller")
      expect(decision.roleViolation).toBeUndefined()
    })

    test("#given docs-research handoff to orchestrator #then return_to_caller (allowed)", () => {
      const handoff = makeHandoff({
        status: "DONE",
        handoff: "sisyphus",
      })
      const decision = decideRouting(handoff, {
        sourceAgent: "librarian",
      })
      expect(decision.kind).toBe("return_to_caller")
    })
  })

// ─── decideRoutingFromTaskHandoff ───────────────────────────────────────────

describe("decideRoutingFromTaskHandoff", () => {
  test("#given valid task handoff data #then produces decision", () => {
    const decision = decideRoutingFromTaskHandoff({
      status: "DONE",
      target: "return_to_caller",
      signalCount: 2,
    })
    expect(decision.kind).toBe("return_to_caller")
  })

  test("#given no handoff data #then no_handoff_data decision", () => {
    const decision = decideRoutingFromTaskHandoff({
      status: null,
      target: null,
      signalCount: 0,
    })
    expect(decision.kind).toBe("no_handoff_data")
  })

  test("#given BLOCKED status #then invalid_target_blocked", () => {
    const decision = decideRoutingFromTaskHandoff({
      status: "BLOCKED",
      target: "return_to_parent_for_routing",
      signalCount: 1,
    })
    expect(decision.kind).toBe("invalid_target_blocked")
  })

  test("#given unknown target #then unknown_target_fallback", () => {
    const decision = decideRoutingFromTaskHandoff({
      status: "DONE",
      target: "random-agent",
      signalCount: 0,
    })
    expect(decision.kind).toBe("unknown_target_fallback")
  })

  test("#given source metadata #then passes through", () => {
    const decision = decideRoutingFromTaskHandoff({
      status: "DONE",
      target: "sisyphus",
      signalCount: 1,
      sourceTaskId: "task_7",
      sourceAgent: "nodejs-backend-developer",
    })
    expect(decision.kind).toBe("return_to_caller")
    expect(decision.sourceTaskId).toBe("task_7")
    expect(decision.sourceAgent).toBe("nodejs-backend-developer")
  })
})

// ─── isUserVisibleDecision ─────────────────────────────────────────────────

describe("isUserVisibleDecision", () => {
  const visibleKinds: RoutingDecisionKind[] = [
    "return_to_parent_for_routing",
    "unknown_target_fallback",
    "invalid_target_blocked",
    "role_policy_violation",
  ]
  const invisibleKinds: RoutingDecisionKind[] = [
    "return_to_caller",
    "no_handoff_data",
  ]

  for (const kind of visibleKinds) {
    test(`#given ${kind} #then true`, () => {
      expect(isUserVisibleDecision(kind)).toBe(true)
    })
  }

  for (const kind of invisibleKinds) {
    test(`#given ${kind} #then false`, () => {
      expect(isUserVisibleDecision(kind)).toBe(false)
    })
  }
})

// ─── isTerminalDecision ────────────────────────────────────────────────────

describe("isTerminalDecision", () => {
  const terminalKinds: RoutingDecisionKind[] = [
    "no_handoff_data",
    "invalid_target_blocked",
    "role_policy_violation",
  ]
  const nonTerminalKinds: RoutingDecisionKind[] = [
    "return_to_caller",
    "return_to_parent_for_routing",
    "unknown_target_fallback",
  ]

  for (const kind of terminalKinds) {
    test(`#given ${kind} #then true`, () => {
      expect(isTerminalDecision(kind)).toBe(true)
    })
  }

  for (const kind of nonTerminalKinds) {
    test(`#given ${kind} #then false`, () => {
      expect(isTerminalDecision(kind)).toBe(false)
    })
  }
})

// ─── Property existence on decisions ───────────────────────────────────────

describe("RoutingDecision completeness", () => {
  const allKinds: RoutingDecisionKind[] = [
    "return_to_caller",
    "return_to_parent_for_routing",
    "invalid_target_blocked",
    "no_handoff_data",
    "unknown_target_fallback",
    "role_policy_violation",
  ]

  for (const kind of allKinds) {
    test(`#given ${kind} decision #then all required fields present`, () => {
      let decision: RoutingDecision

      // Force each kind by constructing the right handoff
      switch (kind) {
        case "return_to_caller":
          decision = decideRouting(makeHandoff({ status: "DONE", handoff: "return_to_caller" }))
          break
        case "return_to_parent_for_routing":
          decision = decideRouting(makeHandoff({ status: "DONE", handoff: "return_to_parent_for_routing" }))
          break
        case "invalid_target_blocked":
          decision = decideRouting(makeHandoff({ status: "BLOCKED", handoff: "return_to_caller" }))
          break
        case "no_handoff_data":
          decision = decideRouting(makeHandoff({ status: null, handoff: null, signals: [] }))
          break
        case "unknown_target_fallback":
          decision = decideRouting(makeHandoff({ status: "DONE", handoff: "nonexistent" }))
          break
        case "role_policy_violation":
          decision = decideRouting(makeHandoff({ status: "DONE", handoff: "nodejs-backend-developer" }), { sourceAgent: "qa-test-engineer" })
          break
      }

      expect(decision.kind).toBe(kind)
      expect(typeof decision.reason).toBe("string")
      expect(decision.reason.length).toBeGreaterThan(0)
      expect(typeof decision.decidedAt).toBe("string")
      expect(decision.decidedAt.length).toBeGreaterThan(0)
    })
  }
})
