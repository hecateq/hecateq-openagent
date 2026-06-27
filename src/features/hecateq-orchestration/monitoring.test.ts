import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test"

import {
  createOrchestrationMonitor,
  getOrchestrationMonitor,
  _resetOrchestrationMonitorForTesting,
} from "./monitoring"
import type { OrchestrationMonitor, OrchestrationEvent } from "./monitoring"

describe("createOrchestrationMonitor", () => {
  test("returns a new monitor instance with zeroed metrics", () => {
    const monitor = createOrchestrationMonitor()
    const metrics = monitor.getMetrics()

    expect(metrics.delegationsTotal).toBe(0)
    expect(metrics.handoffsTotal).toBe(0)
    expect(metrics.successRate).toBe(1.0)
    expect(metrics.averageRoutingDepth).toBe(0)
    expect(metrics.averageDelegationMs).toBe(0)
    expect(Object.keys(metrics.delegationsByAgent).length).toBe(0)
    expect(metrics.handoffsByAction.continue).toBe(0)
    expect(metrics.handoffsByAction.reroute).toBe(0)
    expect(metrics.handoffsByAction.stop).toBe(0)
    expect(metrics.handoffsByAction.blocked).toBe(0)
    expect(metrics.routingDecisions.exact_agent).toBe(0)
    expect(metrics.routingDecisions.category).toBe(0)
    expect(metrics.routingDecisions.blocked).toBe(0)
  })

  test("returns independent instances", () => {
    const a = createOrchestrationMonitor()
    const b = createOrchestrationMonitor()

    a.recordEvent({ type: "delegation", agent: "oracle" })
    b.recordEvent({ type: "handoff", action: "continue" })

    expect(a.getMetrics().delegationsTotal).toBe(1)
    expect(b.getMetrics().delegationsTotal).toBe(0)
    expect(a.getMetrics().handoffsTotal).toBe(0)
    expect(b.getMetrics().handoffsTotal).toBe(1)
  })
})

