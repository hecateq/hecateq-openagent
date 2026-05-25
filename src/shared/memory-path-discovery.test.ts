import { describe, expect, it } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  discoverMemoryPaths,
  readMemoryPointer,
  validateMemoryPointer,
  resolvePointerPath,
  resolveContinuationPath,
  POINTER_KIND,
  type DiscoveredPaths,
  type MemoryPointer,
} from "./memory-path-discovery"
import {
  CONTINUATION_FILENAME,
} from "./memory-continuation"
import {
  PROJECT_MEMORY_DIR,
  bootstrapMemoryFiles,
  findProjectRoot,
} from "./memory-bootstrap"
import {
  MEMORY_MANIFEST_FILENAME,
} from "./memory-manifest"

describe("memory-path-discovery", () => {
  let testDir = ""

  function setupTempDir(): string {
    testDir = join(tmpdir(), `omo-mem-discovery-${randomUUID()}`)
    mkdirSync(testDir, { recursive: true })
    return testDir
  }

  function cleanup(): void {
    if (testDir) rmSync(testDir, { recursive: true, force: true })
  }

  function setupProject(): string {
    const root = setupTempDir()
    // Create .opencode marker
    mkdirSync(join(root, ".opencode"), { recursive: true })
    bootstrapMemoryFiles(root)
    return root
  }

  describe("resolvePointerPath", () => {
    it("returns the correct pointer path at project root", () => {
      // given
      const root = setupTempDir()

      // when
      const path = resolvePointerPath(root)

      // then
      expect(path).toBe(join(root, ".memory-manifest.json"))

      cleanup()
    })
  })

  describe("resolveContinuationPath", () => {
    it("returns the correct continuation path under memory dir", () => {
      // given
      const root = setupTempDir()

      // when
      const path = resolveContinuationPath(root)

      // then
      expect(path).toBe(join(root, PROJECT_MEMORY_DIR, CONTINUATION_FILENAME))

      cleanup()
    })
  })

  describe("validateMemoryPointer", () => {
    it("accepts a valid v1 pointer", () => {
      // given
      const valid: MemoryPointer = {
        version: 1,
        kind: "hecateq-memory-pointer",
        manifest_path: ".opencode/state/memory/memory.json",
        continuation_path: ".opencode/state/memory/continuation.json",
        authoritative_root: ".opencode/state/memory",
      }

      // when
      const result = validateMemoryPointer(valid)

      // then
      expect(result).not.toBeNull()
      expect(result?.version).toBe(1)
      expect(result?.kind).toBe("hecateq-memory-pointer")
    })

    it("rejects null", () => {
      // when
      const result = validateMemoryPointer(null)

      // then
      expect(result).toBeNull()
    })

    it("rejects object with wrong kind", () => {
      // given
      const wrong = { version: 1, kind: "not-a-pointer", manifest_path: "x", authoritative_root: "x" }

      // when
      const result = validateMemoryPointer(wrong)

      // then
      expect(result).toBeNull()
    })

    it("rejects object missing manifest_path", () => {
      // given
      const missing = { version: 1, kind: POINTER_KIND, authoritative_root: "x" }

      // when
      const result = validateMemoryPointer(missing)

      // then
      expect(result).toBeNull()
    })

    it("defaults continuation_path when omitted", () => {
      // given
      const minimal = {
        version: 1,
        kind: POINTER_KIND,
        manifest_path: ".opencode/state/memory/memory.json",
        authoritative_root: ".opencode/state/memory",
      }

      // when
      const result = validateMemoryPointer(minimal)

      // then
      expect(result).not.toBeNull()
      expect(result?.continuation_path).toBe(".opencode/state/memory/continuation.json")
    })
  })

  describe("readMemoryPointer", () => {
    it("returns null when file does not exist", () => {
      // given
      const root = setupTempDir()
      const pointerPath = resolvePointerPath(root)

      // when
      const result = readMemoryPointer(pointerPath)

      // then
      expect(result).toBeNull()

      cleanup()
    })

    it("reads and validates a valid pointer file", () => {
      // given
      const root = setupTempDir()
      const pointerPath = resolvePointerPath(root)
      const pointer: MemoryPointer = {
        version: 1,
        kind: POINTER_KIND,
        manifest_path: ".opencode/state/memory/memory.json",
        continuation_path: ".opencode/state/memory/continuation.json",
        authoritative_root: ".opencode/state/memory",
      }
      writeFileSync(pointerPath, JSON.stringify(pointer, null, 2), "utf-8")

      // when
      const result = readMemoryPointer(pointerPath)

      // then
      expect(result).not.toBeNull()
      expect(result?.manifest_path).toBe(".opencode/state/memory/memory.json")

      cleanup()
    })

    it("returns null for invalid JSON", () => {
      // given
      const root = setupTempDir()
      const pointerPath = resolvePointerPath(root)
      writeFileSync(pointerPath, "not json", "utf-8")

      // when
      const result = readMemoryPointer(pointerPath)

      // then
      expect(result).toBeNull()

      cleanup()
    })
  })

  describe("discoverMemoryPaths", () => {
    it("returns null when no project root found", () => {
      // given
      const root = setupTempDir()
      // no .opencode, no .git, no manifest files

      // when
      const result = discoverMemoryPaths(root)

      // then
      expect(result).toBeNull()

      cleanup()
    })

    it("discovers paths using defaults when no pointer file exists", () => {
      // given
      const root = setupProject()

      // when
      const result = discoverMemoryPaths(root)

      // then
      expect(result).not.toBeNull()
      const r = result as DiscoveredPaths
      expect(r.projectRoot).toBe(root)
      expect(r.pointerExists).toBe(false)
      expect(r.manifestPath).toBe(join(root, PROJECT_MEMORY_DIR, MEMORY_MANIFEST_FILENAME))
      expect(r.continuationPath).toBe(resolveContinuationPath(root))
      expect(r.authoritativeDir).toBe(join(root, PROJECT_MEMORY_DIR))

      cleanup()
    })

    it("resolves paths from pointer file when it exists", () => {
      // given
      const root = setupProject()
      const pointerPath = resolvePointerPath(root)
      const pointer: MemoryPointer = {
        version: 1,
        kind: POINTER_KIND,
        manifest_path: ".opencode/state/memory/memory.json",
        continuation_path: ".opencode/state/memory/continuation.json",
        authoritative_root: ".opencode/state/memory",
      }
      writeFileSync(pointerPath, JSON.stringify(pointer, null, 2), "utf-8")

      // when
      const result = discoverMemoryPaths(root)

      // then
      expect(result).not.toBeNull()
      const r = result as DiscoveredPaths
      expect(r.pointerExists).toBe(true)
      expect(r.manifestPath).toBe(join(root, PROJECT_MEMORY_DIR, MEMORY_MANIFEST_FILENAME))
      expect(r.continuationPath).toBe(resolveContinuationPath(root))

      cleanup()
    })

    it("rejects absolute paths in pointer and falls back to defaults", () => {
      // given
      const root = setupProject()
      const pointerPath = resolvePointerPath(root)
      const malicious: MemoryPointer = {
        version: 1,
        kind: POINTER_KIND,
        manifest_path: "/etc/passwd",
        continuation_path: ".opencode/state/memory/continuation.json",
        authoritative_root: ".opencode/state/memory",
      }
      writeFileSync(pointerPath, JSON.stringify(malicious, null, 2), "utf-8")

      // when
      const result = discoverMemoryPaths(root)

      // then — absolute path is rejected, falls back safely
      expect(result).not.toBeNull()
      const r = result as DiscoveredPaths
      expect(r.manifestPath).toBe(join(root, PROJECT_MEMORY_DIR, MEMORY_MANIFEST_FILENAME))

      cleanup()
    })

    it("rejects path that escapes project root", () => {
      // given
      const root = setupProject()
      const pointerPath = resolvePointerPath(root)
      const escape: MemoryPointer = {
        version: 1,
        kind: POINTER_KIND,
        manifest_path: "../../etc/passwd",
        continuation_path: ".opencode/state/memory/continuation.json",
        authoritative_root: ".opencode/state/memory",
      }
      writeFileSync(pointerPath, JSON.stringify(escape, null, 2), "utf-8")

      // when
      const result = discoverMemoryPaths(root)

      // then — path escaping project root falls back safely
      expect(result).not.toBeNull()
      const r = result as DiscoveredPaths
      expect(r.manifestPath).toBe(join(root, PROJECT_MEMORY_DIR, MEMORY_MANIFEST_FILENAME))

      cleanup()
    })

    it("reports manifestExists correctly", () => {
      // given
      const root = setupProject()
      // No manifest exists yet

      // when
      const result = discoverMemoryPaths(root)

      // then
      expect(result).not.toBeNull()
      const r = result as DiscoveredPaths
      expect(r.manifestExists).toBe(false)

      cleanup()
    })

    it("reports continuationExists correctly", () => {
      // given
      const root = setupProject()

      // when
      const result = discoverMemoryPaths(root)

      // then
      expect(result).not.toBeNull()
      const r = result as DiscoveredPaths
      expect(r.continuationExists).toBe(false)

      cleanup()
    })
  })
})
