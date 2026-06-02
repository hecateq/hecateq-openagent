import { describe, expect, it } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { DecisionLogEntry } from "./decision-log"
import { PROJECT_MEMORY_DIR } from "./memory-bootstrap"
import {
  renderTasksMarkdownFromJsonl,
  renderDecisionsMarkdownFromJsonl,
  renderTaskAndDecisionMarkdown,
  type RenderResult,
} from "./memory-curated-renderer"
import type { TaskStateEntry } from "./task-state-memory"

function setupTempDir(): string {
  const dir = join(tmpdir(), `omo-curated-renderer-${randomUUID()}`)
  mkdirSync(join(dir, PROJECT_MEMORY_DIR), { recursive: true })
  return dir
}

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
}

function getTasksJsonlPath(root: string): string {
  return join(root, PROJECT_MEMORY_DIR, "tasks.jsonl")
}

function getTasksMdPath(root: string): string {
  return join(root, PROJECT_MEMORY_DIR, "tasks.md")
}

function getDecisionsJsonlPath(root: string): string {
  return join(root, PROJECT_MEMORY_DIR, "decisions.jsonl")
}

function getDecisionsMdPath(root: string): string {
  return join(root, PROJECT_MEMORY_DIR, "decisions.md")
}

function writeTasksJsonl(root: string, entries: TaskStateEntry[]): void {
  const dir = join(root, PROJECT_MEMORY_DIR)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const content = entries.map((e) => JSON.stringify(e)).join("\n") + "\n"
  writeFileSync(getTasksJsonlPath(root), content, "utf-8")
}

function writeDecisionsJsonl(root: string, entries: DecisionLogEntry[]): void {
  const dir = join(root, PROJECT_MEMORY_DIR)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const content = entries.map((e) => JSON.stringify(e)).join("\n") + "\n"
  writeFileSync(getDecisionsJsonlPath(root), content, "utf-8")
}

function writeTasksMd(root: string, content: string): void {
  const dir = join(root, PROJECT_MEMORY_DIR)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(getTasksMdPath(root), content, "utf-8")
}

function writeDecisionsMd(root: string, content: string): void {
  const dir = join(root, PROJECT_MEMORY_DIR)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(getDecisionsMdPath(root), content, "utf-8")
}

function readTasksMd(root: string): string {
  return readFileSync(getTasksMdPath(root), "utf-8")
}

function readDecisionsMd(root: string): string {
  return readFileSync(getDecisionsMdPath(root), "utf-8")
}

function makeTaskEntry(overrides?: Partial<TaskStateEntry>): TaskStateEntry {
  return {
    version: 1 as const,
    id: "task-001",
    timestamp: "2026-05-31T10:00:00.000Z",
    action: "create" as const,
    title: "Fix authentication bug",
    status: "planned" as const,
    priority: "high" as const,
    owner_agent: "hephaestus",
    source_session_id: "ses_abc123",
    ...overrides,
  } as TaskStateEntry
}

function makeDecisionEntry(
  overrides?: Partial<DecisionLogEntry>,
): DecisionLogEntry {
  return {
    version: 1 as const,
    id: "dec-001",
    timestamp: "2026-05-31T10:00:00.000Z",
    action: "record" as const,
    title: "Use PostgreSQL for primary storage",
    status: "active" as const,
    decision: "We will use PostgreSQL 16 as the primary database.",
    rationale: "PostgreSQL provides ACID compliance and strong JSON support.",
    impact_area: "database",
    alternatives_rejected: ["MongoDB", "SQLite"],
    source_session_id: "ses_abc123",
    ...overrides,
  } as DecisionLogEntry
}

// ---------------------------------------------------------------------------
// Task rendering tests
// ---------------------------------------------------------------------------

