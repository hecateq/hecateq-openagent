import { readFileSync } from "node:fs"
import { join } from "node:path"
import { beforeAll, beforeEach, describe, expect, it, mock } from "bun:test"
import type { ConsumeDelegationsResult } from "../../features/hecateq-orchestration"
import type { RoutingDecision } from "../../features/hecateq-orchestration/types"

// Mocks
const mockShowHecateqToastSafe = mock(() => Promise.resolve(true))

mock.module("../../shared/hecateq-toast", () => ({
  showHecateqToastSafe: mockShowHecateqToastSafe,
}))
mock.module("../../shared/hecateq-toast.ts", () => ({
  showHecateqToastSafe: mockShowHecateqToastSafe,
}))

const hookModulePromise = import("./index")

// Helpers

function makeRoleViolation(overrides: Partial<RoutingDecision> = {}): RoutingDecision {
  return {
    kind: "role_policy_violation",
    reason: "Reviewer-auditor cannot handoff to implementer",
    originalTarget: "hephaestus",
    decidedAt: new Date().toISOString(),
    sourceTaskId: "task-1",
    sourceAgent: "oracle",
    roleViolation: {
      sourceRole: "reviewer-auditor",
      targetRole: "implementer",
      rule: "Reviewer-auditor cannot handoff to implementer",
    },
    ...overrides,
  }
}

function makeInvalidTargetBlocked(overrides: Partial<RoutingDecision> = {}): RoutingDecision {
  return {
    kind: "invalid_target_blocked",
    reason: 'Handoff status is BLOCKED; routing to "hephaestus" is suppressed',
    originalTarget: "hephaestus",
    decidedAt: new Date().toISOString(),
    sourceTaskId: "task-2",
    sourceAgent: "sisyphus",
    ...overrides,
  }
}

function makeReturnToParent(): RoutingDecision {
  return {
    kind: "return_to_parent_for_routing",
    reason: "Agent requested parent-level routing decision",
    originalTarget: "return_to_parent_for_routing",
    decidedAt: new Date().toISOString(),
    sourceTaskId: "task-3",
    sourceAgent: "oracle",
  }
}

function makeUnknownTargetFallback(): RoutingDecision {
  return {
    kind: "unknown_target_fallback",
    reason: 'Handoff target "bogus" is not a known agent ID',
    originalTarget: "bogus",
    decidedAt: new Date().toISOString(),
    sourceTaskId: "task-4",
    sourceAgent: "explore",
  }
}

function makeReturnToCaller(): RoutingDecision {
  return {
    kind: "return_to_caller",
    reason: "Agent explicitly requested return to caller",
    originalTarget: "return_to_caller",
    decidedAt: new Date().toISOString(),
    sourceTaskId: "task-5",
    sourceAgent: "librarian",
  }
}

function makeNoHandoffData(): RoutingDecision {
  return {
    kind: "no_handoff_data",
    reason: "No handoff metadata was present",
    originalTarget: null,
    decidedAt: new Date().toISOString(),
  }
}

function makeResult(overrides: Partial<ConsumeDelegationsResult> = {}): ConsumeDelegationsResult {
  return {
    results: [],
    iterations: 0,
    totalConsumed: 0,
    guardrailBlocked: 0,
    spawnPolicyBlocked: false,
    rateLimitBlocked: false,
    userVisibleRoutingDecisions: [],
    userVisibleGuardrailBlocks: [],
    ...overrides,
  }
}

// Tests

