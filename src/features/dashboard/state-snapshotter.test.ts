import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { createStateSnapshotter } from "./state-snapshotter"
import { OmoStateManager } from "../hecateq-orchestration/omo-state-manager"

const tempDirs: string[] = []

function createTempDir(): string {
  const directory = mkdtempSync(join(tmpdir(), "omo-dashboard-"))
  tempDirs.push(directory)
  return directory
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) {
      try { rmSync(dir, { recursive: true, force: true }) } catch {}
    }
  }
})

describe("state-snapshotter", () => {
  test("health returns ok when state file exists", () => {
    const dir = createTempDir()
    const stateMgr = new OmoStateManager(dir)
    stateMgr.readOrCreate()

    const snap = createStateSnapshotter(dir)
    const health = snap.getHealth(1000)
    expect(health.status).toBe("ok")
    expect(health.state_file_exists).toBe(true)
    expect(health.version).toBe("1.0.0")
  })

  test("health returns degraded when no state file", () => {
    const dir = createTempDir()
    const snap = createStateSnapshotter(dir)
    const health = snap.getHealth(1000)
    expect(health.status).toBe("degraded")
    expect(health.state_file_exists).toBe(false)
  })

  test("state returns error when no state file", () => {
    const dir = createTempDir()
    const snap = createStateSnapshotter(dir)
    const result = snap.getState()
    expect("error" in result).toBe(true)
    if ("error" in result) {
      expect(result.error.code).toBe("STATE_FILE_NOT_FOUND")
    }
  })

  test("state returns delegation and spawn data from OmoState", () => {
    const dir = createTempDir()
    const stateMgr = new OmoStateManager(dir)
    stateMgr.readOrCreate()

    stateMgr.emitSignal("schema_ready", { source: "database-specialist" })
    stateMgr.recordSpawnStart({
      sessionId: "ses_1",
      delegationId: "dlg_1",
      targetAgent: "database-specialist",
      spawnedAt: new Date().toISOString(),
      status: "running",
      routingDepth: 1,
    })

    const snap = createStateSnapshotter(dir)
    const result = snap.getState()
    expect("error" in result).toBe(false)

    if (!("error" in result)) {
      expect(result.signal_registry.pending.length).toBe(1)
      expect(result.signal_registry.pending[0]!.signal).toBe("schema_ready")
      expect(result.spawn.active_sessions.length).toBe(1)
      expect(result.spawn.active_sessions[0]!.target_agent).toBe("database-specialist")
    }
  })

  test("signals returns known signals from registry", () => {
    const dir = createTempDir()
    const stateMgr = new OmoStateManager(dir)
    stateMgr.readOrCreate()

    const snap = createStateSnapshotter(dir)
    const result = snap.getSignals()

    if (!("error" in result)) {
      expect(result.known_signals.length).toBe(9)
      expect(result.known_signals[0]!.signal).toBe("schema_ready")
      expect(result.known_signals[0]!.emitters).toContain("database-specialist")
    }
  })

  test("spawns returns config with counts", () => {
    const dir = createTempDir()
    const stateMgr = new OmoStateManager(dir)
    stateMgr.readOrCreate()

    stateMgr.recordSpawnStart({
      sessionId: "s1", delegationId: "d1", targetAgent: "oracle",
      spawnedAt: new Date().toISOString(), status: "running", routingDepth: 1,
    })

    const snap = createStateSnapshotter(dir)
    const result = snap.getSpawns()

    if (!("error" in result)) {
      expect(result.active_sessions.length).toBe(1)
      expect(result.config.active_count).toBe(1)
      expect(result.config.max_concurrent).toBe(5)
    }
  })

  test("summary returns compact state overview", () => {
    const dir = createTempDir()
    const stateMgr = new OmoStateManager(dir)
    stateMgr.readOrCreate()

    stateMgr.emitSignal("schema_ready", {})
    stateMgr.emitSignal("backend_ready", {})

    const snap = createStateSnapshotter(dir)
    const result = snap.getSummary(5000)

    if (!("error" in result)) {
      expect(result.pending_signals).toBe(2)
      expect(result.uptime_ms).toBe(5000)
    }
  })

  test("delegations returns chain from pending delegations", () => {
    const dir = createTempDir()
    const stateMgr = new OmoStateManager(dir)
    stateMgr.readOrCreate()

    stateMgr.recordPendingDelegation({
      id: "dlg_test_1",
      targetAgent: "database-specialist",
      prompt: "Design the schema",
      sourceTaskId: "task_1",
      sourceAgent: "sisyphus",
      createdAt: new Date().toISOString(),
      status: "pending",
      routingDepth: 1,
    })

    const snap = createStateSnapshotter(dir)
    const result = snap.getDelegations()

    if (!("error" in result)) {
      expect(result.active_chains.length).toBe(1)
      expect(result.active_chains[0]!.depth).toBe(0)
    }
  })

  test("history returns routing history", () => {
    const dir = createTempDir()
    const stateMgr = new OmoStateManager(dir)
    stateMgr.readOrCreate()

    stateMgr.recordRoutingDecision({
      decision: "return_to_caller",
      reason: "Test decision",
      originalTarget: "database-specialist",
      decidedAt: new Date().toISOString(),
    })

    const snap = createStateSnapshotter(dir)
    const result = snap.getHistory()

    if (!("error" in result)) {
      expect(result.routing_history.length).toBe(1)
      expect(result.history_summary.total_routing_decisions).toBe(1)
    }
  })

  test("dag returns graph from signal state", () => {
    const dir = createTempDir()
    const stateMgr = new OmoStateManager(dir)
    stateMgr.readOrCreate()

    stateMgr.emitSignal("schema_ready", { source: "database-specialist" })

    const snap = createStateSnapshotter(dir)
    const result = snap.getDag()

    if (!("error" in result)) {
      expect(result.active_graphs.length).toBe(1)
      expect(result.pending_signals.length).toBe(1)
    }
  })

  test("all endpoints work when state is initialized", () => {
    const dir = createTempDir()
    const stateMgr = new OmoStateManager(dir)
    stateMgr.readOrCreate()

    const snap = createStateSnapshotter(dir)

    expect("error" in snap.getHealth(0)).toBe(false)
    expect("error" in snap.getState()).toBe(false)
    expect("error" in snap.getSignals()).toBe(false)
    expect("error" in snap.getDelegations()).toBe(false)
    expect("error" in snap.getSpawns()).toBe(false)
    expect("error" in snap.getHistory()).toBe(false)
    expect("error" in snap.getDag()).toBe(false)
    expect("error" in snap.getSummary(0)).toBe(false)
  })
})
