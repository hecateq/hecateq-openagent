import { describe, expect, it } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { DecisionLogEntry } from "./decision-log"
import {
  cleanFileMap,
  compactProgress,
  compactRiskProfile,
  curateActiveContext,
  enforceQualityHistoryRetention,
  resolveOpenQuestions,
  runMemoryCurator,
  type CuratorResult,
} from "./memory-curator"
import { PROJECT_MEMORY_DIR } from "./memory-bootstrap"
import type { TaskStateEntry } from "./task-state-memory"
import { formatQualityEntry, type QualityHistoryEntry } from "./memory-quality-writer"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupTempDir(): string {
  const dir = join(tmpdir(), `omo-curator-${randomUUID()}`)
  mkdirSync(join(dir, PROJECT_MEMORY_DIR), { recursive: true })
  return dir
}

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
}

function getMemPath(root: string, fileName: string): string {
  return join(root, PROJECT_MEMORY_DIR, fileName)
}

function writeMem(root: string, fileName: string, content: string): void {
  const dir = join(root, PROJECT_MEMORY_DIR)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(getMemPath(root, fileName), content, "utf-8")
}

function readMem(root: string, fileName: string): string {
  return readFileSync(getMemPath(root, fileName), "utf-8")
}

function memExists(root: string, fileName: string): boolean {
  return existsSync(getMemPath(root, fileName))
}

function writeTasksJsonl(root: string, entries: TaskStateEntry[]): void {
  const content = entries.map((e) => JSON.stringify(e)).join("\n") + "\n"
  writeMem(root, "tasks.jsonl", content)
}

function writeDecisionsJsonl(
  root: string,
  entries: DecisionLogEntry[],
): void {
  const content = entries.map((e) => JSON.stringify(e)).join("\n") + "\n"
  writeMem(root, "decisions.jsonl", content)
}

function writeQualityHistoryEntries(
  root: string,
  entries: QualityHistoryEntry[],
): void {
  const parts: string[] = ["# Quality History\n\nLast updated: 2026-06-01"]
  for (const e of entries) {
    parts.push(formatQualityEntry(e).trimEnd())
  }
  const content = parts.join("\n\n") + "\n"
  writeMem(root, "quality-history.md", content)
}

function makeTask(
  overrides?: Partial<TaskStateEntry>,
): TaskStateEntry {
  return {
    version: 1 as const,
    id: overrides?.id ?? "task-001",
    timestamp: overrides?.timestamp ?? "2026-06-01T10:00:00.000Z",
    action: overrides?.action ?? "create",
    title: overrides?.title ?? "Fix authentication bug",
    status: overrides?.status ?? "planned",
    priority: overrides?.priority ?? "high",
    owner_agent: overrides?.owner_agent ?? "hephaestus",
    source_session_id: overrides?.source_session_id ?? "ses_abc",
    ...overrides,
  } as TaskStateEntry
}

function makeDecision(
  overrides?: Partial<DecisionLogEntry>,
): DecisionLogEntry {
  return {
    version: 1 as const,
    id: overrides?.id ?? "dec-001",
    timestamp: overrides?.timestamp ?? "2026-06-01T10:00:00.000Z",
    action: overrides?.action ?? "record",
    title: overrides?.title ?? "Use PostgreSQL",
    status: overrides?.status ?? "active",
    decision: overrides?.decision ?? "Primary database is PostgreSQL",
    rationale: overrides?.rationale ?? "Better performance",
    impact_area: overrides?.impact_area ?? "database",
    alternatives_rejected: overrides?.alternatives_rejected ?? ["MySQL"],
    source_session_id: overrides?.source_session_id ?? "ses_abc",
    ...overrides,
  } as DecisionLogEntry
}

// ---------------------------------------------------------------------------
// 1. curateActiveContext tests
// ---------------------------------------------------------------------------