describe("recordEvent", () => {
  let monitor: OrchestrationMonitor

  beforeEach(() => {
    monitor = createOrchestrationMonitor()
  })

  // ── delegation events ─────────────────────────────────────────────────

  test("increments delegationsTotal and tracks agent", () => {
    monitor.recordEvent({ type: "delegation", agent: "database-specialist" })
    monitor.recordEvent({ type: "delegation", agent: "security-architect" })
    monitor.recordEvent({ type: "delegation", agent: "database-specialist" })

    const metrics = monitor.getMetrics()
    expect(metrics.delegationsTotal).toBe(3)
    expect(metrics.delegationsByAgent["database-specialist"]).toBe(2)
    expect(metrics.delegationsByAgent["security-architect"]).toBe(1)
  })

  test("delegation without agent still increments total", () => {
    monitor.recordEvent({ type: "delegation" })

    const metrics = monitor.getMetrics()
    expect(metrics.delegationsTotal).toBe(1)
    expect(Object.keys(metrics.delegationsByAgent).length).toBe(0)
  })

  test("tracks delegation duration", () => {
    monitor.recordEvent({ type: "delegation", agent: "oracle", durationMs: 150 })
    monitor.recordEvent({ type: "delegation", agent: "oracle", durationMs: 250 })

    const metrics = monitor.getMetrics()
    expect(metrics.averageDelegationMs).toBe(200)
  })

  test("ignores zero or negative duration", () => {
    monitor.recordEvent({ type: "delegation", agent: "oracle", durationMs: 0 })
    monitor.recordEvent({ type: "delegation", agent: "oracle", durationMs: -10 })

    const metrics = monitor.getMetrics()
    expect(metrics.averageDelegationMs).toBe(0)
  })

  test("tracks routing depth from metadata", () => {
    monitor.recordEvent({ type: "delegation", metadata: { routingDepth: 1 } })
    monitor.recordEvent({ type: "delegation", metadata: { routingDepth: 3 } })
    monitor.recordEvent({ type: "delegation", metadata: { routingDepth: 2 } })

    expect(monitor.getMetrics().averageRoutingDepth).toBe(2)
  })

  test("ignores invalid routing depth values", () => {
    monitor.recordEvent({ type: "delegation", metadata: { routingDepth: -1 } })
    monitor.recordEvent({ type: "delegation", metadata: { routingDepth: "foo" } })
    monitor.recordEvent({ type: "delegation", metadata: { routingDepth: NaN } })

    expect(monitor.getMetrics().averageRoutingDepth).toBe(0)
  })

  // ── handoff events ────────────────────────────────────────────────────

  test("tracks handoffs by action", () => {
    monitor.recordEvent({ type: "handoff", action: "continue" })
    monitor.recordEvent({ type: "handoff", action: "continue" })
    monitor.recordEvent({ type: "handoff", action: "reroute" })
    monitor.recordEvent({ type: "handoff", action: "stop" })
    monitor.recordEvent({ type: "handoff", action: "blocked" })

    const metrics = monitor.getMetrics()
    expect(metrics.handoffsTotal).toBe(5)
    expect(metrics.handoffsByAction.continue).toBe(2)
    expect(metrics.handoffsByAction.reroute).toBe(1)
    expect(metrics.handoffsByAction.stop).toBe(1)
    expect(metrics.handoffsByAction.blocked).toBe(1)
  })

  test("ignores handoff with unknown action", () => {
    monitor.recordEvent({ type: "handoff", action: "some_unknown_action" })

    const metrics = monitor.getMetrics()
    expect(metrics.handoffsTotal).toBe(1)
    expect(metrics.handoffsByAction.continue).toBe(0)
    expect(metrics.handoffsByAction.reroute).toBe(0)
    expect(metrics.handoffsByAction.stop).toBe(0)
    expect(metrics.handoffsByAction.blocked).toBe(0)
  })

  // ── routing events ────────────────────────────────────────────────────

  test("tracks routing decisions", () => {
    monitor.recordEvent({ type: "routing", action: "exact_agent" })
    monitor.recordEvent({ type: "routing", action: "exact_agent" })
    monitor.recordEvent({ type: "routing", action: "category" })
    monitor.recordEvent({ type: "routing", action: "blocked" })

    const metrics = monitor.getMetrics()
    expect(metrics.routingDecisions.exact_agent).toBe(2)
    expect(metrics.routingDecisions.category).toBe(1)
    expect(metrics.routingDecisions.blocked).toBe(1)
  })

  test("ignores routing with unknown decision", () => {
    monitor.recordEvent({ type: "routing", action: "unknown_kind" })

    const metrics = monitor.getMetrics()
    expect(metrics.routingDecisions.exact_agent).toBe(0)
    expect(metrics.routingDecisions.category).toBe(0)
    expect(metrics.routingDecisions.blocked).toBe(0)
  })

  // ── completion / failure events ───────────────────────────────────────

  test("computes success rate from completion and failure events", () => {
    monitor.recordEvent({ type: "completion" })
    monitor.recordEvent({ type: "completion" })
    monitor.recordEvent({ type: "completion" })
    monitor.recordEvent({ type: "failure" })

    expect(monitor.getMetrics().successRate).toBe(0.75)
  })

  test("success rate is 1.0 with no events", () => {
    expect(monitor.getMetrics().successRate).toBe(1.0)
  })

  test("success rate is 0 with only failures", () => {
    monitor.recordEvent({ type: "failure" })
    monitor.recordEvent({ type: "failure" })

    expect(monitor.getMetrics().successRate).toBe(0)
  })
})

