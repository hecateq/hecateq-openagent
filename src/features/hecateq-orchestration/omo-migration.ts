/**
 * Hecateq OMO Migration — Scaffolding from MVP State to `.omo/hecateq/`
 *
 * Wave 1: Migrate existing handoff state from two MVP sources into the new
 * `.omo/hecateq/state.json` structure:
 *
 * 1. **Boulder state** — `task_sessions["__handoff__"]` entries
 * 2. **Run-continuation markers** — `.omo/run-continuation/*.json` with
 *    `sources["background-task"]` handoff reason data
 *
 * Each migration is idempotent via `migrations.completed` tracking in
 * the new state file. Once a migration ID has been recorded, it will
 * not run again.
 *
 * The existing MVP flow continues to work alongside — this is additive.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

import type {
  HecateqMigrationResult,
  HecateqStoredHandoff,
  HecateqOmoState,
} from "./types"
import type { OmoStateManager } from "./omo-state-manager"
import { CONTINUATION_MARKER_DIR } from "../run-continuation-state/constants"

// ─── Migration IDs ───────────────────────────────────────────────────────────

/** Migration ID for Boulder state → `.omo/hecateq/` */
export const MIGRATION_ID_BOULDER = "migrate-from-boulder-v1" as const

/** Migration ID for continuation markers → `.omo/hecateq/` */
export const MIGRATION_ID_CONTINUATION = "migrate-from-continuation-v1" as const

// ─── Migration: Boulder State ────────────────────────────────────────────────

/**
 * Migrate handoff state from Boulder task_sessions["__handoff__"] into
 * the new `.omo/hecateq/state.json` structure.
 *
 * Scans the Boulder state file for any work that has a `__handoff__`
 * entry in its task_sessions and copies the handoff metadata into the
 * new state's handoff section.
 *
 * Idempotent: tracks completion via `MIGRATION_ID_BOULDER`.
 */
export function migrateFromBoulderState(
  stateManager: OmoStateManager,
  boulderState: HecateqOmoState["migrations"],
): HecateqMigrationResult {
  const result: HecateqMigrationResult = {
    changed: false,
    handoffsMigrated: 0,
    signalsMigrated: 0,
    errors: [],
  }

  // Read the Boulder state file
  const boulderFilePath = join(stateManager["projectRoot"], ".omo", "boulder.json")
  if (!existsSync(boulderFilePath)) {
    return result // No Boulder state — nothing to migrate
  }

  let boulderRaw: Record<string, unknown>
  try {
    boulderRaw = JSON.parse(readFileSync(boulderFilePath, "utf-8")) as Record<string, unknown>
  } catch (error) {
    result.errors.push(`Failed to parse Boulder state: ${String(error)}`)
    return result
  }

  // Find works with __handoff__ task sessions
  const works = boulderRaw.works as Record<string, Record<string, unknown>> | undefined
  if (!works) return result

  const now = new Date().toISOString()
  const handoffs: HecateqStoredHandoff[] = []

  for (const [workId, work] of Object.entries(works)) {
    try {
      const taskSessions = work.task_sessions as Record<string, Record<string, unknown>> | undefined
      if (!taskSessions?.["__handoff__"]) continue

      const entry = taskSessions["__handoff__"]
      const taskTitle = entry.task_title as string | undefined
      if (!taskTitle) continue

      let parsed: { status?: string; target?: string; signalCount?: number; signalNames?: string[] }
      try {
        parsed = JSON.parse(taskTitle) as {
          status?: string
          target?: string
          signalCount?: number
          signalNames?: string[]
        }
      } catch {
        continue // Corrupted title — skip this entry
      }

      const handoff: HecateqStoredHandoff = {
        status: (parsed.status === "DONE" || parsed.status === "IN_PROGRESS" || parsed.status === "BLOCKED")
          ? parsed.status
          : null,
        target: parsed.target ?? null,
        signalCount: parsed.signalCount ?? 0,
        signalNames: parsed.signalNames ?? [],
        timestamp: now,
        source: "boulder",
      }

      handoffs.push(handoff)
      result.handoffsMigrated++
      result.signalsMigrated += handoff.signalNames.length
    } catch (error) {
      result.errors.push(`Failed to migrate work ${workId}: ${String(error)}`)
    }
  }

  if (handoffs.length === 0) return result

  // Write handoffs into the new state
  try {
    const state = stateManager.readOrCreate()
    if (!state.handoff) {
      state.handoff = { active: null, history: [] }
    }

    // Set the most recent handoff as active
    const mostRecent = handoffs[handoffs.length - 1]
    if (mostRecent) {
      state.handoff.active = mostRecent
    }

    // Prepend all migrated handoffs to history
    state.handoff.history = [...handoffs.reverse(), ...state.handoff.history]

    const writeResult = stateManager.write(state)
    if (writeResult.success) {
      result.changed = true
    } else {
      result.errors.push(`Failed to write migrated state: ${writeResult.error ?? "unknown error"}`)
    }
  } catch (error) {
    result.errors.push(`Migration write failed: ${String(error)}`)
  }

  return result
}

// ─── Migration: Continuation Markers ─────────────────────────────────────────

