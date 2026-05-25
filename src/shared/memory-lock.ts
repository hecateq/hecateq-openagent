import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { PROJECT_MEMORY_DIR } from "./memory-bootstrap"
import { writeFileAtomically } from "./write-file-atomically"
import { log } from "./logger"
import {
  type MemoryLock,
  DEFAULT_MEMORY_LOCK_TTL_SECONDS,
} from "./memory-manifest"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Directory for lock files, relative to the project root. */
export const MEMORY_LOCK_DIR_PARENT = PROJECT_MEMORY_DIR
export const MEMORY_LOCK_DIR = ".locks"

/** Minimum allowed TTL. */
export const MIN_MEMORY_LOCK_TTL_SECONDS = 10

/** Maximum allowed TTL. */
export const MAX_MEMORY_LOCK_TTL_SECONDS = 3600

/** Lock file encoding. */
const LOCK_ENCODING = "utf-8" as const

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

/** Resolve the lock directory path for a project root. */
export function getLockDir(projectRoot: string): string {
  return join(projectRoot, MEMORY_LOCK_DIR_PARENT, MEMORY_LOCK_DIR)
}

/** Resolve the lock file path for a specific memory file. */
export function getLockPath(projectRoot: string, fileName: string): string {
  return join(getLockDir(projectRoot), `${fileName}.lock`)
}

// ---------------------------------------------------------------------------
// Lock read / internal helpers
// ---------------------------------------------------------------------------

/**
 * Read a lock file and return the parsed `MemoryLock` object.
 * Returns `null` if the lock file does not exist or is invalid.
 */
export function readLockFile(projectRoot: string, fileName: string): MemoryLock | null {
  const lockPath = getLockPath(projectRoot, fileName)
  if (!existsSync(lockPath)) return null

  try {
    const raw = readFileSync(lockPath, LOCK_ENCODING)
    const parsed: unknown = JSON.parse(raw)
    return validateMemoryLock(parsed)
  } catch {
    log("memory-lock: Failed to read/parse lock file", { lockPath })
    return null
  }
}

/**
 * Validate an unknown object as a MemoryLock.
 * Returns null on structural failure.
 */
function validateMemoryLock(raw: unknown): MemoryLock | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== "object" || Array.isArray(raw)) return null

  const lock = raw as Record<string, unknown>

  if (typeof lock.locked_by_session !== "string") return null
  if (typeof lock.locked_by_agent !== "string") return null
  if (typeof lock.locked_at !== "string") return null
  if (typeof lock.lock_ttl_seconds !== "number" || lock.lock_ttl_seconds <= 0) return null

  return {
    locked_by_session: lock.locked_by_session,
    locked_by_agent: lock.locked_by_agent,
    locked_at: lock.locked_at,
    lock_ttl_seconds: lock.lock_ttl_seconds,
  }
}

/**
 * Check whether a lock has become stale (its TTL has expired).
 * A lock is stale if its age exceeds `lock_ttl_seconds`.
 */
export function isLockStale(lock: MemoryLock, nowMs = Date.now()): boolean {
  const lockedAt = new Date(lock.locked_at).getTime()
  if (Number.isNaN(lockedAt)) return true
  const ageMs = nowMs - lockedAt
  return ageMs > lock.lock_ttl_seconds * 1000
}

/**
 * Check if the lock is owned by the given identity (session + agent).
 */
function isLockOwnedBy(
  lock: MemoryLock,
  sessionId: string,
  agent: string,
): boolean {
  return lock.locked_by_session === sessionId && lock.locked_by_agent === agent
}

