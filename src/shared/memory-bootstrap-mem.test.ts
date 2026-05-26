import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { bootstrapMemoryFiles, PROJECT_MEMORY_FILES } from "./memory-bootstrap"

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

    // All files should exist
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
})