/**
 * Migrate handoff state from run-continuation marker files into the new
 * `.omo/hecateq/state.json` structure.
 *
 * Scans `.omo/run-continuation/*.json` for markers with a background-task
 * source containing handoff JSON in the reason field.
 *
 * Idempotent: tracks completion via `MIGRATION_ID_CONTINUATION`.
 */
export function migrateFromContinuationMarkers(
  stateManager: OmoStateManager,
): HecateqMigrationResult {
  const result: HecateqMigrationResult = {
    changed: false,
    handoffsMigrated: 0,
    signalsMigrated: 0,
    errors: [],
  }

  const markersDir = join(stateManager["projectRoot"], CONTINUATION_MARKER_DIR)
  if (!existsSync(markersDir)) {
    return result // No markers — nothing to migrate
  }

  let files: string[]
  try {
    files = readdirSync(markersDir).filter((f) => f.endsWith(".json"))
  } catch (error) {
    result.errors.push(`Failed to read markers dir: ${String(error)}`)
    return result
  }

  if (files.length === 0) return result

  const now = new Date().toISOString()
  const handoffs: HecateqStoredHandoff[] = []

  for (const file of files) {
    try {
      const filePath = join(markersDir, file)
      const raw = readFileSync(filePath, "utf-8")
      const marker = JSON.parse(raw) as {
        sources?: Record<string, { state?: string; reason?: string }>
      }

      const bgTask = marker.sources?.["background-task"]
      if (!bgTask?.reason) continue

      let parsed: { status?: string; handoff?: string; signalCount?: number; signals?: Array<{ signal: string }> }
      try {
        parsed = JSON.parse(bgTask.reason) as {
          status?: string
          handoff?: string
          signalCount?: number
          signals?: Array<{ signal: string }>
        }
      } catch {
        continue // Corrupted reason — skip
      }

      const signalNames = parsed.signals?.map((s) => s.signal) ?? []
      const handoff: HecateqStoredHandoff = {
        status: (parsed.status === "DONE" || parsed.status === "IN_PROGRESS" || parsed.status === "BLOCKED")
          ? parsed.status
          : null,
        target: parsed.handoff ?? null,
        signalCount: parsed.signalCount ?? signalNames.length,
        signalNames,
        timestamp: now,
        source: "continuation-marker",
      }

      handoffs.push(handoff)
      result.handoffsMigrated++
      result.signalsMigrated += handoff.signalNames.length
    } catch (error) {
      result.errors.push(`Failed to migrate marker ${file}: ${String(error)}`)
    }
  }

  if (handoffs.length === 0) return result

  // Write handoffs into the new state
  try {
    const state = stateManager.readOrCreate()
    if (!state.handoff) {
      state.handoff = { active: null, history: [] }
    }

    const mostRecent = handoffs[handoffs.length - 1]
    if (mostRecent) {
      state.handoff.active = mostRecent
    }

    state.handoff.history = [...handoffs.reverse(), ...state.handoff.history]

    const writeResult = stateManager.write(state)
    if (writeResult.success) {
      result.changed = true
    } else {
      result.errors.push(`Failed to write migrated state: ${writeResult.error ?? "unknown error"}`)
    }
  } catch (error) {
    result.errors.push(`Migration write failed: ${String(error)}`)
  }

  return result
}

// ─── Run All Migrations ──────────────────────────────────────────────────────

/**
 * Run all pending migrations from MVP state sources into the new
 * `.omo/hecateq/state.json` structure.
 *
 * Skips migrations that are already recorded as completed.
 * Returns a combined result with per-migration details.
 */
export function runAllMigrations(
  stateManager: OmoStateManager,
  boulderState: HecateqOmoState["migrations"],
): HecateqMigrationResult {
  const combined: HecateqMigrationResult = {
    changed: false,
    handoffsMigrated: 0,
    signalsMigrated: 0,
    errors: [],
  }

  // Migration 1: Boulder state
  if (!stateManager.isMigrationComplete(MIGRATION_ID_BOULDER)) {
    const boulderResult = migrateFromBoulderState(stateManager, boulderState)
    combined.handoffsMigrated += boulderResult.handoffsMigrated
    combined.signalsMigrated += boulderResult.signalsMigrated
    combined.errors.push(...boulderResult.errors)
    if (boulderResult.changed) {
      stateManager.markMigrationComplete(MIGRATION_ID_BOULDER)
      combined.changed = true
    }
    // If no data found, do NOT mark complete — allows re-attempt
    // if data appears later (e.g., new Boulder file is created)
  }

  // Migration 2: Continuation markers
  if (!stateManager.isMigrationComplete(MIGRATION_ID_CONTINUATION)) {
    const continuationResult = migrateFromContinuationMarkers(stateManager)
    combined.handoffsMigrated += continuationResult.handoffsMigrated
    combined.signalsMigrated += continuationResult.signalsMigrated
    combined.errors.push(...continuationResult.errors)
    if (continuationResult.changed) {
      stateManager.markMigrationComplete(MIGRATION_ID_CONTINUATION)
      combined.changed = true
    }
  }

  return combined
}
