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
  hasSufficientEvidence,
  isDuplicateOfRecentRisk,
  compactAndDedupeRisks,
  extractAffectedTarget,
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

    it("does not create speculative high-risk entries without evidence", () => {
      const root = setupTempDir()

      // updateRiskProfile with a non-matching file and high riskLevel
      // should NOT create speculative entries after dedupe/filter
      updateRiskProfile(root, ["some-file.txt"], "high")
      const entries = readRisks(root)

      // No speculative High-risk operation entry should exist
      const highRisk = entries.find((e) => e.description.includes("High-risk operation"))
      expect(highRisk).toBeUndefined()
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

    it("overrides severity with riskLevel parameter", () => {
      const root = setupTempDir()

      // riskLevel "critical" should override rule severity (medium)
      updateRiskProfile(root, ["prisma/migrations/002_add_users.sql"], "critical")
      const entries = readRisks(root)

      const migrationRisk = entries.find((e) => e.category === "migration_risk")
      expect(migrationRisk).toBeDefined()
      // severity should be "critical" (from riskLevel), not "medium" (rule default)
      expect(migrationRisk!.severity).toBe("critical")

      cleanup()
    })

    it("uses rule default severity when riskLevel is not provided", () => {
      const root = setupTempDir()

      updateRiskProfile(root, ["prisma/migrations/002_add_users.sql"])
      const entries = readRisks(root)

      const migrationRisk = entries.find((e) => e.category === "migration_risk")
      expect(migrationRisk).toBeDefined()
      // severity should be "medium" (rule default), not overridden
      expect(migrationRisk!.severity).toBe("medium")

      cleanup()
    })

    it("ignores invalid riskLevel and uses rule default", () => {
      const root = setupTempDir()

      updateRiskProfile(root, ["prisma/migrations/002_add_users.sql"], "invalid_level")
      const entries = readRisks(root)

      const migrationRisk = entries.find((e) => e.category === "migration_risk")
      expect(migrationRisk).toBeDefined()
      // severity should be "medium" (rule default), invalid level ignored
      expect(migrationRisk!.severity).toBe("medium")

      cleanup()
    })

  })

  describe("hasSufficientEvidence", () => {
    it("accepts security risk from env file change", () => {
      const entry = makeEntry({ description: "Environment file modified: .env" })
      expect(hasSufficientEvidence(entry)).toBe(true)
    })

    it("accepts migration risk from schema file change", () => {
      const entry = makeEntry({ category: "migration_risk", description: "Database schema file changed: src/config/schema/hecateq.ts" })
      expect(hasSufficientEvidence(entry)).toBe(true)
    })

    it("rejects speculative risk without evidence", () => {
      const entry = makeEntry({ category: "destructive_op", description: "Possible risk detected" })
      expect(hasSufficientEvidence(entry)).toBe(false)
    })

    it("rejects vague generic risk", () => {
      const entry = makeEntry({ category: "other", description: "risk" })
      expect(hasSufficientEvidence(entry)).toBe(false)
    })

    it("accepts failing test evidence", () => {
      const entry = makeEntry({ description: "Failing test detected in CI pipeline" })
      expect(hasSufficientEvidence(entry)).toBe(true)
    })

    it("accepts disabled hook evidence", () => {
      const entry = makeEntry({ category: "security", description: "Disabled safety hook: comment-checker" })
      expect(hasSufficientEvidence(entry)).toBe(true)
    })
  })

  describe("isDuplicateOfRecentRisk", () => {
    it("detects duplicate by same description and category", () => {
      const existing = [makeEntry({ timestamp: new Date(Date.now() - 3600000).toISOString() })]
      const candidate = makeEntry({ timestamp: new Date().toISOString() })
      expect(isDuplicateOfRecentRisk(candidate, existing)).toBe(true)
    })

    it("does not flag different risk as duplicate", () => {
      const existing = [makeEntry({ description: "Risk A" })]
      const candidate = makeEntry({ description: "Risk B" })
      expect(isDuplicateOfRecentRisk(candidate, existing)).toBe(false)
    })

    it("does not flag entries outside dedupe window", () => {
      const twoDaysAgo = new Date(Date.now() - 48 * 3600000).toISOString()
      const existing = [makeEntry({ timestamp: twoDaysAgo })]
      const candidate = makeEntry({ timestamp: new Date().toISOString() })
      expect(isDuplicateOfRecentRisk(candidate, existing)).toBe(false)
    })
  })

  describe("compactAndDedupeRisks", () => {
    let testDir = ""

    function setupTempDir(): string {
      testDir = join(tmpdir(), `omo-risk-compact-${randomUUID()}`)
      mkdirSync(join(testDir, PROJECT_MEMORY_DIR), { recursive: true })
      return testDir
    }

    function cleanup(): void {
      if (testDir) rmSync(testDir, { recursive: true, force: true })
    }

    afterEach(() => {
      cleanup()
    })

    it("removes speculative risks when evidenceOnly is true", () => {
      const root = setupTempDir()

      // Write a speculative risk
      writeRisk(root, makeEntry({
        category: "destructive_op",
        description: "Possible risk detected",
        severity: "high",
      }))

      // Write an evidence-backed risk
      writeRisk(root, makeEntry({
        description: "Environment file modified: .env",
        severity: "high",
      }))

      const result = compactAndDedupeRisks(root, { evidenceOnly: true })

      expect(result.removed).toBeGreaterThanOrEqual(1)

      const remaining = readRisks(root)
      // The evidence-backed .env risk should remain
      const envRisk = remaining.find((r) => r.description.includes(".env"))
      expect(envRisk).toBeDefined()
      // The speculative risk should be removed
      const speculativeRisk = remaining.find((r) => r.description.includes("Possible risk"))
      expect(speculativeRisk).toBeUndefined()

      cleanup()
    })

    it("deduplicates repeated risk entries", () => {
      const root = setupTempDir()

      // Write the same risk multiple times
      writeRisk(root, makeEntry({ description: "Environment file modified: .env" }))
      writeRisk(root, makeEntry({ description: "Environment file modified: .env" }))

      const result = compactAndDedupeRisks(root, { evidenceOnly: true })

      expect(result.removed).toBeGreaterThanOrEqual(1)

      const remaining = readRisks(root)
      expect(remaining.length).toBeLessThanOrEqual(1)

      cleanup()
    })

    it("does nothing when no redundant entries exist", () => {
      const root = setupTempDir()

      writeRisk(root, makeEntry({ description: "Environment file modified: .env" }))

      const result = compactAndDedupeRisks(root, { evidenceOnly: true })

      expect(result.removed).toBe(0)

      cleanup()
    })
  })

  describe("extractAffectedTarget", () => {
    it("extracts file path from schema changed description", () => {
      const result = extractAffectedTarget("Database schema file changed: src/config/schema/hecateq.ts")
      expect(result).toBe("src/config/schema/hecateq.ts")
    })

    it("extracts file path from env file changed description", () => {
      const result = extractAffectedTarget("Environment file modified: .env")
      expect(result).toBe(".env")
    })

    it("returns null for descriptive risks without a file target", () => {
      const result = extractAffectedTarget("High-risk operation detected (risk level: high)")
      expect(result).toBeNull()
    })

    it("extracts path from file changed description", () => {
      const result = extractAffectedTarget("Migration file changed: src/db/001.sql")
      expect(result).toBe("src/db/001.sql")
    })
  })

  describe("compactAndDedupeRisks target dedupe", () => {
    let testDir = ""

    function setupTempDir(): string {
      testDir = join(tmpdir(), `omo-risk-target-${randomUUID()}`)
      mkdirSync(join(testDir, PROJECT_MEMORY_DIR), { recursive: true })
      return testDir
    }

    afterEach(() => {
      if (testDir) rmSync(testDir, { recursive: true, force: true })
    })

    it("collapses same target+category entries keeping latest", () => {
      const root = setupTempDir()

      // Write two migration_risk entries for the same target at different timestamps
      writeRisk(root, makeEntry({
        category: "migration_risk",
        description: "Database schema file changed: src/config/schema/hecateq.ts",
        timestamp: "2026-06-02T18:40:36.940Z",
        severity: "medium",
      }))
      writeRisk(root, makeEntry({
        category: "migration_risk",
        description: "Database schema file changed: src/config/schema/hecateq.ts",
        timestamp: "2026-06-05T10:11:09.895Z",
        severity: "medium",
      }))

      const result = compactAndDedupeRisks(root, { evidenceOnly: true })

      // Should have collapsed from 2 → 1
      expect(result.kept).toBe(1)
      expect(result.removed).toBe(1)

      const remaining = readRisks(root)
      expect(remaining.length).toBe(1)
      // Should keep the latest timestamp
      expect(remaining[0].timestamp).toBe("2026-06-05T10:11:09.895Z")

      cleanup()
    })

    it("keeps separate targets as separate entries", () => {
      const root = setupTempDir()

      writeRisk(root, makeEntry({
        category: "migration_risk",
        description: "Database schema file changed: src/config/schema/hecateq.ts",
        severity: "medium",
      }))
      writeRisk(root, makeEntry({
        category: "migration_risk",
        description: "Database schema file changed: assets/hecateq-openagent.schema.json",
        severity: "medium",
      }))

      const result = compactAndDedupeRisks(root, { evidenceOnly: true })

      // Different targets should remain
      expect(result.kept).toBe(2)

      cleanup()
    })
  })
})
