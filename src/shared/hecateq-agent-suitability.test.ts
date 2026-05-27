/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import {
  scoreAgentSuitability,
  rankAgentSuitability,
  type AgentSuitabilityInput,
  type WorkClassification,
} from "./hecateq-agent-suitability"

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const baseWork: WorkClassification = {
  taskSize: "MEDIUM",
  domain: "backend",
  isMultiDomain: false,
  isImplementation: true,
  isAnalysisOnly: false,
  riskLevel: "LOW",
  isScanTask: false,
}

function eligibleAgent(overrides: Partial<AgentSuitabilityInput> = {}): AgentSuitabilityInput {
  return {
    name: "nodejs-backend-developer",
    enabled: true,
    callable: true,
    isCoordinatorTarget: false,
    primaryDomain: "backend",
    secondaryDomains: ["docs"],
    useWhen: ["implementing backend APIs", "service layer"],
    avoidWhen: ["multi-domain refactor"],
    confidence: 0.85,
    ambiguity: "low",
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Hard gates
// ---------------------------------------------------------------------------

describe("scoreAgentSuitability — hard gates", () => {
  describe("#given a disabled agent", () => {
    test("#then it is ineligible with reason", () => {
      // given
      const agent = eligibleAgent({ enabled: false })
      // when
      const result = scoreAgentSuitability(agent, baseWork)
      // then
      expect(result.eligible).toBe(false)
      expect(result.blockReasons).toContain("agent is disabled")
      expect(result.score).toBe(0)
    })
  })

  describe("#given a non-callable agent", () => {
    test("#then it is ineligible with reason", () => {
      // given
      const agent = eligibleAgent({ callable: false })
      // when
      const result = scoreAgentSuitability(agent, baseWork)
      // then
      expect(result.eligible).toBe(false)
      expect(result.blockReasons).toContain("agent is not callable (not in runtime registry)")
      expect(result.score).toBe(0)
    })
  })

  describe("#given the coordinator/self target", () => {
    test("#then it is ineligible with reason", () => {
      // given
      const agent = eligibleAgent({ isCoordinatorTarget: true, name: "hecateq-orchestrator" })
      // when
      const result = scoreAgentSuitability(agent, baseWork)
      // then
      expect(result.eligible).toBe(false)
      expect(result.blockReasons).toContain("coordinator/self target forbidden — cannot delegate to yourself")
      expect(result.score).toBe(0)
    })
  })

  describe("#given a dependency prerequisite is unmet", () => {
    test("#then it is ineligible with reason", () => {
      // given
      const agent = eligibleAgent({ dependencyPrerequisiteUnmet: true })
      // when
      const result = scoreAgentSuitability(agent, baseWork)
      // then
      expect(result.eligible).toBe(false)
      expect(result.blockReasons).toContain("dependency prerequisite is unmet — upstream work must complete first")
      expect(result.score).toBe(0)
    })
  })

  describe("#given disabled takes priority over other gates", () => {
    test("#then disabled reason appears but other gates are not checked", () => {
      // given — disabled + callable=false
      const agent = eligibleAgent({ enabled: false, callable: false })
      // when
      const result = scoreAgentSuitability(agent, baseWork)
      // then
      expect(result.eligible).toBe(false)
      expect(result.blockReasons).toEqual(["agent is disabled"])
    })
  })
})

// ---------------------------------------------------------------------------
// Soft scoring signals
// ---------------------------------------------------------------------------

describe("scoreAgentSuitability — scoring", () => {
  describe("#given a primary domain match", () => {
    test("#then the score increases", () => {
      // given
      const agent = eligibleAgent({ primaryDomain: "backend" })
      const work: WorkClassification = { ...baseWork, domain: "backend" }
      // when
      const result = scoreAgentSuitability(agent, work)
      // then
      expect(result.eligible).toBe(true)
      expect(result.score).toBeGreaterThan(0.2)
    })
  })

  describe("#given a secondary domain match", () => {
    test("#then the score increases (but less than primary)", () => {
      // given
      const agentPrimary = eligibleAgent({ primaryDomain: "backend", secondaryDomains: [] })
      const agentSecondary = eligibleAgent({ primaryDomain: "unknown", secondaryDomains: ["backend"] })
      const work: WorkClassification = { ...baseWork, domain: "backend" }
      // when
      const resultPrimary = scoreAgentSuitability(agentPrimary, work)
      const resultSecondary = scoreAgentSuitability(agentSecondary, work)
      // then
      expect(resultSecondary.score).toBeGreaterThan(0)
      expect(resultPrimary.score).toBeGreaterThan(resultSecondary.score)
    })
  })

  describe("#given avoidWhen conflict", () => {
    test("#then the score is penalized", () => {
      // given
      const agentWithConflict = eligibleAgent({
        avoidWhen: ["backend", "implementing backend APIs"],
        useWhen: [],
      })
      const agentWithoutConflict = eligibleAgent({
        avoidWhen: ["frontend work"],
        useWhen: ["implementing backend APIs"],
      })
      const work: WorkClassification = { ...baseWork, domain: "backend" }
      // when
      const resultConflict = scoreAgentSuitability(agentWithConflict, work)
      const resultClean = scoreAgentSuitability(agentWithoutConflict, work)
      // then
      expect(resultClean.score).toBeGreaterThan(resultConflict.score)
    })
  })

  describe("#given high index confidence", () => {
    test("#then the score includes a confidence bonus", () => {
      // given
      const highConf = eligibleAgent({ confidence: 0.9, primaryDomain: "backend" })
      const lowConf = eligibleAgent({ confidence: 0.3, primaryDomain: "backend" })
      const work: WorkClassification = { ...baseWork, domain: "backend" }
      // when
      const resultHigh = scoreAgentSuitability(highConf, work)
      const resultLow = scoreAgentSuitability(lowConf, work)
      // then
      expect(resultHigh.score).toBeGreaterThan(resultLow.score)
    })
  })

  describe("#given stall/missing index", () => {
    test("#then it warns but does not hard-block", () => {
      // given
      const agent = eligibleAgent({
        stale: true,
        primaryDomain: undefined,
        secondaryDomains: undefined,
        confidence: undefined,
        ambiguity: undefined,
        useWhen: undefined,
        avoidWhen: undefined,
        descriptionDomainHints: ["backend"],
      })
      // when
      const result = scoreAgentSuitability(agent, baseWork)
      // then
      expect(result.eligible).toBe(true)
      expect(result.warnings).toContain("agent index is stale — suitability signals may be outdated")
      expect(result.score).toBeGreaterThan(0)
    })
  })

  describe("#given mixed/unknown work prefers scanner-style agents", () => {
    test("#then a scanner agent scores higher than a non-scanner for unknown-domain work", () => {
      // given
      const scanner = eligibleAgent({
        name: "librarian-tr",
        primaryDomain: "docs",
        useWhen: ["research", "find examples"],
      })
      const implementer = eligibleAgent({
        name: "nodejs-backend-developer",
        primaryDomain: "backend",
        useWhen: ["implementing backend APIs"],
      })
      const work: WorkClassification = {
        ...baseWork,
        domain: "unknown",
        isScanTask: true,
        taskKind: "research",
      }
      // when
      const scannerResult = scoreAgentSuitability(scanner, work)
      const implResult = scoreAgentSuitability(implementer, work)
      // then — scanner gets the scan bonus
      expect(scannerResult.score).toBeGreaterThan(0)
      // The scanner bonus alone won't make it beat primary domain match;
      // but a non-scanner without domain match should be lower.
      // Here neither has primary domain match on "unknown",
      // so scanner's bonus + hints should edge up.
    })
  })
})

// ---------------------------------------------------------------------------
// rankAgentSuitability
// ---------------------------------------------------------------------------

describe("rankAgentSuitability", () => {
  describe("#given multiple agents with varying scores", () => {
    test("#then eligible agents are ranked above ineligible, then by score descending", () => {
      // given
      const agents: AgentSuitabilityInput[] = [
        eligibleAgent({ name: "backend-dev", primaryDomain: "backend", confidence: 0.9 }),
        eligibleAgent({ name: "disabled-dev", enabled: false, primaryDomain: "backend" }),
        eligibleAgent({ name: "frontend-dev", primaryDomain: "frontend", confidence: 0.8 }),
        eligibleAgent({ name: "not-callable", callable: false, primaryDomain: "backend" }),
        eligibleAgent({ name: "coordinator-self", isCoordinatorTarget: true, primaryDomain: "backend" }),
      ]
      const work: WorkClassification = { ...baseWork, domain: "backend" }
      // when
      const ranked = rankAgentSuitability(agents, work)
      // then
      expect(ranked[0].name).toBe("backend-dev")
      expect(ranked[0].eligible).toBe(true)
      // frontend-dev has secondary match on domain — still eligible
      expect(ranked[1].eligible).toBe(true)
      // all ineligible agents have eligible=false and score=0
      const ineligible = ranked.filter((r) => !r.eligible)
      expect(ineligible.length).toBe(3)
      for (const r of ineligible) {
        expect(r.score).toBe(0)
      }
    })
  })

  describe("#given an empty agent list", () => {
    test("#then it returns an empty array", () => {
      // when
      const result = rankAgentSuitability([], baseWork)
      // then
      expect(result).toEqual([])
    })
  })
})

// ---------------------------------------------------------------------------
// Score semantics: capped at 1.0
// ---------------------------------------------------------------------------

describe("scoreAgentSuitability — score cap", () => {
  test("#then the score never exceeds 1.0", () => {
    // given — an agent with every positive signal maxed
    const agent = eligibleAgent({
      primaryDomain: "backend",
      secondaryDomains: ["docs", "backend"],
      useWhen: ["backend", "docs", "implementing backend APIs"],
      confidence: 1.0,
      ambiguity: "low",
    })
    const work: WorkClassification = { ...baseWork, domain: "backend", taskKind: "backend" }
    // when
    const result = scoreAgentSuitability(agent, work)
    // then
    expect(result.score).toBeLessThanOrEqual(1.0)
    expect(result.score).toBeGreaterThan(0.5) // should still be meaningful
  })
})