describe("renderTasksMarkdownFromJsonl", () => {
  it("empty tasks.jsonl renders empty board without fake tasks", async () => {
    const root = setupTempDir()
    writeTasksJsonl(root, [])

    const result = await renderTasksMarkdownFromJsonl(root)
    expect(result.attempted).toBe(true)
    expect(result.updated).toBe(true)
    expect(result.writtenFile).not.toBeNull()

    const content = readTasksMd(root)
    expect(content).toContain("## Pending")
    expect(content).toContain("_No pending tasks._")
    expect(content).toContain("## Blocked")
    expect(content).toContain("_No blocked tasks._")
    expect(content).toContain("## Done")
    expect(content).toContain("_No completed tasks yet._")
    expect(content).not.toContain("- TODO")
    expect(content).not.toContain("- [ ]")
    expect(content).not.toContain("Sample task")

    cleanup(root)
  })

  it("planned task appears under Pending", async () => {
    const root = setupTempDir()
    const task = makeTaskEntry({
      id: "task-plan",
      title: "Add user login",
      status: "planned",
      priority: "high",
    })
    writeTasksJsonl(root, [task])

    const result = await renderTasksMarkdownFromJsonl(root)
    expect(result.updated).toBe(true)

    const content = readTasksMd(root)
    expect(content).toContain("## Pending")
    expect(content).toContain("Add user login")
    expect(content).toContain("(high)")

    cleanup(root)
  })

  it("in_progress task appears under Pending", async () => {
    const root = setupTempDir()
    const task = makeTaskEntry({
      id: "task-ip",
      title: "Build dashboard",
      status: "in_progress",
      priority: "medium",
    })
    writeTasksJsonl(root, [task])

    const result = await renderTasksMarkdownFromJsonl(root)
    expect(result.updated).toBe(true)

    const content = readTasksMd(root)
    expect(content).toContain("## Pending")
    expect(content).toContain("Build dashboard")
    expect(content).toContain("[in progress]")

    cleanup(root)
  })

  it("blocked task appears under Blocked with blocker reason", async () => {
    const root = setupTempDir()
    const task = makeTaskEntry({
      id: "task-blk",
      title: "Deploy to production",
      status: "blocked",
      blockers: ["Waiting for QA approval", "Database migration pending"],
      notes: "Blocked until QA sign-off",
    })
    writeTasksJsonl(root, [task])

    const result = await renderTasksMarkdownFromJsonl(root)
    expect(result.updated).toBe(true)

    const content = readTasksMd(root)
    expect(content).toContain("## Blocked")
    expect(content).toContain("Deploy to production")
    expect(content).toContain("QA approval")
    expect(content).toContain("Database migration pending")
    expect(content).toContain("Notes: Blocked until QA sign-off")

    cleanup(root)
  })

  it("completed task appears under Done", async () => {
    const root = setupTempDir()
    const task = makeTaskEntry({
      id: "task-done",
      title: "Fix login bug",
      status: "completed",
    })
    writeTasksJsonl(root, [task])

    const result = await renderTasksMarkdownFromJsonl(root)
    expect(result.updated).toBe(true)

    const content = readTasksMd(root)
    expect(content).toContain("## Done")
    expect(content).toContain("Fix login bug")
    expect(content).toContain("~~")

    cleanup(root)
  })

  it("latest state wins for same task id", async () => {
    const root = setupTempDir()
    const created = makeTaskEntry({
      id: "task-multi",
      title: "Write tests",
      status: "planned",
      timestamp: "2026-05-31T10:00:00.000Z",
    })
    const blocked = makeTaskEntry({
      id: "task-multi",
      title: "Write tests",
      status: "blocked",
      timestamp: "2026-05-31T10:10:00.000Z",
      action: "block",
      blockers: ["Missing test fixtures"],
    })
    writeTasksJsonl(root, [created, blocked])

    const result = await renderTasksMarkdownFromJsonl(root)
    expect(result.updated).toBe(true)

    const content = readTasksMd(root)
    expect(content).toContain("## Blocked")
    expect(content).toContain("Write tests")
    expect(content).toContain("Missing test fixtures")

    cleanup(root)
  })

  it("cancelled and stale tasks do not pollute Pending", async () => {
    const root = setupTempDir()
    const cancelled = makeTaskEntry({
      id: "task-cxl",
      title: "Old feature request",
      status: "cancelled",
      timestamp: "2026-05-31T08:00:00.000Z",
    })
    const stale = makeTaskEntry({
      id: "task-stale",
      title: "Stale investigation",
      status: "stale",
      timestamp: "2026-05-31T09:00:00.000Z",
    })
    writeTasksJsonl(root, [cancelled, stale])

    const result = await renderTasksMarkdownFromJsonl(root)
    expect(result.updated).toBe(true)

    const content = readTasksMd(root)
    expect(content).toContain("## Done")
    expect(content).toContain("Old feature request")
    expect(content).toContain("[cancelled]")
    expect(content).toContain("Stale investigation")
    expect(content).toContain("[stale]")

    cleanup(root)
  })

  it("malformed JSONL skipped without throw", async () => {
    const root = setupTempDir()
    const validTask = makeTaskEntry({
      id: "task-valid",
      title: "Valid task",
      status: "planned",
    })
    const dir = join(root, PROJECT_MEMORY_DIR)
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      getTasksJsonlPath(root),
      JSON.stringify(validTask) + "\nthis is not json\n",
      "utf-8",
    )

    const result = await renderTasksMarkdownFromJsonl(root)
    expect(result.attempted).toBe(true)
    expect(result.updated).toBe(true)
    expect(result.errors.length).toBe(0)

    const content = readTasksMd(root)
    expect(content).toContain("Valid task")

    cleanup(root)
  })

  it("user-authored notes outside controlled sections are preserved", async () => {
    const root = setupTempDir()
    const task = makeTaskEntry({
      id: "task-001",
      title: "Fix login bug",
      status: "completed",
    })
    writeTasksJsonl(root, [task])

    const existingContent = [
      "# My Project Tasks",
      "",
      "Some personal notes about task organization.",
      "",
      "## Pending",
      "",
      "_No pending tasks._",
      "",
      "## Blocked",
      "",
      "_No blocked tasks._",
      "",
      "## Done",
      "",
      "_No completed tasks yet._",
      "",
      "## My Custom Section",
      "",
      "This is user-authored content that should be preserved.",
      "",
      "<!-- user-note: Internal reference for team -->",
    ].join("\n")
    writeTasksMd(root, existingContent)

    const result = await renderTasksMarkdownFromJsonl(root)
    expect(result.updated).toBe(true)

    const content = readTasksMd(root)
    expect(content).toContain("# My Project Tasks")
    expect(content).toContain("Some personal notes about task organization")
    expect(content).toContain("## My Custom Section")
    expect(content).toContain("This is user-authored content that should be preserved")
    expect(content).toContain("<!-- user-note: Internal reference for team -->")
    expect(content).toContain("## Done")
    expect(content).toContain("Fix login bug")

    cleanup(root)
  })

  it("repeated render idempotent", async () => {
    const root = setupTempDir()
    const task = makeTaskEntry({
      id: "task-001",
      title: "Fix login bug",
      status: "completed",
    })
    writeTasksJsonl(root, [task])

    const result1 = await renderTasksMarkdownFromJsonl(root)
    expect(result1.updated).toBe(true)

    const content1 = readTasksMd(root)

    const result2 = await renderTasksMarkdownFromJsonl(root)
    expect(result2.updated).toBe(false)
    expect(result2.skippedReason).toBe("Content unchanged")

    const content2 = readTasksMd(root)
    expect(content2).toBe(content1)

    cleanup(root)
  })

  it("Done section bounded", async () => {
    const root = setupTempDir()
    const tasks: TaskStateEntry[] = []
    for (let i = 0; i < 20; i++) {
      tasks.push(
        makeTaskEntry({
          id: `task-${String(i).padStart(2, "0")}`,
          title: `Completed task ${i}`,
          status: "completed",
          timestamp: `2026-05-31T${String(i).padStart(2, "0")}:00:00.000Z`,
        }),
      )
    }
    writeTasksJsonl(root, tasks)

    const result = await renderTasksMarkdownFromJsonl(root, { maxDoneTasks: 5 })
    expect(result.updated).toBe(true)

    const content = readTasksMd(root)
    expect(content).toContain("... and 15 more completed tasks not shown")

    cleanup(root)
  })
})

