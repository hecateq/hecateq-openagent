/**
 * Memory Subagent Write Guard — Phase 3B.2
 *
 * Detects and blocks direct subagent write attempts to Hecateq memory files
 * (.opencode/state/memory/). Subagents must emit MEMORY_UPDATE blocks
 * instead of directly editing memory files.
 *
 * Designated writers (bootstrap, manifest, doctor, handoff, task-completion)
 * are allowed to write through their specific identity paths.
 */

import { join, relative } from "node:path"
import { PROJECT_MEMORY_DIR } from "./memory-bootstrap"
import { subagentSessions, syncSubagentSessions } from "../features/claude-code-session-state/state"
import { log } from "./logger"

const SUBAGENT_BLOCK_MESSAGE =
  "Subagents cannot directly edit Hecateq memory files. Emit a MEMORY_UPDATE block instead."

// Files explicitly allowed for subagent write paths (designated writers)
const ALLOWED_DIRECT_WRITE_ABS_PREFIXES: string[] = []

function isSubagentWriteTarget(absolutePath: string): boolean {
  const norm = absolutePath.replace(/\\/g, "/")
  return norm.includes(`/${PROJECT_MEMORY_DIR}/`) || norm.endsWith(`/${PROJECT_MEMORY_DIR}`)
}

function isSubagentSession(sessionId: string | undefined): boolean {
  if (!sessionId) return false
  return subagentSessions.has(sessionId) || syncSubagentSessions.has(sessionId)
}

export interface SubagentWriteGuardResult {
  blocked: boolean
  reason: string | null
}

export function checkSubagentMemoryWrite(
  filePath: string,
  sessionId: string | undefined,
): SubagentWriteGuardResult {
  if (!sessionId) return { blocked: false, reason: null }

  if (!isSubagentSession(sessionId)) {
    return { blocked: false, reason: null }
  }

  const normalized = filePath.replace(/\\/g, "/")

  for (const prefix of ALLOWED_DIRECT_WRITE_ABS_PREFIXES) {
    if (normalized.startsWith(prefix)) {
      return { blocked: false, reason: null }
    }
  }

  if (isSubagentWriteTarget(normalized)) {
    log("memory-subagent-guard: Blocked subagent direct memory write", {
      sessionId,
      filePath,
    })
    return { blocked: true, reason: SUBAGENT_BLOCK_MESSAGE }
  }

  return { blocked: false, reason: null }
}

export function detectSubagentMemoryWrite(
  textContent: string,
  sessionId: string | undefined,
): { detected: boolean; count: number } {
  if (!sessionId || !isSubagentSession(sessionId)) {
    return { detected: false, count: 0 }
  }

  const pattern = new RegExp(
    `(?:write|edit|create|modify|update)\\s+(?:to\\s+)?["'\`]?[^"'\`\\n]*${PROJECT_MEMORY_DIR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^"'\`\\n]*["'\`]?`,
    "gi",
  )

  const matches = textContent.match(pattern)
  const count = matches ? matches.length : 0

  if (count > 0) {
    log("memory-subagent-guard: Detected potential memory write references in subagent text", {
      sessionId,
      count,
    })
  }

  return { detected: count > 0, count }
}