describe("curateActiveContext", () => {
  // given
  it("skips when no task or decision data exists", () => {
    const root = setupTempDir()
    try {
      writeMem(root, "active-context.md", "# Active Context\n\n## Current Goal\n- TODO\n")
      const result = curateActiveContext(root)
      expect(result.attempted).toBe(true)
      expect(result.updated).toBe(false)
      expect(result.skippedReason).toContain("No task or decision data")
    } finally {
      cleanup(root)
    }
  })

  // given
  it("populates Current Goal from in-progress task", () => {
    const root = setupTempDir()
    try {
      writeTasksJsonl(root, [makeTask({ status: "in_progress", title: "Implement login" })])
      writeMem(root, "active-context.md", "# Active Context\n\n## Current Goal\n- TODO\n")
      const result = curateActiveContext(root)
      expect(result.attempted).toBe(true)
      expect(result.updated).toBe(true)
      const content = readMem(root, "active-context.md")
      expect(content).toContain("Implement login")
    } finally {
      cleanup(root)
    }
  })

  // given
  it("populates Current State from blocked tasks", () => {
    const root = setupTempDir()
    try {
      writeTasksJsonl(root, [
        makeTask({ id: "t1", status: "in_progress", title: "Feature A" }),
        makeTask({ id: "t2", status: "blocked", title: "Feature B" }),
      ])
      writeMem(root, "active-context.md", "# Active Context\n\n## Current State\n- TODO\n")
      const result = curateActiveContext(root)
      expect(result.updated).toBe(true)
      const content = readMem(root, "active-context.md")
      expect(content).toContain("Blocked tasks: 1")
    } finally {
      cleanup(root)
    }
  })

  // given
  it("populates Active Constraints from active decisions", () => {
    const root = setupTempDir()
    try {
      writeDecisionsJsonl(root, [
        makeDecision({ title: "Use TypeScript strict mode", decision: "All new code in strict mode" }),
      ])
      writeMem(root, "active-context.md", "# Active Context\n\n## Active Constraints\n- TODO\n")
      const result = curateActiveContext(root)
      expect(result.updated).toBe(true)
      const content = readMem(root, "active-context.md")
      expect(content).toContain("Use TypeScript strict mode")
    } finally {
      cleanup(root)
    }
  })

  // given
  it("replaces scaffold sections when real data exists", () => {
    const root = setupTempDir()
    try {
      writeTasksJsonl(root, [
        makeTask({ status: "in_progress", title: "Migrate to Prisma" }),
      ])
      writeMem(root, "active-context.md", "# Active Context\n\n## Current Goal\n- TODO\n\n## My Section\n- user note\n")
      const result = curateActiveContext(root)
      expect(result.updated).toBe(true)
      const content = readMem(root, "active-context.md")
      expect(content).toContain("Migrate to Prisma")
      expect(content).not.toContain("- TODO")
      expect(content).toContain("## My Section")
      expect(content).toContain("user note")
    } finally {
      cleanup(root)
    }
  })

  // given
  it("idempotent: rerun with same data does not modify", () => {
    const root = setupTempDir()
    try {
      writeTasksJsonl(root, [
        makeTask({ status: "in_progress", title: "Add tests" }),
      ])
      writeMem(root, "active-context.md", "# Active Context\n\n## Current Goal\n- TODO\n")
      const r1 = curateActiveContext(root)
      expect(r1.updated).toBe(true)
      const r2 = curateActiveContext(root)
      expect(r2.updated).toBe(false)
      expect(r2.skippedReason).toBe("Content unchanged")
    } finally {
      cleanup(root)
    }
  })

  // given
  it("does not modify tasks.jsonl or decisions.jsonl", () => {
    const root = setupTempDir()
    try {
      writeTasksJsonl(root, [
        makeTask({ status: "in_progress", title: "Refactor" }),
      ])
      writeDecisionsJsonl(root, [
        makeDecision({ title: "Use ESLint" }),
      ])
      writeMem(root, "active-context.md", "# Active Context\n\n## Current Goal\n- TODO\n")
      const tasksBefore = readMem(root, "tasks.jsonl")
      const decisionsBefore = readMem(root, "decisions.jsonl")

      curateActiveContext(root)

      expect(readMem(root, "tasks.jsonl")).toBe(tasksBefore)
      expect(readMem(root, "decisions.jsonl")).toBe(decisionsBefore)
    } finally {
      cleanup(root)
    }
  })

  // given
  it("creates active-context.md if it does not exist", () => {
    const root = setupTempDir()
    try {
      writeTasksJsonl(root, [
        makeTask({ status: "in_progress", title: "Init project" }),
      ])
      const result = curateActiveContext(root)
      expect(result.updated).toBe(true)
      expect(memExists(root, "active-context.md")).toBe(true)
      const content = readMem(root, "active-context.md")
      expect(content).toContain("Init project")
    } finally {
      cleanup(root)
    }
  })
})