describe("getMetrics after multiple event types", () => {
  test("returns consistent snapshot with mixed events", () => {
    const monitor = createOrchestrationMonitor()

    monitor.recordEvent({ type: "delegation", agent: "sisyphus", durationMs: 100, metadata: { routingDepth: 0 } })
    monitor.recordEvent({ type: "delegation", agent: "oracle", durationMs: 200, metadata: { routingDepth: 1 } })
    monitor.recordEvent({ type: "handoff", action: "continue" })
    monitor.recordEvent({ type: "handoff", action: "reroute" })
    monitor.recordEvent({ type: "routing", action: "exact_agent" })
    monitor.recordEvent({ type: "routing", action: "category" })
    monitor.recordEvent({ type: "completion" })
    monitor.recordEvent({ type: "completion" })
    monitor.recordEvent({ type: "failure" })

    const metrics = monitor.getMetrics()
    expect(metrics.delegationsTotal).toBe(2)
    expect(metrics.delegationsByAgent.sisyphus).toBe(1)
    expect(metrics.delegationsByAgent.oracle).toBe(1)
    expect(metrics.handoffsTotal).toBe(2)
    expect(metrics.handoffsByAction.continue).toBe(1)
    expect(metrics.handoffsByAction.reroute).toBe(1)
    expect(metrics.routingDecisions.exact_agent).toBe(1)
    expect(metrics.routingDecisions.category).toBe(1)
    expect(metrics.averageDelegationMs).toBe(150)
    expect(metrics.averageRoutingDepth).toBe(0.5)
    expect(metrics.successRate).toBe(0.6667)
    expect(metrics.startedAt).toBeGreaterThan(0)
    expect(metrics.lastUpdatedAt).toBeGreaterThanOrEqual(metrics.startedAt)
  })
})

describe("reset", () => {
  test("clears all metrics", () => {
    const monitor = createOrchestrationMonitor()

    monitor.recordEvent({ type: "delegation", agent: "oracle" })
    monitor.recordEvent({ type: "handoff", action: "continue" })
    monitor.recordEvent({ type: "routing", action: "exact_agent" })
    monitor.recordEvent({ type: "completion" })
    monitor.recordEvent({ type: "failure" })

    const before = monitor.getMetrics()
    expect(before.delegationsTotal).toBe(1)

    monitor.reset()

    const after = monitor.getMetrics()
    expect(after.delegationsTotal).toBe(0)
    expect(after.handoffsTotal).toBe(0)
    expect(Object.keys(after.delegationsByAgent).length).toBe(0)
    expect(after.handoffsByAction.continue).toBe(0)
    expect(after.routingDecisions.exact_agent).toBe(0)
    expect(after.successRate).toBe(1.0)
    expect(after.averageRoutingDepth).toBe(0)
    expect(after.averageDelegationMs).toBe(0)
  })

  test("reset updates lastUpdatedAt", () => {
    const monitor = createOrchestrationMonitor()
    const originalUpdatedAt = monitor.getMetrics().lastUpdatedAt

    // Record an event, then reset
    monitor.recordEvent({ type: "delegation" })
    monitor.reset()

    expect(monitor.getMetrics().lastUpdatedAt).toBeGreaterThanOrEqual(originalUpdatedAt)
  })
})

describe("logSnapshot", () => {
  test("does not throw when called", () => {
    const monitor = createOrchestrationMonitor()
    monitor.recordEvent({ type: "delegation", agent: "oracle" })
    monitor.recordEvent({ type: "handoff", action: "continue" })

    expect(() => monitor.logSnapshot()).not.toThrow()
  })

  test("does not throw on empty monitor", () => {
    const monitor = createOrchestrationMonitor()
    expect(() => monitor.logSnapshot()).not.toThrow()
  })
})

describe("singleton via getOrchestrationMonitor", () => {
  beforeEach(() => {
    _resetOrchestrationMonitorForTesting()
  })

  test("returns the same instance on repeated calls", () => {
    const a = getOrchestrationMonitor()
    const b = getOrchestrationMonitor()

    expect(a).toBe(b)
  })

  test("singleton accumulates metrics across callers", () => {
    const a = getOrchestrationMonitor()
    a.recordEvent({ type: "delegation", agent: "oracle" })

    const b = getOrchestrationMonitor()
    b.recordEvent({ type: "handoff", action: "continue" })

    const metrics = b.getMetrics()
    expect(metrics.delegationsTotal).toBe(1)
    expect(metrics.handoffsTotal).toBe(1)
  })

  test("_resetOrchestrationMonitorForTesting clears the singleton", () => {
    const a = getOrchestrationMonitor()
    a.recordEvent({ type: "delegation", agent: "oracle" })

    _resetOrchestrationMonitorForTesting()

    const b = getOrchestrationMonitor()
    expect(b.getMetrics().delegationsTotal).toBe(0)
    expect(b).not.toBe(a)
  })
})

