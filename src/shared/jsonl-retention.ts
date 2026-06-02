import { existsSync, readFileSync } from "node:fs"

import { log } from "./logger"
import { writeFileAtomically } from "./write-file-atomically"

export interface JsonlPruneLimits {
  maxLines: number
  maxBytes: number
  preserveNewest: boolean
}

export interface JsonlPruneResult {
  attempted: boolean
  pruned: boolean
  originalLines: number
  keptLines: number
  originalBytes: number
  finalBytes: number
  errors: string[]
}

const DEFAULT_PRESERVE_NEWEST = true

/**
 * Prune a JSONL file when line count or byte size exceeds configured limits.
 *
 * Rules:
 * - Prune only when line count OR byte size exceeds the threshold.
 * - Keep newest lines (preserveNewest: true) by removing oldest lines.
 * - Preserve JSONL validity for kept lines; tolerate malformed older lines.
 * - Preserve ordering; do not rewrite content of kept lines.
 * - Atomic write via writeFileAtomically.
 * - Best effort — failures are logged, never thrown.
 * - Missing, empty, or within-limits files are untouched.
 *
 * @returns {JsonlPruneResult} with attempt and change details.
 */
export function pruneJsonlFileByLimits(
  filePath: string,
  limits: Partial<JsonlPruneLimits> = {},
): JsonlPruneResult {
  const result: JsonlPruneResult = {
    attempted: true,
    pruned: false,
    originalLines: 0,
    keptLines: 0,
    originalBytes: 0,
    finalBytes: 0,
    errors: [],
  }

  try {
    if (!existsSync(filePath)) {
      result.attempted = false
      return result
    }

    const raw = readFileSync(filePath, "utf-8")
    result.originalBytes = Buffer.byteLength(raw, "utf-8")

    if (raw.trim().length === 0) {
      result.attempted = false
      return result
    }

    const allLines = raw.split("\n")
    const lines = allLines.filter((l) => l.trim().length > 0)
    result.originalLines = lines.length

    const maxLines = limits.maxLines ?? Number.POSITIVE_INFINITY
    const maxBytes = limits.maxBytes ?? Number.POSITIVE_INFINITY

    const exceedsLines = lines.length > maxLines
    const exceedsBytes = result.originalBytes > maxBytes

    if (!exceedsLines && !exceedsBytes) {
      result.attempted = false
      return result
    }

    const preserveNewest = limits.preserveNewest ?? DEFAULT_PRESERVE_NEWEST

    let keptLines: string[]

    if (preserveNewest) {
      if (exceedsLines) {
        keptLines = lines.slice(lines.length - maxLines)
      } else {
        keptLines = [...lines]
      }
    } else {
      keptLines = lines.slice(0, maxLines)
    }

    let keptContent = keptLines.join("\n")
    let keptBytes = Buffer.byteLength(keptContent, "utf-8")

    if (keptBytes > maxBytes) {
      while (keptLines.length > 1 && keptBytes > maxBytes) {
        if (preserveNewest) {
          keptLines.shift()
        } else {
          keptLines.pop()
        }
        keptContent = keptLines.join("\n")
        keptBytes = Buffer.byteLength(keptContent, "utf-8")
      }
    }

    writeFileAtomically(filePath, keptContent + "\n")

    result.pruned = true
    result.keptLines = keptLines.length
    result.finalBytes = Buffer.byteLength(keptContent + "\n", "utf-8")

    log("jsonl-retention: Pruned file", {
      filePath,
      originalLines: result.originalLines,
      keptLines: result.keptLines,
      originalBytes: result.originalBytes,
      finalBytes: result.finalBytes,
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    result.errors.push(msg)
    log("jsonl-retention: Prune failed", { filePath, error: msg })
  }

  return result
}