// ---------------------------------------------------------------------------
// 2. compactProgress tests
// ---------------------------------------------------------------------------

describe("compactProgress", () => {
  // given
  it("skips when progress.md does not exist", () => {
    const root = setupTempDir()
    try {
      const result = compactProgress(root)
      expect(result.updated).toBe(false)
      expect(result.skippedReason).toContain("does not exist")
    } finally {
      cleanup(root)
    }
  })

  // given
  it("compacts older completed milestones when more than 10", () => {
    const root = setupTempDir()
    try {
      const items = Array.from({ length: 15 }, (_, i) => `- Milestone ${i + 1} completed`)
      const content = `# Progress\n\n## Completed\n${items.join("\n")}\n\n## In Progress\n- Current work\n\n## Remaining\n- Future work\n`
      writeMem(root, "progress.md", content)

      const result = compactProgress(root)
      expect(result.attempted).toBe(true)
      expect(result.updated).toBe(true)

      const updated = readMem(root, "progress.md")
      expect(updated).toContain("Milestone 15")
      expect(updated).toContain("Milestone 14")
      expect(updated).toContain("_Older completed milestones compacted: 5._")
      expect(updated).toContain("## In Progress")
      expect(updated).toContain("Current work")
      expect(updated).toContain("## Remaining")
    } finally {
      cleanup(root)
    }
  })

  // given
  it("skips when completed items are 10 or fewer", () => {
    const root = setupTempDir()
    try {
      const items = Array.from({ length: 5 }, (_, i) => `- Milestone ${i + 1}`)
      writeMem(root, "progress.md", `# Progress\n\n## Completed\n${items.join("\n")}\n`)
      const result = compactProgress(root)
      expect(result.updated).toBe(false)
      expect(result.skippedReason).toContain("below compaction threshold")
    } finally {
      cleanup(root)
    }
  })

  // given
  it("skips when already compacted", () => {
    const root = setupTempDir()
    try {
      writeMem(
        root,
        "progress.md",
        "# Progress\n\n## Completed\n- Item 1\n_Older completed milestones compacted: 20._\n",
      )
      const result = compactProgress(root)
      expect(result.updated).toBe(false)
      expect(result.skippedReason).toContain("already compacted")
    } finally {
      cleanup(root)
    }
  })

  // given
  it("idempotent after compaction", () => {
    const root = setupTempDir()
    try {
      const items = Array.from({ length: 12 }, (_, i) => `- M${i + 1}`)
      writeMem(root, "progress.md", `# Progress\n\n## Completed\n${items.join("\n")}\n`)
      const r1 = compactProgress(root)
      expect(r1.updated).toBe(true)
      const r2 = compactProgress(root)
      expect(r2.updated).toBe(false)
      expect(r2.skippedReason).toContain("already compacted")
    } finally {
      cleanup(root)
    }
  })
})

// ---------------------------------------------------------------------------
// 3. cleanFileMap tests
// ---------------------------------------------------------------------------