describe("maybeShowRoutingPolicyToast", () => {
  let maybeShowRoutingPolicyToast: typeof import("./index").maybeShowRoutingPolicyToast

  beforeAll(async () => {
    const mod = await hookModulePromise
    maybeShowRoutingPolicyToast = mod.maybeShowRoutingPolicyToast
  })

  beforeEach(() => {
    mockShowHecateqToastSafe.mockReset()
    mockShowHecateqToastSafe.mockResolvedValue(true)
  })

  // Test 1: role_policy_violation with source+target shows proper toast
  it("shows error toast for role_policy_violation with source and target", () => {
    const cooldowns = new Map<string, number>()

    maybeShowRoutingPolicyToast(
      cooldowns,
      {},
      "ses-abc",
      makeResult({
        userVisibleRoutingDecisions: [makeRoleViolation()],
      }),
    )

    expect(mockShowHecateqToastSafe).toHaveBeenCalledTimes(1)
    const call = mockShowHecateqToastSafe.mock.calls[0] as Array<unknown>
    expect(call[1]).toMatchObject({
      kind: "runtime",
      title: "Routing blocked by role policy",
      variant: "error",
      duration: 7000,
    })
    expect((call[1] as { message: string }).message).toContain("oracle")
    expect((call[1] as { message: string }).message).toContain("hephaestus")
    expect((call[1] as { message: string }).message).toContain("routing role policy")
  })

  // Test 2: role_policy_violation without source/target uses default message
  it("shows toast for role_policy_violation without source/target fallback", () => {
    const cooldowns = new Map<string, number>()

    maybeShowRoutingPolicyToast(
      cooldowns,
      {},
      "ses-def",
      makeResult({
        userVisibleRoutingDecisions: [makeRoleViolation({ sourceAgent: undefined, originalTarget: null })],
      }),
    )

    expect(mockShowHecateqToastSafe).toHaveBeenCalledTimes(1)
    const call = mockShowHecateqToastSafe.mock.calls[0] as Array<unknown>
    expect(call[1]).toMatchObject({
      kind: "runtime",
      title: "Routing blocked by role policy",
      variant: "error",
    })
    expect((call[1] as { message: string }).message).toContain("Check the orchestration context")
  })

  // Test 3: invalid_target_blocked shows proper toast
  it("shows error toast for invalid_target_blocked", () => {
    const cooldowns = new Map<string, number>()

    maybeShowRoutingPolicyToast(
      cooldowns,
      {},
      "ses-ghi",
      makeResult({
        userVisibleRoutingDecisions: [makeInvalidTargetBlocked()],
      }),
    )

    expect(mockShowHecateqToastSafe).toHaveBeenCalledTimes(1)
    const call = mockShowHecateqToastSafe.mock.calls[0] as Array<unknown>
    expect(call[1]).toMatchObject({
      kind: "runtime",
      title: "Blocked handoff suppressed routing",
      variant: "error",
      duration: 7000,
    })
    expect((call[1] as { message: string }).message).toContain("target was blocked")
  })

  // Test 4: Priority — role_policy_violation over invalid_target_blocked
  it("prioritizes role_policy_violation over invalid_target_blocked when both present", () => {
    const cooldowns = new Map<string, number>()

    maybeShowRoutingPolicyToast(
      cooldowns,
      {},
      "ses-prio",
      makeResult({
        userVisibleRoutingDecisions: [
          makeInvalidTargetBlocked(),
          makeRoleViolation(),
        ],
      }),
    )

    expect(mockShowHecateqToastSafe).toHaveBeenCalledTimes(1)
    const call = mockShowHecateqToastSafe.mock.calls[0] as Array<unknown>
    expect(call[1]).toMatchObject({
      title: "Routing blocked by role policy",
    })
  })

  // Test 5: Skips return_to_parent_for_routing
  it("skips return_to_parent_for_routing decisions", () => {
    const cooldowns = new Map<string, number>()

    maybeShowRoutingPolicyToast(
      cooldowns,
      {},
      "ses-skip1",
      makeResult({
        userVisibleRoutingDecisions: [makeReturnToParent()],
      }),
    )

    expect(mockShowHecateqToastSafe).not.toHaveBeenCalled()
  })

  // Test 6: Skips unknown_target_fallback
  it("skips unknown_target_fallback decisions", () => {
    const cooldowns = new Map<string, number>()

    maybeShowRoutingPolicyToast(
      cooldowns,
      {},
      "ses-skip2",
      makeResult({
        userVisibleRoutingDecisions: [makeUnknownTargetFallback()],
      }),
    )

    expect(mockShowHecateqToastSafe).not.toHaveBeenCalled()
  })

  // Test 7: Skips return_to_caller
  it("skips return_to_caller decisions", () => {
    const cooldowns = new Map<string, number>()

    maybeShowRoutingPolicyToast(
      cooldowns,
      {},
      "ses-skip3",
      makeResult({
        userVisibleRoutingDecisions: [makeReturnToCaller()],
      }),
    )

    expect(mockShowHecateqToastSafe).not.toHaveBeenCalled()
  })

  // Test 8: Skips no_handoff_data
  it("skips no_handoff_data decisions", () => {
    const cooldowns = new Map<string, number>()

    maybeShowRoutingPolicyToast(
      cooldowns,
      {},
      "ses-skip4",
      makeResult({
        userVisibleRoutingDecisions: [makeNoHandoffData()],
      }),
    )

    expect(mockShowHecateqToastSafe).not.toHaveBeenCalled()
  })

  // Test 9: No decisions → no toast
  it("shows no toast when userVisibleRoutingDecisions is empty", () => {
    const cooldowns = new Map<string, number>()

    maybeShowRoutingPolicyToast(cooldowns, {}, "ses-empty", makeResult())

    expect(mockShowHecateqToastSafe).not.toHaveBeenCalled()
  })

  // Test 10: Dedupe — same session + kind + target within 30s
  it("deduplicates same session + kind + target within cooldown window", () => {
    const cooldowns = new Map<string, number>()

    maybeShowRoutingPolicyToast(
      cooldowns,
      {},
      "ses-xyz",
      makeResult({
        userVisibleRoutingDecisions: [makeRoleViolation()],
      }),
    )
    expect(mockShowHecateqToastSafe).toHaveBeenCalledTimes(1)

    maybeShowRoutingPolicyToast(
      cooldowns,
      {},
      "ses-xyz",
      makeResult({
        userVisibleRoutingDecisions: [makeRoleViolation()],
      }),
    )
    expect(mockShowHecateqToastSafe).toHaveBeenCalledTimes(1)
  })

  // Test 11: Different targets get separate toasts even within cooldown
  it("allows different targets for same session within cooldown", () => {
    const cooldowns = new Map<string, number>()

    maybeShowRoutingPolicyToast(
      cooldowns,
      {},
      "ses-multi",
      makeResult({
        userVisibleRoutingDecisions: [makeRoleViolation({ originalTarget: "hephaestus" })],
      }),
    )
    expect(mockShowHecateqToastSafe).toHaveBeenCalledTimes(1)

    maybeShowRoutingPolicyToast(
      cooldowns,
      {},
      "ses-multi",
      makeResult({
        userVisibleRoutingDecisions: [makeRoleViolation({ originalTarget: "prometheus" })],
      }),
    )
    expect(mockShowHecateqToastSafe).toHaveBeenCalledTimes(2)
  })

  // Test 12: Different kinds get separate toasts
  it("allows role_policy_violation then invalid_target_blocked for same session", () => {
    const cooldowns = new Map<string, number>()

    maybeShowRoutingPolicyToast(
      cooldowns,
      {},
      "ses-kinds",
      makeResult({
        userVisibleRoutingDecisions: [makeRoleViolation()],
      }),
    )
    expect(mockShowHecateqToastSafe).toHaveBeenCalledTimes(1)

    maybeShowRoutingPolicyToast(
      cooldowns,
      {},
      "ses-kinds",
      makeResult({
        userVisibleRoutingDecisions: [makeInvalidTargetBlocked()],
      }),
    )
    expect(mockShowHecateqToastSafe).toHaveBeenCalledTimes(2)
  })

  // Test 13: No-TUI — does not throw
  it("does not throw when showHecateqToastSafe returns false (no TUI)", () => {
    mockShowHecateqToastSafe.mockResolvedValue(false)
    const cooldowns = new Map<string, number>()

    expect(() => {
      maybeShowRoutingPolicyToast(
        cooldowns,
        null,
        "ses-no-tui",
        makeResult({
          userVisibleRoutingDecisions: [makeRoleViolation()],
        }),
      )
    }).not.toThrow()
  })

  // Test 14: Fire-and-forget reject does not throw
  it("does not throw when showHecateqToastSafe rejects (fire-and-forget)", () => {
    mockShowHecateqToastSafe.mockRejectedValue(new Error("TUI unavailable"))
    const cooldowns = new Map<string, number>()

    expect(() => {
      maybeShowRoutingPolicyToast(
        cooldowns,
        {},
        "ses-reject",
        makeResult({
          userVisibleRoutingDecisions: [makeRoleViolation()],
        }),
      )
    }).not.toThrow()
  })

  // Test 15: Empty sessionID fallback
  it("handles empty sessionID by falling back to unknown-session", () => {
    const cooldowns = new Map<string, number>()

    expect(() => {
      maybeShowRoutingPolicyToast(
        cooldowns,
        {},
        "",
        makeResult({
          userVisibleRoutingDecisions: [makeRoleViolation()],
        }),
      )
    }).not.toThrow()

    expect(mockShowHecateqToastSafe).toHaveBeenCalledTimes(1)
  })

  // Test 16: Invalid target with null originalTarget still works
  it("shows toast for invalid_target_blocked with null target", () => {
    const cooldowns = new Map<string, number>()

    maybeShowRoutingPolicyToast(
      cooldowns,
      {},
      "ses-null-target",
      makeResult({
        userVisibleRoutingDecisions: [makeInvalidTargetBlocked({ originalTarget: null })],
      }),
    )

    expect(mockShowHecateqToastSafe).toHaveBeenCalledTimes(1)
  })
})

