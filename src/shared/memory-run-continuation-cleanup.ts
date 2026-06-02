import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs"
import { join } from "node:path"

import { log } from "./logger"
import {
  RUN_CONTINUATION_MARKER_MAX_AGE_DAYS,
  RUN_CONTINUATION_MAX_MARKERS,
} from "./memory-retention-policy"

const DEFAULT_MARKER_DIR = ".omo/run-continuation"

const MS_PER_DAY = 86_400_000

export interface ContinuationMarkerCleanupResult {
  attempted: boolean
  removed: number
  kept: number
  errors: string[]
}

/**
 * Clean up stale run-continuation markers from the marker directory.
 *
 * Removes markers older than maxAgeDays (default 30 days) and prunes
 * oldest markers when more than maxMarkers (default 200) exist.
 * Preserves the active marker if identifiable (sources with state "active").
 * Tolerates malformed files. Never climbs outside the project root.
 * Best-effort only; failures are logged, never thrown.
 */
export function cleanupContinuationMarkers(
  projectRoot: string,
  markerDir: string = DEFAULT_MARKER_DIR,
  maxAgeDays: number = RUN_CONTINUATION_MARKER_MAX_AGE_DAYS,
  maxMarkers: number = RUN_CONTINUATION_MAX_MARKERS,
): ContinuationMarkerCleanupResult {
  const result: ContinuationMarkerCleanupResult = {
    attempted: true,
    removed: 0,
    kept: 0,
    errors: [],
  }

  try {
    const markersPath = join(projectRoot, markerDir)

    if (!existsSync(markersPath)) {
      result.attempted = false
      return result
    }

    let dirents: string[]
    try {
      dirents = readdirSync(markersPath)
    } catch {
      result.attempted = false
      return result
    }

    if (dirents.length === 0) {
      result.attempted = false
      return result
    }

    const markerFiles = dirents
      .filter((name) => name.endsWith(".json"))
      .map((name) => ({
        name,
        path: join(markersPath, name),
        mtimeMs: (() => {
          try {
            return statSync(join(markersPath, name)).mtimeMs
          } catch {
            return 0
          }
        })(),
        isActive: (() => {
          try {
            const raw = readFileSync(
              join(markersPath, name),
              "utf-8",
            )
            const parsed = JSON.parse(raw)
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
              return false
            const sources = (parsed as Record<string, unknown>).sources
            if (!sources || typeof sources !== "object" || Array.isArray(sources))
              return false
            return Object.values(
              sources as Record<string, Record<string, unknown>>,
            ).some((entry) => entry?.state === "active")
          } catch {
            return false
          }
        })(),
      }))
      .filter((f) => f.mtimeMs > 0)

    const now = Date.now()
    const maxAgeMs = maxAgeDays * MS_PER_DAY

    const stale = markerFiles.filter(
      (f) => !f.isActive && now - f.mtimeMs > maxAgeMs,
    )

    for (const file of stale) {
      try {
        rmSync(file.path)
        result.removed++
      } catch (error) {
        result.errors.push(
          `Failed to remove ${file.name}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }

    const remaining = markerFiles.filter(
      (f) => !stale.includes(f),
    )

    if (remaining.length > maxMarkers) {
      const sorted = remaining
        .filter((f) => !f.isActive)
        .sort((a, b) => a.mtimeMs - b.mtimeMs)

      const toRemove = sorted.slice(0, sorted.length - maxMarkers)

      for (const file of toRemove) {
        try {
          rmSync(file.path)
          result.removed++
        } catch (error) {
          result.errors.push(
            `Failed to remove ${file.name}: ${error instanceof Error ? error.message : String(error)}`,
          )
        }
      }
    }

    if (result.removed > 0) {
      log("memory-run-continuation-cleanup: Cleaned up markers", {
        projectRoot,
        removed: result.removed,
        errors: result.errors.length,
      })
    }
  } catch (error) {
    result.errors.push(
      error instanceof Error ? error.message : String(error),
    )
    log("memory-run-continuation-cleanup: Cleanup failed", {
      projectRoot,
      error: result.errors[result.errors.length - 1],
    })
  }

  return result
}