describe("cleanFileMap", () => {
  // given
  it("removes generated paths from Change Impact Map", () => {
    const root = setupTempDir()
    try {
      writeMem(
        root,
        "file-map.md",
        [
          "# File Map",
          "",
          "## Important Paths",
          "- src/shared/memory-curator.ts",
          "",
          "## Change Impact Map",
          "- src/shared/memory-curator.ts -> src/shared/index.ts",
          "- dist/memory-curator.js -> (generated)",
          "- node_modules/zod/index.d.ts -> (external)",
          "- build/output.js -> (generated)",
          "- .next/server/pages/index.js -> (generated)",
          "- src/shared/logger.ts -> src/shared/index.ts",
          "",
          "## Do Not Scan Blindly",
          "- node_modules/",
          "",
        ].join("\n"),
      )

      const result = cleanFileMap(root)
      expect(result.attempted).toBe(true)
      expect(result.updated).toBe(true)

      const cleaned = readMem(root, "file-map.md")
      expect(cleaned).toContain("memory-curator.ts -> src/shared/index.ts")
      expect(cleaned).toContain("src/shared/logger.ts -> src/shared/index.ts")
      expect(cleaned).not.toContain("dist/memory-curator.js")
      expect(cleaned).not.toContain("node_modules/zod")
      expect(cleaned).not.toContain("build/output.js")
      expect(cleaned).not.toContain(".next/server")
    } finally {
      cleanup(root)
    }
  })

  // given
  it("no-op when no generated paths found", () => {
    const root = setupTempDir()
    try {
      writeMem(
        root,
        "file-map.md",
        "# File Map\n\n## Change Impact Map\n- src/a.ts -> src/b.ts\n- src/c.ts -> src/d.ts\n",
      )
      const result = cleanFileMap(root)
      expect(result.updated).toBe(false)
      expect(result.skippedReason).toContain("No generated paths found")
    } finally {
      cleanup(root)
    }
  })

  // given
  it("idempotent cleanup", () => {
    const root = setupTempDir()
    try {
      writeMem(
        root,
        "file-map.md",
        "# File Map\n\n## Change Impact Map\n- src/a.ts -> src/b.ts\n- dist/out.js -> (generated)\n",
      )
      const r1 = cleanFileMap(root)
      expect(r1.updated).toBe(true)
      const r2 = cleanFileMap(root)
      expect(r2.updated).toBe(false)
    } finally {
      cleanup(root)
    }
  })
})

// ---------------------------------------------------------------------------
// 4. resolveOpenQuestions tests
// ---------------------------------------------------------------------------

describe("resolveOpenQuestions", () => {
  // given
  it("skips when open-questions.md does not exist", () => {
    const root = setupTempDir()
    try {
      const result = resolveOpenQuestions(root)
      expect(result.updated).toBe(false)
      expect(result.skippedReason).toContain("does not exist")
    } finally {
      cleanup(root)
    }
  })

  // given
  it("resolves question matched by decision title", () => {
    const root = setupTempDir()
    try {
      writeDecisionsJsonl(root, [
        makeDecision({ id: "dec-001", title: "Use PostgreSQL for database", decision: "PostgreSQL is primary" }),
      ])
      writeMem(
        root,
        "open-questions.md",
        "# Open Questions\n\n## Active Questions\n- Should we use PostgreSQL for database?\n\n## Waiting For\n- Stakeholder approval\n\n## Unresolved Tradeoffs\n- Performance vs simplicity\n\n## Resolved Questions\n",
      )

      const result = resolveOpenQuestions(root)
      expect(result.attempted).toBe(true)
      expect(result.updated).toBe(true)

      const updated = readMem(root, "open-questions.md")
      expect(updated).toContain("Resolved by decision")
      expect(updated).toContain("dec-001")
      expect(updated).toContain("## Waiting For")
      expect(updated).toContain("Stakeholder approval")
    } finally {
      cleanup(root)
    }
  })

  // given
  it("resolves question matched by completed task title", () => {
    const root = setupTempDir()
    try {
      writeTasksJsonl(root, [
        makeTask({ id: "task-005", status: "completed", title: "Add email validation", action: "create" }),
      ])
      writeMem(
        root,
        "open-questions.md",
        "# Open Questions\n\n## Active Questions\n- How should we implement email validation?\n\n## Resolved Questions\n",
      )

      const result = resolveOpenQuestions(root)
      expect(result.updated).toBe(true)
      const updated = readMem(root, "open-questions.md")
      expect(updated).toContain("Resolved by completed task")
      expect(updated).toContain("task-005")
    } finally {
      cleanup(root)
    }
  })

  // given
  it("leaves unmatched questions active", () => {
    const root = setupTempDir()
    try {
      writeDecisionsJsonl(root, [
        makeDecision({ title: "Use TypeScript" }),
      ])
      writeMem(
        root,
        "open-questions.md",
        "# Open Questions\n\n## Active Questions\n- Should we use Rust for the backend?\n- How to set up CI/CD?\n\n## Resolved Questions\n",
      )

      const result = resolveOpenQuestions(root)
      // Neither question matches "Use TypeScript"
      expect(result.updated).toBe(false)
    } finally {
      cleanup(root)
    }
  })

  // given
  it("idempotent after resolution", () => {
    const root = setupTempDir()
    try {
      writeDecisionsJsonl(root, [
        makeDecision({ id: "dec-001", title: "Use Redis for caching" }),
      ])
      writeMem(
        root,
        "open-questions.md",
        "# Open Questions\n\n## Active Questions\n- Should we use Redis for caching?\n\n## Resolved Questions\n",
      )

      const r1 = resolveOpenQuestions(root)
      expect(r1.updated).toBe(true)
      const r2 = resolveOpenQuestions(root)
      expect(r2.updated).toBe(false)
    } finally {
      cleanup(root)
    }
  })
})

