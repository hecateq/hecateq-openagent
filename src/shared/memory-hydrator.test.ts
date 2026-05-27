import { describe, expect, it } from "bun:test"
import { hydrateMemoryFile } from "./memory-hydrator"
import { detectPlaceholderContent } from "./memory-manifest"
import { FILE_TEMPLATES, PROJECT_MEMORY_FILES } from "./memory-bootstrap"

const REAL_CONTENT =
  "## Current Goal\nBuild the memory hydration system\n\n## Current State\nImplementation in progress\n"

const PROJECT_ROOT = "/tmp/test-project"

describe("memory-hydrator", () => {
  describe("hydrateMemoryFile", () => {
    it("returns non-null rich content for placeholder (old TODO template)", () => {
      // given
      const fileName = "active-context.md"
      const existingContent = FILE_TEMPLATES[fileName]

      // when
      const result = hydrateMemoryFile({ projectRoot: PROJECT_ROOT, fileName, existingContent })

      // then
      expect(result).not.toBeNull()
      expect(result!.length).toBeGreaterThan(100)
      // must contain the project basename
      expect(result!).toContain("test-project")
      // must contain a real dateline
      expect(result!).toMatch(/Last updated: \d{4}-\d{2}-\d{2}/)
      // must contain at least one real non-placeholder line
      expect(result!).toContain("Initial setup")
    })

    it("returns null for real (non-placeholder) content", () => {
      // given
      const fileName = "active-context.md"

      // when
      const result = hydrateMemoryFile({ projectRoot: PROJECT_ROOT, fileName, existingContent: REAL_CONTENT })

      // then
      expect(result).toBeNull()
    })

    it("hydrated content is NOT detected as placeholder", () => {
      // given
      const fileName = "active-context.md"
      const existingContent = FILE_TEMPLATES[fileName]

      // when
      const result = hydrateMemoryFile({ projectRoot: PROJECT_ROOT, fileName, existingContent })

      // then
      expect(result).not.toBeNull()
      expect(detectPlaceholderContent(result!)).toBe(false)
    })

    it("returns null for unknown file name", () => {
      // given
      const fileName = "unknown-file.md"
      const existingContent = "# TODO\n- TODO\n"

      // when
      const result = hydrateMemoryFile({ projectRoot: PROJECT_ROOT, fileName, existingContent })

      // then
      expect(result).toBeNull()
    })

    it("supports all 8 canonical files", () => {
      for (const fileName of PROJECT_MEMORY_FILES) {
        // given
        const existingContent = FILE_TEMPLATES[fileName] ?? ""

        // when
        const result = hydrateMemoryFile({ projectRoot: PROJECT_ROOT, fileName, existingContent })

        // then
        expect(result, `hydrator should handle ${fileName}`).not.toBeNull()
        expect(result!.length).toBeGreaterThan(50)
        expect(result!).toMatch(/Last updated: \d{4}-\d{2}-\d{2}/)
        expect(detectPlaceholderContent(result!)).toBe(false)
      }
    })

    it("uses provided timestamp when given", () => {
      // given
      const fileName = "progress.md"
      const existingContent = FILE_TEMPLATES[fileName]
      const customDate = "2026-06-15"

      // when
      const result = hydrateMemoryFile({
        projectRoot: PROJECT_ROOT,
        fileName,
        existingContent,
        timestamp: customDate,
      })

      // then
      expect(result).not.toBeNull()
      expect(result!).toContain("Last updated: 2026-06-15")
    })

    it("returns deterministic output for the same input", () => {
      // given
      const fileName = "tasks.md"
      const existingContent = FILE_TEMPLATES[fileName]

      // when
      const a = hydrateMemoryFile({ projectRoot: PROJECT_ROOT, fileName, existingContent, timestamp: "2026-01-01" })
      const b = hydrateMemoryFile({ projectRoot: PROJECT_ROOT, fileName, existingContent, timestamp: "2026-01-01" })

      // then
      expect(a).not.toBeNull()
      expect(b).not.toBeNull()
      expect(a).toBe(b)
    })
  })
})
