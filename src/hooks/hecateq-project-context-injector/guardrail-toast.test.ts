import { readFileSync } from "node:fs"
import { join } from "node:path"
import { beforeAll, beforeEach, describe, expect, it, mock } from "bun:test"
import type { ConsumeDelegationsResult } from "../../features/hecateq-orchestration"
import type { HecateqGuardrailBlockDetail } from "../../features/hecateq-orchestration/types"

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

function makeGuardrailBlock(kind: HecateqGuardrailBlockDetail["kind"], overrides: Partial<HecateqGuardrailBlockDetail> = {}): HecateqGuardrailBlockDetail {
  const base: HecateqGuardrailBlockDetail = {
    kind,
    message: `Guardrail block: ${kind}`,
    sourceTaskId: "task-1",
    targetAgent: "hephaestus",
  }
  return { ...base, ...overrides }
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

describe("maybeShowGuardrailToast", () => {
  let maybeShowGuardrailToast: typeof import("./index").maybeShowGuardrailToast

  beforeAll(async () => {
    const mod = await hookModulePromise
    maybeShowGuardrailToast = mod.maybeShowGuardrailToast
  })

  beforeEach(() => {
    mockShowHecateqToastSafe.mockReset()
    mockShowHecateqToastSafe.mockResolvedValue(true)
  })

  // Test 1: cycle_detected -> one Hecateq runtime error toast
  it("shows error toast for cycle_detected", () => {
    const cooldowns = new Map<string, number>()

    maybeShowGuardrailToast(
      cooldowns,
      {},
      "ses-abc",
      makeResult({
        userVisibleGuardrailBlocks: [makeGuardrailBlock("cycle_detected", { message: "N-hop cycle detected: a -> b -> a" })],
      }),
    )

    expect(mockShowHecateqToastSafe).toHaveBeenCalledTimes(1)
    const call = mockShowHecateqToastSafe.mock.calls[0] as Array<unknown>
    expect(call[1]).toMatchObject({
      kind: "runtime",
      title: "Delegation cycle blocked",
      variant: "error",
      duration: 7000,
    })
  })

  // Test 2: max_routing_depth -> one Hecateq runtime warning toast
  it("shows warning toast for max_routing_depth", () => {
    const cooldowns = new Map<string, number>()

    maybeShowGuardrailToast(
      cooldowns,
      {},
      "ses-def",
      makeResult({
        userVisibleGuardrailBlocks: [makeGuardrailBlock("max_routing_depth")],
      }),
    )

    expect(mockShowHecateqToastSafe).toHaveBeenCalledTimes(1)
    const call = mockShowHecateqToastSafe.mock.calls[0] as Array<unknown>
    expect(call[1]).toMatchObject({
      kind: "runtime",
      title: "Routing depth limit reached",
      variant: "warning",
      duration: 7000,
    })
  })

  // Test 3: max_fanout -> warning toast
  it("shows warning toast for max_fanout", () => {
    const cooldowns = new Map<string, number>()

    maybeShowGuardrailToast(
      cooldowns,
      {},
      "ses-ghi",
      makeResult({
        userVisibleGuardrailBlocks: [makeGuardrailBlock("max_fanout")],
      }),
    )

    expect(mockShowHecateqToastSafe).toHaveBeenCalledTimes(1)
    const call = mockShowHecateqToastSafe.mock.calls[0] as Array<unknown>
    expect(call[1]).toMatchObject({
      kind: "runtime",
      title: "Delegation fan-out limit reached",
      variant: "warning",
    })
  })

  // Test 4: blocked_source_task -> warning toast
  it("shows warning toast for blocked_source_task", () => {
    const cooldowns = new Map<string, number>()

    maybeShowGuardrailToast(
      cooldowns,
      {},
      "ses-jkl",
      makeResult({
        userVisibleGuardrailBlocks: [makeGuardrailBlock("blocked_source_task")],
      }),
    )

    expect(mockShowHecateqToastSafe).toHaveBeenCalledTimes(1)
    const call = mockShowHecateqToastSafe.mock.calls[0] as Array<unknown>
    expect(call[1]).toMatchObject({
      kind: "runtime",
      title: "Delegation blocked by source task",
      variant: "warning",
    })
  })

  // Test 5: unknown_target -> error toast
  it("shows error toast for unknown_target", () => {
    const cooldowns = new Map<string, number>()

    maybeShowGuardrailToast(
      cooldowns,
      {},
      "ses-mno",
      makeResult({
        userVisibleGuardrailBlocks: [makeGuardrailBlock("unknown_target")],
      }),
    )

    expect(mockShowHecateqToastSafe).toHaveBeenCalledTimes(1)
    const call = mockShowHecateqToastSafe.mock.calls[0] as Array<unknown>
    expect(call[1]).toMatchObject({
      kind: "runtime",
      title: "Delegation target unavailable",
      variant: "error",
    })
  })

  // Test 6: dedup_skipped -> no toast
  it("shows no toast for dedup_skipped", () => {
    const cooldowns = new Map<string, number>()

    maybeShowGuardrailToast(
      cooldowns,
      {},
      "ses-dedup",
      makeResult({
        userVisibleGuardrailBlocks: [makeGuardrailBlock("dedup_skipped")],
      }),
    )

    expect(mockShowHecateqToastSafe).not.toHaveBeenCalled()
  })

  // Test 7: Multiple guardrail blocks -> priority order chooses one (cycle_detected over max_routing_depth)
  it("prioritizes cycle_detected over max_routing_depth when both present", () => {
    const cooldowns = new Map<string, number>()

    maybeShowGuardrailToast(
      cooldowns,
      {},
      "ses-prio",
      makeResult({
        userVisibleGuardrailBlocks: [
          makeGuardrailBlock("max_routing_depth"),
          makeGuardrailBlock("cycle_detected"),
        ],
      }),
    )

    expect(mockShowHecateqToastSafe).toHaveBeenCalledTimes(1)
    const call = mockShowHecateqToastSafe.mock.calls[0] as Array<unknown>
    expect(call[1]).toMatchObject({
      title: "Delegation cycle blocked",
    })
  })

  // Test 8: Same session/kind/target within 30s -> only one toast
  it("deduplicates same session + kind + target within cooldown", () => {
    const cooldowns = new Map<string, number>()

    maybeShowGuardrailToast(
      cooldowns,
      {},
      "ses-xyz",
      makeResult({
        userVisibleGuardrailBlocks: [makeGuardrailBlock("cycle_detected")],
      }),
    )
    expect(mockShowHecateqToastSafe).toHaveBeenCalledTimes(1)

    maybeShowGuardrailToast(
      cooldowns,
      {},
      "ses-xyz",
      makeResult({
        userVisibleGuardrailBlocks: [makeGuardrailBlock("cycle_detected")],
      }),
    )
    expect(mockShowHecateqToastSafe).toHaveBeenCalledTimes(1)
  })

  // Test 9: Different targets get separate toasts within cooldown
  it("allows different targets for same kind within cooldown", () => {
    const cooldowns = new Map<string, number>()

    maybeShowGuardrailToast(
      cooldowns,
      {},
      "ses-multi",
      makeResult({
        userVisibleGuardrailBlocks: [makeGuardrailBlock("max_routing_depth", { targetAgent: "hephaestus" })],
      }),
    )
    expect(mockShowHecateqToastSafe).toHaveBeenCalledTimes(1)

    maybeShowGuardrailToast(
      cooldowns,
      {},
      "ses-multi",
      makeResult({
        userVisibleGuardrailBlocks: [makeGuardrailBlock("max_routing_depth", { targetAgent: "sisyphus" })],
      }),
    )
    expect(mockShowHecateqToastSafe).toHaveBeenCalledTimes(2)
  })

  // Test 10: No-TUI -> does not throw
  it("does not throw when showHecateqToastSafe returns false (no TUI)", () => {
    mockShowHecateqToastSafe.mockResolvedValue(false)
    const cooldowns = new Map<string, number>()

    expect(() => {
      maybeShowGuardrailToast(
        cooldowns,
        null,
        "ses-no-tui",
        makeResult({
          userVisibleGuardrailBlocks: [makeGuardrailBlock("cycle_detected")],
        }),
      )
    }).not.toThrow()
  })

  // Test 11: Fire-and-forget reject does not throw
  it("does not throw when showHecateqToastSafe rejects (fire-and-forget)", () => {
    mockShowHecateqToastSafe.mockRejectedValue(new Error("TUI unavailable"))
    const cooldowns = new Map<string, number>()

    expect(() => {
      maybeShowGuardrailToast(
        cooldowns,
        {},
        "ses-reject",
        makeResult({
          userVisibleGuardrailBlocks: [makeGuardrailBlock("max_routing_depth")],
        }),
      )
    }).not.toThrow()
  })

  // Test 12: Empty sessionID fallback
  it("handles empty sessionID by falling back to unknown-session", () => {
    const cooldowns = new Map<string, number>()

    expect(() => {
      maybeShowGuardrailToast(
        cooldowns,
        {},
        "",
        makeResult({
          userVisibleGuardrailBlocks: [makeGuardrailBlock("cycle_detected")],
        }),
      )
    }).not.toThrow()

    expect(mockShowHecateqToastSafe).toHaveBeenCalledTimes(1)
  })

  // Test 13: Empty blocks -> no toast
  it("shows no toast when userVisibleGuardrailBlocks is empty", () => {
    const cooldowns = new Map<string, number>()

    maybeShowGuardrailToast(cooldowns, {}, "ses-empty", makeResult())

    expect(mockShowHecateqToastSafe).not.toHaveBeenCalled()
  })

  // Test 14: non_consumable_pending_delegation -> warning toast
  it("shows warning toast for non_consumable_pending_delegation", () => {
    const cooldowns = new Map<string, number>()

    maybeShowGuardrailToast(
      cooldowns,
      {},
      "ses-noncons",
      makeResult({
        userVisibleGuardrailBlocks: [makeGuardrailBlock("non_consumable_pending_delegation")],
      }),
    )

    expect(mockShowHecateqToastSafe).toHaveBeenCalledTimes(1)
    const call = mockShowHecateqToastSafe.mock.calls[0] as Array<unknown>
    expect(call[1]).toMatchObject({
      kind: "runtime",
      title: "Pending delegation was not consumable",
      variant: "warning",
    })
  })

  // Test 15: unknown blocks with non-critical messages -> no toast
  it("skips unknown kind with non-critical message", () => {
    const cooldowns = new Map<string, number>()

    maybeShowGuardrailToast(
      cooldowns,
      {},
      "ses-unknown",
      makeResult({
        userVisibleGuardrailBlocks: [makeGuardrailBlock("unknown", { message: "just a warning" })],
      }),
    )

    expect(mockShowHecateqToastSafe).not.toHaveBeenCalled()
  })

  // Test 16: unknown blocks with critical message -> shows toast
  it("shows toast for unknown kind with critical message", () => {
    const cooldowns = new Map<string, number>()

    maybeShowGuardrailToast(
      cooldowns,
      {},
      "ses-critical",
      makeResult({
        userVisibleGuardrailBlocks: [makeGuardrailBlock("unknown", { message: "Consumption failed: unable to consume delegation" })],
      }),
    )

    expect(mockShowHecateqToastSafe).toHaveBeenCalledTimes(1)
    const call = mockShowHecateqToastSafe.mock.calls[0] as Array<unknown>
    expect(call[1]).toMatchObject({
      kind: "runtime",
      title: "Delegation guardrail blocked",
      variant: "warning",
    })
  })
})

// ── Static / structural verification tests ──

const SRC_ROOT = join(import.meta.dir, "..", "..")

describe("static checks — guardrail toast", () => {
  const FORBIDDEN_TUI = [
    "showHecateqToastSafe",
    "hecateq-toast",
    "notification-toast",
  ]

  function assertTuiFree(filePath: string): void {
    const content = readFileSync(filePath, "utf-8")
    for (const pattern of FORBIDDEN_TUI) {
      expect(content).not.toContain(pattern)
    }
  }

  // Test 17: Runtime consumer TUI-free
  it("runtime-delegation-consumer.ts remains TUI-free", () => {
    assertTuiFree(join(SRC_ROOT, "features", "hecateq-orchestration", "runtime-delegation-consumer.ts"))
  })

  // Test 18: routing-policy-engine.ts TUI-free
  it("routing-policy-engine.ts remains TUI-free", () => {
    assertTuiFree(join(SRC_ROOT, "features", "hecateq-orchestration", "routing-policy-engine.ts"))
  })

  // Test 19: delegation-controller.ts TUI-free
  it("delegation-controller.ts remains TUI-free", () => {
    assertTuiFree(join(SRC_ROOT, "features", "hecateq-orchestration", "delegation-controller.ts"))
  })

  // Test 20: delegation-executor.ts TUI-free
  it("delegation-executor.ts remains TUI-free", () => {
    assertTuiFree(join(SRC_ROOT, "features", "hecateq-orchestration", "delegation-executor.ts"))
  })

  // Test 21: types.ts TUI-free
  it("types.ts remains TUI-free", () => {
    assertTuiFree(join(SRC_ROOT, "features", "hecateq-orchestration", "types.ts"))
  })

  // Test 22: cycle-detector.ts TUI-free
  it("cycle-detector.ts remains TUI-free", () => {
    assertTuiFree(join(SRC_ROOT, "features", "hecateq-orchestration", "cycle-detector.ts"))
  })

  // Test 23: Hook catch block does not call maybeShowGuardrailToast or showHecateqToastSafe
  it("consumer reject preserves log-only catch, no guardrail toast", () => {
    const hookPath = join(SRC_ROOT, "hooks", "hecateq-project-context-injector", "index.ts")
    const content = readFileSync(hookPath, "utf-8")

    const consumeIdx = content.indexOf("consumeDelegationsAtRuntime({")
    expect(consumeIdx).toBeGreaterThan(0)

    const afterConsume = content.slice(consumeIdx)
    const catchIdx = afterConsume.indexOf(".catch((err) => {")
    expect(catchIdx).toBeGreaterThan(0)

    const catchBlockStart = afterConsume.slice(catchIdx)
    const catchBlockSlice = catchBlockStart.slice(0, 500)

    expect(catchBlockSlice).not.toContain("maybeShowGuardrailToast")
    expect(catchBlockSlice).not.toContain("showHecateqToastSafe")
    expect(catchBlockSlice).toContain("Delegation consumption failed")
  })
})
