import { describe, expect, it, afterEach, beforeEach } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"

import {
  CHANGE_IMPACT_SECTION_HEADER,
  enforceChangeImpactRetention,
  type ChangeImpactEntry,
  type ChangeImpactRetentionResult,
} from "./memory-change-impact"

function tmpProjectDir(): string {
  const dir = join(tmpdir(), "change-impact-test-" + randomUUID())
  mkdirSync(dir, { recursive: true })
  mkdirSync(join(dir, ".opencode", "state", "memory"), { recursive: true })
  return dir
}

function createFileMap(projectRoot: string, entries: ChangeImpactEntry[]): void {
  const memoryDir = join(projectRoot, ".opencode", "state", "memory")
  const filePath = join(memoryDir, "file-map.md")
  const entryLines = entries.map((e) =>
    `- \`${e.path}\` — [${e.confidence}](${e.confidenceBasis}) ${e.changeType} — ${e.sourceSessionId} — ${e.timestamp}`,
  )
  const content =
    "# File Map\n\n## Important Paths\n- src/index.ts\n\n## Entry Points\n- src/index.ts\n\n## Do Not Scan Blindly\n- .env\n\n" +
    CHANGE_IMPACT_SECTION_HEADER +
    "\n\n" +
    entryLines.join("\n") +
    "\n"
  writeFileSync(filePath, content, "utf-8")
}

function makeEntry(i: number): ChangeImpactEntry {
  return {
    path: `src/file-${i}.ts`,
    changeType: "modified",
    confidence: "high",
    confidenceBasis: `test:file-${i}.test.ts`,
    sourceSessionId: "ses_test",
    timestamp: new Date().toISOString(),
  }
}

function countImpactEntries(content: string): number {
  const entries = content.match(/^- `[^`]+` — /gm)
  return entries ? entries.length : 0
}

describe("enforceChangeImpactRetention", () => {
  let projectRoot = ""

  beforeEach(() => {
    projectRoot = tmpProjectDir()
  })

  afterEach(() => {
    try {
      if (existsSync(projectRoot)) rmSync(projectRoot, { recursive: true })
    } catch {
      // cleanup
    }
  })

  describe("#given missing file-map.md", () => {
    it("returns compacted=false with reason", () => {
      const result = enforceChangeImpactRetention(projectRoot)
      expect(result.compacted).toBe(false)
      expect(result.reason).toBe("file-map.md does not exist")
    })
  })

  describe("#given file-map.md with no entries", () => {
    it("returns compacted=false with reason", () => {
      createFileMap(projectRoot, [])
      const result = enforceChangeImpactRetention(projectRoot)
      expect(result.compacted).toBe(false)
      expect(result.reason).toBe("No change impact entries")
    })
  })

  describe("#given file-map.md within limits", () => {
    it("returns compacted=false", () => {
      const entries = Array.from({ length: 10 }, (_, i) => makeEntry(i))
      createFileMap(projectRoot, entries)
      const result = enforceChangeImpactRetention(projectRoot, 100)
      expect(result.compacted).toBe(false)
      expect(result.reason).toBe("Within retention limits")
    })
  })

  describe("#given entries exceeding max count", () => {
    it("keeps newest entries and compacts oldest", () => {
      const entries = Array.from({ length: 50 }, (_, i) => makeEntry(i))
      createFileMap(projectRoot, entries)
      const result = enforceChangeImpactRetention(projectRoot, 20)
      expect(result.compacted).toBe(true)
      expect(result.keptEntries).toBe(20)
      expect(result.compactedOlder).toBe(30)

      const filePath = join(projectRoot, ".opencode", "state", "memory", "file-map.md")
      const content = readFileSync(filePath, "utf-8")
      expect(countImpactEntries(content)).toBe(20)
    })
  })

  describe("#given generated path entries", () => {
    it("removes generated paths", () => {
      const entries: ChangeImpactEntry[] = [
        { path: "dist/bundle.js", changeType: "modified", confidence: "high", confidenceBasis: "build", sourceSessionId: "ses_test", timestamp: new Date().toISOString() },
        { path: "node_modules/pkg/index.js", changeType: "modified", confidence: "low", confidenceBasis: "none", sourceSessionId: "ses_test", timestamp: new Date().toISOString() },
        { path: "src/real.ts", changeType: "modified", confidence: "high", confidenceBasis: "test", sourceSessionId: "ses_test", timestamp: new Date().toISOString() },
        { path: ".next/cache/output.js", changeType: "created", confidence: "low", confidenceBasis: "none", sourceSessionId: "ses_test", timestamp: new Date().toISOString() },
        { path: "src/also-real.ts", changeType: "modified", confidence: "high", confidenceBasis: "test", sourceSessionId: "ses_test", timestamp: new Date().toISOString() },
      ]
      createFileMap(projectRoot, entries)
      const result = enforceChangeImpactRetention(projectRoot, 100)
      expect(result.compacted).toBe(true)
      expect(result.removedGenerated).toBe(3)
      expect(result.keptEntries).toBe(2)

      const filePath = join(projectRoot, ".opencode", "state", "memory", "file-map.md")
      const content = readFileSync(filePath, "utf-8")
      expect(content).toContain("src/real.ts")
      expect(content).toContain("src/also-real.ts")
      expect(content).not.toContain("dist/bundle.js")
      expect(content).not.toContain("node_modules/pkg")
      expect(content).not.toContain(".next/cache")
    })
  })

  describe("#given idempotency", () => {
    it("does not compact twice", () => {
      const entries = Array.from({ length: 50 }, (_, i) => makeEntry(i))
      createFileMap(projectRoot, entries)
      const first = enforceChangeImpactRetention(projectRoot, 20)
      expect(first.compacted).toBe(true)
      const second = enforceChangeImpactRetention(projectRoot, 20)
      expect(second.compacted).toBe(false)
    })
  })

  describe("#given important paths, entry points, and do-not-scan sections are preserved", () => {
    it("keeps Important Paths and Entry Points after compaction", () => {
      const entries = Array.from({ length: 30 }, (_, i) => makeEntry(i))
      createFileMap(projectRoot, entries)
      enforceChangeImpactRetention(projectRoot, 10)

      const filePath = join(projectRoot, ".opencode", "state", "memory", "file-map.md")
      const content = readFileSync(filePath, "utf-8")
      expect(content).toContain("## Important Paths")
      expect(content).toContain("src/index.ts")
      expect(content).toContain("## Entry Points")
      expect(content).toContain("## Do Not Scan Blindly")
      expect(content).toContain(".env")
    })
  })
})
