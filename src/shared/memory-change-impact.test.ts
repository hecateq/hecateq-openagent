import { describe, expect, it, afterEach, beforeEach } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"

import {
  CHANGE_IMPACT_SECTION_HEADER,
  domainInfoForPath,
  riskReasonForEntry,
  formatChangeImpactSection,
  migrateChangeImpactSection,
  enforceChangeImpactRetention,
  appendChangeImpactEntryWithResult,
  type ChangeImpactEntry,
  type ChangeImpactRetentionResult,
} from "./memory-change-impact"

import { acquireLock, releaseLock } from "./memory-lock"

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

describe("domainInfoForPath", () => {
  describe("#given high-risk domain paths", () => {
    it("detects auth domain as high risk", () => {
      const result = domainInfoForPath("src/features/auth/login.ts")
      expect(result.domain).toBe("auth")
      expect(result.risk).toBe("high")
    })

    it("detects schema domain as high risk", () => {
      const result = domainInfoForPath("src/config/schema/user.schema.ts")
      expect(result.domain).toBe("schema")
      expect(result.risk).toBe("high")
    })

    it("detects shared core domain as high risk", () => {
      const result = domainInfoForPath("src/shared/deep-merge.ts")
      expect(result.domain).toBe("shared_core")
      expect(result.risk).toBe("high")
    })

    it("detects memory bootstrap as memory_system not shared_core", () => {
      const result = domainInfoForPath("src/shared/memory-bootstrap.ts")
      expect(result.domain).toBe("memory_system")
      expect(result.risk).toBe("high")
    })

    it("detects core orchestration as high risk", () => {
      const result = domainInfoForPath("src/features/hecateq-orchestration/controller.ts")
      expect(result.domain).toBe("core_orchestration")
      expect(result.risk).toBe("high")
    })

    it("detects memory system as high risk", () => {
      const result = domainInfoForPath("src/shared/memory-bootstrap.ts")
      expect(result.domain).toBe("memory_system")
      expect(result.risk).toBe("high")
    })

    it("detects routing as high risk", () => {
      const result = domainInfoForPath("src/hooks/routing-policy/index.ts")
      expect(result.domain).toBe("routing")
      expect(result.risk).toBe("high")
    })
  })

  describe("#given medium-risk domain paths", () => {
    it("detects config as medium risk", () => {
      const result = domainInfoForPath("src/config/schema/hecateq.ts")
      expect(result.domain).toBe("schema")
      expect(result.risk).toBe("high")
    })

    it("detects shared component as medium risk", () => {
      const result = domainInfoForPath("src/components/Button.tsx")
      // src/components/ → shared_component
      expect(result.domain).toBe("shared_component")
      expect(result.risk).toBe("medium")
    })

    it("detects global style as medium risk", () => {
      const result = domainInfoForPath("src/styles/theme.css")
      expect(result.domain).toBe("global_style")
      expect(result.risk).toBe("medium")
    })
  })

  describe("#given low-risk domain paths", () => {
    it("detects test-only as low risk", () => {
      const result = domainInfoForPath("src/shared/foo.test.ts")
      expect(result.domain).toBe("test_only")
      expect(result.risk).toBe("low")
    })

    it("detects doc change as low risk", () => {
      const result = domainInfoForPath("README.md")
      expect(result.domain).toBe("doc")
      expect(result.risk).toBe("low")
    })

    it("detects config runtime as low risk", () => {
      const result = domainInfoForPath("bun.lock")
      expect(result.domain).toBe("config_runtime")
      expect(result.risk).toBe("low")
    })

    it("detects isolated page as low risk", () => {
      const result = domainInfoForPath("src/app/dashboard/page.tsx")
      expect(result.domain).toBe("isolated_page")
      expect(result.risk).toBe("low")
    })
  })
})

