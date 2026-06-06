import { describe, expect, it, afterEach } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  checkMemoryReadiness,
  checkActiveContext,
  checkProgress,
  checkTasks,
  checkDecisions,
  checkQualityHistory,
  checkRiskProfile,
  checkContinuation,
  checkManifest,
  checkPlaceholders,
} from "./memory-quality-gate"
import { PROJECT_MEMORY_DIR, PROJECT_MEMORY_FILES } from "./memory-bootstrap"

const RECENT_TIMESTAMP = () => new Date(Date.now() - 3600000).toISOString()
const STALE_TIMESTAMP = () => new Date(Date.now() - 90000000).toISOString()
const REAL_CONTENT = "# Active Context\n\n## Current Goal\nBuild the authentication module\n\n## Status\nIn progress\n"

function placeholderContent(filename: string): string {
  return `# ${filename.replace(".md", "")}\n\nLast updated: TODO\n\n## Current Goal\n- TODO\n`
}

function realContent(filename: string): string {
  return `# ${filename.replace(".md", "")}\n\nLast updated: ${RECENT_TIMESTAMP()}\n\n## Current Goal\nReal project content for ${filename}\n`
}

function memoryDir(root: string): string {
  return join(root, PROJECT_MEMORY_DIR)
}

function filePath(root: string, filename: string): string {
  return join(memoryDir(root), filename)
}

function createRealMemoryFile(root: string, filename: string): void {
  writeFileSync(filePath(root, filename), realContent(filename), "utf-8")
}

function createPlaceholderMemoryFile(root: string, filename: string): void {
  writeFileSync(filePath(root, filename), placeholderContent(filename), "utf-8")
}

function createValidManifest(root: string, updatedAt: string): void {
  const manifest = {
    schema_version: 2,
    manifest_updated_at: updatedAt,
    manifest_revision: 1,
    token_budget: { total_cost_chars: 0, estimated_total_tokens: 0, reading_cost: "low", recommended_read_order: [] },
    files: {},
    required_files: [],
    optional_files: [],
    deprecated_files: [],
    locks: {},
    migrations_applied: [],
    harness_timestamps: { opencode: null, "claude-code": null, codex: null, cli: null },
    project_identity: { project_id: "test", project_name: "test", workspace_kind: "single" },
    discovery: { pointer_file: "", authoritative_root: "", continuation_path: "" },
    resume: { continuation_state: "missing", summary: "", primary_task_ref: "", next_step_hint: "", suggested_reads: [], last_handoff_at: null },
  }
  writeFileSync(filePath(root, "memory.json"), JSON.stringify(manifest, null, 2), "utf-8")
}

function createContinuation(root: string, sourceHashes: Record<string, string>): void {
  const continuation = {
    schema_version: 1,
    state_revision: 1,
    updated_at: RECENT_TIMESTAMP(),
    work_state: {
      objective: "Test objective",
      status: "active",
      primary_task: { ref: "task-1", title: "Test task", state: "next" },
      branch: null,
      base_ref: null,
    },
    resume_plan: { must_read: [], next_actions: [], touched_paths: [] },
    handoff: { reason: "test", notes: "test notes" },
    quality_gate: null,
    source_hashes: sourceHashes,
  }
  writeFileSync(filePath(root, "continuation.json"), JSON.stringify(continuation, null, 2), "utf-8")
}

function setupHealthyMemory(root: string): void {
  mkdirSync(memoryDir(root), { recursive: true })
  for (const f of PROJECT_MEMORY_FILES) {
    createRealMemoryFile(root, f)
  }
  createValidManifest(root, RECENT_TIMESTAMP())
  createContinuation(root, {})
}

function setupPartialMemory(root: string): void {
  mkdirSync(memoryDir(root), { recursive: true })
  createRealMemoryFile(root, "active-context.md")
  createRealMemoryFile(root, "progress.md")
  createRealMemoryFile(root, "tasks.md")
  createRealMemoryFile(root, "decisions.md")
  createRealMemoryFile(root, "quality-history.md")
}