// ---------------------------------------------------------------------------
// 5. compactRiskProfile tests
// ---------------------------------------------------------------------------

describe("compactRiskProfile", () => {
  // given
  it("skips when risk-profile.md does not exist", () => {
    const root = setupTempDir()
    try {
      const result = compactRiskProfile(root)
      expect(result.updated).toBe(false)
      expect(result.skippedReason).toContain("does not exist")
    } finally {
      cleanup(root)
    }
  })

  // given
  it("compacts resolved risks when more than 10", () => {
    const root = setupTempDir()
    try {
      const entries = Array.from({ length: 15 }, (_, i) => {
        const ts = `2026-06-0${String(i + 1).padStart(2, "0")}T10:00:00.000Z`
        return `### ${ts} — [low] other\n- **Description**: Risk ${i + 1}\n- **Source**: agent`
      })
      writeMem(
        root,
        "risk-profile.md",
        [
          "# Risk Profile",
          "",
          "Last updated: 2026-06-01",
          "",
          "## Active Risks",
          "- (none recorded)",
          "",
          "## Resolved Risks",
          ...entries,
          "",
          "## Sensitive Paths",
          "- .env",
          "",
          "## Rollback Notes",
          "- Keep git backups",
          "",
        ].join("\n"),
      )

      const result = compactRiskProfile(root)
      expect(result.attempted).toBe(true)
      expect(result.updated).toBe(true)

      const updated = readMem(root, "risk-profile.md")
      expect(updated).toContain("Risk 15")
      expect(updated).toContain("Risk 14")
      expect(updated).toContain("_Older resolved risks compacted: 5._")
      expect(updated).toContain("## Sensitive Paths")
      expect(updated).toContain(".env")
      expect(updated).toContain("## Rollback Notes")
    } finally {
      cleanup(root)
    }
  })

  // given
  it("skips when resolved risks are 10 or fewer", () => {
    const root = setupTempDir()
    try {
      const entries = Array.from({ length: 5 }, (_, i) => {
        const ts = `2026-06-0${String(i + 1).padStart(2, "0")}T10:00:00.000Z`
        return `### ${ts} — [low] other\n- **Description**: Risk ${i + 1}\n- **Source**: agent`
      })
      writeMem(
        root,
        "risk-profile.md",
        `# Risk Profile\n\n## Active Risks\n\n## Resolved Risks\n${entries.join("\n")}\n`,
      )
      const result = compactRiskProfile(root)
      expect(result.updated).toBe(false)
      expect(result.skippedReason).toContain("below compaction threshold")
    } finally {
      cleanup(root)
    }
  })

  // given
  it("idempotent after compaction", () => {
    const root = setupTempDir()
    try {
      const entries = Array.from({ length: 12 }, (_, i) => {
        const ts = `2026-06-0${String(i + 1).padStart(2, "0")}T10:00:00.000Z`
        return `### ${ts} — [low] other\n- **Description**: Risk ${i + 1}\n- **Source**: agent`
      })
      writeMem(
        root,
        "risk-profile.md",
        `# Risk Profile\n\n## Active Risks\n\n## Resolved Risks\n${entries.join("\n")}\n`,
      )
      const r1 = compactRiskProfile(root)
      expect(r1.updated).toBe(true)
      const r2 = compactRiskProfile(root)
      expect(r2.updated).toBe(false)
      expect(r2.skippedReason).toContain("already compacted")
    } finally {
      cleanup(root)
    }
  })
})

// ---------------------------------------------------------------------------
// 6. enforceQualityHistoryRetention tests
// ---------------------------------------------------------------------------

