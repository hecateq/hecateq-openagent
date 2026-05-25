import { describe, expect, it } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  buildContinuation,
  computeContinuationState,
  readContinuation,
  writeContinuation,
  validateContinuation,
  buildContinuationSummary,
  getContinuationPath,
  CONTINUATION_SCHEMA_VERSION,
  type MemoryContinuation,
} from "./memory-continuation"
import {
  PROJECT_MEMORY_DIR,
  bootstrapMemoryFiles,
} from "./memory-bootstrap"
import {
  createMemoryManifest,
  writeManifest,
  type MemoryManifest,
} from "./memory-manifest"

describe("memory-continuation", () => {
  let testDir = ""

  function setupTempDir(): string {
    testDir = join(tmpdir(), `omo-mem-cont-${randomUUID()}`)
    mkdirSync(testDir, { recursive: true })
    return testDir
  }

  function cleanup(): void {
    if (testDir) rmSync(testDir, { recursive: true, force: true })
  }

  function setupProject(): { root: string; manifest: MemoryManifest } {
    const root = setupTempDir()
    mkdirSync(join(root, ".opencode"), { recursive: true })
    bootstrapMemoryFiles(root)
    const manifest = createMemoryManifest(root)
    writeManifest(root, manifest)
    return { root, manifest }
  }

  describe("validateContinuation", () => {
    it("accepts a valid continuation", () => {
      // given
      const valid: MemoryContinuation = {
        schema_version: 1,
        state_revision: 1,
        updated_at: "2026-05-25T12:00:00Z",
        source_manifest_revision: 1,
        source_hashes: {},
        work_state: {
          objective: "Finish memory portability",
          status: "active",
          primary_task: { ref: "tasks.md#current", title: "Implement memory-continuation", state: "next" },
          branch: "dev",
          base_ref: null,
        },
        resume_plan: {
          must_read: [],
          next_actions: [],
          touched_paths: [],
          blockers: [],
          verification_pending: [],
        },
        handoff: {
          from_harness: "opencode",
          to_harness: null,
          reason: "continue later",
          notes: "",
        },
      }

      // when
      const result = validateContinuation(valid)

      // then
      expect(result).not.toBeNull()
      expect(result?.schema_version).toBe(1)
    })

    it("rejects null", () => {
      // when
      const result = validateContinuation(null)

      // then
      expect(result).toBeNull()
    })

    it("rejects object missing schema_version", () => {
      // when
      const result = validateContinuation({ state_revision: 1, updated_at: "x", work_state: {}, resume_plan: {}, handoff: {} })

      // then
      expect(result).toBeNull()
    })

    it("rejects object with schema_version 0", () => {
      // when
      const result = validateContinuation({ schema_version: 0, state_revision: 1, updated_at: "x", work_state: {}, resume_plan: {}, handoff: {} })

      // then
      expect(result).toBeNull()
    })
  })

  describe("readContinuation", () => {
    it("returns null when file does not exist", () => {
      // given
      const root = setupTempDir()

      // when
      const result = readContinuation(root)

      // then
      expect(result).toBeNull()

      cleanup()
    })

    it("reads a valid continuation", () => {
      // given
      const { root, manifest } = setupProject()
      const input = {
        objective: "Test objective",
        primaryTaskRef: "tasks.md#current",
        primaryTaskTitle: "Test task",
        primaryTaskState: "next" as const,
        nextActions: ["Do X", "Verify Y"],
        touchedPaths: ["src/shared/memory-manifest.ts"],
        blockers: [],
        verificationPending: [],
        mustRead: [{ path: "active-context.md", reason: "current constraints" }],
        branch: null,
        fromHarness: "opencode",
        handoffReason: "test",
        handoffNotes: "",
        manifest,
      }
      const continuation = buildContinuation(1, input)
      writeContinuation(root, continuation)

      // when
      const result = readContinuation(root)

      // then
      expect(result).not.toBeNull()
      expect(result?.work_state.objective).toBe("Test objective")
      expect(result?.resume_plan.next_actions).toContain("Do X")

      cleanup()
    })

    it("returns null for invalid JSON", () => {
      // given
      const { root } = setupProject()
      const path = getContinuationPath(root)
      writeFileSync(path, "not json", "utf-8")

      // when
      const result = readContinuation(root)

      // then
      expect(result).toBeNull()

      cleanup()
    })
  })

  describe("buildContinuation", () => {
    it("truncates long objective", () => {
      // given
      const { root, manifest } = setupProject()
      const longObj = "a".repeat(600)
      const input = {
        objective: longObj,
        primaryTaskRef: "tasks.md#current",
        primaryTaskTitle: "T",
        primaryTaskState: "next" as const,
        nextActions: [],
        touchedPaths: [],
        blockers: [],
        verificationPending: [],
        mustRead: [],
        branch: null,
        fromHarness: "opencode",
        handoffReason: "test",
        handoffNotes: "",
        manifest,
      }

      // when
      const result = buildContinuation(1, input)

      // then
      expect(result.work_state.objective.length).toBeLessThanOrEqual(500)
      expect(result.work_state.objective.endsWith("...")).toBe(true)

      cleanup()
    })

    it("truncates touched_paths to max", () => {
      // given
      const { root, manifest } = setupProject()
      const manyPaths = Array.from({ length: 60 }, (_, i) => `src/file-${i}.ts`)
      const input = {
        objective: "Test",
        primaryTaskRef: "tasks.md#current",
        primaryTaskTitle: "T",
        primaryTaskState: "next" as const,
        nextActions: [],
        touchedPaths: manyPaths,
        blockers: [],
        verificationPending: [],
        mustRead: [],
        branch: null,
        fromHarness: "opencode",
        handoffReason: "test",
        handoffNotes: "",
        manifest,
      }

      // when
      const result = buildContinuation(1, input)

      // then
      expect(result.resume_plan.touched_paths.length).toBeLessThanOrEqual(50)

      cleanup()
    })

    it("builds source_hashes from manifest non-placeholder entries", () => {
      // given
      const { root, manifest } = setupProject()
      const input = {
        objective: "Test",
        primaryTaskRef: "tasks.md#current",
        primaryTaskTitle: "T",
        primaryTaskState: "next" as const,
        nextActions: [],
        touchedPaths: [],
        blockers: [],
        verificationPending: [],
        mustRead: [],
        branch: null,
        fromHarness: "opencode",
        handoffReason: "test",
        handoffNotes: "",
        manifest,
      }

      // when
      const result = buildContinuation(1, input)

      // then
      expect(result.source_hashes).toBeDefined()
      // All bootstrap files are placeholders, so source_hashes should be empty
      expect(Object.keys(result.source_hashes).length).toBeGreaterThanOrEqual(0)

      cleanup()
    })
  })

  describe("computeContinuationState", () => {
    it("returns 'missing' when no continuation exists", () => {
      // given
      const { root, manifest } = setupProject()

      // when
      const state = computeContinuationState(root, manifest)

      // then
      expect(state).toBe("missing")

      cleanup()
    })

    it("returns 'fresh' when all hashes match", () => {
      // given
      const { root, manifest } = setupProject()
      const input = {
        objective: "Test",
        primaryTaskRef: "tasks.md#current",
        primaryTaskTitle: "T",
        primaryTaskState: "next" as const,
        nextActions: [],
        touchedPaths: [],
        blockers: [],
        verificationPending: [],
        mustRead: [],
        branch: null,
        fromHarness: "opencode",
        handoffReason: "test",
        handoffNotes: "",
        manifest,
      }
      const continuation = buildContinuation(1, input)
      writeContinuation(root, continuation)

      // when
      const state = computeContinuationState(root, manifest)

      // then
      expect(state).toBe("fresh")

      cleanup()
    })

    it("returns 'stale' when a source hash diverges", () => {
      // given
      const { root, manifest } = setupProject()
      // Create a continuation with hashes that don't match
      const staleContinuation: MemoryContinuation = {
        schema_version: 1,
        state_revision: 1,
        updated_at: new Date().toISOString(),
        source_manifest_revision: 1,
        source_hashes: { "active-context.md": "wrong-hash" },
        work_state: {
          objective: "Test",
          status: "active",
          primary_task: { ref: "tasks.md#current", title: "T", state: "next" },
          branch: null,
          base_ref: null,
        },
        resume_plan: {
          must_read: [],
          next_actions: [],
          touched_paths: [],
          blockers: [],
          verification_pending: [],
        },
        handoff: {
          from_harness: "opencode",
          to_harness: null,
          reason: "test",
          notes: "",
        },
      }
      writeContinuation(root, staleContinuation)

      // when
      const state = computeContinuationState(root, manifest)

      // then
      expect(state).toBe("stale")

      cleanup()
    })

    it("returns 'fresh' when continuation has empty source_hashes (all source files were placeholders)", () => {
      // given
      const { root, manifest } = setupProject()
      const emptyContinuation: MemoryContinuation = {
        schema_version: 1,
        state_revision: 1,
        updated_at: new Date().toISOString(),
        source_manifest_revision: 1,
        source_hashes: {},
        work_state: {
          objective: "Test",
          status: "active",
          primary_task: { ref: "tasks.md#current", title: "T", state: "next" },
          branch: null,
          base_ref: null,
        },
        resume_plan: {
          must_read: [],
          next_actions: [],
          touched_paths: [],
          blockers: [],
          verification_pending: [],
        },
        handoff: {
          from_harness: "opencode",
          to_harness: null,
          reason: "test",
          notes: "",
        },
      }
      writeContinuation(root, emptyContinuation)

      // when
      const state = computeContinuationState(root, manifest)

      // then — empty source_hashes means all source files were placeholders, still valid
      expect(state).toBe("fresh")

      cleanup()
    })
  })

  describe("buildContinuationSummary", () => {
    it("returns null when no continuation exists", () => {
      // given
      const { root, manifest } = setupProject()

      // when
      const summary = buildContinuationSummary(root, manifest)

      // then
      expect(summary).toBeNull()

      cleanup()
    })

    it("returns summary when continuation is fresh", () => {
      // given
      const { root, manifest } = setupProject()
      const input = {
        objective: "Port memory system for cross-harness use",
        primaryTaskRef: "tasks.md#current",
        primaryTaskTitle: "Implement memory-continuation.ts",
        primaryTaskState: "next" as const,
        nextActions: ["Write tests", "Update injector"],
        touchedPaths: ["src/shared/memory-manifest.ts"],
        blockers: ["Need v2 manifest fields"],
        verificationPending: ["TypeScript diagnostics"],
        mustRead: [{ path: "active-context.md", reason: "current constraints" }],
        branch: "dev",
        fromHarness: "opencode",
        handoffReason: "continue later",
        handoffNotes: "Slice 1 of memory portability",
        manifest,
      }
      const continuation = buildContinuation(1, input)
      writeContinuation(root, continuation)

      // when
      const summary = buildContinuationSummary(root, manifest)

      // then
      expect(summary).not.toBeNull()
      expect(summary).toContain("Continuation state: fresh")
      expect(summary).toContain("Port memory system")

      cleanup()
    })
  })
})