// ---------------------------------------------------------------------------
// Decision rendering tests
// ---------------------------------------------------------------------------

describe("renderDecisionsMarkdownFromJsonl", () => {
  it("empty decisions.jsonl renders empty snapshot without fake decisions", async () => {
    const root = setupTempDir()
    writeDecisionsJsonl(root, [])

    const result = await renderDecisionsMarkdownFromJsonl(root)
    expect(result.attempted).toBe(true)
    expect(result.updated).toBe(true)
    expect(result.writtenFile).not.toBeNull()

    const content = readDecisionsMd(root)
    expect(content).toContain("## Accepted Decisions")
    expect(content).toContain("_No active decisions._")
    expect(content).toContain("## Rejected Approaches")
    expect(content).toContain("## Superseded / Reverted Decisions")
    expect(content).not.toContain("- Use")
    expect(content).not.toContain("Sample decision")

    cleanup(root)
  })

  it("active decision appears under Accepted Decisions", async () => {
    const root = setupTempDir()
    const dec = makeDecisionEntry({
      id: "dec-active",
      title: "Use TypeScript strict mode",
      status: "active",
      decision: "All new code must use TypeScript strict mode.",
      rationale: "Type safety reduces runtime errors.",
      impact_area: "language",
      alternatives_rejected: ["JavaScript", "Flow"],
    })
    writeDecisionsJsonl(root, [dec])

    const result = await renderDecisionsMarkdownFromJsonl(root)
    expect(result.updated).toBe(true)

    const content = readDecisionsMd(root)
    expect(content).toContain("## Accepted Decisions")
    expect(content).toContain("Use TypeScript strict mode")
    expect(content).toContain("All new code must use TypeScript strict mode")
    expect(content).toContain("Type safety reduces runtime errors")
    expect(content).toContain("- **Impact Area:** language")
    expect(content).toContain("JavaScript")
    expect(content).toContain("Flow")

    cleanup(root)
  })

  it("superseded decision appears under Superseded / Reverted Decisions", async () => {
    const root = setupTempDir()
    const dec = makeDecisionEntry({
      id: "dec-sup",
      title: "Use MongoDB for storage",
      status: "superseded",
      decision: "We will use MongoDB as the database.",
      rationale: "Document model fits our data.",
      impact_area: "database",
      superseded_by: "dec-pg-001",
    })
    writeDecisionsJsonl(root, [dec])

    const result = await renderDecisionsMarkdownFromJsonl(root)
    expect(result.updated).toBe(true)

    const content = readDecisionsMd(root)
    expect(content).toContain("## Superseded / Reverted Decisions")
    expect(content).toContain("Use MongoDB for storage")
    expect(content).toContain("superseded")
    expect(content).toContain("dec-pg-001")

    cleanup(root)
  })

  it("reverted decision appears under Superseded / Reverted Decisions", async () => {
    const root = setupTempDir()
    const dec = makeDecisionEntry({
      id: "dec-rev",
      title: "Use Webpack for bundling",
      status: "reverted",
      decision: "We will use Webpack instead of Vite.",
      rationale: "More mature plugin ecosystem.",
      impact_area: "build",
      changed_by: "dec-vite-001",
    })
    writeDecisionsJsonl(root, [dec])

    const result = await renderDecisionsMarkdownFromJsonl(root)
    expect(result.updated).toBe(true)

    const content = readDecisionsMd(root)
    expect(content).toContain("## Superseded / Reverted Decisions")
    expect(content).toContain("Use Webpack for bundling")
    expect(content).toContain("reverted")
    expect(content).toContain("dec-vite-001")

    cleanup(root)
  })

  it("rejected alternatives appear under Rejected Approaches", async () => {
    const root = setupTempDir()
    const dec = makeDecisionEntry({
      id: "dec-with-alts",
      title: "Use PostgreSQL",
      status: "active",
      decision: "Use PostgreSQL 16.",
      rationale: "ACID compliance and JSON support.",
      impact_area: "database",
      alternatives_rejected: ["MongoDB", "SQLite", "MySQL"],
    })
    writeDecisionsJsonl(root, [dec])

    const result = await renderDecisionsMarkdownFromJsonl(root)
    expect(result.updated).toBe(true)

    const content = readDecisionsMd(root)
    expect(content).toContain("## Rejected Approaches")
    expect(content).toContain("MongoDB")
    expect(content).toContain("SQLite")
    expect(content).toContain("MySQL")

    cleanup(root)
  })

  it("latest state wins for same decision id", async () => {
    const root = setupTempDir()
    const original = makeDecisionEntry({
      id: "dec-evolve",
      title: "Use REST for API",
      status: "active",
      decision: "Use REST.",
      rationale: "Simple and well-understood.",
      timestamp: "2026-05-31T10:00:00.000Z",
    })
    const superseded = makeDecisionEntry({
      id: "dec-evolve",
      title: "Use REST for API",
      status: "superseded",
      decision: "Use GraphQL instead.",
      rationale: "Better for complex queries.",
      action: "supersede",
      superseded_by: "dec-gql-002",
      timestamp: "2026-05-31T10:10:00.000Z",
    })
    writeDecisionsJsonl(root, [original, superseded])

    const result = await renderDecisionsMarkdownFromJsonl(root)
    expect(result.updated).toBe(true)

    const content = readDecisionsMd(root)
    // Should appear under Superseded, not under Accepted
    expect(content).toContain("## Superseded / Reverted Decisions")
    expect(content).toContain("Use REST for API")

    // Accepted section should be empty
    const acceptedSection = content.substring(
      content.indexOf("## Accepted Decisions"),
      content.indexOf("## Rejected Approaches"),
    )
    expect(acceptedSection).not.toContain("Use REST for API")

    cleanup(root)
  })

  it("malformed JSONL skipped without throw", async () => {
    const root = setupTempDir()
    const validDec = makeDecisionEntry({
      id: "dec-valid",
      title: "Valid decision",
      status: "active",
    })
    const dir = join(root, PROJECT_MEMORY_DIR)
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      getDecisionsJsonlPath(root),
      JSON.stringify(validDec) + "\nthis is not json\n",
      "utf-8",
    )

    const result = await renderDecisionsMarkdownFromJsonl(root)
    expect(result.attempted).toBe(true)
    expect(result.updated).toBe(true)
    expect(result.errors.length).toBe(0)

    const content = readDecisionsMd(root)
    expect(content).toContain("Valid decision")

    cleanup(root)
  })

  it("user-authored Notes section preserved", async () => {
    const root = setupTempDir()
    const dec = makeDecisionEntry({
      id: "dec-notes",
      title: "Use Prisma ORM",
      status: "active",
      decision: "Use Prisma for database access.",
      rationale: "Type-safe queries and migrations.",
      impact_area: "database",
    })
    writeDecisionsJsonl(root, [dec])

    const existingContent = [
      "# Architecture Decisions",
      "",
      "Custom project notes about decision-making process.",
      "",
      "## Accepted Decisions",
      "",
      "_placeholder_",
      "",
      "## Rejected Approaches",
      "",
      "_placeholder_",
      "",
      "## Superseded / Reverted Decisions",
      "",
      "_placeholder_",
      "",
      "## Notes",
      "",
      "These are user-authored notes about decisions.",
      "They should be preserved by the renderer.",
      "",
      "<!-- custom-annotation: team discussion notes -->",
    ].join("\n")
    writeDecisionsMd(root, existingContent)

    const result = await renderDecisionsMarkdownFromJsonl(root)
    expect(result.updated).toBe(true)

    const content = readDecisionsMd(root)
    expect(content).toContain("# Architecture Decisions")
    expect(content).toContain("Custom project notes about decision-making process")
    expect(content).toContain("## Notes")
    expect(content).toContain("These are user-authored notes about decisions")
    expect(content).toContain("<!-- custom-annotation: team discussion notes -->")
    expect(content).toContain("## Accepted Decisions")
    expect(content).toContain("Use Prisma ORM")

    cleanup(root)
  })

  it("repeated render idempotent", async () => {
    const root = setupTempDir()
    const dec = makeDecisionEntry({
      id: "dec-idem",
      title: "Use ESLint flat config",
      status: "active",
    })
    writeDecisionsJsonl(root, [dec])

    const result1 = await renderDecisionsMarkdownFromJsonl(root)
    expect(result1.updated).toBe(true)

    const content1 = readDecisionsMd(root)

    const result2 = await renderDecisionsMarkdownFromJsonl(root)
    expect(result2.updated).toBe(false)
    expect(result2.skippedReason).toBe("Content unchanged")

    const content2 = readDecisionsMd(root)
    expect(content2).toBe(content1)

    cleanup(root)
  })

  it("no tasks or test results rendered as decisions", async () => {
    const root = setupTempDir()
    const dec = makeDecisionEntry({
      id: "dec-clean",
      title: "Use Bun as runtime",
      status: "active",
      decision: "Use Bun for development and testing.",
      rationale: "Fast startup and native TypeScript support.",
      impact_area: "runtime",
    })
    writeDecisionsJsonl(root, [dec])

    const result = await renderDecisionsMarkdownFromJsonl(root)
    expect(result.updated).toBe(true)

    const content = readDecisionsMd(root)
    // Should contain the actual decision
    expect(content).toContain("Use Bun as runtime")
    // Should NOT contain task-like content markers
    expect(content).not.toContain("## Pending")
    expect(content).not.toContain("## Done")
    expect(content).not.toContain("- [ ]")
    expect(content).not.toContain("passed")
    expect(content).not.toContain("failed")
    expect(content).not.toContain("Test results")

    cleanup(root)
  })
})

// ---------------------------------------------------------------------------
// Combined render tests
// ---------------------------------------------------------------------------

describe("renderTaskAndDecisionMarkdown", () => {
  it("renders both files independently", async () => {
    const root = setupTempDir()
    const task = makeTaskEntry({
      id: "task-combined",
      title: "Combined test task",
      status: "planned",
    })
    const dec = makeDecisionEntry({
      id: "dec-combined",
      title: "Combined test decision",
      status: "active",
    })
    writeTasksJsonl(root, [task])
    writeDecisionsJsonl(root, [dec])

    const combined = await renderTaskAndDecisionMarkdown(root)
    expect(combined.tasks.updated).toBe(true)
    expect(combined.decisions.updated).toBe(true)

    const tasksContent = readTasksMd(root)
    expect(tasksContent).toContain("Combined test task")

    const decisionsContent = readDecisionsMd(root)
    expect(decisionsContent).toContain("Combined test decision")

    cleanup(root)
  })
})