// ─── Real-world delegation scenarios ──────────────────────────────────────

describe("real-world delegation scenarios", () => {
  let monitor: OrchestrationMonitor

  beforeEach(() => {
    monitor = createOrchestrationMonitor()
  })

  test("full delegation flow: delegation, handoff continue, completion aggregates metrics correctly", () => {
    // given - a complete delegation lifecycle
    monitor.recordEvent({ type: "delegation", agent: "oracle", durationMs: 150, metadata: { routingDepth: 1 } })
    monitor.recordEvent({ type: "handoff", action: "continue" })
    monitor.recordEvent({ type: "completion" })

    // when
    const metrics = monitor.getMetrics()

    // then - all stages aggregated
    expect(metrics.delegationsTotal).toBe(1)
    expect(metrics.delegationsByAgent.oracle).toBe(1)
    expect(metrics.handoffsTotal).toBe(1)
    expect(metrics.handoffsByAction.continue).toBe(1)
    expect(metrics.averageDelegationMs).toBe(150)
    expect(metrics.averageRoutingDepth).toBe(1)
    expect(metrics.successRate).toBe(1.0)
  })

  test("full delegation flow with retry: failure then retry yields 50 percent success rate", () => {
    // given - delegation fails, retries, succeeds
    monitor.recordEvent({ type: "delegation", agent: "oracle", durationMs: 100 })
    monitor.recordEvent({ type: "failure" })
    monitor.recordEvent({ type: "delegation", agent: "oracle", durationMs: 200 })
    monitor.recordEvent({ type: "completion" })

    // when
    const metrics = monitor.getMetrics()

    // then - 1 success out of 2 attempts
    expect(metrics.delegationsTotal).toBe(2)
    expect(metrics.delegationsByAgent.oracle).toBe(2)
    expect(metrics.averageDelegationMs).toBe(150)
    expect(metrics.successRate).toBe(0.5)
  })

  test("multiple delegations to different agents populate delegationsByAgent with 3 entries", () => {
    // given - three agents delegated
    monitor.recordEvent({ type: "delegation", agent: "oracle" })
    monitor.recordEvent({ type: "delegation", agent: "sisyphus" })
    monitor.recordEvent({ type: "delegation", agent: "hephaestus" })

    // when
    const metrics = monitor.getMetrics()

    // then
    expect(metrics.delegationsTotal).toBe(3)
    expect(Object.keys(metrics.delegationsByAgent).length).toBe(3)
    expect(metrics.delegationsByAgent.oracle).toBe(1)
    expect(metrics.delegationsByAgent.sisyphus).toBe(1)
    expect(metrics.delegationsByAgent.hephaestus).toBe(1)
  })

  test("sequential handoffs: continue, continue, stop yields correct action counts", () => {
    // given - three handoffs with mixed actions
    monitor.recordEvent({ type: "handoff", action: "continue" })
    monitor.recordEvent({ type: "handoff", action: "continue" })
    monitor.recordEvent({ type: "handoff", action: "stop" })

    // when
    const metrics = monitor.getMetrics()

    // then
    expect(metrics.handoffsTotal).toBe(3)
    expect(metrics.handoffsByAction.continue).toBe(2)
    expect(metrics.handoffsByAction.reroute).toBe(0)
    expect(metrics.handoffsByAction.stop).toBe(1)
    expect(metrics.handoffsByAction.blocked).toBe(0)
  })

  test("mixed routing decisions: exact_agent, category, blocked all present in routingDecisions", () => {
    // given - three different routing decisions
    monitor.recordEvent({ type: "routing", action: "exact_agent" })
    monitor.recordEvent({ type: "routing", action: "category" })
    monitor.recordEvent({ type: "routing", action: "blocked" })

    // when
    const metrics = monitor.getMetrics()

    // then
    expect(metrics.routingDecisions.exact_agent).toBe(1)
    expect(metrics.routingDecisions.category).toBe(1)
    expect(metrics.routingDecisions.blocked).toBe(1)
  })
})

