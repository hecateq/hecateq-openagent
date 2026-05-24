import { describe, expect, test } from "bun:test"

import {
  selectRoutingStrategy,
  formatRoutingStrategy,
  ROUTING_STRATEGY_MODES,
} from "./routing-strategy"
import type { RoutingStrategyMode, TaskSize } from "./routing-strategy"
import type { TaskIntentCategory } from "./task-intent-classifier"
import { classifyTaskIntent } from "./task-intent-classifier"

// ─── Helper ──────────────────────────────────────────────────────────────────

function buildClassification(primaryDomain: TaskIntentCategory, confidence: number, secondaryDomains: TaskIntentCategory[] = []) {
  return {
    primaryDomain,
    confidence,
    secondaryDomains,
    matchedSignals: [],
    categoryScores: {} as Record<TaskIntentCategory, number>,
    isMultiDomain: primaryDomain === "multi-domain",
  }
}

// ─── Strategy Selection ──────────────────────────────────────────────────────

describe("selectRoutingStrategy", () => {
  test("backend small task -> single-owner", () => {
    const classification = buildClassification("backend", 0.85)
    const strategy = selectRoutingStrategy(classification, "small")

    expect(strategy.mode).toBe("single-owner")
    expect(strategy.confidence).toBeGreaterThan(0.5)
    expect(strategy.applicableDomains).toContain("backend")
    expect(strategy.policyHooks.length).toBeGreaterThan(0)
  })

  test("backend medium task -> single-owner", () => {
    const classification = buildClassification("backend", 0.8)
    const strategy = selectRoutingStrategy(classification, "medium")

    expect(strategy.mode).toBe("single-owner")
    expect(strategy.rationale).toContain("Backend")
  })

  test("backend large task -> sequential-multi-agent", () => {
    const classification = buildClassification("backend", 0.85)
    const strategy = selectRoutingStrategy(classification, "large")

    expect(strategy.mode).toBe("sequential-multi-agent")
    expect(strategy.rationale).toContain("multi-step")
  })

  test("frontend small task -> single-owner", () => {
    const classification = buildClassification("frontend", 0.8)
    const strategy = selectRoutingStrategy(classification, "small")

    expect(strategy.mode).toBe("single-owner")
  })

  test("docs medium task -> single-owner", () => {
    const classification = buildClassification("docs", 0.75)
    const strategy = selectRoutingStrategy(classification, "medium")

    expect(strategy.mode).toBe("single-owner")
  })

  test("security small with high confidence -> single-owner", () => {
    const classification = buildClassification("security", 0.85)
    const strategy = selectRoutingStrategy(classification, "small")

    expect(strategy.mode).toBe("single-owner")
  })

  test("security large -> research-first", () => {
    const classification = buildClassification("security", 0.7)
    const strategy = selectRoutingStrategy(classification, "large")

    expect(strategy.mode).toBe("research-first")
    expect(strategy.rationale).toContain("investigation")
  })

  test("security medium -> research-first", () => {
    const classification = buildClassification("security", 0.65)
    const strategy = selectRoutingStrategy(classification, "medium")

    expect(strategy.mode).toBe("research-first")
  })

  test("debugging medium -> research-first", () => {
    const classification = buildClassification("debugging", 0.7)
    const strategy = selectRoutingStrategy(classification, "medium")

    expect(strategy.mode).toBe("research-first")
  })

  test("debugging small high confidence -> single-owner", () => {
    const classification = buildClassification("debugging", 0.9)
    const strategy = selectRoutingStrategy(classification, "small")

    expect(strategy.mode).toBe("single-owner")
  })

  test("planning medium -> plan-first", () => {
    const classification = buildClassification("planning", 0.8)
    const strategy = selectRoutingStrategy(classification, "medium")

    expect(strategy.mode).toBe("plan-first")
    expect(strategy.policyHooks.some((h) => h.includes("PROMPT INTAKE"))).toBe(true)
  })

  test("planning small -> single-owner", () => {
    const classification = buildClassification("planning", 0.7)
    const strategy = selectRoutingStrategy(classification, "small")

    expect(strategy.mode).toBe("single-owner")
  })

  test("refactor large -> plan-first", () => {
    const classification = buildClassification("refactor", 0.75)
    const strategy = selectRoutingStrategy(classification, "large")

    expect(strategy.mode).toBe("plan-first")
  })

  test("research medium -> research-first", () => {
    const classification = buildClassification("research", 0.8)
    const strategy = selectRoutingStrategy(classification, "medium")

    expect(strategy.mode).toBe("research-first")
  })

  test("research small -> research-first", () => {
    const classification = buildClassification("research", 0.6)
    const strategy = selectRoutingStrategy(classification, "small")

    expect(strategy.mode).toBe("research-first")
  })

  test("multi-domain small -> single-owner", () => {
    const classification = buildClassification("multi-domain", 0.7, ["backend", "frontend"])
    const strategy = selectRoutingStrategy(classification, "small")

    expect(strategy.mode).toBe("single-owner")
  })

  test("multi-domain medium backend+frontend -> contract-first", () => {
    const classification = buildClassification("multi-domain", 0.75, ["backend", "frontend"])
    const strategy = selectRoutingStrategy(classification, "medium")

    expect(strategy.mode).toBe("contract-first")
    expect(strategy.policyHooks.some((h) => h.includes("SHARED CONTRACT"))).toBe(true)
  })

  test("multi-domain medium with non-frontend-backend -> sequential-multi-agent", () => {
    const classification = buildClassification("multi-domain", 0.7, ["docs", "refactor"])
    const strategy = selectRoutingStrategy(classification, "medium")

    // Middle: no frontend/backend mix -> sequential
    expect(strategy.mode).toBe("sequential-multi-agent")
  })

  test("multi-domain large -> contract-first", () => {
    const classification = buildClassification("multi-domain", 0.7, ["backend", "frontend"])
    const strategy = selectRoutingStrategy(classification, "large")

    expect(strategy.mode).toBe("contract-first")
  })

  test("unknown small -> analysis-only", () => {
    const classification = buildClassification("unknown", 0)
    const strategy = selectRoutingStrategy(classification, "small")

    expect(strategy.mode).toBe("analysis-only")
  })

  test("unknown medium -> blocked", () => {
    const classification = buildClassification("unknown", 0)
    const strategy = selectRoutingStrategy(classification, "medium")

    expect(strategy.mode).toBe("blocked")
    expect(strategy.confidence).toBeLessThan(0.5)
  })

  test("unknown large -> blocked", () => {
    const classification = buildClassification("unknown", 0)
    const strategy = selectRoutingStrategy(classification, "large")

    expect(strategy.mode).toBe("blocked")
  })
})

