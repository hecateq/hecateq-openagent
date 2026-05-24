import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { OmoStateManager } from "./omo-state-manager"
import {
  migrateFromBoulderState,
  migrateFromContinuationMarkers,
  runAllMigrations,
  MIGRATION_ID_BOULDER,
  MIGRATION_ID_CONTINUATION,
} from "./omo-migration"
import { CONTINUATION_MARKER_DIR } from "../run-continuation-state/constants"

const tempDirs: string[] = []

function createTempDir(): string {
  const directory = mkdtempSync(join(tmpdir(), "omo-migration-"))
  tempDirs.push(directory)
  return directory
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

// ─── migrateFromBoulderState ─────────────────────────────────────────────────

describe("migrateFromBoulderState", () => {
  test("#given boulder state with __handoff__ entry #then migrates handoff", () => {
    const dir = createTempDir()
    const mgr = new OmoStateManager(dir)
    mgr.create()

    // Create a fake Boulder state file with a __handoff__ entry
    const boulderDir = join(dir, ".omo")
    mkdirSync(boulderDir, { recursive: true })
    writeFileSync(
      join(boulderDir, "boulder.json"),
      JSON.stringify({
        active_work_id: "work-1",
        works: {
          "work-1": {
            id: "work-1",
            task_sessions: {
              __handoff__: {
                task_key: "__handoff__",
                task_label: "Handoff: DONE → return_to_caller",
                task_title: JSON.stringify({
                  status: "DONE",
                  target: "return_to_caller",
                  signalCount: 2,
                  signalNames: ["tests_passed", "performance_verified"],
                }),
                session_id: "handoff-work-1-123",
                agent: "return_to_caller",
              },
            },
          },
        },
      }),
      "utf-8",
    )

    const result = migrateFromBoulderState(mgr, { completed: [], last_run: null })

    expect(result.changed).toBe(true)
    expect(result.handoffsMigrated).toBe(1)
    expect(result.signalsMigrated).toBe(2)
    expect(result.errors).toHaveLength(0)

    // Verify the state was written
    const state = mgr.read()
    expect(state).not.toBeNull()
    expect(state!.handoff!.active!.status).toBe("DONE")
    expect(state!.handoff!.active!.target).toBe("return_to_caller")
    expect(state!.handoff!.active!.signalNames).toEqual(["tests_passed", "performance_verified"])
    expect(state!.handoff!.active!.source).toBe("boulder")
  })

  test("#given boulder state without __handoff__ entry #then returns no change", () => {
    const dir = createTempDir()
    const mgr = new OmoStateManager(dir)
    mgr.create()

    const boulderDir = join(dir, ".omo")
    mkdirSync(boulderDir, { recursive: true })
    writeFileSync(
      join(boulderDir, "boulder.json"),
      JSON.stringify({
        active_work_id: "work-1",
        works: {
          "work-1": { id: "work-1", task_sessions: {} },
        },
      }),
      "utf-8",
    )

    const result = migrateFromBoulderState(mgr, { completed: [], last_run: null })
    expect(result.changed).toBe(false)
    expect(result.handoffsMigrated).toBe(0)
  })

  test("#given no boulder state file #then returns no change", () => {
    const dir = createTempDir()
    const mgr = new OmoStateManager(dir)
    mgr.create()

    const result = migrateFromBoulderState(mgr, { completed: [], last_run: null })
    expect(result.changed).toBe(false)
    expect(result.handoffsMigrated).toBe(0)
  })

  test("#given corrupt boulder state #then returns error", () => {
    const dir = createTempDir()
    const mgr = new OmoStateManager(dir)
    mgr.create()

    const boulderDir = join(dir, ".omo")
    mkdirSync(boulderDir, { recursive: true })
    writeFileSync(join(boulderDir, "boulder.json"), "not valid json", "utf-8")

    const result = migrateFromBoulderState(mgr, { completed: [], last_run: null })
    expect(result.handoffsMigrated).toBe(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatch(/Failed to parse Boulder state/)
  })

  test("#given boulder with corrupt task_title #then skips that entry", () => {
    const dir = createTempDir()
    const mgr = new OmoStateManager(dir)
    mgr.create()

    const boulderDir = join(dir, ".omo")
    mkdirSync(boulderDir, { recursive: true })
    writeFileSync(
      join(boulderDir, "boulder.json"),
      JSON.stringify({
        works: {
          "work-1": {
            task_sessions: {
              __handoff__: {
                task_title: "not-json",
              },
            },
          },
        },
      }),
      "utf-8",
    )

    const result = migrateFromBoulderState(mgr, { completed: [], last_run: null })
    expect(result.changed).toBe(false)
    expect(result.handoffsMigrated).toBe(0)
  })
})

// ─── migrateFromContinuationMarkers ──────────────────────────────────────────

describe("migrateFromContinuationMarkers", () => {
  test("#given marker with background-task handoff #then migrates handoff", () => {
    const dir = createTempDir()
    const mgr = new OmoStateManager(dir)
    mgr.create()

    // Create a continuation marker file
    const markersDir = join(dir, CONTINUATION_MARKER_DIR)
    mkdirSync(markersDir, { recursive: true })
    writeFileSync(
      join(markersDir, "ses_test.json"),
      JSON.stringify({
        sessionID: "ses_test",
        updatedAt: new Date().toISOString(),
        sources: {
          "background-task": {
            state: "active",
            reason: JSON.stringify({
              status: "IN_PROGRESS",
              handoff: "nodejs-backend-developer",
              signalCount: 1,
              signals: [{ signal: "schema_ready", payload: { version: 2 } }],
            }),
            updatedAt: new Date().toISOString(),
          },
        },
      }),
      "utf-8",
    )

    const result = migrateFromContinuationMarkers(mgr)

    expect(result.changed).toBe(true)
    expect(result.handoffsMigrated).toBe(1)
    expect(result.signalsMigrated).toBe(1)
    expect(result.errors).toHaveLength(0)

    const state = mgr.read()
    expect(state).not.toBeNull()
    expect(state!.handoff!.active!.status).toBe("IN_PROGRESS")
    expect(state!.handoff!.active!.target).toBe("nodejs-backend-developer")
    expect(state!.handoff!.active!.signalNames).toEqual(["schema_ready"])
    expect(state!.handoff!.active!.source).toBe("continuation-marker")
  })

  test("#given marker without background-task source #then skips", () => {
    const dir = createTempDir()
    const mgr = new OmoStateManager(dir)
    mgr.create()

    const markersDir = join(dir, CONTINUATION_MARKER_DIR)
    mkdirSync(markersDir, { recursive: true })
    writeFileSync(
      join(markersDir, "ses_no_bg.json"),
      JSON.stringify({
        sessionID: "ses_no_bg",
        sources: { todo: { state: "stopped", updatedAt: new Date().toISOString() } },
      }),
      "utf-8",
    )

    const result = migrateFromContinuationMarkers(mgr)
    expect(result.changed).toBe(false)
    expect(result.handoffsMigrated).toBe(0)
  })

  test("#given no markers dir #then returns no change", () => {
    const dir = createTempDir()
    const mgr = new OmoStateManager(dir)
    mgr.create()

    const result = migrateFromContinuationMarkers(mgr)
    expect(result.changed).toBe(false)
    expect(result.handoffsMigrated).toBe(0)
  })

  test("#given empty markers dir #then returns no change", () => {
    const dir = createTempDir()
    const mgr = new OmoStateManager(dir)
    mgr.create()

    const markersDir = join(dir, CONTINUATION_MARKER_DIR)
    mkdirSync(markersDir, { recursive: true }) // empty dir

    const result = migrateFromContinuationMarkers(mgr)
    expect(result.changed).toBe(false)
    expect(result.handoffsMigrated).toBe(0)
  })

  test("#given marker with corrupted reason JSON #then skips that marker", () => {
    const dir = createTempDir()
    const mgr = new OmoStateManager(dir)
    mgr.create()

    const markersDir = join(dir, CONTINUATION_MARKER_DIR)
    mkdirSync(markersDir, { recursive: true })
    writeFileSync(
      join(markersDir, "ses_corrupt.json"),
      JSON.stringify({
        sources: {
          "background-task": {
            reason: "not valid json",
          },
        },
      }),
      "utf-8",
    )

    const result = migrateFromContinuationMarkers(mgr)
    expect(result.changed).toBe(false)
    expect(result.handoffsMigrated).toBe(0)
  })
})

// ─── runAllMigrations ────────────────────────────────────────────────────────

describe("runAllMigrations", () => {
  test("#given both sources #then runs pending migrations and marks complete", () => {
    const dir = createTempDir()
    const mgr = new OmoStateManager(dir)
    mgr.create()

    // Create a Boulder entry
    const boulderDir = join(dir, ".omo")
    mkdirSync(boulderDir, { recursive: true })
    writeFileSync(
      join(boulderDir, "boulder.json"),
      JSON.stringify({
        works: {
          "work-1": {
            task_sessions: {
              __handoff__: {
                task_title: JSON.stringify({
                  status: "DONE",
                  target: "return_to_caller",
                  signalCount: 1,
                  signalNames: ["tests_passed"],
                }),
              },
            },
          },
        },
      }),
      "utf-8",
    )

    // Create a continuation marker
    const markersDir = join(dir, CONTINUATION_MARKER_DIR)
    mkdirSync(markersDir, { recursive: true })
    writeFileSync(
      join(markersDir, "ses_test.json"),
      JSON.stringify({
        sources: {
          "background-task": {
            reason: JSON.stringify({
              status: "IN_PROGRESS",
              handoff: "nodejs-backend-developer",
              signalCount: 1,
              signals: [{ signal: "schema_ready", payload: {} }],
            }),
          },
        },
      }),
      "utf-8",
    )

    const result = runAllMigrations(mgr, { completed: [], last_run: null })
    expect(result.changed).toBe(true)
    expect(result.handoffsMigrated).toBe(2)
    expect(result.signalsMigrated).toBe(2)

    // Both migrations should be marked complete
    expect(mgr.isMigrationComplete(MIGRATION_ID_BOULDER)).toBe(true)
    expect(mgr.isMigrationComplete(MIGRATION_ID_CONTINUATION)).toBe(true)
  })

  test("#given already completed migrations #then does not rerun", () => {
    const dir = createTempDir()
    const mgr = new OmoStateManager(dir)
    mgr.create()

    // Mark both as already completed
    mgr.markMigrationComplete(MIGRATION_ID_BOULDER)
    mgr.markMigrationComplete(MIGRATION_ID_CONTINUATION)

    const result = runAllMigrations(mgr, { completed: [], last_run: null })
    expect(result.changed).toBe(false)
    expect(result.handoffsMigrated).toBe(0)
    expect(result.signalsMigrated).toBe(0)
  })

  test("#given only one completed migration with data in other #then runs pending and marks complete", () => {
    const dir = createTempDir()
    const mgr = new OmoStateManager(dir)
    mgr.create()

    // Mark only boulder as completed
    mgr.markMigrationComplete(MIGRATION_ID_BOULDER)

    // Create a continuation marker with data
    const markersDir = join(dir, CONTINUATION_MARKER_DIR)
    mkdirSync(markersDir, { recursive: true })
    writeFileSync(
      join(markersDir, "ses_test.json"),
      JSON.stringify({
        sources: {
          "background-task": {
            reason: JSON.stringify({
              status: "DONE",
              handoff: "return_to_caller",
              signalCount: 1,
              signals: [{ signal: "tests_passed", payload: {} }],
            }),
          },
        },
      }),
      "utf-8",
    )

    const result = runAllMigrations(mgr, { completed: [], last_run: null })
    expect(result.changed).toBe(true)
    expect(result.handoffsMigrated).toBe(1)
    expect(result.signalsMigrated).toBe(1)

    // Boulder should not have run again, continuation marked complete
    expect(mgr.isMigrationComplete(MIGRATION_ID_BOULDER)).toBe(true)
    expect(mgr.isMigrationComplete(MIGRATION_ID_CONTINUATION)).toBe(true)
  })

  test("#given no data in either source #then no migrations are marked complete", () => {
    const dir = createTempDir()
    const mgr = new OmoStateManager(dir)
    mgr.create()

    // No Boulder file, no continuation markers — nothing to migrate
    const result = runAllMigrations(mgr, { completed: [], last_run: null })
    expect(result.changed).toBe(false)
    expect(result.handoffsMigrated).toBe(0)
    expect(result.signalsMigrated).toBe(0)

    // Migrations should NOT be marked complete — they can retry if data appears
    expect(mgr.isMigrationComplete(MIGRATION_ID_BOULDER)).toBe(false)
    expect(mgr.isMigrationComplete(MIGRATION_ID_CONTINUATION)).toBe(false)
  })
})