// ─── Edge cases ──────────────────────────────────────────────────────────

describe("edge cases", () => {
  let monitor: OrchestrationMonitor

  beforeEach(() => {
    monitor = createOrchestrationMonitor()
  })

  test("event with unknown type does not crash and does not affect counters", () => {
    // given - an event with type not in the switch cases
    const unknownEvent = { type: "unknown_type" as OrchestrationEvent["type"] }

    // when
    monitor.recordEvent(unknownEvent)

    // then - no counters changed
    const metrics = monitor.getMetrics()
    expect(metrics.delegationsTotal).toBe(0)
    expect(metrics.handoffsTotal).toBe(0)
    expect(metrics.successRate).toBe(1.0)
    expect(metrics.averageDelegationMs).toBe(0)
    expect(metrics.averageRoutingDepth).toBe(0)
  })

  test("extremely large durationMs just over one hour is recorded correctly", () => {
    // given - a delegation with duration just over 1 hour
    const oneHourMs = 3600000
    monitor.recordEvent({ type: "delegation", agent: "oracle", durationMs: oneHourMs + 1 })

    // when
    const metrics = monitor.getMetrics()

    // then
    expect(metrics.averageDelegationMs).toBe(3600001)
  })

  test("NaN durationMs is excluded from average delegation time", () => {
    // given - one event with NaN duration and one with valid duration
    monitor.recordEvent({ type: "delegation", agent: "oracle", durationMs: NaN })
    monitor.recordEvent({ type: "delegation", agent: "oracle", durationMs: 200 })

    // when
    const metrics = monitor.getMetrics()

    // then - only the valid duration counted
    expect(metrics.averageDelegationMs).toBe(200)
  })

  test("empty string agent counts in total but not in delegationsByAgent", () => {
    // given - delegation with empty string agent
    monitor.recordEvent({ type: "delegation", agent: "" })

    // when
    const metrics = monitor.getMetrics()

    // then
    expect(metrics.delegationsTotal).toBe(1)
    expect(Object.keys(metrics.delegationsByAgent).length).toBe(0)
  })

  test("delegation without durationMs does not affect average", () => {
    // given - delegation with no durationMs field
    monitor.recordEvent({ type: "delegation", agent: "oracle" })
    monitor.recordEvent({ type: "delegation", agent: "oracle", durationMs: 300 })

    // when
    const metrics = monitor.getMetrics()

    // then - only the explicit duration counted
    expect(metrics.averageDelegationMs).toBe(300)
  })
})

// ─── Stress / concurrent scenarios ────────────────────────────────────────