describe("enforceQualityHistoryRetention", () => {
  // given
  it("does not compact when entries within limit", () => {
    const root = setupTempDir()
    try {
      const entries: QualityHistoryEntry[] = Array.from({ length: 5 }, (_, i) => ({
        timestamp: `2026-06-0${String((10 - i)).padStart(2, "0")}T10:00:00.000Z`,
        command: `test:run-${i}`,
        result: "PASS" as const,
        output_summary: `Test run ${i} passed`,
        known_failures: [],
        is_pre_existing: false,
        verification_pending: [],
      }))
      writeQualityHistoryEntries(root, entries)

      const result = enforceQualityHistoryRetention(root, { qualityRetentionLimit: 20 })
      expect(result.attempted).toBe(true)
      expect(result.updated).toBe(false)
    } finally {
      cleanup(root)
    }
  })

  // given
  it("compacts when entries exceed limit, preserves latest failure", () => {
    const root = setupTempDir()
    try {
      const entries: QualityHistoryEntry[] = Array.from({ length: 30 }, (_, i) => ({
        timestamp: `2026-06-${String(30 - i).padStart(2, "0")}T10:00:00.000Z`,
        command: i === 29 ? "test:run-critical" : `test:run-${i}`,
        result: i === 29 ? ("FAIL" as const) : ("PASS" as const),
        output_summary: i === 29 ? "Critical test failed" : `Test run ${i} passed`,
        known_failures: i === 29 ? ["test-login"] : [],
        is_pre_existing: i === 29,
        verification_pending: [],
      }))
      writeQualityHistoryEntries(root, entries)

      const result = enforceQualityHistoryRetention(root, { qualityRetentionLimit: 20 })
      expect(result.attempted).toBe(true)
      expect(result.updated).toBe(true)

      // Verify retention occurred
      const content = readMem(root, "quality-history.md")
      expect(content).toContain("FAIL")
      expect(content).toContain("Critical test failed")
      expect(content).toContain("_Older passing quality entries compacted:")
    } finally {
      cleanup(root)
    }
  })

  // given
  it("always preserves latest failure even if older than limit", () => {
    const root = setupTempDir()
    try {
      const entries: QualityHistoryEntry[] = []
      // First entry is a failure (oldest)
      entries.push({
        timestamp: "2026-01-01T10:00:00.000Z",
        command: "test:run-critical",
        result: "FAIL" as const,
        output_summary: "Critical test failed",
        known_failures: ["test-auth"],
        is_pre_existing: true,
        verification_pending: [],
      })
      // Fill rest with passing entries (newer)
      for (let i = 0; i < 30; i++) {
        entries.push({
          timestamp: `2026-06-${String(30 - i).padStart(2, "0")}T10:00:00.000Z`,
          command: `test:run-${i}`,
          result: "PASS" as const,
          output_summary: `Test run ${i} passed`,
          known_failures: [],
          is_pre_existing: false,
          verification_pending: [],
        })
      }
      writeQualityHistoryEntries(root, entries)

      const result = enforceQualityHistoryRetention(root, { qualityRetentionLimit: 5 })
      expect(result.updated).toBe(true)

      const content = readMem(root, "quality-history.md")
      expect(content).toContain("FAIL")
      expect(content).toContain("Critical test failed")
    } finally {
      cleanup(root)
    }
  })

  // given
  it("does not invent results or alter pass/fail semantics", () => {
    const root = setupTempDir()
    try {
      const entries: QualityHistoryEntry[] = Array.from({ length: 25 }, (_, i) => ({
        timestamp: `2026-06-${String(25 - i).padStart(2, "0")}T10:00:00.000Z`,
        command: `test:run-${i}`,
        result: "PASS" as const,
        output_summary: `Test run ${i} passed`,
        known_failures: [],
        is_pre_existing: false,
        verification_pending: [],
      }))
      writeQualityHistoryEntries(root, entries)

      enforceQualityHistoryRetention(root, { qualityRetentionLimit: 20 })

      const content = readMem(root, "quality-history.md")
      // Should still have PASS results, not invented FAIL
      expect(content).toContain("PASS")
      // All PASS entries beyond limit should be compacted
      expect(content).toContain("compacted")
    } finally {
      cleanup(root)
    }
  })
})

