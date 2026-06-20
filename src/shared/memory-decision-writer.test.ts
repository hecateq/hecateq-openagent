import { describe, expect, it } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  writeDecision,
  readDecisions,
  formatDecision,
  parseDecisions,
  isDuplicateDecision,
  type DecisionEntry,
} from "./memory-decision-writer"
import { acquireLock, getLock, releaseLock } from "./memory-lock"
import { PROJECT_MEMORY_DIR } from "./memory-bootstrap"

const DECISIONS_FILE = "decisions.md"
const LOCK_SESSION = "memory-decision-writer"

describe("memory-decision-writer", () => {
  let testDir = ""

  function setupTempDir(): string {
    testDir = join(tmpdir(), `omo-mem-decision-${randomUUID()}`)
    mkdirSync(join(testDir, PROJECT_MEMORY_DIR), { recursive: true })
    return testDir
  }

  function cleanup(): void {
    if (testDir) rmSync(testDir, { recursive: true, force: true })
  }

  function makeEntry(overrides?: Partial<DecisionEntry>): DecisionEntry {
    return {
      timestamp: "2025-01-01T00:00:00.000Z",
      decision: "Use PostgreSQL for the main database",
      rationale: "ACID compliance and strong ecosystem support",
      impact_area: "database",
      source: "agent",
      ...overrides,
    }
  }

  function writeEntryDirect(root: string, entry: DecisionEntry): void {
    const dir = join(root, PROJECT_MEMORY_DIR)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const header = "## Accepted Decisions"
    let content = ""
    const filePath = join(dir, DECISIONS_FILE)
    if (existsSync(filePath)) {
      content = readFileSync(filePath, "utf-8")
    } else {
      content = `# Decisions\n\nLast updated: 2025-01-01\n\n${header}\n\n## Rejected Approaches\n- (none recorded)\n\n## Notes\n- Decisions are recorded automatically\n`
    }
    const formatted = formatDecision(entry)
    const sectionIdx = content.indexOf(header)
    const insertPos = sectionIdx + header.length
    content = content.slice(0, insertPos) + "\n\n" + formatted + content.slice(insertPos)
  }

  describe("writeDecision", () => {
    it("appends decision to decisions.md", () => {
      const root = setupTempDir()
      const entry = makeEntry()

      writeDecision(root, entry)
      const content = readFileSync(join(root, PROJECT_MEMORY_DIR, DECISIONS_FILE), "utf-8")
      expect(content).toContain("Use PostgreSQL for the main database")
      expect(content).toContain("ACID compliance and strong ecosystem support")
      expect(content).toContain("database")

      cleanup()
    })

    it("creates file if missing", () => {
      const root = setupTempDir()
      const filePath = join(root, PROJECT_MEMORY_DIR, DECISIONS_FILE)
      expect(existsSync(filePath)).toBe(false)

      writeDecision(root, makeEntry())
      expect(existsSync(filePath)).toBe(true)

      const content = readFileSync(filePath, "utf-8")
      expect(content).toContain("# Decisions")
      expect(content).toContain("Use PostgreSQL")

      cleanup()
    })

    it("acquires lock before write", () => {
      const root = setupTempDir()
      const filePath = join(root, PROJECT_MEMORY_DIR, DECISIONS_FILE)

      acquireLock(root, DECISIONS_FILE, "blocker", "blocker")
      writeDecision(root, makeEntry())
      expect(existsSync(filePath)).toBe(false)

      releaseLock(root, DECISIONS_FILE, "blocker", "blocker")
      cleanup()
    })

    it("releases lock after write", () => {
      const root = setupTempDir()

      writeDecision(root, makeEntry())
      const lock = getLock(root, DECISIONS_FILE)
      expect(lock).toBeNull()

      cleanup()
    })
  })

  describe("readDecisions", () => {
    it("returns empty array if file missing", () => {
      const root = setupTempDir()
      const entries = readDecisions(root)
      expect(entries).toEqual([])
      cleanup()
    })

    it("parses entries correctly", () => {
      const root = setupTempDir()

      writeDecision(root, makeEntry())
      const entries = readDecisions(root)

      expect(entries.length).toBe(1)
      expect(entries[0].decision).toBe("Use PostgreSQL for the main database")
      expect(entries[0].rationale).toBe("ACID compliance and strong ecosystem support")
      expect(entries[0].impact_area).toBe("database")
      expect(entries[0].source).toBe("agent")

      cleanup()
    })
  })

  describe("formatDecision", () => {
    it("formats decision as markdown", () => {
      const entry = makeEntry()
      const result = formatDecision(entry)

      expect(result).toContain("### 2025-01-01T00:00:00.000Z — [database]")
      expect(result).toContain("**Decision**: Use PostgreSQL for the main database")
      expect(result).toContain("**Rationale**: ACID compliance and strong ecosystem support")
      expect(result).toContain("**Source**: agent")
    })

    it("includes rejected alternatives when present", () => {
      const entry = makeEntry({ rejected_alternatives: "MySQL, MongoDB" })
      const result = formatDecision(entry)

      expect(result).toContain("**Rejected Alternatives**: MySQL, MongoDB")
    })

    it("omits rejected alternatives when absent", () => {
      const entry = makeEntry()
      const result = formatDecision(entry)

      expect(result).not.toContain("Rejected Alternatives")
    })
  })

  describe("parseDecisions", () => {
    it("parses markdown back to entries", () => {
      const entry = makeEntry()
      const markdown = formatDecision(entry)
      const content = `# Decisions\n\n## Accepted Decisions\n\n${markdown}\n`
      const entries = parseDecisions(content)

      expect(entries.length).toBe(1)
      expect(entries[0].decision).toBe("Use PostgreSQL for the main database")
      expect(entries[0].rationale).toBe("ACID compliance and strong ecosystem support")
      expect(entries[0].impact_area).toBe("database")
      expect(entries[0].source).toBe("agent")
    })

    it("handles multiple entries", () => {
      const e1 = makeEntry({ timestamp: "2025-01-01T00:00:00.000Z", decision: "Decision A" })
      const e2 = makeEntry({ timestamp: "2025-01-02T00:00:00.000Z", decision: "Decision B" })
      const content = `# Decisions\n\n## Accepted Decisions\n\n${formatDecision(e1)}\n\n${formatDecision(e2)}\n`
      const entries = parseDecisions(content)

      expect(entries.length).toBe(2)
      expect(entries[0].decision).toBe("Decision A")
      expect(entries[1].decision).toBe("Decision B")
    })

    it("skips entries with missing required fields", () => {
      const content = `# Decisions\n\n## Accepted Decisions\n\n### 2025-01-01T00:00:00.000Z — [test]\n- **Decision**: Some decision\n`
      const entries = parseDecisions(content)
      expect(entries.length).toBe(0)
    })
  })

  describe("isDuplicateDecision", () => {
    it("detects similar decisions with matching rationale", () => {
      const root = setupTempDir()

      writeDecision(root, makeEntry({ decision: "Use PostgreSQL for main database", rationale: "ACID compliance and strong ecosystem support" }))
      const result = isDuplicateDecision(root, "use postgresql for main db", "acid compliance strong ecosystem", 0.5)

      expect(result).toBe(true)
      cleanup()
    })

    it("returns false when decision matches but rationale differs", () => {
      const root = setupTempDir()

      writeDecision(root, makeEntry({ decision: "Use PostgreSQL for main database", rationale: "ACID compliance and strong ecosystem support" }))
      const result = isDuplicateDecision(root, "Use PostgreSQL for main database", "we just like SQL", 0.8)

      expect(result).toBe(false)
      cleanup()
    })

    it("returns false for different decisions with different rationales", () => {
      const root = setupTempDir()

      writeDecision(root, makeEntry({ decision: "Use PostgreSQL for main database", rationale: "ACID compliance" }))
      const result = isDuplicateDecision(root, "Switch to a NoSQL solution", "document flexibility", 0.8)

      expect(result).toBe(false)
      cleanup()
    })

    it("returns false when no decisions exist", () => {
      const root = setupTempDir()
      const result = isDuplicateDecision(root, "Anything at all", "some rationale")
      expect(result).toBe(false)
      cleanup()
    })

    it("detects exact duplicate with same rationale", () => {
      const root = setupTempDir()

      writeDecision(root, makeEntry({ decision: "Use PostgreSQL", rationale: "ACID compliance" }))
      const result = isDuplicateDecision(root, "Use PostgreSQL", "ACID compliance")

      expect(result).toBe(true)
      cleanup()
    })
  })

  describe("writeDecision dedup", () => {
    it("skips writing duplicate decision with same rationale", () => {
      const root = setupTempDir()

      const entry = makeEntry({ decision: "Use Redis for caching", rationale: "fast in-memory access" })
      writeDecision(root, entry)

      const afterFirst = readDecisions(root)
      expect(afterFirst.length).toBe(1)

      writeDecision(root, entry)
      const afterSecond = readDecisions(root)
      expect(afterSecond.length).toBe(1)

      cleanup()
    })

    it("writes decision with same title but different rationale", () => {
      const root = setupTempDir()

      writeDecision(root, makeEntry({ decision: "Use PostgreSQL", rationale: "ACID compliance" }))
      writeDecision(root, makeEntry({ decision: "Use PostgreSQL", rationale: "we like SQL more" }))

      const entries = readDecisions(root)
      expect(entries.length).toBe(2)

      cleanup()
    })

    it("writes decision with same rationale but different title", () => {
      const root = setupTempDir()

      writeDecision(root, makeEntry({ decision: "Use PostgreSQL", rationale: "ACID compliance" }))
      writeDecision(root, makeEntry({ decision: "Use MySQL", rationale: "ACID compliance" }))

      const entries = readDecisions(root)
      expect(entries.length).toBe(2)

      cleanup()
    })

    it("skips near-duplicate decision with high similarity", () => {
      const root = setupTempDir()

      writeDecision(root, makeEntry({ decision: "Use PostgreSQL for database storage", rationale: "strong ACID compliance guarantees" }))
      writeDecision(root, makeEntry({ decision: "use postgresql for database storage", rationale: "strong acid compliance guarantees" }))

      const entries = readDecisions(root)
      expect(entries.length).toBe(1)

      cleanup()
    })
  })
})