describe("riskReasonForEntry", () => {
  it("returns existing basis when not none", () => {
    const result = riskReasonForEntry("src/foo.ts", "test:src/foo.test.ts")
    expect(result).toBe("test:src/foo.test.ts")
  })

  it("returns doc reason for markdown files", () => {
    const result = riskReasonForEntry("README.md", "none")
    expect(result).toBe("doc:doc-only")
  })

  it("returns config reason for config files", () => {
    const result = riskReasonForEntry(".opencode/config.jsonc", "none")
    expect(result).toBe("cfg:config-file")
  })

  it("returns style reason for CSS files", () => {
    const result = riskReasonForEntry("src/styles/global.css", "none")
    expect(result).toBe("style:style-only")
  })

  it("returns test reason for test files", () => {
    const result = riskReasonForEntry("src/foo.test.ts", "none")
    expect(result).toBe("test:test-file")
  })

  it("returns domain-scoped reason for unknown files", () => {
    const result = riskReasonForEntry("src/random/lib.ts", "none")
    // Falls into src/lib/ → shared_core domain
    expect(result).toContain("no-test:")
  })
})

describe("formatChangeImpactSection", () => {
  describe("#given mixed domain entries", () => {
    it("groups entries by domain with risk labels", () => {
      const entries: ChangeImpactEntry[] = [
        {
          path: "src/features/auth/login.ts",
          changeType: "modified",
          confidence: "high",
          confidenceBasis: "test:login.test.ts",
          sourceSessionId: "ses_1",
          timestamp: "2026-06-06T00:00:00.000Z",
        },
        {
          path: "README.md",
          changeType: "modified",
          confidence: "low",
          confidenceBasis: "none",
          sourceSessionId: "ses_1",
          timestamp: "2026-06-06T00:00:00.000Z",
        },
        {
          path: "src/components/Button.tsx",
          changeType: "modified",
          confidence: "medium",
          confidenceBasis: "dir:src/components",
          sourceSessionId: "ses_1",
          timestamp: "2026-06-06T00:00:00.000Z",
        },
      ]

      const result = formatChangeImpactSection(entries)

      // High risk groups first
      expect(result).toContain("Auth / Identity")
      expect(result).toContain("⚠️ High")
      // Medium risk groups
      expect(result).toContain("Shared Component / UI")
      expect(result).toContain("🔶 Medium")
      // Low risk groups
      expect(result).toContain("Documentation")
      expect(result).toContain("🔹 Low")
      // All paths present
      expect(result).toContain("src/features/auth/login.ts")
      expect(result).toContain("README.md")
      expect(result).toContain("src/components/Button.tsx")
    })

    it("deduplicates same path+type entries", () => {
      const entries: ChangeImpactEntry[] = [
        {
          path: "src/foo.ts",
          changeType: "modified",
          confidence: "high",
          confidenceBasis: "test:foo.test.ts",
          sourceSessionId: "ses_1",
          timestamp: "2026-06-06T00:00:00.000Z",
        },
        {
          path: "src/foo.ts",
          changeType: "modified",
          confidence: "high",
          confidenceBasis: "test:foo.test.ts",
          sourceSessionId: "ses_2",
          timestamp: "2026-06-07T00:00:00.000Z",
        },
      ]

      const result = formatChangeImpactSection(entries)
      // Path should appear only once
      const matches = result.match(/src\/foo\.ts/g)
      expect(matches).toHaveLength(1)
    })

    it("does not emit raw [low](none) rows", () => {
      const entries: ChangeImpactEntry[] = [
        {
          path: "README.md",
          changeType: "modified",
          confidence: "low",
          confidenceBasis: "none",
          sourceSessionId: "ses_1",
          timestamp: "2026-06-06T00:00:00.000Z",
        },
      ]

      const result = formatChangeImpactSection(entries)
      // Should not have bare [low](none) — riskReasonForEntry replaces "none"
      expect(result).not.toContain("[low](none)")
      // Should have the doc reason instead
      expect(result).toContain("[low](doc:doc-only)")
    })
  })

  describe("#given empty entries", () => {
    it("returns empty state message", () => {
      const result = formatChangeImpactSection([])
      expect(result).toContain("no changes tracked")
    })
  })
})