/** Ensure the lock directory exists. */
function ensureLockDir(projectRoot: string): void {
  const dir = getLockDir(projectRoot)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

/** Clamp TTL to the allowed range. */
function clampTtl(ttlSeconds: number): number {
  if (ttlSeconds < MIN_MEMORY_LOCK_TTL_SECONDS) return MIN_MEMORY_LOCK_TTL_SECONDS
  if (ttlSeconds > MAX_MEMORY_LOCK_TTL_SECONDS) return MAX_MEMORY_LOCK_TTL_SECONDS
  return Math.floor(ttlSeconds)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Result of an acquire attempt.
 */
export interface AcquireLockResult {
  /** True if the lock was successfully acquired (or re-acquired by same owner). */
  acquired: boolean
  /** True if the lock was taken over from a stale owner. */
  brokeStale: boolean
  /** If not acquired, the current lock holder (null if failed for unknown reason). */
  existingLock: MemoryLock | null
  /** If not acquired, a human-readable reason. */
  reason: string | null
}

/**
 * Acquire a file-based lock for a memory file.
 *
 * Strategy:
 * 1. If no lock file exists → create one and return `acquired: true`.
 * 2. If a lock file exists AND the lock is stale → break it, then create
 *    a new lock and return `acquired: true, brokeStale: true`.
 * 3. If a lock file exists AND the same owner → extend the TTL
 *    (update `locked_at`) and return `acquired: true`.
 * 4. If a lock file exists AND a different owner → return
 *    `acquired: false` with the existing lock info.
 *
 * This is a cooperative, advisory lock — no OS-level enforcement.
 * The caller is responsible for respecting lock state.
 *
 * @param projectRoot - Project root directory
 * @param fileName - Memory file name (e.g., "active-context.md")
 * @param sessionId - Session ID of the locking agent
 * @param agent - Agent name (not harness display name)
 * @param ttlSeconds - Lock TTL in seconds (clamped to 10–3600, default 300)
 */
export function acquireLock(
  projectRoot: string,
  fileName: string,
  sessionId: string,
  agent: string,
  ttlSeconds = DEFAULT_MEMORY_LOCK_TTL_SECONDS,
): AcquireLockResult {
  const effectiveTtl = clampTtl(ttlSeconds)

  // Ensure lock directory exists before any read/write
  ensureLockDir(projectRoot)

  const existing = readLockFile(projectRoot, fileName)

  // Case 1: No existing lock
  if (!existing) {
    writeLock(projectRoot, fileName, sessionId, agent, effectiveTtl)
    return {
      acquired: true,
      brokeStale: false,
      existingLock: null,
      reason: null,
    }
  }

  // Case 2: Stale lock → break it
  if (isLockStale(existing)) {
    breakStaleLock(projectRoot, fileName)
    writeLock(projectRoot, fileName, sessionId, agent, effectiveTtl)
    return {
      acquired: true,
      brokeStale: true,
      existingLock: null,
      reason: null,
    }
  }

  // Case 3: Same owner → extend TTL
  if (isLockOwnedBy(existing, sessionId, agent)) {
    writeLock(projectRoot, fileName, sessionId, agent, effectiveTtl)
    return {
      acquired: true,
      brokeStale: false,
      existingLock: null,
      reason: null,
    }
  }

  // Case 4: Different owner → blocked
  return {
    acquired: false,
    brokeStale: false,
    existingLock: existing,
    reason: `Lock held by session "${existing.locked_by_session}" agent "${existing.locked_by_agent}"`,
  }
}

/**
 * Release a file-based lock.
 *
 * Does nothing if:
 * - The lock file does not exist
 * - The lock file exists but has a different owner (returns `false`)
 *
 * @returns `true` if the lock was released, `false` otherwise.
 */
export function releaseLock(
  projectRoot: string,
  fileName: string,
  sessionId: string,
  agent: string,
): boolean {
  const existing = readLockFile(projectRoot, fileName)
  if (!existing) return false

  // Only the lock owner can release
  if (!isLockOwnedBy(existing, sessionId, agent)) return false

  const lockPath = getLockPath(projectRoot, fileName)
  try {
    unlinkSync(lockPath)
    return true
  } catch {
    log("memory-lock: Failed to unlink lock file", { lockPath })
    return false
  }
}

/**
 * Force-release a lock regardless of owner. Use with caution —
 * only for recovery or when the caller is certain the lock is stale.
 *
 * Does nothing if the lock file does not exist.
 */
export function breakStaleLock(
  projectRoot: string,
  fileName: string,
): void {
  const lockPath = getLockPath(projectRoot, fileName)
  if (!existsSync(lockPath)) return

  try {
    unlinkSync(lockPath)
  } catch {
    log("memory-lock: Failed to break stale lock", { lockPath })
  }
}

/**
 * Get the current lock state for a memory file.
 * Returns `null` if no lock exists (file is free).
 */
export function getLock(
  projectRoot: string,
  fileName: string,
): MemoryLock | null {
  return readLockFile(projectRoot, fileName)
}

/**
 * List all memory files that currently have an active (non-stale) lock.
 */
export function listActiveLocks(
  projectRoot: string,
): Array<{ fileName: string; lock: MemoryLock }> {
  const lockDir = getLockDir(projectRoot)
  if (!existsSync(lockDir)) return []

  const results: Array<{ fileName: string; lock: MemoryLock }> = []

  try {
    const entries = readdirSync(lockDir)
    for (const entry of entries) {
      if (!entry.endsWith(".lock")) continue

      const fileName = entry.slice(0, -".lock".length)
      const lock = readLockFile(projectRoot, fileName)
      if (lock && !isLockStale(lock)) {
        results.push({ fileName, lock })
      }
    }
  } catch {
    // Directory missing or unreadable — return empty
  }

  return results
}

// ---------------------------------------------------------------------------
// Internal write helper
// ---------------------------------------------------------------------------

function writeLock(
  projectRoot: string,
  fileName: string,
  sessionId: string,
  agent: string,
  ttlSeconds: number,
): void {
  const lockPath = getLockPath(projectRoot, fileName)
  const lock: MemoryLock = {
    locked_by_session: sessionId,
    locked_by_agent: agent,
    locked_at: new Date().toISOString(),
    lock_ttl_seconds: ttlSeconds,
  }

  const json = JSON.stringify(lock, null, 2) + "\n"

  // Use atomic write for the lock file — critical to avoid partial locks
  try {
    writeFileAtomically(lockPath, json)
  } catch {
    // Fallback to direct write if atomic fails (e.g., EXDEV on some mounts)
    writeFileSync(lockPath, json, LOCK_ENCODING)
  }
}