describe("memory-quality-gate", () => {
  let testDir = ""

  function setupTempDir(): string {
    testDir = join(tmpdir(), `omo-mem-gate-${randomUUID()}`)
    return testDir
  }

  afterEach(() => {
    if (testDir) rmSync(testDir, { recursive: true, force: true })
  })

  describe("checkActiveContext", () => {
    it("returns pass for real content", () => {
      const root = setupTempDir()
      mkdirSync(memoryDir(root), { recursive: true })
      createRealMemoryFile(root, "active-context.md")

      const result = checkActiveContext(root)
      expect(result.passed).toBe(true)
    })

    it("returns fail for placeholder content", () => {
      const root = setupTempDir()
      mkdirSync(memoryDir(root), { recursive: true })
      createPlaceholderMemoryFile(root, "active-context.md")

      const result = checkActiveContext(root)
      expect(result.passed).toBe(false)
      expect(result.message).toContain("placeholder")
    })

    it("returns fail when file is missing", () => {
      const root = setupTempDir()
      mkdirSync(memoryDir(root), { recursive: true })

      const result = checkActiveContext(root)
      expect(result.passed).toBe(false)
      expect(result.message).toContain("missing")
    })
  })

  describe("checkProgress", () => {
    it("returns pass for real content", () => {
      const root = setupTempDir()
      mkdirSync(memoryDir(root), { recursive: true })
      createRealMemoryFile(root, "progress.md")

      const result = checkProgress(root)
      expect(result.passed).toBe(true)
    })
  })

  describe("checkTasks", () => {
    it("returns pass for real content", () => {
      const root = setupTempDir()
      mkdirSync(memoryDir(root), { recursive: true })
      createRealMemoryFile(root, "tasks.md")

      const result = checkTasks(root)
      expect(result.passed).toBe(true)
    })
  })

  describe("checkDecisions", () => {
    it("returns pass for real content", () => {
      const root = setupTempDir()
      mkdirSync(memoryDir(root), { recursive: true })
      createRealMemoryFile(root, "decisions.md")

      const result = checkDecisions(root)
      expect(result.passed).toBe(true)
    })
  })

  describe("checkQualityHistory", () => {
    it("returns pass for real content", () => {
      const root = setupTempDir()
      mkdirSync(memoryDir(root), { recursive: true })
      createRealMemoryFile(root, "quality-history.md")

      const result = checkQualityHistory(root)
      expect(result.passed).toBe(true)
    })
  })

  describe("checkRiskProfile", () => {
    it("returns pass for real content", () => {
      const root = setupTempDir()
      mkdirSync(memoryDir(root), { recursive: true })
      createRealMemoryFile(root, "risk-profile.md")

      const result = checkRiskProfile(root)
      expect(result.passed).toBe(true)
    })
  })

  describe("checkContinuation", () => {
    it("returns pass for fresh continuation", () => {
      const root = setupTempDir()
      mkdirSync(memoryDir(root), { recursive: true })
      createRealMemoryFile(root, "active-context.md")
      createValidManifest(root, RECENT_TIMESTAMP())
      createContinuation(root, {})

      const result = checkContinuation(root)
      expect(result.passed).toBe(true)
      expect(result.message).toContain("fresh")
    })

    it("returns fail for stale continuation", () => {
      const root = setupTempDir()
      mkdirSync(memoryDir(root), { recursive: true })
      createRealMemoryFile(root, "active-context.md")
      createValidManifest(root, RECENT_TIMESTAMP())
      createContinuation(root, { "active-context.md": "bun:doesnotmatch" })

      const result = checkContinuation(root)
      expect(result.passed).toBe(false)
      expect(result.message).toContain("stale")
    })

    it("returns fail when continuation is missing", () => {
      const root = setupTempDir()
      mkdirSync(memoryDir(root), { recursive: true })
      createValidManifest(root, RECENT_TIMESTAMP())

      const result = checkContinuation(root)
      expect(result.passed).toBe(false)
      expect(result.message).toContain("continuation")
    })

    it("returns fail when manifest is missing", () => {
      const root = setupTempDir()
      mkdirSync(memoryDir(root), { recursive: true })
      createContinuation(root, {})

      const result = checkContinuation(root)
      expect(result.passed).toBe(false)
      expect(result.message).toContain("manifest")
    })
  })

  describe("checkManifest", () => {
    it("returns pass for current manifest", () => {
      const root = setupTempDir()
      mkdirSync(memoryDir(root), { recursive: true })
      createValidManifest(root, RECENT_TIMESTAMP())

      const result = checkManifest(root)
      expect(result.passed).toBe(true)
      expect(result.message).toContain("current")
    })

    it("returns fail for old manifest", () => {
      const root = setupTempDir()
      mkdirSync(memoryDir(root), { recursive: true })
      createValidManifest(root, STALE_TIMESTAMP())

      const result = checkManifest(root)
      expect(result.passed).toBe(false)
      expect(result.message).toContain("freshness")
    })

    it("returns fail when manifest is missing", () => {
      const root = setupTempDir()
      mkdirSync(memoryDir(root), { recursive: true })

      const result = checkManifest(root)
      expect(result.passed).toBe(false)
      expect(result.message).toContain("manifest")
    })
  })

  describe("checkPlaceholders", () => {
    it("returns pass when all files have real content", () => {
      const root = setupTempDir()
      mkdirSync(memoryDir(root), { recursive: true })
      for (const f of PROJECT_MEMORY_FILES) {
        createRealMemoryFile(root, f)
      }

      const result = checkPlaceholders(root)
      expect(result.passed).toBe(true)
    })

    it("detects remaining placeholders", () => {
      const root = setupTempDir()
      mkdirSync(memoryDir(root), { recursive: true })
      for (const f of PROJECT_MEMORY_FILES) {
        if (f === "active-context.md") {
          createRealMemoryFile(root, f)
        } else {
          createPlaceholderMemoryFile(root, f)
        }
      }

      const result = checkPlaceholders(root)
      expect(result.passed).toBe(false)
      expect(result.message).toContain("placeholder")
    })

    it("detects missing files as placeholders", () => {
      const root = setupTempDir()
      mkdirSync(memoryDir(root), { recursive: true })
      createRealMemoryFile(root, "active-context.md")

      const result = checkPlaceholders(root)
      expect(result.passed).toBe(false)
      // The number of placeholder files depends on how many required files exist.
      // With only active-context.md created, all other required files are detected as placeholders.
      expect(result.message).toMatch(/Found \d+ file\(s\) with remaining placeholders/)
      expect(result.message).toContain("progress.md")
      expect(result.message).toContain("tasks.md")
    })
  })

  describe("checkMemoryReadiness", () => {
    it("returns PASS for healthy memory", () => {
      const root = setupTempDir()
      setupHealthyMemory(root)

      const result = checkMemoryReadiness(root)
      expect(result.status).toBe("PASS")
      expect(result.score).toBeGreaterThanOrEqual(80)
      expect(result.recommendations.length).toBe(0)
    })

    it("returns WARN for partially populated memory", () => {
      const root = setupTempDir()
      setupPartialMemory(root)

      const result = checkMemoryReadiness(root)
      expect(result.status).toBe("WARN")
      expect(result.score).toBeGreaterThanOrEqual(50)
      expect(result.score).toBeLessThan(80)
      expect(result.recommendations.length).toBeGreaterThan(0)
    })

    it("returns FAIL for missing files", () => {
      const root = setupTempDir()
      mkdirSync(memoryDir(root), { recursive: true })

      const result = checkMemoryReadiness(root)
      expect(result.status).toBe("FAIL")
      expect(result.score).toBeLessThan(50)
    })
  })
})