describe("migrateChangeImpactSection", () => {
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

  function createLegacyFileMap(content: string): void {
    const memoryDir = join(projectRoot, ".opencode", "state", "memory")
    const filePath = join(memoryDir, "file-map.md")
    writeFileSync(filePath, content, "utf-8")
  }

  describe("#given file with legacy raw rows", () => {
    it("converts to grouped format", () => {
      const legacy = `# File Map

Last updated: 2026-06-01

## Important Paths
- src/index.ts

## Change Impact Map

- \`src/features/auth/login.ts\` — [high](test:login.test.ts) modified — ses_1 — 2026-06-01T00:00:00.000Z
- \`README.md\` — [low](none) modified — ses_1 — 2026-06-01T00:00:00.000Z
- \`src/components/Button.tsx\` — [medium](none) modified — ses_1 — 2026-06-01T00:00:00.000Z

## Test Section
- something else
`

      createLegacyFileMap(legacy)
      const result = migrateChangeImpactSection(projectRoot)
      expect(result).toBe(true)

      const content = readFileSync(join(projectRoot, ".opencode", "state", "memory", "file-map.md"), "utf-8")
      // Should have domain group headers
      expect(content).toContain("Auth / Identity")
      expect(content).toContain("Shared Component / UI")
      expect(content).toContain("Documentation")
      // Should not have raw [low](none) — riskReasonForEntry replaces "none"
      expect(content).not.toContain("[low](none)")
      // Should preserve sections outside Change Impact Map
      expect(content).toContain("## Important Paths")
      expect(content).toContain("src/index.ts")
      expect(content).toContain("## Test Section")
      expect(content).toContain("something else")
    })

    it("deduplicates same path+type entries", () => {
      const legacy = `# File Map

## Change Impact Map

- \`src/foo.ts\` — [high](test:foo.test.ts) modified — ses_1 — 2026-06-01T00:00:00.000Z
- \`src/foo.ts\` — [high](test:foo.test.ts) modified — ses_2 — 2026-06-02T00:00:00.000Z
`

      createLegacyFileMap(legacy)
      const result = migrateChangeImpactSection(projectRoot)
      expect(result).toBe(true)

      const content = readFileSync(join(projectRoot, ".opencode", "state", "memory", "file-map.md"), "utf-8")
      expect(content).toContain("src/foo.ts")
      const matches = content.match(/src\/foo\.ts/g)
      expect(matches).toHaveLength(1)
    })

    it("normalizes absolute paths", () => {
      const legacy = `# File Map

## Change Impact Map

- \`/home/user/project/src/foo.ts\` — [high](test:foo.test.ts) modified — ses_1 — 2026-06-01T00:00:00.000Z
`

      createLegacyFileMap(legacy)
      const result = migrateChangeImpactSection(projectRoot)
      expect(result).toBe(true)

      const content = readFileSync(join(projectRoot, ".opencode", "state", "memory", "file-map.md"), "utf-8")
      // Should have relative path without /home/ prefix
      expect(content).toContain("src/foo.ts")
      expect(content).not.toContain("/home/")
    })

    it("normalizes absolute paths for root-level doc files", () => {
      const legacy = `# File Map

## Change Impact Map

- \`/home/user/project/ROADMAP.md\` — [low](none) modified — ses_1 — 2026-06-01T00:00:00.000Z
- \`/home/user/project/CHANGELOG.md\` — [low](none) modified — ses_1 — 2026-06-01T00:00:00.000Z
- \`/home/user/project/README.md\` — [low](none) modified — ses_1 — 2026-06-01T00:00:00.000Z
`

      createLegacyFileMap(legacy)
      const result = migrateChangeImpactSection(projectRoot)
      expect(result).toBe(true)

      const content = readFileSync(join(projectRoot, ".opencode", "state", "memory", "file-map.md"), "utf-8")
      expect(content).toContain("ROADMAP.md")
      expect(content).toContain("CHANGELOG.md")
      expect(content).toContain("README.md")
      expect(content).not.toContain("/home/")
      expect(content).not.toContain("ROADMAP.md — [low](none)")
    })

    it("filters out command strings like 'bun test'", () => {
      const legacy = `# File Map

## Change Impact Map

- \`src/foo.ts\` — [high](test:foo.test.ts) modified — ses_1 — 2026-06-01T00:00:00.000Z
- \`bun test src/tools/delegate-task/routing-toast.test.ts\` — [medium](self:test-file) modified — ses_1 — 2026-06-01T00:00:00.000Z
- \`bun test src/tools/delegate-task/dependency-graph-toast.test.ts\` — [medium](self:test-file) modified — ses_1 — 2026-06-01T00:00:00.000Z
`

      createLegacyFileMap(legacy)
      const result = migrateChangeImpactSection(projectRoot)
      expect(result).toBe(true)

      const content = readFileSync(join(projectRoot, ".opencode", "state", "memory", "file-map.md"), "utf-8")
      // Real file should be present
      expect(content).toContain("src/foo.ts")
      // Command strings should be filtered out
      expect(content).not.toContain("bun test")
      expect(content).not.toContain("routing-toast")
      expect(content).not.toContain("dependency-graph-toast")
    })
  })

  describe("#given file without Change Impact Map", () => {
    it("returns false", () => {
      const content = `# File Map\n\n## Important Paths\n- src/index.ts\n`
      createLegacyFileMap(content)
      const result = migrateChangeImpactSection(projectRoot)
      expect(result).toBe(false)
    })
  })

  describe("#given already-migrated file", () => {
    it("returns false (no changes needed)", () => {
      const entries: ChangeImpactEntry[] = [
        {
          path: "src/foo.ts",
          changeType: "modified",
          confidence: "high",
          confidenceBasis: "test:foo.test.ts",
          sourceSessionId: "ses_1",
          timestamp: "2026-06-01T00:00:00.000Z",
        },
      ]
      createFileMap(projectRoot, entries)

      // First migration should convert to grouped format
      const first = migrateChangeImpactSection(projectRoot)
      expect(first).toBe(true)

      // Second migration should detect no changes
      const second = migrateChangeImpactSection(projectRoot)
      expect(second).toBe(false)
    })
  })
})

describe("appendChangeImpactEntryWithResult", () => {
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

  it("returns structured result with manifest info", () => {
    const entry: ChangeImpactEntry = {
      path: "src/test.ts",
      changeType: "modified",
      confidence: "high",
      confidenceBasis: "test",
      sourceSessionId: "ses_1",
      timestamp: new Date().toISOString(),
    }

    const result = appendChangeImpactEntryWithResult(projectRoot, entry)
    expect(result.appended).toBe(1)
    expect(result.skipped).toBe(0)
    expect(result.lockBlocked).toBe(false)
  })

  it("returns lockBlocked=true when lock is held", () => {
    const entry: ChangeImpactEntry = {
      path: "src/locked.ts",
      changeType: "modified",
      confidence: "high",
      confidenceBasis: "test",
      sourceSessionId: "ses_1",
      timestamp: new Date().toISOString(),
    }

    acquireLock(projectRoot, "file-map.md", "blocker", "blocker")
    const result = appendChangeImpactEntryWithResult(projectRoot, entry)
    expect(result.appended).toBe(0)
    expect(result.lockBlocked).toBe(true)
    expect(result.skipped).toBe(1)

    releaseLock(projectRoot, "file-map.md", "blocker", "blocker")
  })
})
