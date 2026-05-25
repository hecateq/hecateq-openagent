import { describe, expect, test } from "bun:test"

import { DelegationCycleDetector, SignalDagTriggerTracker } from "./cycle-detector"

describe("DelegationCycleDetector — N-hop graph-based", () => {
  test("allows first delegation in chain", () => {
    const detector = new DelegationCycleDetector()
    const result = detector.wouldCreateCycle("sisyphus", "database-specialist")
    expect(result.cycle).toBe(false)
  })

  // ── 2-hop cycles ──────────────────────────────────────────────────────

  test("blocks reverse pair A→B after B→A was recorded", () => {
    const detector = new DelegationCycleDetector()
    detector.recordDelegation("database-specialist", "oracle")

    const result = detector.wouldCreateCycle("oracle", "database-specialist")
    expect(result.cycle).toBe(true)
    expect(result.reason).toContain("N-hop cycle")
    expect(result.reason).toContain("oracle")
    expect(result.reason).toContain("database-specialist")
  })

  // ── 3-hop cycles ──────────────────────────────────────────────────────

  test("blocks 3-hop A→B→C→A cycle", () => {
    const detector = new DelegationCycleDetector()
    detector.recordDelegation("sisyphus", "database-specialist")
    detector.recordDelegation("database-specialist", "security-architect")

    const result = detector.wouldCreateCycle("security-architect", "sisyphus")
    expect(result.cycle).toBe(true)
    expect(result.reason).toContain("N-hop cycle")
  })

  test("blocks 3-hop A→B→C→A with different order", () => {
    const detector = new DelegationCycleDetector()
    detector.recordDelegation("oracle", "qa-engineer")
    detector.recordDelegation("qa-engineer", "backend-dev")

    const result = detector.wouldCreateCycle("backend-dev", "oracle")
    expect(result.cycle).toBe(true)
  })

  // ── 4-hop cycles ──────────────────────────────────────────────────────

  test("blocks 4-hop A→B→C→D→A cycle", () => {
    const detector = new DelegationCycleDetector()
    detector.recordDelegation("sisyphus", "database-specialist")
    detector.recordDelegation("database-specialist", "security-architect")
    detector.recordDelegation("security-architect", "qa-test-engineer")

    const result = detector.wouldCreateCycle("qa-test-engineer", "sisyphus")
    expect(result.cycle).toBe(true)
  })

  // ── Node-revisit cycles ───────────────────────────────────────────────

  test("blocks A→B→C→D→B (revisiting B)", () => {
    const detector = new DelegationCycleDetector()
    detector.recordDelegation("sisyphus", "database-specialist")
    detector.recordDelegation("database-specialist", "security-architect")
    detector.recordDelegation("security-architect", "qa-test-engineer")

    const result = detector.wouldCreateCycle("qa-test-engineer", "database-specialist")
    expect(result.cycle).toBe(true)
    expect(result.reason).toContain("N-hop cycle")
  })

  // ── Self-loops ────────────────────────────────────────────────────────

  test("blocks self-loop A→A", () => {
    const detector = new DelegationCycleDetector()
    const result = detector.wouldCreateCycle("oracle", "oracle")
    expect(result.cycle).toBe(true)
    expect(result.reason).toContain("Self-loop")
  })

  // ── Legitimate chains ─────────────────────────────────────────────────

  test("allows A→B after A→C was recorded (different target)", () => {
    const detector = new DelegationCycleDetector()
    detector.recordDelegation("sisyphus", "database-specialist")

    const result = detector.wouldCreateCycle("sisyphus", "oracle")
    expect(result.cycle).toBe(false)
  })

  test("allows linear A→B→C→D→E chain", () => {
    const detector = new DelegationCycleDetector()
    detector.recordDelegation("sisyphus", "database-specialist")
    detector.recordDelegation("database-specialist", "security-architect")
    detector.recordDelegation("security-architect", "qa-test-engineer")

    expect(detector.getEdgeCount()).toBe(3)

    const result = detector.wouldCreateCycle("qa-test-engineer", "compliance-specialist")
    expect(result.cycle).toBe(false)
  })

  test("allows diamond A→B, A→C structure", () => {
    const detector = new DelegationCycleDetector()
    detector.recordDelegation("sisyphus", "database-specialist")
    detector.recordDelegation("sisyphus", "security-architect")

    const result = detector.wouldCreateCycle("database-specialist", "security-architect")
    expect(result.cycle).toBe(false)
  })

  // ── State management ──────────────────────────────────────────────────

  test("reset clears all edges", () => {
    const detector = new DelegationCycleDetector()
    detector.recordDelegation("a", "b")
    detector.recordDelegation("b", "c")
    expect(detector.getEdgeCount()).toBe(2)

    detector.reset()
    expect(detector.getEdgeCount()).toBe(0)
    expect(detector.wouldCreateCycle("c", "a").cycle).toBe(false)
  })

  test("getEdgeCount returns correct count", () => {
    const detector = new DelegationCycleDetector()
    expect(detector.getEdgeCount()).toBe(0)
    detector.recordDelegation("a", "b")
    expect(detector.getEdgeCount()).toBe(1)
    detector.recordDelegation("b", "c")
    expect(detector.getEdgeCount()).toBe(2)
    detector.recordDelegation("c", "d")
    expect(detector.getEdgeCount()).toBe(3)
  })

  test("getAgentCount returns distinct agent count", () => {
    const detector = new DelegationCycleDetector()
    detector.recordDelegation("a", "b")
    detector.recordDelegation("b", "c")
    detector.recordDelegation("a", "d")
    expect(detector.getAgentCount()).toBe(4)
  })

  // ── Edge cases ────────────────────────────────────────────────────────

  test("empty source or target returns no cycle", () => {
    const detector = new DelegationCycleDetector()
    expect(detector.wouldCreateCycle("", "oracle").cycle).toBe(false)
    expect(detector.wouldCreateCycle("oracle", "").cycle).toBe(false)
  })

  test("recordDelegation with empty values is no-op", () => {
    const detector = new DelegationCycleDetector()
    detector.recordDelegation("", "oracle")
    detector.recordDelegation("oracle", "")
    expect(detector.getEdgeCount()).toBe(0)
  })
})

describe("SignalDagTriggerTracker", () => {
  test("marks and checks triggered tasks", () => {
    const tracker = new SignalDagTriggerTracker()
    expect(tracker.isAlreadyTriggered("task_1")).toBe(false)

    tracker.markTriggered("task_1")
    expect(tracker.isAlreadyTriggered("task_1")).toBe(true)
    expect(tracker.isAlreadyTriggered("task_2")).toBe(false)
  })

  test("tracks trigger count", () => {
    const tracker = new SignalDagTriggerTracker()
    expect(tracker.getTriggeredCount()).toBe(0)

    tracker.markTriggered("t1")
    tracker.markTriggered("t2")
    expect(tracker.getTriggeredCount()).toBe(2)

    tracker.markTriggered("t1")
    expect(tracker.getTriggeredCount()).toBe(2)
  })

  test("reset clears all", () => {
    const tracker = new SignalDagTriggerTracker()
    tracker.markTriggered("t1")
    tracker.markTriggered("t2")
    tracker.reset()
    expect(tracker.getTriggeredCount()).toBe(0)
    expect(tracker.isAlreadyTriggered("t1")).toBe(false)
  })
})
