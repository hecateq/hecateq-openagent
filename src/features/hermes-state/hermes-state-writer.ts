/**
 * Hermes State Writer — safe file I/O for Hermes Agentic OS read-only state export.
 *
 * Writes to <projectRoot>/.opencode/state/ on behalf of Hermes.
 * - Never throws on write failures (best-effort with logged errors).
 * - All writes are atomic via tmp+rename.
 * - JSONL is append-only.
 * - Sanitization helpers strip secret-like fields.
 *
 * This module is plugin-side only. No HTTP server, no dashboard UI.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const STATE_DIR = join(".opencode", "state")

// ─── Patterns for secret-like field detection ──────────────────────────────
const SECRET_KEY_PATTERNS = [
  /secret/i,
  /token/i,
  /password/i,
  /passwd/i,
  /api[_-]?key/i,
  /auth/i,
  /credential/i,
  /private[_-]?key/i,
  /access[_-]?key/i,
  /signing[_-]?key/i,
  /encryption[_-]?key/i,
]

const SECRET_VALUE_PATTERNS = [
  /^sk-[a-zA-Z0-9]{20,}/,
  /^pk-[a-zA-Z0-9]{20,}/,
  /^ghp_[a-zA-Z0-9]{20,}/,
  /^gho_[a-zA-Z0-9]{20,}/,
  /^ghu_[a-zA-Z0-9]{20,}/,
  /^ghs_[a-zA-Z0-9]{20,}/,
  /^ghr_[a-zA-Z0-9]{20,}/,
  /^xox[bprsa]-[a-zA-Z0-9-]+/,
  /^eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/, // JWT-like
  /^[A-Za-z0-9+/]{40,}={0,2}$/,                    // base64-like (40+ chars)
]

export interface HermesStateWriterConfig {
  projectRoot: string
}

export class HermesStateWriter {
  readonly projectRoot: string

  constructor(projectRoot: string) {
    if (!projectRoot || projectRoot.trim().length === 0) {
      throw new Error("HermesStateWriter: projectRoot is required")
    }
    this.projectRoot = projectRoot
  }

  /** Absolute path to the state directory */
  get stateDir(): string {
    return join(this.projectRoot, STATE_DIR)
  }

  /** Absolute path to the events sub-directory */
  get eventsDir(): string {
    return join(this.stateDir, "events")
  }

  // ── Directory management ────────────────────────────────────────────────

  /** Ensure state directory exists. Never throws. */
  ensureStateDir(): boolean {
    try {
      mkdirSync(this.stateDir, { recursive: true })
      return true
    } catch {
      return false
    }
  }

  /** Ensure events directory exists. Never throws. */
  ensureEventsDir(): boolean {
    try {
      mkdirSync(this.eventsDir, { recursive: true })
      return true
    } catch {
      return false
    }
  }

  // ── Atomic write ────────────────────────────────────────────────────────

  /**
   * Write content to a file atomically via tmp+rename.
   * Always writes through the state directory root.
   * Returns true on success, false on failure. Never throws.
   */
  writeAtomically(filename: string, content: string): boolean {
    try {
      this.ensureStateDir()
      const targetPath = join(this.stateDir, filename)
      const tmpPath = `${targetPath}.tmp`

      writeFileSync(tmpPath, content, "utf-8")
      renameSync(tmpPath, targetPath)
      return true
    } catch (error) {
      // Best-effort; Hermes reads are tolerant of missing/corrupt files
      return false
    }
  }

  // ── JSONL append ────────────────────────────────────────────────────────

  /**
   * Append a single JSON object as a line to a JSONL file.
   * The file is created if it does not exist.
   * Returns true on success, false on failure. Never throws.
   *
   * @param filePath - Relative path below stateDir (e.g., "events/events-2026-06-03.jsonl")
   */
  appendJSONL(filePath: string, obj: Record<string, unknown>): boolean {
    try {
      this.ensureStateDir()
      const fullPath = join(this.stateDir, filePath)
      const dir = join(fullPath, "..")
      try {
        mkdirSync(dir, { recursive: true })
      } catch {
        // Directory may already exist
      }
      const line = JSON.stringify(obj) + "\n"
      appendFileSync(fullPath, line, "utf-8")
      return true
    } catch {
      return false
    }
  }

  // ── Sanitization helpers ────────────────────────────────────────────────

  /**
   * Check if a key name matches secret-like patterns.
   * Used to decide whether to strip a field from exported data.
   */
  isSecretKey(key: string): boolean {
    return SECRET_KEY_PATTERNS.some((p) => p.test(key))
  }

  /**
   * Check if a string value looks like a secret (API key, token, etc).
   */
  isSecretValue(value: string): boolean {
    if (typeof value !== "string" || value.length === 0) return false
    return SECRET_VALUE_PATTERNS.some((p) => p.test(value))
  }

  /**
   * Sanitize an object for export: recursively strip secret-like fields.
   * Returns a new object — never mutates the original.
   */
  sanitizeForExport<T>(value: T, maxDepth = 10): T {
    if (maxDepth <= 0) return "[truncated]" as unknown as T
    if (value === null || value === undefined) return value
    if (typeof value !== "object") {
      if (typeof value === "string" && this.isSecretValue(value)) {
        return "[redacted]" as unknown as T
      }
      return value
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.sanitizeForExport(item, maxDepth - 1)) as unknown as T
    }
    const result: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (this.isSecretKey(key)) {
        result[key] = "[redacted]"
        continue
      }
      result[key] = this.sanitizeForExport(val, maxDepth - 1)
    }
    return result as T
  }

  /**
   * Truncate a description string for safe export.
   * Hermes needs short descriptions, not full prompts.
   */
  static truncateDescription(desc: string | undefined | null, maxLen = 200): string {
    if (!desc) return ""
    const cleaned = desc.replace(/[\n\r]+/g, " ").trim()
    if (cleaned.length <= maxLen) return cleaned
    return cleaned.slice(0, maxLen - 3) + "..."
  }

  /**
   * Format a Date to ISO-8601 or return null.
   */
  static toISO(date: Date | undefined | null): string | null {
    if (!date) return null
    try {
      return date.toISOString()
    } catch {
      return null
    }
  }
}
