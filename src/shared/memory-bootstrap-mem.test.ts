import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync as fsMkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { bootstrapMemoryFiles, PROJECT_MEMORY_FILES, PROJECT_MEMORY_JSONL_FILES, FILE_TEMPLATES } from "./memory-bootstrap"
import { detectPlaceholderContent } from "./memory-manifest"

describe("memory-bootstrap with new files", () => {
  const tempDirs: string[] = []

  function createTempDir(): string {
    const d = mkdtempSync(join(tmpdir(), "omo-mem-boot-"))
    tempDirs.push(d)
    return d
  }

  afterAll(() => {
    for (const d of tempDirs) {
      try { rmSync(d, { recursive: true, force: true }) } catch { /* ignore */ }
    }
  })

  test("#given fresh project #then bootstraps all 8 files", () => {
    const dir = createTempDir()
    const result = bootstrapMemoryFiles(dir)
    expect(result.created.length).toBeGreaterThanOrEqual(8)
    expect(result.errors).toEqual([])

    // All files should exist with non-empty, non-placeholder content
    for (const file of PROJECT_MEMORY_FILES) {
      const filePath = join(dir, ".opencode", "state", "memory", file)
      expect(existsSync(filePath)).toBe(true)
      const content = readFileSync(filePath, "utf-8")
      expect(content.length).toBeGreaterThan(0)
    }
  })

  test("#given existing files #then skips without overwrite", () => {
    const dir = createTempDir()
    const firstResult = bootstrapMemoryFiles(dir)
    expect(firstResult.created.length).toBeGreaterThanOrEqual(8)

    const secondResult = bootstrapMemoryFiles(dir)
    expect(secondResult.created).toEqual([])
    expect(secondResult.skipped.length).toBeGreaterThanOrEqual(8)
  })

  test("#new files have proper templates #then content includes expected headings", () => {
    const dir = createTempDir()
    bootstrapMemoryFiles(dir)

    const agentRouting = readFileSync(join(dir, ".opencode", "state", "memory", "agent-routing.md"), "utf-8")
    expect(agentRouting).toContain("Agent Routing")
    expect(agentRouting).toContain("## Preferred Agents by Domain")

    const qualityHistory = readFileSync(join(dir, ".opencode", "state", "memory", "quality-history.md"), "utf-8")
    expect(qualityHistory).toContain("Quality History")
    expect(qualityHistory).toContain("## Quality Gate Results")

    const riskProfile = readFileSync(join(dir, ".opencode", "state", "memory", "risk-profile.md"), "utf-8")
    expect(riskProfile).toContain("Risk Profile")
    expect(riskProfile).toContain("## Sensitive Paths")
  })

  test("#PROJECT_MEMORY_FILES includes new files", () => {
    expect(PROJECT_MEMORY_FILES).toContain("agent-routing.md")
    expect(PROJECT_MEMORY_FILES).toContain("quality-history.md")
    expect(PROJECT_MEMORY_FILES).toContain("risk-profile.md")
    expect(PROJECT_MEMORY_FILES.length).toBe(8)
  })

  test("#fresh bootstrap does not write raw TODO-only files", () => {
    // given
    const dir = createTempDir()

    // when
    const result = bootstrapMemoryFiles(dir)

    // then — all created files must not be placeholder
    expect(result.created.length).toBe(10)
    for (const file of PROJECT_MEMORY_FILES) {
      const filePath = join(dir, ".opencode", "state", "memory", file)
      const content = readFileSync(filePath, "utf-8")
      expect(detectPlaceholderContent(content), `${file} should not be placeholder`).toBe(false)
      expect(content).not.toMatch(/- TODO\b/)
    }
  })

  test("#existing non-placeholder preserved", () => {
    // given
    const dir = createTempDir()
    const first = bootstrapMemoryFiles(dir)
    expect(first.created.length).toBe(10)

    // write real content to one file
    const realContent = "## Current Goal\nBuild the system\n\n## Status\nWorking\n"
    const targetPath = join(dir, ".opencode", "state", "memory", "active-context.md")
    writeFileSync(targetPath, realContent, "utf-8")

    // when — run bootstrap again (with default hydration enabled)
    const second = bootstrapMemoryFiles(dir)

    // then — real content preserved, not hydrated
    expect(second.created).toEqual([])
    expect(second.hydrated).not.toContain("active-context.md")
    expect(readFileSync(targetPath, "utf-8")).toBe(realContent)
  })

  test("#given old placeholder files #when hydrate_placeholders=true #then hydrated", () => {
    // given — create memory dir with old TODO template content
    const dir = createTempDir()
    const memDir = join(dir, ".opencode", "state", "memory")
    fsMkdirSync(memDir, { recursive: true })

    // Write files with old TODO-only template content (simulating pre-patch state)
    for (const file of PROJECT_MEMORY_FILES) {
      writeFileSync(join(memDir, file), FILE_TEMPLATES[file] ?? "", "utf-8")
    }

    // when — bootstrap with hydration enabled
    const result = bootstrapMemoryFiles(dir, { hydratePlaceholders: true })

    // then — all 8 files should be hydrated
    expect(result.hydrated.length).toBe(8)
    for (const file of PROJECT_MEMORY_FILES) {
      const content = readFileSync(join(memDir, file), "utf-8")
      expect(detectPlaceholderContent(content)).toBe(false)
      expect(content).toMatch(/Last updated: \d{4}-\d{2}-\d{2}/)
    }
  })

  test("#given old placeholder files #when hydrate_placeholders=false #then skip hydration", () => {
    // given — create memory dir with old TODO template content
    const dir = createTempDir()
    const memDir = join(dir, ".opencode", "state", "memory")
    fsMkdirSync(memDir, { recursive: true })

    for (const file of PROJECT_MEMORY_FILES) {
      writeFileSync(join(memDir, file), FILE_TEMPLATES[file] ?? "", "utf-8")
    }

    // when — bootstrap with hydration disabled
    const result = bootstrapMemoryFiles(dir, { hydratePlaceholders: false })

    // then — no hydration, markdown files remain placeholder, only JSONL files are created
    expect(result.hydrated).toEqual([])
    expect(result.created).toEqual([...PROJECT_MEMORY_JSONL_FILES])
    for (const file of PROJECT_MEMORY_FILES) {
      const content = readFileSync(join(memDir, file), "utf-8")
      expect(detectPlaceholderContent(content)).toBe(true)
    }
  })

  test("#BootstrapResult.hydrated filled correctly", () => {
    const dir = createTempDir()

    // fresh create: no hydrated (files are created, not hydrated)
    const first = bootstrapMemoryFiles(dir)
    expect(first.created.length).toBe(10)
    expect(first.hydrated).toEqual([])

    // write old placeholder into one file
    const targetPath = join(dir, ".opencode", "state", "memory", "progress.md")
    writeFileSync(targetPath, FILE_TEMPLATES["progress.md"] ?? "", "utf-8")

    // re-bootstrap with hydration: that one file gets hydrated
    const second = bootstrapMemoryFiles(dir, { hydratePlaceholders: true })
    expect(second.hydrated).toEqual(["progress.md"])
    expect(second.created).toEqual([])
  })

  test("#artifact dir behavior unchanged", () => {
    const dir = createTempDir()

    const result = bootstrapMemoryFiles(dir)
    expect(result.artifactDirsCreated.sort()).toEqual([
      ".opencode/state/contracts",
      ".opencode/state/task-graphs",
    ].sort())

    // Second run should not create them again
    const secondResult = bootstrapMemoryFiles(dir)
    expect(secondResult.artifactDirsCreated).toEqual([])
  })

  test("#given fresh project #then bootstraps tasks.jsonl as empty file", () => {
    const dir = createTempDir()
    const result = bootstrapMemoryFiles(dir)

    const tasksPath = join(dir, ".opencode", "state", "memory", "tasks.jsonl")
    expect(existsSync(tasksPath)).toBe(true)
    expect(result.created).toContain("tasks.jsonl")

    const content = readFileSync(tasksPath, "utf-8")
    expect(content).toBe("")
  })

  test("#given fresh project #then bootstraps decisions.jsonl as empty file", () => {
    const dir = createTempDir()
    const result = bootstrapMemoryFiles(dir)

    const decisionsPath = join(dir, ".opencode", "state", "memory", "decisions.jsonl")
    expect(existsSync(decisionsPath)).toBe(true)
    expect(result.created).toContain("decisions.jsonl")

    const content = readFileSync(decisionsPath, "utf-8")
    expect(content).toBe("")
  })

  test("#given existing tasks.jsonl with content #then not overwritten", () => {
    const dir = createTempDir()
    const memDir = join(dir, ".opencode", "state", "memory")
    fsMkdirSync(memDir, { recursive: true })

    const existingContent = '{"version":1,"id":"task-1","timestamp":"2026-05-31T10:00:00.000Z","action":"create","title":"Test","status":"planned"}\n'
    writeFileSync(join(memDir, "tasks.jsonl"), existingContent, "utf-8")

    const result = bootstrapMemoryFiles(dir)
    expect(result.created).not.toContain("tasks.jsonl")
    expect(result.skipped).toContain("tasks.jsonl")

    const content = readFileSync(join(memDir, "tasks.jsonl"), "utf-8")
    expect(content).toBe(existingContent)
  })

  test("#given existing decisions.jsonl with content #then not overwritten", () => {
    const dir = createTempDir()
    const memDir = join(dir, ".opencode", "state", "memory")
    fsMkdirSync(memDir, { recursive: true })

    const existingContent = '{"version":1,"id":"dec-1","timestamp":"2026-05-31T10:00:00.000Z","action":"record","title":"Test","status":"active","decision":"X","rationale":"Y","impact_area":"auth"}\n'
    writeFileSync(join(memDir, "decisions.jsonl"), existingContent, "utf-8")

    const result = bootstrapMemoryFiles(dir)
    expect(result.created).not.toContain("decisions.jsonl")
    expect(result.skipped).toContain("decisions.jsonl")

    const content = readFileSync(join(memDir, "decisions.jsonl"), "utf-8")
    expect(content).toBe(existingContent)
  })

  test("#given all markdown files already exist #when JSONL files exist too #then all skipped, nothing overwritten", () => {
    const dir = createTempDir()
    const memDir = join(dir, ".opencode", "state", "memory")
    fsMkdirSync(memDir, { recursive: true })

    // Pre-create all markdown files with custom content
    for (const file of PROJECT_MEMORY_FILES) {
      writeFileSync(join(memDir, file), "custom content", "utf-8")
    }
    // Pre-create JSONL files with custom content
    writeFileSync(join(memDir, "tasks.jsonl"), '{"line":"one"}\n', "utf-8")
    writeFileSync(join(memDir, "decisions.jsonl"), '{"line":"two"}\n', "utf-8")

    const result = bootstrapMemoryFiles(dir)
    expect(result.created).toEqual([])

    for (const file of PROJECT_MEMORY_FILES) {
      expect(result.skipped).toContain(file)
      expect(readFileSync(join(memDir, file), "utf-8")).toBe("custom content")
    }
    for (const file of PROJECT_MEMORY_JSONL_FILES) {
      expect(result.skipped).toContain(file)
    }
    expect(readFileSync(join(memDir, "tasks.jsonl"), "utf-8")).toBe('{"line":"one"}\n')
    expect(readFileSync(join(memDir, "decisions.jsonl"), "utf-8")).toBe('{"line":"two"}\n')
  })

  test("#PROJECT_MEMORY_JSONL_FILES contains expected entries", () => {
    expect(PROJECT_MEMORY_JSONL_FILES).toContain("tasks.jsonl")
    expect(PROJECT_MEMORY_JSONL_FILES).toContain("decisions.jsonl")
    expect(PROJECT_MEMORY_JSONL_FILES.length).toBe(2)
  })

  test("#.opencode/state/memory/ path unchanged", () => {
    const dir = createTempDir()
    bootstrapMemoryFiles(dir)

    const memoryDir = join(dir, ".opencode", "state", "memory")
    expect(existsSync(memoryDir)).toBe(true)
    expect(existsSync(join(memoryDir, "memory.json"))).toBe(false) // manifest not auto-created by bootstrap
    expect(existsSync(join(memoryDir, "active-context.md"))).toBe(true)
  })
})
