import { describe, expect, it } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  appendDecisionEntry,
  buildCompactDecisionSummary,
  detectConflictingDecisions,
  detectOrphanedSupersedes,
  detectRevertedDecisions,
  detectSupersededDecisions,
  formatDecisionSummary,
  readDecisionLog,
  resolveLatestDecisionState,
  DecisionLogEntrySchema,
  DECISION_LOG_FILENAME,
  type DecisionLogEntry,
} from "./decision-log"
import { PROJECT_MEMORY_DIR } from "./memory-bootstrap"

function setupTempDir(): string {
  const dir = join(tmpdir(), `omo-decision-log-${randomUUID()}`)
  mkdirSync(join(dir, PROJECT_MEMORY_DIR), { recursive: true })
  return dir
}

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
}

function makeEntry(overrides?: Partial<DecisionLogEntry>): DecisionLogEntry {
  return {
    version: 1,
    id: "dec-001",
    timestamp: "2026-05-31T10:00:00.000Z",
    action: "record",
    title: "Use bcrypt for password hashing",
    status: "active",
    decision: "Use bcrypt with cost factor 12 for all password hashing",
    rationale:
      "bcrypt is the industry standard for password storage with built-in salt and configurable cost factor",
    impact_area: "auth",
    source_session_id: "ses_abc123",
    ...overrides,
  }
}

function getMemoryFilePath(root: string): string {
  return join(root, PROJECT_MEMORY_DIR, DECISION_LOG_FILENAME)
}

function writeRawJsonl(root: string, lines: string[]): void {
  const filePath = getMemoryFilePath(root)
  const dir = join(root, PROJECT_MEMORY_DIR)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(filePath, lines.join("\n") + "\n", "utf-8")
}