// ── Static / structural verification tests ──

const SRC_ROOT = join(import.meta.dir, "..", "..")

describe("static checks — routing policy toast", () => {
  // Test 17: Runtime consumer remains TUI-free
  it("runtime-delegation-consumer.ts remains TUI-free", () => {
    const consumerPath = join(
      SRC_ROOT,
      "features",
      "hecateq-orchestration",
      "runtime-delegation-consumer.ts",
    )
    const content = readFileSync(consumerPath, "utf-8")

    const forbidden = [
      "showHecateqToastSafe",
      "hecateq-toast",
      "notification-toast",
    ]

    for (const pattern of forbidden) {
      expect(content).not.toContain(pattern)
    }
  })

  // Test 18: routing-policy-engine.ts is TUI-free
  it("routing-policy-engine.ts remains TUI-free", () => {
    const enginePath = join(
      SRC_ROOT,
      "features",
      "hecateq-orchestration",
      "routing-policy-engine.ts",
    )
    const content = readFileSync(enginePath, "utf-8")

    const forbidden = [
      "showHecateqToastSafe",
      "hecateq-toast",
      "notification-toast",
    ]

    for (const pattern of forbidden) {
      expect(content).not.toContain(pattern)
    }
  })

  // Test 19: delegation-controller.ts is TUI-free
  it("delegation-controller.ts remains TUI-free", () => {
    const controllerPath = join(
      SRC_ROOT,
      "features",
      "hecateq-orchestration",
      "delegation-controller.ts",
    )
    const content = readFileSync(controllerPath, "utf-8")

    const forbidden = [
      "showHecateqToastSafe",
      "hecateq-toast",
      "notification-toast",
    ]

    for (const pattern of forbidden) {
      expect(content).not.toContain(pattern)
    }
  })

  // Test 20: delegation-executor.ts is TUI-free
  it("delegation-executor.ts remains TUI-free", () => {
    const executorPath = join(
      SRC_ROOT,
      "features",
      "hecateq-orchestration",
      "delegation-executor.ts",
    )
    const content = readFileSync(executorPath, "utf-8")

    const forbidden = [
      "showHecateqToastSafe",
      "hecateq-toast",
      "notification-toast",
    ]

    for (const pattern of forbidden) {
      expect(content).not.toContain(pattern)
    }
  })

  // Test 21: Hook catch block does not call maybeShowRoutingPolicyToast or showHecateqToastSafe
  it("consumer reject preserves log-only catch, no routing policy toast", () => {
    const hookPath = join(
      SRC_ROOT,
      "hooks",
      "hecateq-project-context-injector",
      "index.ts",
    )
    const content = readFileSync(hookPath, "utf-8")

    const consumeIdx = content.indexOf("consumeDelegationsAtRuntime({")
    expect(consumeIdx).toBeGreaterThan(0)

    const afterConsume = content.slice(consumeIdx)
    const catchIdx = afterConsume.indexOf(".catch((err) => {")
    expect(catchIdx).toBeGreaterThan(0)

    const catchBlockStart = afterConsume.slice(catchIdx)
    const catchBlockSlice = catchBlockStart.slice(0, 500)

    expect(catchBlockSlice).not.toContain("maybeShowRoutingPolicyToast")
    expect(catchBlockSlice).not.toContain("showHecateqToastSafe")
    expect(catchBlockSlice).toContain("Delegation consumption failed")
  })
})