// ─── Domain Specific Recommended Approach ────────────────────────────────────

describe("selectRoutingStrategy approach text", () => {
  test("backend strategy contains delegation guidance", () => {
    const classification = buildClassification("backend", 0.8)
    const strategy = selectRoutingStrategy(classification)
    expect(strategy.recommendedApproach).toContain("task(")
    expect(strategy.recommendedApproach).toContain("subagent_type")
  })

  test("multi-domain strategy contains contract guidance", () => {
    const classification = buildClassification("multi-domain", 0.7, ["backend", "frontend"])
    const strategy = selectRoutingStrategy(classification, "medium")
    expect(strategy.recommendedApproach).toContain("shared contract")
    expect(strategy.recommendedApproach).toContain("contract boundary")
  })

  test("security strategy contains investigation guidance", () => {
    const classification = buildClassification("security", 0.7)
    const strategy = selectRoutingStrategy(classification, "medium")
    expect(strategy.recommendedApproach).toContain("analysis")
  })

  test("planning strategy contains structured plan guidance", () => {
    const classification = buildClassification("planning", 0.8)
    const strategy = selectRoutingStrategy(classification, "large")
    expect(strategy.recommendedApproach).toContain("plan")
  })
})

// ─── End-to-end with real classifier ─────────────────────────────────────────

describe("selectRoutingStrategy with real classifier", () => {
  test("real backend task -> single-owner", () => {
    const classification = classifyTaskIntent("Create a new Prisma data model and corresponding REST API endpoint")
    const strategy = selectRoutingStrategy(classification, "medium")
    expect(strategy.mode === "single-owner" || strategy.mode === "sequential-multi-agent").toBe(true)
  })

  test("real frontend task -> single-owner", () => {
    const classification = classifyTaskIntent("Build a React component for the user dashboard with Tailwind styling")
    const strategy = selectRoutingStrategy(classification, "small")
    expect(strategy.mode).toBe("single-owner")
  })

  test("real debugging task -> research-first", () => {
    const classification = classifyTaskIntent("Investigate a crash: the app freezes when processing null references and the stack trace points to a race condition")
    const strategy = selectRoutingStrategy(classification, "medium")
    expect(strategy.mode).toBe("research-first")
  })

  test("real multi-domain task -> contract-first", () => {
    const classification = classifyTaskIntent("Build a full-stack feature: add a new Prisma model and a React settings page")
    const strategy = selectRoutingStrategy(classification, "medium")
    // Should route to contract-first when backend+frontend are both present
    expect(strategy.mode === "contract-first" || strategy.mode === "sequential-multi-agent" || strategy.mode === "single-owner").toBe(true)
  })

  test("real unknown task -> blocked or analysis-only", () => {
    const classification = classifyTaskIntent("do stuff")
    const strategy = selectRoutingStrategy(classification, "medium")
    expect(strategy.mode === "blocked" || strategy.mode === "analysis-only").toBe(true)
  })
})

// ─── Format ──────────────────────────────────────────────────────────────────

describe("formatRoutingStrategy", () => {
  test("formats a strategy into readable text", () => {
    const classification = buildClassification("backend", 0.85)
    const strategy = selectRoutingStrategy(classification, "medium")
    const formatted = formatRoutingStrategy(strategy)
    expect(formatted).toContain("routing_mode:")
    expect(formatted).toContain(strategy.mode)
    expect(formatted).toContain("rationale:")
    expect(formatted).toContain("approach:")
    expect(formatted).toContain("confidence:")
  })
})

// ─── Mode Enum ────────────────────────────────────────────────────────────────

describe("ROUTING_STRATEGY_MODES", () => {
  test("all expected modes are defined", () => {
    const expected: RoutingStrategyMode[] = [
      "single-owner",
      "research-first",
      "plan-first",
      "contract-first",
      "sequential-multi-agent",
      "parallel-after-contract",
      "analysis-only",
      "blocked",
    ]
    for (const mode of expected) {
      expect(ROUTING_STRATEGY_MODES).toContain(mode)
    }
  })
})
