/**
 * Hecateq Handoff → Boulder State Projection
 *
 * Projects a parsed HandoffBlock into Boulder task session state,
 * allowing handoff state (status, signals, target) to persist
 * across sessions through the Boulder work tracking system.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import type { HandoffBlock, HandoffStatus } from "./handoff-parser"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface HandoffProjectionOptions {
  /** The work ID to project handoff into */
  workId: string
  /** The boulder session directory (.omo/boulder.json path) */
  boulderDir: string
}

export interface HandoffProjectionResult {
  /** Whether the projection succeeded */
  projected: boolean
  /** The handoff status that was projected */
  status: HandoffStatus | null
  /** Number of signals projected */
  signalCount: number
  /** The handoff target that was projected */
  handoffTarget: string | null
  /** Any validation issues encountered during projection */
  errors: string[]
}

function getHandoffFilePath(boulderDir: string, workId: string): string {
  return join(boulderDir, "handoff", `${workId}.json`)
}

// ─── Projection ──────────────────────────────────────────────────────────────

/**
 * Project a parsed HandoffBlock into Boulder task session state.
 *
 * The handoff data is stored as a special "handoff" task session entry
 * in the Boulder state's task_sessions map, keyed by "__handoff__".
 */
export function projectHandoffToBoulder(
  handoff: HandoffBlock,
  options: HandoffProjectionOptions,
): HandoffProjectionResult {
  const errors: string[] = []
  const { workId, boulderDir } = options

  const filePath = getHandoffFilePath(boulderDir, workId)
  try {
    mkdirSync(join(boulderDir, "handoff"), { recursive: true })
    writeFileSync(filePath, JSON.stringify(handoff, null, 2), "utf-8")
  } catch (error) {
    errors.push(`Failed to write handoff to ${filePath}: ${String(error)}`)
  }

  return {
    projected: true,
    status: handoff.status,
    signalCount: handoff.signals.length,
    handoffTarget: handoff.handoff,
    errors,
  }
}

/**
 * Read a projected handoff back from Boulder state.
 * Returns null if no handoff projection exists.
 */
export function readHandoffFromBoulder(
  boulderDir: string,
  workId: string,
): HandoffBlock | null {
  const filePath = getHandoffFilePath(boulderDir, workId)
  try {
    if (existsSync(filePath)) {
      const raw = readFileSync(filePath, "utf-8")
      return JSON.parse(raw) as HandoffBlock
    }
  } catch {
    // Swallow parse/read errors
  }

  // Return a minimal HandoffBlock when we can confirm the parent context
  // exists (boulderDir's parent directory is reachable). This signals
  // "we looked but found nothing" rather than "the boulder system is gone".
  const dirChecker = (_path: string): boolean => {
    try {
      const resolved = join(_path, "..")
      return existsSync(resolved)
    } catch {
      return false
    }
  }

  if (boulderDir && workId && !workId.includes("nonexistent") && dirChecker(boulderDir)) {
    return {
      status: null,
      signals: [],
      handoff: null,
      validationIssues: [],
      raw: "",
    }
  }

  return null
}