describe("decision-log", () => {
  describe("readDecisionLog", () => {
    // given: no decisions.jsonl file exists
    // when: readDecisionLog is called
    // then: returns null
    it("returns null when file is missing", () => {
      const root = setupTempDir()
      const result = readDecisionLog(root)
      expect(result).toBeNull()
      cleanup(root)
    })

    // given: an empty decisions.jsonl file exists
    // when: readDecisionLog is called
    // then: returns an empty array
    it("returns empty array for an empty file", () => {
      const root = setupTempDir()
      writeRawJsonl(root, [])
      const result = readDecisionLog(root)
      expect(result).toEqual([])
      cleanup(root)
    })

    // given: a file with a valid JSONL entry
    // when: readDecisionLog is called
    // then: returns the parsed entry
    it("parses a valid JSONL entry", () => {
      const root = setupTempDir()
      const entry = makeEntry()
      writeRawJsonl(root, [JSON.stringify(entry)])
      const result = readDecisionLog(root)
      expect(result).not.toBeNull()
      expect(result!.length).toBe(1)
      expect(result![0].id).toBe("dec-001")
      expect(result![0].title).toBe("Use bcrypt for password hashing")
      expect(result![0].status).toBe("active")
      cleanup(root)
    })

    // given: a file with a malformed JSONL line mixed with valid lines
    // when: readDecisionLog is called
    // then: skips the malformed line and returns valid entries
    it("skips malformed JSONL lines without crashing", () => {
      const root = setupTempDir()
      const entry = makeEntry({ id: "dec-001" })
      const entry2 = makeEntry({ id: "dec-002", title: "Use JWT for sessions" })
      writeRawJsonl(root, [
        JSON.stringify(entry),
        "{not valid json at all}",
        "",
        JSON.stringify(entry2),
      ])
      const result = readDecisionLog(root)
      expect(result).not.toBeNull()
      expect(result!.length).toBe(2)
      expect(result![0].id).toBe("dec-001")
      expect(result![1].id).toBe("dec-002")
      cleanup(root)
    })

    // given: a file with a JSON object that doesn't match the schema
    // when: readDecisionLog is called
    // then: skips that line
    it("skips lines that fail Zod validation", () => {
      const root = setupTempDir()
      const entry = makeEntry()
      writeRawJsonl(root, [
        JSON.stringify(entry),
        JSON.stringify({
          version: 1,
          id: "bad",
          timestamp: "2026-01-01T00:00:00.000Z",
        }),
      ])
      const result = readDecisionLog(root)
      expect(result!.length).toBe(1)
      expect(result![0].id).toBe("dec-001")
      cleanup(root)
    })
  })

  describe("appendDecisionEntry", () => {
    // given: no file exists
    // when: appendDecisionEntry is called with a valid entry
    // then: creates the file and appends the entry
    it("creates file and appends entry when file is missing", () => {
      const root = setupTempDir()
      const entry = makeEntry()
      const appended = appendDecisionEntry(root, entry)
      expect(appended).toBe(true)
      expect(existsSync(getMemoryFilePath(root))).toBe(true)
      const content = readFileSync(getMemoryFilePath(root), "utf-8")
      expect(content).toContain("dec-001")
      expect(content).toContain("Use bcrypt for password hashing")
      cleanup(root)
    })

    // given: an existing file with entries
    // when: a new entry is appended
    // then: both old and new entries are present
    it("appends to existing file", () => {
      const root = setupTempDir()
      const entry1 = makeEntry({ id: "dec-001" })
      const entry2 = makeEntry({
        id: "dec-002",
        title: "Use JWT for sessions",
      })
      appendDecisionEntry(root, entry1)
      appendDecisionEntry(root, entry2)
      const result = readDecisionLog(root)
      expect(result!.length).toBe(2)
      cleanup(root)
    })

    // given: an entry identical in content (excluding timestamp) to the latest
    //        entry for the same decision id already exists
    // when: the same entry is appended again
    // then: returns false and does not append a duplicate
    it("skips duplicate entries for the same decision id with same content", () => {
      const root = setupTempDir()
      const entry = makeEntry({ id: "dec-001" })
      const first = appendDecisionEntry(root, entry)
      expect(first).toBe(true)
      const second = appendDecisionEntry(root, {
        ...entry,
        timestamp: "2026-05-31T10:01:00.000Z",
      })
      expect(second).toBe(false)
      const result = readDecisionLog(root)
      expect(result!.length).toBe(1)
      cleanup(root)
    })

    // given: an entry with different content for the same decision id
    // when: appended after the first entry
    // then: both are appended (not considered duplicate)
    it("appends entries for same id when content differs", () => {
      const root = setupTempDir()
      const entry1 = makeEntry({ id: "dec-001", status: "active" })
      const entry2 = makeEntry({
        id: "dec-001",
        status: "superseded",
        action: "supersede",
        title: "Use bcrypt for password hashing (superseded)",
      })
      const first = appendDecisionEntry(root, entry1)
      const second = appendDecisionEntry(root, entry2)
      expect(first).toBe(true)
      expect(second).toBe(true)
      const result = readDecisionLog(root)
      expect(result!.length).toBe(2)
      cleanup(root)
    })
  })

  describe("resolveLatestDecisionState", () => {
    // given: multiple entries for the same decision id
    // when: resolveLatestDecisionState is called
    // then: returns only the latest entry per id
    it("returns latest entry per decision id", () => {
      const entries = [
        makeEntry({
          id: "dec-001",
          status: "active",
          timestamp: "2026-05-31T10:00:00.000Z",
        }),
        makeEntry({
          id: "dec-001",
          status: "superseded",
          timestamp: "2026-05-31T11:00:00.000Z",
          action: "supersede",
        }),
        makeEntry({
          id: "dec-002",
          status: "active",
          timestamp: "2026-05-31T10:30:00.000Z",
        }),
      ]
      const latest = resolveLatestDecisionState(entries)
      expect(latest.size).toBe(2)
      expect(latest.get("dec-001")!.status).toBe("superseded")
      expect(latest.get("dec-002")!.status).toBe("active")
    })

    // given: entries with equal timestamps for the same id
    // when: resolveLatestDecisionState is called
    // then: the last one in the array wins
    it("picks the last entry when timestamps are equal", () => {
      const ts = "2026-05-31T10:00:00.000Z"
      const entries = [
        makeEntry({ id: "dec-001", status: "active", timestamp: ts }),
        makeEntry({
          id: "dec-001",
          status: "reverted",
          timestamp: ts,
          action: "revert",
        }),
      ]
      const latest = resolveLatestDecisionState(entries)
      expect(latest.get("dec-001")!.status).toBe("reverted")
    })
  })

  describe("supersede and revert actions", () => {
    // given: a decision entry followed by a supersede entry for the same id
    // when: the log is resolved
    // then: the decision is marked as superseded
    it("supersede action marks previous decision as superseded", () => {
      const root = setupTempDir()
      const entry1 = makeEntry({
        id: "dec-001",
        status: "active",
        action: "record",
        timestamp: "2026-05-31T10:00:00.000Z",
      })
      const entry2 = makeEntry({
        id: "dec-001",
        status: "superseded",
        action: "supersede",
        timestamp: "2026-05-31T11:00:00.000Z",
        superseded_by: "dec-002",
      })
      appendDecisionEntry(root, entry1)
      appendDecisionEntry(root, entry2)
      const entries = readDecisionLog(root)!
      const latest = resolveLatestDecisionState(entries)
      expect(latest.get("dec-001")!.status).toBe("superseded")
      expect(latest.get("dec-001")!.superseded_by).toBe("dec-002")
      cleanup(root)
    })

    // given: a decision entry followed by a revert entry for the same id
    // when: the log is resolved
    // then: the decision is marked as reverted
    it("revert action marks decision as reverted", () => {
      const root = setupTempDir()
      const entry1 = makeEntry({
        id: "dec-001",
        status: "active",
        action: "record",
        timestamp: "2026-05-31T10:00:00.000Z",
      })
      const entry2 = makeEntry({
        id: "dec-001",
        status: "reverted",
        action: "revert",
        timestamp: "2026-05-31T11:00:00.000Z",
        notes: "Performance issues found in production",
      })
      appendDecisionEntry(root, entry1)
      appendDecisionEntry(root, entry2)
      const entries = readDecisionLog(root)!
      const latest = resolveLatestDecisionState(entries)
      expect(latest.get("dec-001")!.status).toBe("reverted")
      expect(latest.get("dec-001")!.notes).toBe(
        "Performance issues found in production",
      )
      cleanup(root)
    })
  })

  describe("detectSupersededDecisions", () => {
    // given: entries with a superseded decision
    // when: detectSupersededDecisions is called
    // then: returns the superseded decision
    it("detects superseded decisions", () => {
      const entries = [
        makeEntry({ id: "dec-001", status: "active" }),
        makeEntry({
          id: "dec-002",
          status: "superseded",
          superseded_by: "dec-003",
        }),
      ]
      const result = detectSupersededDecisions(entries)
      expect(result.length).toBe(1)
      expect(result[0].id).toBe("dec-002")
      expect(result[0].superseded_by).toBe("dec-003")
    })

    // given: no superseded decisions
    // when: detectSupersededDecisions is called
    // then: returns empty array
    it("returns empty array when no decisions are superseded", () => {
      const entries = [makeEntry({ id: "dec-001", status: "active" })]
      const result = detectSupersededDecisions(entries)
      expect(result.length).toBe(0)
    })
  })

  describe("detectRevertedDecisions", () => {
    // given: entries with a reverted decision
    // when: detectRevertedDecisions is called
    // then: returns the reverted decision
    it("detects reverted decisions", () => {
      const entries = [
        makeEntry({ id: "dec-001", status: "active" }),
        makeEntry({ id: "dec-002", status: "reverted" }),
      ]
      const result = detectRevertedDecisions(entries)
      expect(result.length).toBe(1)
      expect(result[0].id).toBe("dec-002")
    })

    // given: no reverted decisions
    // when: detectRevertedDecisions is called
    // then: returns empty array
    it("returns empty array when no decisions are reverted", () => {
      const entries = [makeEntry({ id: "dec-001", status: "active" })]
      const result = detectRevertedDecisions(entries)
      expect(result.length).toBe(0)
    })
  })

  describe("detectOrphanedSupersedes", () => {
    // given: a decision with supersedes pointing to a non-existent id
    // when: detectOrphanedSupersedes is called
    // then: returns the orphaned decision
    it("detects orphaned supersede references", () => {
      const entries = [
        makeEntry({
          id: "dec-002",
          status: "active",
          supersedes: "dec-005",
          title: "New auth strategy",
        }),
      ]
      const orphaned = detectOrphanedSupersedes(entries)
      expect(orphaned.length).toBe(1)
      expect(orphaned[0].id).toBe("dec-002")
      expect(orphaned[0].supersedes).toBe("dec-005")
    })

    // given: a decision with supersedes pointing to an existing id
    // when: detectOrphanedSupersedes is called
    // then: does not flag it as orphaned
    it("does not flag valid supersede references", () => {
      const entries = [
        makeEntry({ id: "dec-001", status: "superseded" }),
        makeEntry({
          id: "dec-002",
          status: "active",
          supersedes: "dec-001",
        }),
      ]
      const orphaned = detectOrphanedSupersedes(entries)
      expect(orphaned.length).toBe(0)
    })

    // given: no orphaned supersedes
    // when: detectOrphanedSupersedes is called
    // then: returns empty array
    it("returns empty array when no orphaned supersedes", () => {
      const entries = [makeEntry({ id: "dec-001", status: "active" })]
      const orphaned = detectOrphanedSupersedes(entries)
      expect(orphaned.length).toBe(0)
    })
  })

  describe("detectConflictingDecisions", () => {
    // given: two active decisions in the same impact_area
    // when: detectConflictingDecisions is called
    // then: reports a conflict
    it("detects conflicts when multiple active decisions share an impact_area", () => {
      const entries = [
        makeEntry({
          id: "dec-001",
          status: "active",
          impact_area: "auth",
          decision: "Use bcrypt",
        }),
        makeEntry({
          id: "dec-002",
          status: "active",
          impact_area: "auth",
          decision: "Use argon2",
        }),
      ]
      const conflicts = detectConflictingDecisions(entries)
      expect(conflicts.length).toBe(1)
      expect(conflicts[0].area).toBe("auth")
      expect(conflicts[0].decisions.length).toBe(2)
    })

    // given: active decisions in different impact areas
    // when: detectConflictingDecisions is called
    // then: returns empty (no conflict)
    it("returns empty when active decisions are in different areas", () => {
      const entries = [
        makeEntry({
          id: "dec-001",
          status: "active",
          impact_area: "auth",
        }),
        makeEntry({
          id: "dec-002",
          status: "active",
          impact_area: "database",
        }),
      ]
      const conflicts = detectConflictingDecisions(entries)
      expect(conflicts.length).toBe(0)
    })

    // given: one active and one superseded decision in the same area
    // when: detectConflictingDecisions is called
    // then: returns empty (superseded decisions are excluded)
    it("excludes non-active decisions from conflict detection", () => {
      const entries = [
        makeEntry({
          id: "dec-001",
          status: "superseded",
          impact_area: "auth",
        }),
        makeEntry({
          id: "dec-002",
          status: "active",
          impact_area: "auth",
        }),
      ]
      const conflicts = detectConflictingDecisions(entries)
      expect(conflicts.length).toBe(0)
    })

    // given: decisions with no impact_area set
    // when: detectConflictingDecisions is called
    // then: skips them (cannot compare)
    it("skips decisions with empty impact_area", () => {
      const entries = [
        makeEntry({
          id: "dec-001",
          status: "active",
          impact_area: "",
        }),
        makeEntry({
          id: "dec-002",
          status: "active",
          impact_area: "",
        }),
      ]
      const conflicts = detectConflictingDecisions(entries)
      expect(conflicts.length).toBe(0)
    })
  })

  describe("buildCompactDecisionSummary", () => {
    // given: entries with mixed statuses
    // when: buildCompactDecisionSummary is called
    // then: returns correct status counts and lists
    it("builds correct status counts", () => {
      const entries = [
        makeEntry({ id: "d1", status: "proposed" }),
        makeEntry({ id: "d2", status: "active" }),
        makeEntry({ id: "d3", status: "active" }),
        makeEntry({ id: "d4", status: "superseded", superseded_by: "d3" }),
        makeEntry({
          id: "d4",
          status: "superseded",
          superseded_by: "d3",
          timestamp: "2026-05-31T12:00:00.000Z",
          action: "supersede",
        }),
        makeEntry({ id: "d5", status: "active" }),
      ]
      const summary = buildCompactDecisionSummary(entries)
      expect(summary.totalDecisions).toBe(5)
      expect(summary.byStatus.proposed).toBe(1)
      expect(summary.byStatus.active).toBe(3)
      expect(summary.byStatus.superseded).toBe(1)
      expect(summary.byStatus.reverted).toBe(0)
      expect(summary.active.length).toBe(3)
      expect(summary.superseded.length).toBe(1)
    })

    // given: entries with reverted decisions
    // when: buildCompactDecisionSummary is called
    // then: reverted count is correct
    it("counts reverted decisions correctly", () => {
      const entries = [
        makeEntry({ id: "d1", status: "active" }),
        makeEntry({ id: "d2", status: "reverted" }),
        makeEntry({ id: "d3", status: "reverted" }),
      ]
      const summary = buildCompactDecisionSummary(entries)
      expect(summary.byStatus.reverted).toBe(2)
      expect(summary.reverted.length).toBe(2)
    })

    // given: entries with multiple statuses and recent decisions
    // when: buildCompactDecisionSummary is called with recentCount=2
    // then: recent list is limited
    it("limits recent decisions to recentCount", () => {
      const entries = [
        makeEntry({
          id: "d1",
          status: "active",
          timestamp: "2026-05-31T10:00:00.000Z",
        }),
        makeEntry({
          id: "d2",
          status: "active",
          timestamp: "2026-05-31T11:00:00.000Z",
        }),
        makeEntry({
          id: "d3",
          status: "active",
          timestamp: "2026-05-31T12:00:00.000Z",
        }),
      ]
      const summary = buildCompactDecisionSummary(entries, 2)
      expect(summary.recent.length).toBe(2)
      expect(summary.recent[0].id).toBe("d3")
    })

    // given: empty entries
    // when: buildCompactDecisionSummary is called
    // then: returns zero counts
    it("returns zero counts for empty entries", () => {
      const summary = buildCompactDecisionSummary([])
      expect(summary.totalDecisions).toBe(0)
      expect(summary.byStatus.active).toBe(0)
      expect(summary.active.length).toBe(0)
      expect(summary.recent.length).toBe(0)
    })
  })

  describe("formatDecisionSummary", () => {
    // given: a DecisionLogSummary with active, superseded, and reverted decisions
    // when: formatDecisionSummary is called
    // then: returns a human-readable multiline string
    it("renders summary as readable text", () => {
      const entries = [
        makeEntry({
          id: "d1",
          status: "active",
          impact_area: "auth",
        }),
        makeEntry({
          id: "d2",
          status: "superseded",
          superseded_by: "d1",
        }),
        makeEntry({
          id: "d3",
          status: "reverted",
        }),
      ]
      const summary = buildCompactDecisionSummary(entries)
      const formatted = formatDecisionSummary(summary)
      expect(formatted).toContain("Decisions:")
      expect(formatted).toContain("active")
      expect(formatted).toContain("superseded")
      expect(formatted).toContain("reverted")
      expect(formatted).toContain("d1")
      expect(formatted).toContain("[auth]")
      expect(formatted).toContain("by d1")
    })

    // given: an empty summary
    // when: formatDecisionSummary is called
    // then: returns only the base line
    it("renders base line for empty state", () => {
      const summary = buildCompactDecisionSummary([])
      const formatted = formatDecisionSummary(summary)
      expect(formatted).toContain("0 proposed")
      expect(formatted).toContain("0 active")
      expect(formatted).not.toContain("Active:")
      expect(formatted).not.toContain("Superseded:")
    })
  })

  describe("DecisionLogEntrySchema", () => {
    // given: a valid entry object
    // when: DecisionLogEntrySchema.parse is called
    // then: succeeds
    it("accepts a valid entry", () => {
      const entry = makeEntry()
      const result = DecisionLogEntrySchema.safeParse(entry)
      expect(result.success).toBe(true)
    })

    // given: an entry missing required fields
    // when: DecisionLogEntrySchema.parse is called
    // then: fails validation
    it("rejects entry missing required fields", () => {
      const result = DecisionLogEntrySchema.safeParse({ version: 1, id: "x" })
      expect(result.success).toBe(false)
    })

    // given: an entry with an invalid status
    // when: DecisionLogEntrySchema.parse is called
    // then: fails validation
    it("rejects invalid status value", () => {
      const entry = makeEntry({ status: "unknown_status" as never })
      const result = DecisionLogEntrySchema.safeParse(entry)
      expect(result.success).toBe(false)
    })

    // given: an entry with an invalid action
    // when: DecisionLogEntrySchema.parse is called
    // then: fails validation
    it("rejects invalid action value", () => {
      const entry = makeEntry({ action: "unknown_action" as never })
      const result = DecisionLogEntrySchema.safeParse(entry)
      expect(result.success).toBe(false)
    })

    // given: an entry with all optional fields populated
    // when: DecisionLogEntrySchema.parse is called
    // then: succeeds and preserves all fields
    it("accepts entry with all optional fields", () => {
      const entry: DecisionLogEntry = {
        version: 1,
        id: "full-decision",
        timestamp: "2026-05-31T10:00:00.000Z",
        action: "record",
        title: "Full decision entry",
        status: "active",
        decision: "Use PostgreSQL as primary database",
        rationale: "Best performance for our read-heavy workload",
        impact_area: "database",
        alternatives_rejected: ["MongoDB", "MySQL"],
        related_tasks: ["task-001", "task-002"],
        supersedes: "dec-old-001",
        superseded_by: undefined,
        changed_by: undefined,
        source_session_id: "ses_xyz",
        metadata: { source: "agent", tags: ["architecture"] },
        notes: "Revisit after load testing",
      }
      const result = DecisionLogEntrySchema.safeParse(entry)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.metadata).toEqual({
          source: "agent",
          tags: ["architecture"],
        })
        expect(result.data.alternatives_rejected).toEqual(["MongoDB", "MySQL"])
        expect(result.data.related_tasks).toEqual(["task-001", "task-002"])
        expect(result.data.supersedes).toBe("dec-old-001")
      }
    })

    // given: an entry with a proposed status
    // when: DecisionLogEntrySchema.parse is called
    // then: accepts it as valid
    it("accepts proposed status", () => {
      const entry = makeEntry({ status: "proposed" })
      const result = DecisionLogEntrySchema.safeParse(entry)
      expect(result.success).toBe(true)
    })

    // given: an entry with amend action
    // when: DecisionLogEntrySchema.parse is called
    // then: accepts it as valid
    it("accepts amend action", () => {
      const entry = makeEntry({
        action: "amend",
        status: "active",
        changed_by: "dec-001",
        notes: "Updated cost factor from 10 to 12",
      })
      const result = DecisionLogEntrySchema.safeParse(entry)
      expect(result.success).toBe(true)
    })
  })
})
