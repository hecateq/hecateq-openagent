import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { PROJECT_MEMORY_DIR } from "./memory-bootstrap"
import {
  writeOpenQuestions,
  writeOpenQuestionFromSignal,
  OPEN_QUESTIONS_WRITER_IDENTITY,
  type OpenQuestionEntry,
} from "./memory-open-questions-writer"
import { acquireLock, releaseLock } from "./memory-lock"
import { readManifest } from "./memory-manifest"
import { canWriteMemoryFile } from "./memory-writer-ownership"
import { writeFileSync } from "node:fs"

function setupTempDir(): string {
  const dir = join(tmpdir(), `omo-moq-${randomUUID()}`)
  mkdirSync(join(dir, PROJECT_MEMORY_DIR), { recursive: true })
  return dir
}

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
}

function filePath(root: string, name: string): string {
  return join(root, PROJECT_MEMORY_DIR, name)
}

function writeMemoryJson(root: string): void {
  const manifest = {
    schema_version: 2,
    manifest_revision: 1,
    manifest_updated_at: new Date().toISOString(),
    token_budget: { total_cost_chars: 0, estimated_total_tokens: 0, reading_cost: "low" as const, recommended_read_order: [] },
    files: {},
    required_files: ["progress.md", "tasks.md", "file-map.md", "decisions.md", "agent-routing.md", "quality-history.md", "risk-profile.md", "open-questions.md", "conventions.md", "environment.md", "active-context.md"],
    optional_files: [],
    deprecated_files: [],
    locks: {},
    migrations_applied: [],
    harness_timestamps: { opencode: null, "claude-code": null, codex: null, cli: null },
    project_identity: { project_id: "test", project_name: "test", workspace_kind: "single" as const },
    discovery: { pointer_file: "", authoritative_root: "", continuation_path: "" },
    resume: { continuation_state: "missing" as const, summary: "", primary_task_ref: "", next_step_hint: "", suggested_reads: [], last_handoff_at: null },
  }
  writeFileSync(filePath(root, "memory.json"), JSON.stringify(manifest, null, 2), "utf-8")
}