describe("stress and concurrent scenarios", () => {
  let monitor: OrchestrationMonitor

  beforeEach(() => {
    monitor = createOrchestrationMonitor()
  })

  test("1000 events recorded in quick succession yields accurate metrics", () => {
    // given - 1000 mixed events
    for (let i = 0; i < 300; i++) {
      monitor.recordEvent({ type: "delegation", agent: "oracle", durationMs: 100 })
    }
    for (let i = 0; i < 200; i++) {
      monitor.recordEvent({ type: "handoff", action: "continue" })
    }
    for (let i = 0; i < 200; i++) {
      monitor.recordEvent({ type: "routing", action: "exact_agent" })
    }
    for (let i = 0; i < 150; i++) {
      monitor.recordEvent({ type: "completion" })
    }
    for (let i = 0; i < 150; i++) {
      monitor.recordEvent({ type: "failure" })
    }

    // when
    const metrics = monitor.getMetrics()

    // then
    expect(metrics.delegationsTotal).toBe(300)
    expect(metrics.delegationsByAgent.oracle).toBe(300)
    expect(metrics.handoffsTotal).toBe(200)
    expect(metrics.handoffsByAction.continue).toBe(200)
    expect(metrics.routingDecisions.exact_agent).toBe(200)
    expect(metrics.averageDelegationMs).toBe(100)
    expect(metrics.successRate).toBe(0.5)
  })

  test("100 delegations to the same agent shows count of 100 in delegationsByAgent", () => {
    // given - 100 delegations to the same agent
    for (let i = 0; i < 100; i++) {
      monitor.recordEvent({ type: "delegation", agent: "sisyphus" })
    }

    // when
    const metrics = monitor.getMetrics()

    // then
    expect(metrics.delegationsTotal).toBe(100)
    expect(metrics.delegationsByAgent.sisyphus).toBe(100)
  })

  test("alternating delegation and completion events compute success rate correctly", () => {
    // given - 50 pairs of (completion, failure) interleaved with delegations
    for (let i = 0; i < 50; i++) {
      monitor.recordEvent({ type: "delegation", agent: "oracle" })
      monitor.recordEvent({ type: "completion" })
      monitor.recordEvent({ type: "delegation", agent: "oracle" })
      monitor.recordEvent({ type: "failure" })
    }

    // when - 50 completions and 50 failures out of 100 total
    const metrics = monitor.getMetrics()

    // then
    expect(metrics.delegationsTotal).toBe(100)
    expect(metrics.successRate).toBe(0.5)
  })
})

// ─── Snapshot / serialization ────────────────────────────────────────────

describe("snapshot and serialization", () => {
  let monitor: OrchestrationMonitor

  beforeEach(() => {
    monitor = createOrchestrationMonitor()
  })

  afterEach(() => {
    mock.restore()
  })

  test("getMetrics returns a deep copy - mutating result does not affect internal state", () => {
    // given - monitor with recorded events
    monitor.recordEvent({ type: "delegation", agent: "oracle" })
    monitor.recordEvent({ type: "handoff", action: "continue" })

    // when - mutate the first snapshot
    const firstSnapshot = monitor.getMetrics()
    firstSnapshot.delegationsTotal = 999
    firstSnapshot.delegationsByAgent.oracle = 999
    firstSnapshot.handoffsByAction.continue = 999
    firstSnapshot.routingDecisions.exact_agent = 999

    // then - second snapshot retains original values
    const secondSnapshot = monitor.getMetrics()
    expect(secondSnapshot.delegationsTotal).toBe(1)
    expect(secondSnapshot.delegationsByAgent.oracle).toBe(1)
    expect(secondSnapshot.handoffsByAction.continue).toBe(1)
  })

  test("logSnapshot writes structured data to shared logger", async () => {
    // given - mock the logger before importing monitoring
    const capturedCalls: Array<{ msg: string; data?: unknown }> = []

    mock.module("../../shared/logger", () => ({
      log: (msg: string, data?: unknown) => {
        capturedCalls.push({ msg, data })
      },
    }))

    const { createOrchestrationMonitor: createMockedMonitor } = await import(
      "./monitoring?logSnapshotMock=" + Math.random()
    )

    const mockMonitor = createMockedMonitor()
    mockMonitor.recordEvent({ type: "delegation", agent: "oracle", durationMs: 150 })
    mockMonitor.recordEvent({ type: "completion" })

    // when
    mockMonitor.logSnapshot()

    // then
    expect(capturedCalls.length).toBe(1)
    expect(capturedCalls[0].msg).toBe("orchestration-monitor:snapshot")

    const data = capturedCalls[0].data as Record<string, unknown> | undefined
    expect(data).toBeDefined()
    expect(data!.delegationsTotal).toBe(1)
    expect(data!.handoffsTotal).toBe(0)
    expect(data!.successRate).toBe(1.0)
    expect(data!.delegationsByAgent).toBeDefined()
    expect((data!.delegationsByAgent as Record<string, number>).oracle).toBe(1)
  })
})
