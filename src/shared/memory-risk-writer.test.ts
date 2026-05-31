import { describe, expect, it, afterEach } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  writeRisk,
  readRisks,
  formatRisk,
  parseRisks,
  updateRiskProfile,
  type RiskEntry,
} from "./memory-risk-writer"
import { acquireLock, getLock, releaseLock } from "./memory-lock"
import { PROJECT_MEMORY_DIR } from "./memory-bootstrap"

const RISK_FILE = "risk-profile.md"

describe("memory-risk-writer", () => {
  let testDir = ""

  function setupTempDir(): string {
    testDir = join(tmpdir(), `omo-mem-risk-${randomUUID()}`)
    mkdirSync(join(testDir, PROJECT_MEMORY_DIR), { recursive: true })
    return testDir
  }

  function cleanup(): void {
    if (testDir) rmSync(testDir, { recursive: true, force: true })
  }

  function makeEntry(overrides?: Partial<RiskEntry>): RiskEntry {
    return {
      timestamp: "2025-01-01T00:00:00.000Z",
      category: "security",
      description: "Environment file exposed in git",
      severity: "high",
      source: "agent",
      ...overrides,
    }
  }

  afterEach(() => {
    cleanup()
  })

  describe("writeRisk", () => {
    it("appends risk to risk-profile.md", () => {
      const root = setupTempDir()

      writeRisk(root, makeEntry())
      const content = readFileSync(join(root, PROJECT_MEMORY_DIR, RISK_FILE), "utf-8")
      expect(content).toContain("Environment file exposed in git")
      expect(content).toContain("[high] security")

      cleanup()
    })

    it("creates file if missing", () => {
      const root = setupTempDir()
      const filePath = join(root, PROJECT_MEMORY_DIR, RISK_FILE)
      expect(existsSync(filePath)).toBe(false)

      writeRisk(root, makeEntry())
      expect(existsSync(filePath)).toBe(true)

      const content = readFileSync(filePath, "utf-8")
      expect(content).toContain("# Risk Profile")
      expect(content).toContain("Environment file exposed")

      cleanup()
    })

    it("uses best-effort locking (writes even when lock is held)", () => {
      const root = setupTempDir()
      const filePath = join(root, PROJECT_MEMORY_DIR, RISK_FILE)

      acquireLock(root, RISK_FILE, "blocker", "blocker")
      writeRisk(root, makeEntry())
      expect(existsSync(filePath)).toBe(true)

      releaseLock(root, RISK_FILE, "blocker", "blocker")
      cleanup()
    })

    it("releases lock after write when lock was acquired", () => {
      const root = setupTempDir()

      writeRisk(root, makeEntry())
      const lock = getLock(root, RISK_FILE)
      expect(lock).toBeNull()

      cleanup()
    })
  })

  describe("readRisks", () => {
    it("returns empty array if file missing", () => {
      const root = setupTempDir()
      const entries = readRisks(root)
      expect(entries).toEqual([])
      cleanup()
    })

    it("parses entries correctly", () => {
      const root = setupTempDir()

      writeRisk(root, makeEntry())
      const entries = readRisks(root)

      expect(entries.length).toBe(1)
      expect(entries[0].description).toBe("Environment file exposed in git")
      expect(entries[0].category).toBe("security")
      expect(entries[0].severity).toBe("high")
      expect(entries[0].source).toBe("agent")

      cleanup()
    })
  })

  describe("formatRisk", () => {
    it("formats risk as markdown", () => {
      const entry = makeEntry()
      const result = formatRisk(entry)

      expect(result).toContain("### 2025-01-01T00:00:00.000Z — [high] security")
      expect(result).toContain("**Description**: Environment file exposed in git")
      expect(result).toContain("**Source**: agent")
    })

    it("includes mitigation when present", () => {
      const entry = makeEntry({ mitigation: "Add .env to gitignore" })
      const result = formatRisk(entry)

      expect(result).toContain("**Mitigation**: Add .env to gitignore")
    })

    it("includes rollback plan when present", () => {
      const entry = makeEntry({ rollback_plan: "Revert commit abc123" })
      const result = formatRisk(entry)

      expect(result).toContain("**Rollback Plan**: Revert commit abc123")
    })

    it("omits optional fields when absent", () => {
      const entry = makeEntry()
      const result = formatRisk(entry)

      expect(result).not.toContain("Mitigation")
      expect(result).not.toContain("Rollback Plan")
    })
  })

  describe("parseRisks", () => {
    it("parses markdown back to entries", () => {
      const entry = makeEntry()
      const markdown = formatRisk(entry)
      const content = `# Risk Profile\n\nLast updated: 2025-01-01\n\n## Active Risks\n\n${markdown}\n\n## Sensitive Paths\n- (none recorded)\n\n## Mitigated Risks\n- (none recorded)\n`
      const entries = parseRisks(content)

      expect(entries.length).toBe(1)
      expect(entries[0].description).toBe("Environment file exposed in git")
      expect(entries[0].category).toBe("security")
      expect(entries[0].severity).toBe("high")
    })

    it("handles multiple entries", () => {
      const e1 = makeEntry({ timestamp: "2025-01-01T00:00:00.000Z", description: "Risk A" })
      const e2 = makeEntry({ timestamp: "2025-01-02T00:00:00.000Z", description: "Risk B" })
      const content = `# Risk Profile\n\nLast updated: 2025-01-01\n\n## Active Risks\n\n${formatRisk(e1)}\n\n${formatRisk(e2)}\n\n## Sensitive Paths\n- (none recorded)\n`
      const entries = parseRisks(content)

      expect(entries.length).toBe(2)
      expect(entries[0].description).toBe("Risk A")
      expect(entries[1].description).toBe("Risk B")
    })

    it("returns empty array for content without Active Risks section", () => {
      const content = `# Risk Profile\n\nLast updated: 2025-01-01\n\n## Some Other Section\n- stuff\n`
      const entries = parseRisks(content)
      expect(entries).toEqual([])
    })
  })

  describe("updateRiskProfile", () => {
    it("detects security risk from .env changes", () => {
      const root = setupTempDir()

      updateRiskProfile(root, [".env"])
      const entries = readRisks(root)

      expect(entries.length).toBeGreaterThanOrEqual(1)
      const envRisk = entries.find((e) => e.category === "security")
      expect(envRisk).toBeDefined()
      expect(envRisk!.description).toContain(".env")
      expect(envRisk!.severity).toBe("high")

      cleanup()
    })

    it("detects migration risk from migration files", () => {
      const root = setupTempDir()

      updateRiskProfile(root, ["src/db/migration/001_initial.sql"])
      const entries = readRisks(root)

      const migrationRisk = entries.find((e) => e.category === "migration_risk")
      expect(migrationRisk).toBeDefined()
      expect(migrationRisk!.description).toContain("migration")
      expect(migrationRisk!.severity).toBe("medium")

      cleanup()
    })

    it("creates entries for high-risk levels", () => {
      const root = setupTempDir()

      updateRiskProfile(root, ["some-file.txt"], "high")
      const entries = readRisks(root)

      const highRisk = entries.find((e) => e.description.includes("High-risk operation"))
      expect(highRisk).toBeDefined()
      expect(highRisk!.severity).toBe("high")
      expect(highRisk!.source).toBe("report")
      expect(highRisk!.mitigation).toContain("Review all changes")

      cleanup()
    })

    it("skips files that do not match any rule", () => {
      const root = setupTempDir()

      updateRiskProfile(root, ["README.md", "src/index.ts"])
      const entries = readRisks(root)
      expect(entries.length).toBe(0)

      cleanup()
    })

    it("handles empty changed files list", () => {
      const root = setupTempDir()

      updateRiskProfile(root, [])
      const entries = readRisks(root)
      expect(entries).toEqual([])

      cleanup()
    })
  })
})