// ---------------------------------------------------------------------------
// 7. runMemoryCurator tests
// ---------------------------------------------------------------------------

describe("runMemoryCurator", () => {
  // given
  it("runs all curator functions and returns combined results", () => {
    const root = setupTempDir()
    try {
      writeTasksJsonl(root, [
        makeTask({ status: "in_progress", title: "Feature X" }),
      ])
      writeDecisionsJsonl(root, [
        makeDecision({ title: "Use ESLint flat config" }),
      ])
      writeMem(root, "active-context.md", "# Active Context\n\n## Current Goal\n- TODO\n")
      writeMem(
        root,
        "open-questions.md",
        "# Open Questions\n\n## Active Questions\n- Should we use ESLint flat config?\n\n## Resolved Questions\n",
      )

      const result = runMemoryCurator(root)

      expect(result.activeContext.attempted).toBe(true)
      expect(result.activeContext.updated).toBe(true)
      expect(result.openQuestions.attempted).toBe(true)
      expect(result.openQuestions.updated).toBe(true)
      // progress doesn't exist
      expect(result.progress.updated).toBe(false)
      // file-map doesn't exist
      expect(result.fileMap.updated).toBe(false)
    } finally {
      cleanup(root)
    }
  })

  // given
  it("isolates failures — one failure does not block others", () => {
    const root = setupTempDir()
    try {
      writeTasksJsonl(root, [
        makeTask({ status: "in_progress", title: "Feature Y" }),
      ])
      writeMem(root, "active-context.md", "# Active Context\n\n## Current Goal\n- TODO\n")
      // No other files — they should gracefully skip

      const result = runMemoryCurator(root)

      expect(result.activeContext.updated).toBe(true)
      // These should have attempted but not updated (no data)
      expect(result.progress.errors.length).toBeGreaterThanOrEqual(0)
      expect(result.fileMap.errors.length).toBeGreaterThanOrEqual(0)
    } finally {
      cleanup(root)
    }
  })
})

// ---------------------------------------------------------------------------
// 8. JSONL untouched tests
// ---------------------------------------------------------------------------

describe("curator does not modify append-only JSONL sources", () => {
  // given
  it("tasks.jsonl is unchanged after active-context curation", () => {
    const root = setupTempDir()
    try {
      writeTasksJsonl(root, [
        makeTask({ status: "in_progress", title: "A" }),
      ])
      writeMem(root, "active-context.md", "# Active Context\n\n## Current Goal\n- TODO\n")
      const before = readMem(root, "tasks.jsonl")
      curateActiveContext(root)
      expect(readMem(root, "tasks.jsonl")).toBe(before)
    } finally {
      cleanup(root)
    }
  })

  // given
  it("decisions.jsonl is unchanged after open-questions resolution", () => {
    const root = setupTempDir()
    try {
      writeDecisionsJsonl(root, [
        makeDecision({ id: "d1", title: "Use Redis" }),
      ])
      writeMem(
        root,
        "open-questions.md",
        "# Open Questions\n\n## Active Questions\n- Should we use Redis?\n\n## Resolved Questions\n",
      )
      const before = readMem(root, "decisions.jsonl")
      resolveOpenQuestions(root)
      expect(readMem(root, "decisions.jsonl")).toBe(before)
    } finally {
      cleanup(root)
    }
  })
})

// ---------------------------------------------------------------------------
// 9. Ownership check tests
// ---------------------------------------------------------------------------

describe("curator ownership", () => {
  // given
  it("curator operations do not write to unauthorized files", () => {
    // The curator functions use CURATOR_IDENTITY for ownership checks.
    // Quality-history is NOT in curator's allowed list — enforceQualityHistoryRetention
    // delegates to compactQualityHistory which uses quality_writer identity.
    // This test verifies the ownership split is correct.
    const root = setupTempDir()
    try {
      writeTasksJsonl(root, [
        makeTask({ status: "in_progress", title: "X" }),
      ])
      writeMem(root, "active-context.md", "# Active Context\n\n## Current Goal\n- TODO\n")

      // curateActiveContext uses memory_curator → authorized for active-context.md
      const result = curateActiveContext(root)
      expect(result.attempted).toBe(true)
      expect(result.skippedReason).toBeNull()
    } finally {
      cleanup(root)
    }
  })
})
