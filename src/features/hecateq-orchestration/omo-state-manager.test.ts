import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import {
  OmoStateManager,
  HECATEQ_OMO_DIR,
  HECATEQ_OMO_STATE_FILE,
  HECATEQ_HANDOFF_HISTORY_MAX,
  HECATEQ_SIGNAL_PENDING_MAX,
  createDefaultState,
} from "./omo-state-manager"
import type { HecateqStoredHandoff, HecateqOmoState } from "./types"

const tempDirs: string[] = []

function createTempDir(): string {
  const directory = mkdtempSync(join(tmpdir(), "omo-omo-state-"))
  tempDirs.push(directory)
  return directory
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

// ─── Constructor ─────────────────────────────────────────────────────────────

describe("OmoStateManager constructor", () => {
  test("#given valid projectRoot #then creates instance with correct paths", () => {
    const dir = createTempDir()
    const mgr = new OmoStateManager(dir)

    expect(mgr.omoDir).toBe(join(dir, HECATEQ_OMO_DIR))
    expect(mgr.stateFilePath).toBe(join(dir, HECATEQ_OMO_DIR, HECATEQ_OMO_STATE_FILE))
  })

  test("#given empty projectRoot #then throws", () => {
    expect(() => new OmoStateManager("")).toThrow("projectRoot is required")
    expect(() => new OmoStateManager("  ")).toThrow("projectRoot is required")
  })
})

// ─── ensureDir ───────────────────────────────────────────────────────────────

describe("OmoStateManager.ensureDir", () => {
  test("#given non-existent directory #then creates it", () => {
    const dir = createTempDir()
    const mgr = new OmoStateManager(dir)
    const omoDir = join(dir, HECATEQ_OMO_DIR)

    expect(existsSync(omoDir)).toBe(false)
    mgr.ensureDir()
    expect(existsSync(omoDir)).toBe(true)
  })

  test("#given existing directory #then does not throw", () => {
    const dir = createTempDir()
    const mgr = new OmoStateManager(dir)

    mgr.ensureDir()
    expect(() => mgr.ensureDir()).not.toThrow()
  })
})

// ─── read / write / create / readOrCreate ────────────────────────────────────

describe("OmoStateManager read/write lifecycle", () => {
  test("#given no state file #then read returns null", () => {
    const dir = createTempDir()
    const mgr = new OmoStateManager(dir)

    expect(mgr.read()).toBeNull()
  })

  test("#given write then read #then returns same data", () => {
    const dir = createTempDir()
    const mgr = new OmoStateManager(dir)

    const state: HecateqOmoState = {
      schema_version: 1,
      last_updated: new Date().toISOString(),
      handoff: {
        active: {
          status: "DONE",
          target: "return_to_caller",
          signalCount: 1,
          signalNames: ["tests_passed"],
          timestamp: new Date().toISOString(),
          source: "direct",
        },
        history: [],
      },
    }

    const writeResult = mgr.write(state)
    expect(writeResult.success).toBe(true)

    const readBack = mgr.read()
    expect(readBack).not.toBeNull()
    expect(readBack!.schema_version).toBe(1)
    expect(readBack!.handoff!.active!.status).toBe("DONE")
    expect(readBack!.handoff!.active!.target).toBe("return_to_caller")
    expect(readBack!.handoff!.active!.signalNames).toEqual(["tests_passed"])
  })

  test("#given corrupt state file #then read returns null", () => {
    const dir = createTempDir()
    const mgr = new OmoStateManager(dir)

    mgr.ensureDir()
    const { writeFileSync } = require("node:fs")
    writeFileSync(mgr.stateFilePath, "not valid json", "utf-8")

    expect(mgr.read()).toBeNull()
  })

  test("#given create #then writes default state and returns it", () => {
    const dir = createTempDir()
    const mgr = new OmoStateManager(dir)

    const state = mgr.create()
    expect(state).not.toBeNull()
    expect(state!.schema_version).toBe(1)
    expect(state!.handoff).toBeDefined()
    expect(state!.handoff!.active).toBeNull()
    expect(state!.handoff!.history).toEqual([])
    expect(state!.signal_registry).toBeDefined()
    expect(state!.signal_registry!.pending).toEqual([])
    expect(state!.signal_registry!.consumed).toEqual([])
    expect(state!.migrations!.completed).toEqual([])
  })

  test("#given readOrCreate on empty dir #then creates and returns default", () => {
    const dir = createTempDir()
    const mgr = new OmoStateManager(dir)

    const state = mgr.readOrCreate()
    expect(state).not.toBeNull()
    expect(state.schema_version).toBe(1)
    expect(existsSync(mgr.stateFilePath)).toBe(true)
  })

  test("#given readOrCreate with existing state #then returns existing", () => {
    const dir = createTempDir()
    const mgr = new OmoStateManager(dir)

    const first = mgr.readOrCreate()
    first.handoff!.active = {
      status: "IN_PROGRESS",
      target: "nodejs-backend-developer",
      signalCount: 0,
      signalNames: [],
      timestamp: new Date().toISOString(),
      source: "direct",
    }
    mgr.write(first)

    const second = mgr.readOrCreate()
    expect(second.handoff!.active!.target).toBe("nodejs-backend-developer")
  })
})

// ─── Handoff helpers ─────────────────────────────────────────────────────────

describe("OmoStateManager handoff helpers", () => {
  let mgr: OmoStateManager

  beforeEach(() => {
    const dir = createTempDir()
    mgr = new OmoStateManager(dir)
    mgr.create()
  })

  test("#given recordHandoff #then sets active and adds to history", () => {
    const handoff: HecateqStoredHandoff = {
      status: "DONE",
      target: "return_to_caller",
      signalCount: 2,
      signalNames: ["tests_passed", "performance_verified"],
      timestamp: new Date().toISOString(),
      source: "direct",
    }

    const state = mgr.recordHandoff(handoff)
    expect(state).not.toBeNull()
    expect(state!.handoff!.active!.status).toBe("DONE")
    expect(state!.handoff!.active!.target).toBe("return_to_caller")
    expect(state!.handoff!.history).toHaveLength(1)
  })

  test("#given getActiveHandoff with active handoff #then returns it", () => {
    const handoff: HecateqStoredHandoff = {
      status: "IN_PROGRESS",
      target: "nodejs-backend-developer",
      signalCount: 1,
      signalNames: ["schema_ready"],
      timestamp: new Date().toISOString(),
      source: "direct",
    }

    mgr.recordHandoff(handoff)
    const active = mgr.getActiveHandoff()
    expect(active).not.toBeNull()
    expect(active!.target).toBe("nodejs-backend-developer")
  })

  test("#given getActiveHandoff with no handoff #then returns null", () => {
    const active = mgr.getActiveHandoff()
    expect(active).toBeNull()
  })

  test("#given clearActiveHandoff #then active becomes null but history persists", () => {
    const handoff: HecateqStoredHandoff = {
      status: "BLOCKED",
      target: "return_to_parent_for_routing",
      signalCount: 0,
      signalNames: [],
      timestamp: new Date().toISOString(),
      source: "direct",
    }

    mgr.recordHandoff(handoff)
    expect(mgr.getActiveHandoff()).not.toBeNull()

    mgr.clearActiveHandoff()
    expect(mgr.getActiveHandoff()).toBeNull()
    expect(mgr.getHandoffHistory()).toHaveLength(1)
  })

  test("#given multiple handoffs #then history is capped", () => {
    const many = HECATEQ_HANDOFF_HISTORY_MAX + 5
    for (let i = 0; i < many; i++) {
      mgr.recordHandoff({
        status: "DONE",
        target: `agent-${i}`,
        signalCount: 0,
        signalNames: [],
        timestamp: new Date().toISOString(),
        source: "direct",
      })
    }

    expect(mgr.getHandoffHistory()).toHaveLength(HECATEQ_HANDOFF_HISTORY_MAX)
    // Most recent entry should be the last one we added
    expect(mgr.getHandoffHistory()[0]!.target).toBe(`agent-${many - 1}`)
  })

  test("#given getHandoffHistory #then returns most recent first", () => {
    mgr.recordHandoff({
      status: "DONE", target: "first", signalCount: 0, signalNames: [],
      timestamp: new Date().toISOString(), source: "direct",
    })
    mgr.recordHandoff({
      status: "DONE", target: "second", signalCount: 0, signalNames: [],
      timestamp: new Date().toISOString(), source: "direct",
    })

    const history = mgr.getHandoffHistory()
    expect(history[0]!.target).toBe("second")
    expect(history[1]!.target).toBe("first")
  })
})

// ─── Signal registry helpers ─────────────────────────────────────────────────

describe("OmoStateManager signal helpers", () => {
  let mgr: OmoStateManager

  beforeEach(() => {
    const dir = createTempDir()
    mgr = new OmoStateManager(dir)
    mgr.create()
  })

  test("#given emitSignal #then signal is in pending", () => {
    mgr.emitSignal("tests_passed", { passed: true }, "qa-test-engineer")

    const pending = mgr.getPendingSignals()
    expect(pending).toHaveLength(1)
    expect(pending[0]!.signal).toBe("tests_passed")
    expect(pending[0]!.emitterAgent).toBe("qa-test-engineer")
  })

  test("#given consumeSignal #then moves from pending to consumed", () => {
    mgr.emitSignal("schema_ready", { version: 2 }, "database-specialist")

    expect(mgr.hasPendingSignal("schema_ready")).toBe(true)
    expect(mgr.hasPendingSignal("tests_passed")).toBe(false)

    const consumed = mgr.consumeSignal("schema_ready")
    expect(consumed).not.toBeNull()
    expect(consumed!.signal).toBe("schema_ready")
    expect(consumed!.consumedAt).toBeDefined()

    expect(mgr.hasPendingSignal("schema_ready")).toBe(false)
    expect(mgr.getPendingSignals()).toHaveLength(0)
    expect(mgr.getConsumedSignals()).toHaveLength(1)
  })

  test("#given consumeSignal with no matching pending #then returns null", () => {
    const consumed = mgr.consumeSignal("nonexistent_signal")
    expect(consumed).toBeNull()
  })

  test("#given getPendingSignals with none #then returns empty array", () => {
    expect(mgr.getPendingSignals()).toEqual([])
  })

  test("#given emitSignal without emitter #then signal has no emitterAgent", () => {
    mgr.emitSignal("compliance_signed", {})
    const pending = mgr.getPendingSignals()
    expect(pending[0]!.emitterAgent).toBeUndefined()
  })

  test("#given many pending signals #then auto-prunes oldest", () => {
    const many = HECATEQ_SIGNAL_PENDING_MAX + 10
    for (let i = 0; i < many; i++) {
      mgr.emitSignal(`signal-${i}`, {})
    }

    const pending = mgr.getPendingSignals()
    expect(pending.length).toBeLessThanOrEqual(HECATEQ_SIGNAL_PENDING_MAX)
    // Oldest signals should have been pruned, newest should remain
    expect(pending[0]!.signal).toBe(`signal-${many - HECATEQ_SIGNAL_PENDING_MAX}`)
  })
})

// ─── Migration tracking ──────────────────────────────────────────────────────

describe("OmoStateManager migration tracking", () => {
  let mgr: OmoStateManager

  beforeEach(() => {
    const dir = createTempDir()
    mgr = new OmoStateManager(dir)
    mgr.create()
  })

  test("#given markMigrationComplete #then isMigrationComplete returns true", () => {
    expect(mgr.isMigrationComplete("test-migration")).toBe(false)
    mgr.markMigrationComplete("test-migration")
    expect(mgr.isMigrationComplete("test-migration")).toBe(true)
  })

  test("#given multiple migrations #then getCompletedMigrations returns all", () => {
    mgr.markMigrationComplete("mig-a")
    mgr.markMigrationComplete("mig-b")
    mgr.markMigrationComplete("mig-c")

    const completed = mgr.getCompletedMigrations()
    expect(completed).toContain("mig-a")
    expect(completed).toContain("mig-b")
    expect(completed).toContain("mig-c")
    expect(completed).toHaveLength(3)
  })

  test("#given markMigrationComplete twice same id #then no duplicates", () => {
    mgr.markMigrationComplete("dup-check")
    mgr.markMigrationComplete("dup-check")

    expect(mgr.getCompletedMigrations()).toHaveLength(1)
  })
})

// ─── createDefaultState ──────────────────────────────────────────────────────

describe("createDefaultState", () => {
  test("#given call #then returns valid default state", () => {
    const state = createDefaultState()

    expect(state.schema_version).toBe(1)
    expect(state.last_updated).toBeDefined()
    expect(state.handoff).toBeDefined()
    expect(state.handoff!.active).toBeNull()
    expect(state.handoff!.history).toEqual([])
    expect(state.signal_registry).toBeDefined()
    expect(state.signal_registry!.pending).toEqual([])
    expect(state.signal_registry!.consumed).toEqual([])
    expect(state.routing).toBeDefined()
    expect(state.routing!.active_target).toBeNull()
    expect(state.routing!.queue).toEqual([])
    expect(state.migrations).toBeDefined()
    expect(state.migrations!.completed).toEqual([])
    expect(state.migrations!.last_run).toBeNull()
  })
})
