import { describe, expect, it } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  refreshManifestAfterWrite,
  resolveMemoryFileName,
  shouldRefreshManifest,
  extractFilePathFromArgs,
  type ManifestRefreshResult,
} from "./memory-manifest-updater"
import {
  PROJECT_MEMORY_DIR,
  bootstrapMemoryFiles,
  bootstrapMemoryManifest,
} from "./memory-bootstrap"
import {
  readManifest,
  writeManifest,
  type MemoryManifest,
} from "./memory-manifest"

describe("memory-manifest-updater", () => {
  let testDir = ""

  function setupTempDir(): string {
    testDir = join(tmpdir(), `omo-mem-updater-${randomUUID()}`)
    mkdirSync(testDir, { recursive: true })
    mkdirSync(join(testDir, ".opencode"), { recursive: true })
    bootstrapMemoryFiles(testDir)
    bootstrapMemoryManifest(testDir, "opencode")
    return testDir
  }

  function cleanup(): void {
    if (testDir) rmSync(testDir, { recursive: true, force: true })
  }

  function writeMemoryFile(projectRoot: string, fileName: string, content: string): string {
    const filePath = join(projectRoot, PROJECT_MEMORY_DIR, fileName)
    writeFileSync(filePath, content, "utf-8")
    return filePath
  }

  describe("resolveMemoryFileName", () => {
    it("returns file name for a path inside memory directory", () => {
      // given
      const root = setupTempDir()
      const memoryFilePath = join(root, PROJECT_MEMORY_DIR, "active-context.md")

      // when
      const result = resolveMemoryFileName(root, memoryFilePath)

      // then
      expect(result).toBe("active-context.md")

      cleanup()
    })

    it("returns null for a path outside memory directory", () => {
      // given
      const root = setupTempDir()
      const outsidePath = join(root, "src", "index.ts")

      // when
      const result = resolveMemoryFileName(root, outsidePath)

      // then
      expect(result).toBeNull()

      cleanup()
    })

    it("rejects path traversal attempts", () => {
      // given
      const root = setupTempDir()
      const traversalPath = join(root, PROJECT_MEMORY_DIR, "..", "..", "etc", "passwd")

      // when
      const result = resolveMemoryFileName(root, traversalPath)

      // then
      expect(result).toBeNull()

      cleanup()
    })

    it("handles nested files inside memory directory", () => {
      // given
      const root = setupTempDir()
      const nestedPath = join(root, PROJECT_MEMORY_DIR, ".locks", "test.lock")

      // when
      const result = resolveMemoryFileName(root, nestedPath)

      // then
      expect(result).toBe(".locks/test.lock")

      cleanup()
    })
  })

  describe("shouldRefreshManifest", () => {
    it("returns path for Write tool with filePath arg", () => {
      // given
      const args = { filePath: "/some/path.md" }

      // when
      const result = shouldRefreshManifest("write", args)

      // then
      expect(result).toBe("/some/path.md")
    })

    it("returns path for edit tool", () => {
      // given
      const args = { filePath: "/some/file.ts" }

      // when
      const result = shouldRefreshManifest("edit", args)

      // then
      expect(result).toBe("/some/file.ts")
    })

    it("returns null for non-write tools", () => {
      // given
      const args = { filePath: "/some/path.md" }

      // when
      const result = shouldRefreshManifest("read", args)

      // then
      expect(result).toBeNull()
    })

    it("returns null when no recognizable file path arg", () => {
      // given
      const args = { query: "something" }

      // when
      const result = shouldRefreshManifest("write", args)

      // then
      expect(result).toBeNull()
    })

    it("detects path from 'file_path' arg key", () => {
      // given
      const args = { file_path: "/tmp/test.md" }

      // when
      const result = shouldRefreshManifest("replace", args)

      // then
      expect(result).toBe("/tmp/test.md")
    })
  })

  describe("extractFilePathFromArgs", () => {
    it("extracts filePath from args", () => {
      // given
      const args = { filePath: "/foo/bar.md" }

      // when
      const result = extractFilePathFromArgs(args)

      // then
      expect(result).toBe("/foo/bar.md")
    })

    it("returns null for undefined args", () => {
      // when
      const result = extractFilePathFromArgs(undefined)

      // then
      expect(result).toBeNull()
    })

    it("returns null for empty filePath", () => {
      // given
      const args = { filePath: "" }

      // when
      const result = extractFilePathFromArgs(args)

      // then
      expect(result).toBeNull()
    })
  })

  describe("refreshManifestAfterWrite", () => {
    it("updates manifest when a memory file is written", () => {
      // given a project with initial manifest
      const root = setupTempDir()
      const initialManifest = readManifest(root)
      const originalHash = initialManifest!.files["active-context.md"].content_hash

      // Write new content to a memory file
      const filePath = writeMemoryFile(root, "active-context.md", "# Active Context\n\n## Current Goal\n- Build something great\n")

      // when refreshing manifest after write
      const result = refreshManifestAfterWrite(root, filePath)

      // then
      expect(result.attempted).toBe(true)
      expect(result.updated).toBe(true)
      expect(result.memoryFileName).toBe("active-context.md")

      // Verify manifest was actually updated
      const updatedManifest = readManifest(root)
      expect(updatedManifest).not.toBeNull()
      expect(updatedManifest!.files["active-context.md"].content_hash).not.toBe(originalHash)
      expect(updatedManifest!.files["active-context.md"].is_placeholder).toBe(false)

      cleanup()
    })

    it("returns attempted=false for files outside memory directory", () => {
      // given
      const root = setupTempDir()
      const outsidePath = join(root, "src", "index.ts")

      // when
      const result = refreshManifestAfterWrite(root, outsidePath)

      // then
      expect(result.attempted).toBe(false)
      expect(result.updated).toBe(false)
      expect(result.memoryFileName).toBeNull()
      expect(result.reason).toContain("outside")

      cleanup()
    })

    it("returns attempted=true but updated=false when manifest is missing", () => {
      // given project with memory dir but no manifest
      const root = setupTempDir()
      const manifestPath = join(root, PROJECT_MEMORY_DIR, "memory.json")
      rmSync(manifestPath, { force: true })

      const filePath = writeMemoryFile(root, "active-context.md", "# New content\n")

      // when
      const result = refreshManifestAfterWrite(root, filePath)

      // then
      expect(result.attempted).toBe(true)
      expect(result.updated).toBe(false)
      expect(result.reason).toContain("manifest")

      cleanup()
    })

    it("stamps update metadata on the manifest", () => {
      // given
      const root = setupTempDir()
      const filePath = writeMemoryFile(root, "decisions.md", "# Decisions\n\n## Accepted\n- Use Prisma\n")

      // when
      refreshManifestAfterWrite(root, filePath, "codex", "oracle", "ses_meta")

      // then
      const updated = readManifest(root)
      expect(updated!.updated_by_harness).toBe("codex")
      expect(updated!.updated_by_agent).toBe("oracle")
      expect(updated!.updated_by_session).toBe("ses_meta")
      expect(updated!.manifest_revision).toBeGreaterThan(1)

      cleanup()
    })

    it("increments manifest_revision on each refresh", () => {
      // given
      const root = setupTempDir()
      const file1 = writeMemoryFile(root, "active-context.md", "# v1\n")
      refreshManifestAfterWrite(root, file1)
      const rev1 = readManifest(root)!.manifest_revision!

      const file2 = writeMemoryFile(root, "progress.md", "# v2\n")
      refreshManifestAfterWrite(root, file2)
      const rev2 = readManifest(root)!.manifest_revision!

      // then — each refresh bumps revision
      expect(rev2).toBeGreaterThan(rev1)

      cleanup()
    })

    it("returns attempted=false when no project root found", () => {
      // given a non-project directory
      const root = join(tmpdir(), `omo-mem-updater-noproj-${randomUUID()}`)
      mkdirSync(root, { recursive: true })

      // when
      const result = refreshManifestAfterWrite(root, join(root, "file.md"))

      // then
      expect(result.attempted).toBe(false)
      expect(result.reason).toContain("No project root")

      rmSync(root, { recursive: true, force: true })
    })

    it("handles a file that was deleted between the write and refresh", () => {
      // given
      const root = setupTempDir()
      const filePath = writeMemoryFile(root, "tasks.md", "# Tasks\n- Do stuff\n")

      // Delete the file before refreshing
      rmSync(filePath, { force: true })

      // when
      const result = refreshManifestAfterWrite(root, filePath)

      // then
      expect(result.attempted).toBe(true)
      expect(result.updated).toBe(false)
      expect(result.reason).toContain("no longer exists")

      cleanup()
    })

    it("keeps existing last_modified_by fields when refreshing", () => {
      // given a manifest with agent/harness stamps on the file entry
      const root = setupTempDir()
      const filePath = writeMemoryFile(root, "file-map.md", "# File Map\n- src/index.ts\n")

      // First refresh stamps the entry
      refreshManifestAfterWrite(root, filePath, "opencode", "sisyphus", "ses_1")

      // Set last_modified_by on the file entry and write manifest to disk
      const manifest1 = readManifest(root)!
      manifest1.files["file-map.md"].last_modified_by_agent = "sisyphus"
      manifest1.files["file-map.md"].last_modified_by_harness = "opencode"
      writeManifest(root, manifest1)

      // Write new content to the same file
      writeMemoryFile(root, "file-map.md", "# File Map\n## Updated\n- src/foo.ts\n")

      // when refreshing again
      refreshManifestAfterWrite(root, filePath, "cli", undefined, "ses_2")

      // then previous agent/harness stamps on the file entry are preserved
      const updated = readManifest(root)
      expect(updated!.files["file-map.md"].last_modified_by_agent).toBe("sisyphus")
      expect(updated!.files["file-map.md"].last_modified_by_harness).toBe("opencode")

      cleanup()
    })
  })
})
