import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import type { WakeDedupePersistence } from "./wake-idempotency"
import { log } from "../../shared"

/**
 * File-based persistence for wake deduplication keys.
 *
 * Writes dispatched keys to `<stateDir>/wake-dedupe.jsonl` in append-only mode.
 * Uses atomic rename for writes: writes to a temp file, then renames.
 * On read, loads all non-expired keys from the file.
 *
 * Corruption handling: if the file is corrupt (unparseable lines), treats
 * as "no dedupe records" (fail-open) with a warning.
 */
export class FileWakeDedupePersistence implements WakeDedupePersistence {
  private readonly filePath: string
  private readonly ttlMs: number
  private initialized = false

  constructor(stateDir: string, ttlMs: number = 5 * 60 * 1000) {
    this.filePath = join(stateDir, "wake-dedupe.jsonl")
    this.ttlMs = ttlMs
  }

  isAvailable(): boolean {
    return true
  }

  async readKeys(): Promise<string[]> {
    this.ensureInitialized()
    if (!existsSync(this.filePath)) return []

    try {
      const content = readFileSync(this.filePath, "utf-8")
      const lines = content.split("\n").filter((line) => line.trim().length > 0)
      const now = Date.now()
      const validKeys: string[] = []

      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as { key: string; ts: number }
          if (typeof entry.key === "string" && typeof entry.ts === "number") {
            if (now - entry.ts <= this.ttlMs) {
              validKeys.push(entry.key)
            }
          }
        } catch {
          // Corrupt line — skip (fail-open)
        }
      }

      return validKeys
    } catch (err) {
      log("[wake-dedup] Failed to read persistence file, treating as empty (fail-open)", {
        filePath: this.filePath,
        error: String(err),
      })
      return []
    }
  }

  async addKey(key: string): Promise<void> {
    this.ensureInitialized()

    const timestamp = Date.now()
    const line = JSON.stringify({ key, ts: timestamp }) + "\n"

    // Atomic write: write to temp, then rename
    const tmpPath = `${this.filePath}.tmp.${crypto.randomUUID().slice(0, 8)}`
    try {
      // Append the new line to the existing content (or create new)
      const existing = existsSync(this.filePath)
        ? readFileSync(this.filePath, "utf-8")
        : ""
      const newContent = existing + line
      const { writeFileSync } = require("node:fs") as typeof import("node:fs")
      writeFileSync(tmpPath, newContent, "utf-8")
      renameSync(tmpPath, this.filePath)
    } catch (err) {
      // Clean up temp file on failure
      try { unlinkSync(tmpPath) } catch { /* ignore */ }
      log("[wake-dedup] Failed to persist key (non-fatal)", {
        key,
        filePath: this.filePath,
        error: String(err),
      })
    }
  }

  private ensureInitialized(): void {
    if (this.initialized) return
    const dir = join(this.filePath, "..")
    try {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
    } catch {
      // Directory creation failure is non-fatal — writes may still fail later
    }
    this.initialized = true
  }
}
