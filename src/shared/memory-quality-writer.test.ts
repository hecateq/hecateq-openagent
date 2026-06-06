import { describe, expect, it } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  writeQualityHistory,
  readQualityHistory,
  formatQualityEntry,
  parseQualityHistory,
  compactQualityHistory,
  QUALITY_OUTPUT_SUMMARY_MAX_LENGTH,
  type QualityHistoryEntry,
  type QualityGateReport,
} from "./memory-quality-writer"
import { getLock, acquireLock, releaseLock } from "./memory-lock"
import { PROJECT_MEMORY_DIR } from "./memory-bootstrap"

const HISTORY_FILE = "quality-history.md"
const LOCK_SESSION = "memory-quality-writer"
const LOCK_AGENT = "memory-quality-writer"

describe("memory-quality-writer", () => {
  let testDir = ""

  function setupTempDir(): string {
    testDir = join(tmpdir(), `omo-mem-quality-${randomUUID()}`)
    mkdirSync(join(testDir, PROJECT_MEMORY_DIR), { recursive: true })
    return testDir
  }

  function cleanup(): void {
    if (testDir) rmSync(testDir, { recursive: true, force: true })
  }

  function makeReport(overrides?: Partial<QualityGateReport>): QualityGateReport {
    return {
      results: [
        {
          kind: "typecheck",
          passed: true,
          command: "bun run typecheck",
          exitCode: 0,
          stdout: "",
          stderr: "",
          message: "Typecheck passed",
          skipped: false,
        },
      ],
      allPassed: true,
      passedCount: 1,
      failedCount: 0,
      skippedCount: 0,
      ...overrides,
    }
  }

  function makeEntry(overrides?: Partial<QualityHistoryEntry>): QualityHistoryEntry {
    return {
      timestamp: "2025-01-01T00:00:00.000Z",
      command: "bun run typecheck",
      result: "PASS",
      output_summary: "typecheck: PASS — Typecheck passed",
      known_failures: [],
      is_pre_existing: false,
      verification_pending: [],
      ...overrides,
    }
  }

  describe("writeQualityHistory", () => {
    it("creates file if missing", () => {
      const root = setupTempDir()
      const historyPath = join(root, PROJECT_MEMORY_DIR, HISTORY_FILE)

      expect(existsSync(historyPath)).toBe(false)
      writeQualityHistory(root, makeReport())
      expect(existsSync(historyPath)).toBe(true)

      const content = readFileSync(historyPath, "utf-8")
      expect(content).toContain("# Quality History")
      expect(content).toContain("Last updated:")
      expect(content).toContain("## Quality Gate Run —")

      cleanup()
    })

    it("writes entry to quality-history.md", () => {
      const root = setupTempDir()
      const report = makeReport()

      writeQualityHistory(root, report)
      const content = readFileSync(join(root, PROJECT_MEMORY_DIR, HISTORY_FILE), "utf-8")
      expect(content).toContain("PASS")
      expect(content).toContain("Typecheck passed")
      expect(content).toContain("bun run typecheck")

      cleanup()
    })

    it("acquires lock before write", () => {
      const root = setupTempDir()
      const historyPath = join(root, PROJECT_MEMORY_DIR, HISTORY_FILE)

      acquireLock(root, HISTORY_FILE, "blocker-session", "blocker-agent")
      writeQualityHistory(root, makeReport())
      expect(existsSync(historyPath)).toBe(false)

      releaseLock(root, HISTORY_FILE, "blocker-session", "blocker-agent")
      cleanup()
    })

    it("releases lock after write", () => {
      const root = setupTempDir()

      writeQualityHistory(root, makeReport())
      const lock = getLock(root, HISTORY_FILE)
      expect(lock).toBeNull()

      cleanup()
    })
  })

  describe("readQualityHistory", () => {
    it("returns empty array if file missing", () => {
      const root = setupTempDir()
      const entries = readQualityHistory(root)
      expect(entries).toEqual([])
      cleanup()
    })

    it("parses entries correctly", () => {
      const root = setupTempDir()
      const report = makeReport()

      writeQualityHistory(root, report)
      const entries = readQualityHistory(root)

      expect(entries.length).toBe(1)
      expect(entries[0].result).toBe("PASS")
      expect(entries[0].command).toContain("bun run typecheck")

      cleanup()
    })
  })

  describe("formatQualityEntry", () => {
    it("formats entry as markdown", () => {
      const entry = makeEntry()
      const result = formatQualityEntry(entry)

      expect(result).toContain("## Quality Gate Run — 2025-01-01T00:00:00.000Z")
      expect(result).toContain("Result: PASS")
      expect(result).toContain("Command: bun run typecheck")
      expect(result).toContain("### Output Summary")
    })

    it("includes known failures section when present", () => {
      const entry = makeEntry({ known_failures: ["known flaky test: login.spec.ts"] })
      const result = formatQualityEntry(entry)

      expect(result).toContain("### Known Failures")
      expect(result).toContain("known flaky test: login.spec.ts")
    })

    it("includes verification pending section when present", () => {
      const entry = makeEntry({ verification_pending: ["integration-test"] })
      const result = formatQualityEntry(entry)

      expect(result).toContain("### Verification Pending")
      expect(result).toContain("integration-test")
    })
  })

  describe("parseQualityHistory", () => {
    it("parses markdown back to entries", () => {
      const entry = makeEntry()
      const markdown = formatQualityEntry(entry)
      const entries = parseQualityHistory(markdown)

      expect(entries.length).toBe(1)
      expect(entries[0].timestamp).toBe("2025-01-01T00:00:00.000Z")
      expect(entries[0].result).toBe("PASS")
      expect(entries[0].command).toBe("bun run typecheck")
    })

    it("handles empty content", () => {
      const entries = parseQualityHistory("")
      expect(entries).toEqual([])
    })

    it("handles malformed entries gracefully", () => {
      const badContent = `# Quality History\n\nLast updated: 2025-01-01\n\nThis is not a valid entry\n\n## Random heading`
      const entries = parseQualityHistory(badContent)
      expect(entries).toEqual([])
    })

    it("parses multiple entries correctly", () => {
      const root = setupTempDir()
      writeQualityHistory(root, makeReport())
      writeQualityHistory(root, makeReport({ allPassed: false, failedCount: 1 }))
      const entries = readQualityHistory(root)

      expect(entries.length).toBe(2)
      expect(entries[0].result).toBe("FAIL")
      expect(entries[1].result).toBe("PASS")

      cleanup()
    })
  })

  describe("#compactQualityHistory - Phase 2 FAIL preservation", () => {
    it("preserves FAIL entries preferentially over PASS entries", () => {
      const root = setupTempDir()

      // Write 25 PASS entries, then 1 FAIL entry
      for (let i = 0; i < 25; i++) {
        writeQualityHistory(root, makeReport({ allPassed: true, passedCount: 1 }))
      }
      writeQualityHistory(root, makeReport({ allPassed: false, failedCount: 1 }))

      // Verify FAIL is preserved after auto-compaction at 20
      const entries = readQualityHistory(root)
      const failEntries = entries.filter((e) => e.result === "FAIL")
      expect(failEntries.length).toBeGreaterThanOrEqual(1)

      cleanup()
    })

    it("FAIL entries survive manual compactAndDedupeRisks-like compaction", () => {
      const root = setupTempDir()

      // Write 20 PASS + 5 FAIL entries
      for (let i = 0; i < 20; i++) {
        writeQualityHistory(root, makeReport({ allPassed: true, passedCount: 1 }))
      }
      for (let i = 0; i < 5; i++) {
        writeQualityHistory(root, makeReport({ allPassed: false, failedCount: 1 }))
      }

      const entriesBefore = readQualityHistory(root)
      const failCountBefore = entriesBefore.filter((e) => e.result === "FAIL").length

      // Compact with strict limit 10
      const result = compactQualityHistory(root, 10)

      const entriesAfter = readQualityHistory(root)
      const failCountAfter = entriesAfter.filter((e) => e.result === "FAIL").length

      // All FAIL entries should be preserved
      expect(failCountAfter).toBeGreaterThanOrEqual(failCountBefore)

      cleanup()
    })

    it("does not needlessly delete FAIL history", () => {
      // given: entries mostly within limit
      const root = setupTempDir()

      // Write 10 entries, 5 FAIL
      for (let i = 0; i < 5; i++) {
        writeQualityHistory(root, makeReport({ allPassed: true, passedCount: 1 }))
      }
      for (let i = 0; i < 5; i++) {
        writeQualityHistory(root, makeReport({ allPassed: false, failedCount: 1 }))
      }

      // Compact with limit 20 — entries are within limit
      const result = compactQualityHistory(root, 20)

      // No compaction needed
      expect(result.compacted).toBe(false)

      const entries = readQualityHistory(root)
      expect(entries.filter((e) => e.result === "FAIL").length).toBe(5)

      cleanup()
    })

    it("QUALITY_OUTPUT_SUMMARY_MAX_LENGTH is at least 500", () => {
      expect(QUALITY_OUTPUT_SUMMARY_MAX_LENGTH).toBeGreaterThanOrEqual(500)
    })
  })
})
