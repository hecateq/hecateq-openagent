import { describe, expect, it } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  createMemoryManifest,
  refreshFileEntry,
  readManifest,
  validateManifest,
  writeManifest,
  getManifestPath,
  MEMORY_MANIFEST_SCHEMA_VERSION,
} from "./memory-manifest"
import {
  PROJECT_MEMORY_DIR,
  PROJECT_MEMORY_FILES,
  PROJECT_MEMORY_OPTIONAL_FILES,
  FILE_TEMPLATES,
  bootstrapMemoryFiles,
} from "./memory-bootstrap"

describe("memory-manifest", () => {
  let testDir = ""

  function setupTempDir(): string {
    testDir = join(tmpdir(), `omo-mem-manifest-${randomUUID()}`)
    mkdirSync(testDir, { recursive: true })
    return testDir
  }

  function cleanup(): void {
    if (testDir) rmSync(testDir, { recursive: true, force: true })
  }

  describe("createMemoryManifest", () => {
    it("creates a manifest with all required files from bootstrap", () => {
      // given
      const root = setupTempDir()
      bootstrapMemoryFiles(root)

      // when
      const manifest = createMemoryManifest(root)

      // then
      expect(manifest.schema_version).toBe(MEMORY_MANIFEST_SCHEMA_VERSION)
      expect(typeof manifest.manifest_updated_at).toBe("string")
      expect(Object.keys(manifest.files).sort()).toEqual([...PROJECT_MEMORY_FILES, ...PROJECT_MEMORY_OPTIONAL_FILES].sort())
      expect(manifest.required_files).toEqual([...PROJECT_MEMORY_FILES])
      expect(manifest.optional_files).toEqual([...PROJECT_MEMORY_OPTIONAL_FILES])
      expect(manifest.deprecated_files).toEqual([])
      expect(manifest.token_budget.reading_cost).toBe("low")
      expect(manifest.migrations_applied).toContain("v1-initial-manifest")

      cleanup()
    })

    it("marks all template files as placeholders when using raw TODO templates", () => {
      // given — create only the memory dir and write raw TODO templates directly,
      // bypassing bootstrapMemoryFiles (which now creates hydrated content)
      const root = setupTempDir()
      const memDir = join(root, ".opencode", "state", "memory")
      mkdirSync(memDir, { recursive: true })
      // Write raw FILE_TEMPLATES (the old TODO-only content)
      for (const fileName of PROJECT_MEMORY_FILES) {
        writeFileSync(join(memDir, fileName), FILE_TEMPLATES[fileName] ?? "", "utf-8")
      }

      // when
      const manifest = createMemoryManifest(root)

      // then all files are raw TODO templates with placeholder=true
      for (const fileName of PROJECT_MEMORY_FILES) {
        const entry = manifest.files[fileName]
        expect(entry).toBeDefined()
        expect(entry.is_placeholder).toBe(true)
        expect(entry.summary).toBe("[template placeholder — not yet populated]")
      }

      cleanup()
    })

    it("bootstrap produces hydrated non-placeholder content", () => {
      // given — fresh bootstrap via bootstrapMemoryFiles now creates hydrated content
      const root = setupTempDir()
      bootstrapMemoryFiles(root)

      // when
      const manifest = createMemoryManifest(root)

      // then — all files are NOT placeholders (hydrated)
      for (const fileName of PROJECT_MEMORY_FILES) {
        const entry = manifest.files[fileName]
        expect(entry).toBeDefined()
        expect(entry.is_placeholder).toBe(false)
        expect(entry.summary).not.toBe("[template placeholder — not yet populated]")
      }

      cleanup()
    })

    it("detects non-placeholder content", () => {
      // given
      const root = setupTempDir()
      bootstrapMemoryFiles(root)
      const memoryFile = join(root, PROJECT_MEMORY_DIR, "active-context.md")
      writeFileSync(memoryFile, "## Current Goal\nBuild memory manifest system\n\n## Current State\nIn progress\n", "utf-8")

      // when
      const manifest = createMemoryManifest(root)

      // then
      const entry = manifest.files["active-context.md"]
      expect(entry).toBeDefined()
      expect(entry.is_placeholder).toBe(false)
      expect(entry.summary).not.toBe("[template placeholder — not yet populated]")

      cleanup()
    })

    it("stamps harness timestamp when assignHarness is provided", () => {
      // given
      const root = setupTempDir()
      bootstrapMemoryFiles(root)

      // when
      const manifest = createMemoryManifest(root, "opencode")

      // then
      expect(manifest.harness_timestamps.opencode).toBeDefined()
      expect(manifest.harness_timestamps["claude-code"]).toBeNull()
      expect(manifest.harness_timestamps.codex).toBeNull()
      expect(manifest.harness_timestamps.cli).toBeNull()

      cleanup()
    })

    it("computes token budget correctly", () => {
      // given
      const root = setupTempDir()
      bootstrapMemoryFiles(root)

      // when
      const manifest = createMemoryManifest(root)

      // then
      expect(manifest.token_budget.total_cost_chars).toBeGreaterThan(0)
      expect(manifest.token_budget.estimated_total_tokens).toBeGreaterThan(0)
      expect(manifest.token_budget.reading_cost).toBe("low")
      expect(manifest.token_budget.recommended_read_order.length).toBeGreaterThan(0)

      cleanup()
    })

    it("includes file size, hash, section count for each entry", () => {
      // given
      const root = setupTempDir()
      bootstrapMemoryFiles(root)

      // when
      const manifest = createMemoryManifest(root)

      // then
      for (const fileName of PROJECT_MEMORY_FILES) {
        const entry = manifest.files[fileName]
        expect(entry.size_bytes).toBeGreaterThan(0)
        expect(typeof entry.content_hash).toBe("string")
        expect(entry.content_hash.length).toBeGreaterThan(0)
        expect(typeof entry.section_count).toBe("number")
        expect(entry.encoding).toBe("utf-8")
      }

      cleanup()
    })
  })

  describe("readManifest", () => {
    it("returns null when manifest does not exist", () => {
      // given
      const root = setupTempDir()

      // when
      const manifest = readManifest(root)

      // then
      expect(manifest).toBeNull()

      cleanup()
    })

    it("reads a valid manifest", () => {
      // given
      const root = setupTempDir()
      bootstrapMemoryFiles(root)
      const created = createMemoryManifest(root)
      writeManifest(root, created)

      // when
      const manifest = readManifest(root)

      // then
      expect(manifest).not.toBeNull()
      expect(manifest?.schema_version).toBe(MEMORY_MANIFEST_SCHEMA_VERSION)

      cleanup()
    })

    it("returns null for invalid JSON", () => {
      // given
      const root = setupTempDir()
      const manifestPath = getManifestPath(root)
      mkdirSync(join(root, PROJECT_MEMORY_DIR), { recursive: true })
      writeFileSync(manifestPath, "not valid json {{{", "utf-8")

      // when
      const manifest = readManifest(root)

      // then
      expect(manifest).toBeNull()

      cleanup()
    })
  })

  describe("validateManifest", () => {
    it("accepts a valid manifest", () => {
      // given
      const root = setupTempDir()
      bootstrapMemoryFiles(root)
      const manifest = createMemoryManifest(root)

      // when
      const result = validateManifest(manifest)

      // then
      expect(result.valid).toBe(true)

      cleanup()
    })

    it("rejects null", () => {
      // when
      const result = validateManifest(null)

      // then
      expect(result.valid).toBe(false)
      if (!result.valid) expect(result.reason).toContain("null")
    })

    it("rejects missing schema_version", () => {
      // when
      const result = validateManifest({ files: {}, required_files: [], manifest_updated_at: "2026-01-01" })

      // then
      expect(result.valid).toBe(false)
      if (!result.valid) expect(result.reason).toContain("schema_version")
    })

    it("rejects missing files object", () => {
      // when
      const result = validateManifest({ schema_version: 1, required_files: [], manifest_updated_at: "2026-01-01" })

      // then
      expect(result.valid).toBe(false)
      if (!result.valid) expect(result.reason).toContain("files")
    })

    it("rejects schema_version below 1", () => {
      // when
      const result = validateManifest({ schema_version: 0, files: {}, required_files: [], manifest_updated_at: "2026-01-01" })

      // then
      expect(result.valid).toBe(false)
      if (!result.valid) expect(result.reason).toContain("schema_version")
    })
  })

  describe("refreshFileEntry", () => {
    it("updates entry when file content changes", () => {
      // given
      const root = setupTempDir()
      bootstrapMemoryFiles(root)
      const manifest = createMemoryManifest(root)
      writeManifest(root, manifest)

      const originalEntry = manifest.files["active-context.md"]
      const memoryFile = join(root, PROJECT_MEMORY_DIR, "active-context.md")
      writeFileSync(memoryFile, "## New Content\nReal project context here\n", "utf-8")

      // when
      const refreshed = refreshFileEntry(root, manifest, "active-context.md")

      // then
      const newEntry = refreshed.files["active-context.md"]
      expect(newEntry).toBeDefined()
      expect(newEntry.content_hash).not.toBe(originalEntry?.content_hash)
      expect(newEntry.is_placeholder).toBe(false)

      cleanup()
    })

    it("removes entry when file is deleted", () => {
      // given
      const root = setupTempDir()
      bootstrapMemoryFiles(root)
      const manifest = createMemoryManifest(root)
      writeManifest(root, manifest)

      const memoryFile = join(root, PROJECT_MEMORY_DIR, "active-context.md")
      rmSync(memoryFile)

      // when
      const refreshed = refreshFileEntry(root, manifest, "active-context.md")

      // then
      expect(refreshed.files["active-context.md"]).toBeUndefined()
      expect(refreshed.locks["active-context.md"]).toBeUndefined()

      cleanup()
    })
  })
})