describe("memory-open-questions-writer", () => {
  describe("#writeOpenQuestions", () => {
    it("writes entries to open-questions.md", () => {
      // given
      const root = setupTempDir()
      const entries: OpenQuestionEntry[] = [
        {
          question: "What database should we use?",
          context: "Need to choose between SQLite and PostgreSQL",
          category: "active",
        },
      ]

      // when
      const result = writeOpenQuestions(root, entries)

      // then
      expect(result.written).toBe(true)
      expect(result.file).toBe("open-questions.md")
      const content = readFileSync(filePath(root, "open-questions.md"), "utf-8")
      expect(content).toContain("What database should we use?")
      expect(content).toContain("## Active Questions")

      cleanup(root)
    })

    it("skips when entries array is empty", () => {
      // given
      const root = setupTempDir()

      // when
      const result = writeOpenQuestions(root, [])

      // then
      expect(result.written).toBe(false)
      expect(result.reason).toContain("no entries to write")

      cleanup(root)
    })

    it("categorizes entries into correct sections", () => {
      // given
      const root = setupTempDir()
      const entries: OpenQuestionEntry[] = [
        { question: "Active Q", category: "active" },
        { question: "Waiting Q", category: "waiting" },
        { question: "Tradeoff Q", category: "tradeoff" },
        { question: "Resolved Q", category: "resolved", answer: "Use SQLite" },
      ]

      // when
      writeOpenQuestions(root, entries)

      // then
      const content = readFileSync(filePath(root, "open-questions.md"), "utf-8")
      expect(content).toContain("Active Q")
      expect(content).toContain("Waiting Q")
      expect(content).toContain("Tradeoff Q")
      expect(content).toContain("Resolved Q")
      expect(content).toContain("Use SQLite")

      cleanup(root)
    })

    it("includes timestamp in formatted entry", () => {
      // given
      const root = setupTempDir()
      const ts = "2026-06-06T12:00:00.000Z"
      const entries: OpenQuestionEntry[] = [
        { question: "Test question", timestamp: ts, category: "active" },
      ]

      // when
      writeOpenQuestions(root, entries)

      // then
      const content = readFileSync(filePath(root, "open-questions.md"), "utf-8")
      expect(content).toContain("2026-06-06")

      cleanup(root)
    })
  })

  describe("#Phase 2 lock + manifest", () => {
    it("acquires lock before write (lock acquired blocks second write)", () => {
      // given
      const root = setupTempDir()
      const entries: OpenQuestionEntry[] = [
        { question: "Test lock", category: "active" },
      ]

      // Acquire lock first (simulate another writer)
      acquireLock(root, "open-questions.md", "other-session", "other-agent", 300)

      // when — write should fail to acquire lock
      const result = writeOpenQuestions(root, entries)

      // then
      expect(result.written).toBe(false)
      expect(result.reason).toContain("lock")

      // release
      releaseLock(root, "open-questions.md", "other-session", "other-agent")
      cleanup(root)
    })

    it("releases lock after write", () => {
      // given
      const root = setupTempDir()
      const entries: OpenQuestionEntry[] = [
        { question: "Release test", category: "active" },
      ]

      // when
      writeOpenQuestions(root, entries)

      // then — lock should be released
      const lock = acquireLock(root, "open-questions.md", "test-session", "test-agent", 300)
      expect(lock.acquired).toBe(true)
      releaseLock(root, "open-questions.md", "test-session", "test-agent")

      cleanup(root)
    })

    it("refreshes manifest after successful write", () => {
      // given
      const root = setupTempDir()
      writeMemoryJson(root)
      const entries: OpenQuestionEntry[] = [
        { question: "What DB to use for manifest test?", category: "active" },
      ]

      // Read manifest before write
      const before = readManifest(root)
      const beforeHash = before?.files?.["open-questions.md"]?.content_hash

      // when
      writeOpenQuestions(root, entries)

      // then — manifest should be updated
      const after = readManifest(root)
      expect(after).not.toBeNull()
      if (after) {
        const entry = after.files["open-questions.md"]
        expect(entry).toBeDefined()
        if (beforeHash) {
          expect(entry.content_hash).not.toBe(beforeHash)
        }
        expect(entry.size_bytes).toBeGreaterThan(0)
        expect(entry.last_modified).toBeDefined()
      }

      cleanup(root)
    })

    it("router result carries manifest update info when manifest exists", () => {
      // given
      const root = setupTempDir()
      writeMemoryJson(root)
      const entries: OpenQuestionEntry[] = [
        { question: "Manifest test question", category: "active" },
      ]

      // when
      const result = writeOpenQuestions(root, entries)

      // then — manifestUpdated should be true and manifestReason null
      expect(result.written).toBe(true)
      expect(result.reason).toContain("manifest")
      expect(result.manifestUpdated).toBe(true)
      expect(result.manifestReason).toBeNull()

      cleanup(root)
    })

    it("returns manifestUpdated=false when lock prevents write", () => {
      const root = setupTempDir()
      const entries: OpenQuestionEntry[] = [
        { question: "Lock manifest test", category: "active" },
      ]

      // Acquire lock
      acquireLock(root, "open-questions.md", "other", "other", 300)

      const result = writeOpenQuestions(root, entries)

      expect(result.written).toBe(false)
      expect(result.manifestUpdated).toBe(false)
      expect(result.manifestReason).toMatch(/[Ll]ock/)

      releaseLock(root, "open-questions.md", "other", "other")
      cleanup(root)
    })

    it("returns manifestUpdated=false when ownership violated", () => {
      const root = setupTempDir()
      const entries: OpenQuestionEntry[] = [
        { question: "Ownership test", category: "active" },
      ]

      const result = writeOpenQuestions(root, entries, "quality_writer")

      expect(result.written).toBe(false)
      expect(result.manifestUpdated).toBe(false)
      expect(result.manifestReason).toContain("not authorized")

      cleanup(root)
    })
  })

  describe("#writeOpenQuestionFromSignal", () => {
    it("writes from MEMORY_UPDATE data with question field", () => {
      // given
      const root = setupTempDir()
      const data = { question: "Should we migrate to ESM?", context: "Package.json type field" }

      // when
      const result = writeOpenQuestionFromSignal(root, data)

      // then
      expect(result.written).toBe(true)
      const content = readFileSync(filePath(root, "open-questions.md"), "utf-8")
      expect(content).toContain("Should we migrate to ESM?")

      cleanup(root)
    })

    it("writes from MEMORY_UPDATE data using description fallback", () => {
      // given
      const root = setupTempDir()
      const data = { description: "How should we handle auth?" }

      // when
      const result = writeOpenQuestionFromSignal(root, data)

      // then
      expect(result.written).toBe(true)
      const content = readFileSync(filePath(root, "open-questions.md"), "utf-8")
      expect(content).toContain("How should we handle auth?")

      cleanup(root)
    })

    it("skips when question is too short", () => {
      // given
      const root = setupTempDir()
      const data = { question: "Hi" }

      // when
      const result = writeOpenQuestionFromSignal(root, data)

      // then
      expect(result.written).toBe(false)
      expect(result.reason).toContain("too short")

      cleanup(root)
    })

    it("skips when no question data exists", () => {
      // given
      const root = setupTempDir()

      // when
      const result = writeOpenQuestionFromSignal(root, undefined)

      // then
      expect(result.written).toBe(false)

      cleanup(root)
    })

    it("writes resolved category questions correctly", () => {
      // given
      const root = setupTempDir()
      const data = {
        question: "What DB to use?",
        answer: "PostgreSQL",
        category: "resolved",
        resolved_by: "dec-001",
      }

      // when
      writeOpenQuestionFromSignal(root, data)

      // then
      const content = readFileSync(filePath(root, "open-questions.md"), "utf-8")
      expect(content).toContain("What DB to use?")
      expect(content).toContain("PostgreSQL")
      expect(content).toContain("dec-001")

      cleanup(root)
    })
  })
})
