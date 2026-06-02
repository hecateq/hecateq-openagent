import { describe, expect, it, afterEach, beforeEach } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync, utimesSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import {
  collectTasksJsonlRetentionIssues,
  collectDecisionsJsonlRetentionIssues,
  collectChangeImpactRetentionIssues,
  collectContinuationMarkerRetentionIssues,
} from "./hecateq-workflow"
import { PROJECT_MEMORY_DIR } from "../../../shared/memory-bootstrap"

function makeMemoryDir(root: string): string {
  const dir = join(root, PROJECT_MEMORY_DIR)
  mkdirSync(dir, { recursive: true })
  return dir
}

describe("Phase 6 doctor retention checks", () => {
  let cwd = ""

  beforeEach(() => {
    cwd = join(tmpdir(), "doctor-retention-test-" + Math.random().toString(36).slice(2))
    mkdirSync(cwd, { recursive: true })
    // Override process.cwd behavior by creating a memory dir that the functions will use.
    // The functions use process.cwd() internally; we replace it for test isolation.
  })

  afterEach(() => {
    try {
      if (existsSync(cwd)) rmSync(cwd, { recursive: true })
    } catch {
      // cleanup
    }
  })

  describe("collectTasksJsonlRetentionIssues", () => {
    it("warns when tasks.jsonl has > 1000 lines", () => {
      makeMemoryDir(cwd)
      const lines = Array.from({ length: 1001 }, (_, i) =>
        JSON.stringify({ id: `task-${i}`, value: "x".repeat(50) }),
      ).join("\n")
      writeFileSync(join(cwd, PROJECT_MEMORY_DIR, "tasks.jsonl"), lines, "utf-8")
      const issues = collectTasksJsonlRetentionIssues(cwd)
      expect(issues.some((i) => i.title.includes("line count exceeded"))).toBe(true)
    })

    it("warns when tasks.jsonl exceeds 1MB in bytes", () => {
      makeMemoryDir(cwd)
      const lines = Array.from({ length: 200 }, (_, i) =>
        JSON.stringify({ id: `task-${i}`, value: "x".repeat(8000) }),
      ).join("\n")
      writeFileSync(join(cwd, PROJECT_MEMORY_DIR, "tasks.jsonl"), lines, "utf-8")
      const issues = collectTasksJsonlRetentionIssues(cwd)
      expect(issues.some((i) => i.title.includes("byte size exceeded"))).toBe(true)
    })

    it("returns no issues when tasks.jsonl is within limits", () => {
      makeMemoryDir(cwd)
      writeFileSync(join(cwd, PROJECT_MEMORY_DIR, "tasks.jsonl"), "{}", "utf-8")
      const issues = collectTasksJsonlRetentionIssues(cwd)
      expect(issues).toHaveLength(0)
    })

    it("returns no issues when tasks.jsonl does not exist", () => {
      const issues = collectTasksJsonlRetentionIssues(cwd)
      expect(issues).toHaveLength(0)
    })
  })

  describe("collectDecisionsJsonlRetentionIssues", () => {
    it("warns when decisions.jsonl has > 500 lines", () => {
      makeMemoryDir(cwd)
      const lines = Array.from({ length: 501 }, (_, i) =>
        JSON.stringify({ id: `d-${i}`, value: "x".repeat(50) }),
      ).join("\n")
      writeFileSync(join(cwd, PROJECT_MEMORY_DIR, "decisions.jsonl"), lines, "utf-8")
      const issues = collectDecisionsJsonlRetentionIssues(cwd)
      expect(issues.some((i) => i.title.includes("line count exceeded"))).toBe(true)
    })

    it("returns no issues when decisions.jsonl does not exist", () => {
      const issues = collectDecisionsJsonlRetentionIssues(cwd)
      expect(issues).toHaveLength(0)
    })
  })

  describe("collectChangeImpactRetentionIssues", () => {
    it("warns when change impact map has > 100 entries", () => {
      makeMemoryDir(cwd)
      const entries = Array.from({ length: 101 }, (_, i) =>
        `- \`src/file-${i}.ts\` — [high](test) modified — ses_test — 2025-01-01T00:00:00.000Z`,
      )
      const content =
        "# File Map\n\n## Change Impact Map\n\n" + entries.join("\n") + "\n"
      writeFileSync(join(cwd, PROJECT_MEMORY_DIR, "file-map.md"), content, "utf-8")
      const issues = collectChangeImpactRetentionIssues(cwd)
      expect(issues.some((i) => i.title.includes("Change Impact Map"))).toBe(true)
    })

    it("returns no issues when file-map.md does not exist", () => {
      const issues = collectChangeImpactRetentionIssues(cwd)
      expect(issues).toHaveLength(0)
    })

    it("returns no issues when no Change Impact Map section exists", () => {
      makeMemoryDir(cwd)
      writeFileSync(join(cwd, PROJECT_MEMORY_DIR, "file-map.md"), "# File Map\n\n## Important Paths\n", "utf-8")
      const issues = collectChangeImpactRetentionIssues(cwd)
      expect(issues).toHaveLength(0)
    })
  })

  describe("collectContinuationMarkerRetentionIssues", () => {
    it("warns when > 200 markers exist", () => {
      const markerDir = join(cwd, ".omo", "run-continuation")
      mkdirSync(markerDir, { recursive: true })
      for (let i = 0; i < 201; i++) {
        writeFileSync(
          join(markerDir, `session-${i}.json`),
          JSON.stringify({ sessionID: `s-${i}`, updatedAt: new Date().toISOString(), sources: {} }),
          "utf-8",
        )
      }
      const issues = collectContinuationMarkerRetentionIssues(cwd)
      expect(issues.some((i) => i.title.includes("marker count exceeded"))).toBe(true)
    })

    it("returns no issues when marker directory does not exist", () => {
      const issues = collectContinuationMarkerRetentionIssues(cwd)
      expect(issues).toHaveLength(0)
    })
  })
})
