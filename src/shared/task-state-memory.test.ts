import { describe, expect, it } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  appendTaskEntry,
  buildCompactTaskSummary,
  detectBlockedTasks,
  detectStaleTasks,
  formatTaskSummary,
  readTaskState,
  resolveLatestTaskState,
  TaskStateEntrySchema,
  TASK_STATE_MEMORY_FILENAME,
  type TaskStateEntry,
} from "./task-state-memory"
import { PROJECT_MEMORY_DIR } from "./memory-bootstrap"

function setupTempDir(): string {
  const dir = join(tmpdir(), `omo-task-state-${randomUUID()}`)
  mkdirSync(join(dir, PROJECT_MEMORY_DIR), { recursive: true })
  return dir
}

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
}

function makeEntry(overrides?: Partial<TaskStateEntry>): TaskStateEntry {
  return {
    version: 1,
    id: "task-001",
    timestamp: "2026-05-31T10:00:00.000Z",
    action: "create",
    title: "Fix authentication bug",
    status: "planned",
    priority: "high",
    owner_agent: "hephaestus",
    source_session_id: "ses_abc123",
    ...overrides,
  }
}

function getMemoryFilePath(root: string): string {
  return join(root, PROJECT_MEMORY_DIR, TASK_STATE_MEMORY_FILENAME)
}

function writeRawJsonl(root: string, lines: string[]): void {
  const filePath = getMemoryFilePath(root)
  const dir = join(root, PROJECT_MEMORY_DIR)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(filePath, lines.join("\n") + "\n", "utf-8")
}

describe("task-state-memory", () => {
  describe("readTaskState", () => {
    // given: no tasks.jsonl file exists
    // when: readTaskState is called
    // then: returns null
    it("returns null when file is missing", () => {
      const root = setupTempDir()
      const result = readTaskState(root)
      expect(result).toBeNull()
      cleanup(root)
    })

    // given: an empty tasks.jsonl file exists
    // when: readTaskState is called
    // then: returns an empty array
    it("returns empty array for an empty file", () => {
      const root = setupTempDir()
      writeRawJsonl(root, [])
      const result = readTaskState(root)
      expect(result).toEqual([])
      cleanup(root)
    })

    // given: a file with a valid JSONL entry
    // when: readTaskState is called
    // then: returns the parsed entry
    it("parses a valid JSONL entry", () => {
      const root = setupTempDir()
      const entry = makeEntry()
      writeRawJsonl(root, [JSON.stringify(entry)])
      const result = readTaskState(root)
      expect(result).not.toBeNull()
      expect(result!.length).toBe(1)
      expect(result![0].id).toBe("task-001")
      expect(result![0].title).toBe("Fix authentication bug")
      expect(result![0].status).toBe("planned")
      cleanup(root)
    })

    // given: a file with a malformed JSONL line mixed with valid lines
    // when: readTaskState is called
    // then: skips the malformed line and returns valid entries
    it("skips malformed JSONL lines without crashing", () => {
      const root = setupTempDir()
      const entry = makeEntry({ id: "task-001" })
      const entry2 = makeEntry({ id: "task-002", title: "Add email validation" })
      writeRawJsonl(root, [
        JSON.stringify(entry),
        "{not valid json at all}",
        "",
        JSON.stringify(entry2),
      ])
      const result = readTaskState(root)
      expect(result).not.toBeNull()
      expect(result!.length).toBe(2)
      expect(result![0].id).toBe("task-001")
      expect(result![1].id).toBe("task-002")
      cleanup(root)
    })

    // given: a file with a JSON object that doesn't match the schema
    // when: readTaskState is called
    // then: skips that line
    it("skips lines that fail Zod validation", () => {
      const root = setupTempDir()
      const entry = makeEntry()
      writeRawJsonl(root, [
        JSON.stringify(entry),
        JSON.stringify({ version: 1, id: "bad", timestamp: "2026-01-01T00:00:00.000Z" }),
      ])
      const result = readTaskState(root)
      expect(result!.length).toBe(1)
      expect(result![0].id).toBe("task-001")
      cleanup(root)
    })
  })

  describe("appendTaskEntry", () => {
    // given: no file exists
    // when: appendTaskEntry is called with a valid entry
    // then: creates the file and appends the entry
    it("creates file and appends entry when file is missing", () => {
      const root = setupTempDir()
      const entry = makeEntry()
      const appended = appendTaskEntry(root, entry)
      expect(appended).toBe(true)
      expect(existsSync(getMemoryFilePath(root))).toBe(true)
      const content = readFileSync(getMemoryFilePath(root), "utf-8")
      expect(content).toContain("task-001")
      expect(content).toContain("Fix authentication bug")
      cleanup(root)
    })

    // given: an existing file with entries
    // when: a new entry is appended
    // then: both old and new entries are present
    it("appends to existing file", () => {
      const root = setupTempDir()
      const entry1 = makeEntry({ id: "task-001" })
      const entry2 = makeEntry({ id: "task-002", title: "Add tests" })
      appendTaskEntry(root, entry1)
      appendTaskEntry(root, entry2)
      const result = readTaskState(root)
      expect(result!.length).toBe(2)
      cleanup(root)
    })

    // given: an entry identical in content (excluding timestamp) to the latest
    //        entry for the same task id already exists
    // when: the same entry is appended again
    // then: returns false and does not append a duplicate
    it("skips duplicate entries for the same task id with same content", () => {
      const root = setupTempDir()
      const entry = makeEntry({ id: "task-001" })
      const first = appendTaskEntry(root, entry)
      expect(first).toBe(true)
      const second = appendTaskEntry(root, { ...entry, timestamp: "2026-05-31T10:01:00.000Z" })
      expect(second).toBe(false)
      const result = readTaskState(root)
      expect(result!.length).toBe(1)
      cleanup(root)
    })

    // given: an entry with different content for the same task id
    // when: appended after the first entry
    // then: both are appended (not considered duplicate)
    it("appends entries for same id when content differs", () => {
      const root = setupTempDir()
      const entry1 = makeEntry({ id: "task-001", status: "planned" })
      const entry2 = makeEntry({ id: "task-001", status: "in_progress", action: "update" })
      const first = appendTaskEntry(root, entry1)
      const second = appendTaskEntry(root, entry2)
      expect(first).toBe(true)
      expect(second).toBe(true)
      const result = readTaskState(root)
      expect(result!.length).toBe(2)
      cleanup(root)
    })
  })

  describe("resolveLatestTaskState", () => {
    // given: multiple entries for the same task id
    // when: resolveLatestTaskState is called
    // then: returns only the latest entry per id
    it("returns latest entry per task id", () => {
      const entries = [
        makeEntry({ id: "task-001", status: "planned", timestamp: "2026-05-31T10:00:00.000Z" }),
        makeEntry({ id: "task-001", status: "in_progress", timestamp: "2026-05-31T11:00:00.000Z", action: "update" }),
        makeEntry({ id: "task-002", status: "completed", timestamp: "2026-05-31T10:30:00.000Z" }),
      ]
      const latest = resolveLatestTaskState(entries)
      expect(latest.size).toBe(2)
      expect(latest.get("task-001")!.status).toBe("in_progress")
      expect(latest.get("task-002")!.status).toBe("completed")
    })

    // given: entries with equal timestamps for the same id
    // when: resolveLatestTaskState is called
    // then: the last one in the array wins
    it("picks the last entry when timestamps are equal", () => {
      const ts = "2026-05-31T10:00:00.000Z"
      const entries = [
        makeEntry({ id: "task-001", status: "planned", timestamp: ts }),
        makeEntry({ id: "task-001", status: "in_progress", timestamp: ts, action: "update" }),
      ]
      const latest = resolveLatestTaskState(entries)
      expect(latest.get("task-001")!.status).toBe("in_progress")
    })
  })

  describe("buildCompactTaskSummary", () => {
    // given: entries with mixed statuses
    // when: buildCompactTaskSummary is called
    // then: returns correct status counts and lists
    it("builds correct status counts", () => {
      const entries = [
        makeEntry({ id: "t1", status: "planned" }),
        makeEntry({ id: "t2", status: "in_progress" }),
        makeEntry({ id: "t3", status: "in_progress" }),
        makeEntry({ id: "t4", status: "blocked", blockers: ["t2"] }),
        makeEntry({ id: "t5", status: "completed" }),
        makeEntry({ id: "t5", status: "completed", action: "complete", timestamp: "2026-05-31T12:00:00.000Z" }),
      ]
      const summary = buildCompactTaskSummary(entries)
      expect(summary.totalTasks).toBe(5)
      expect(summary.byStatus.planned).toBe(1)
      expect(summary.byStatus.in_progress).toBe(2)
      expect(summary.byStatus.blocked).toBe(1)
      expect(summary.byStatus.completed).toBe(1)
      expect(summary.active.length).toBe(2)
      expect(summary.blocked.length).toBe(1)
      expect(summary.recentlyCompleted.length).toBe(1)
    })

    // given: tasks with next_action set
    // when: buildCompactTaskSummary is called
    // then: nextActions list is populated
    it("collects next actions", () => {
      const entries = [
        makeEntry({ id: "t1", status: "in_progress", next_action: "Run integration tests" }),
        makeEntry({ id: "t2", status: "planned", next_action: "Review PR #42" }),
      ]
      const summary = buildCompactTaskSummary(entries)
      expect(summary.nextActions.length).toBe(2)
    })
  })

  describe("formatTaskSummary", () => {
    // given: a TaskStateSummary with active, blocked, and completed tasks
    // when: formatTaskSummary is called
    // then: returns a human-readable multiline string
    it("renders summary as readable text", () => {
      const entries = [
        makeEntry({ id: "t1", status: "in_progress", priority: "high" }),
        makeEntry({ id: "t2", status: "blocked", blockers: ["t1"] }),
        makeEntry({ id: "t3", status: "completed" }),
      ]
      const summary = buildCompactTaskSummary(entries)
      const formatted = formatTaskSummary(summary)
      expect(formatted).toContain("Tasks:")
      expect(formatted).toContain("in_progress")
      expect(formatted).toContain("blocked")
      expect(formatted).toContain("t1")
      expect(formatted).toContain("high")
      expect(formatted).toContain("blocked by: t1")
    })

    // given: an empty summary
    // when: formatTaskSummary is called
    // then: returns only the base line
    it("renders base line for empty state", () => {
      const summary = buildCompactTaskSummary([])
      const formatted = formatTaskSummary(summary)
      expect(formatted).toContain("0 planned")
      expect(formatted).not.toContain("Active:")
      expect(formatted).not.toContain("Blocked:")
    })
  })

  describe("detectStaleTasks", () => {
    // given: an in_progress task with a timestamp older than the threshold
    // when: detectStaleTasks is called
    // then: returns the stale task
    it("detects tasks older than the stale threshold", () => {
      const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
      const entries = [
        makeEntry({ id: "t1", status: "in_progress", timestamp: oldDate }),
      ]
      const stale = detectStaleTasks(entries)
      expect(stale.length).toBe(1)
      expect(stale[0].id).toBe("t1")
    })

    // given: an in_progress task recently updated
    // when: detectStaleTasks is called with the default threshold
    // then: does not flag it as stale
    it("does not flag recently updated tasks as stale", () => {
      const recentDate = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString()
      const entries = [
        makeEntry({ id: "t1", status: "in_progress", timestamp: recentDate }),
      ]
      const stale = detectStaleTasks(entries)
      expect(stale.length).toBe(0)
    })

    // given: a completed task that is old
    // when: detectStaleTasks is called
    // then: does not flag it (only in_progress tasks are checked)
    it("does not flag completed tasks as stale", () => {
      const oldDate = new Date(Date.now() - 100 * 60 * 60 * 1000).toISOString()
      const entries = [
        makeEntry({ id: "t1", status: "completed", timestamp: oldDate }),
      ]
      const stale = detectStaleTasks(entries)
      expect(stale.length).toBe(0)
    })

    // given: entries with a custom stale threshold
    // when: detectStaleTasks is called with threshold=1
    // then: tasks older than 1 hour are flagged
    it("respects custom stale threshold", () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
      const entries = [
        makeEntry({ id: "t1", status: "in_progress", timestamp: twoHoursAgo }),
      ]
      const stale = detectStaleTasks(entries, 1)
      expect(stale.length).toBe(1)
    })
  })

  describe("detectBlockedTasks", () => {
    // given: entries with a blocked task
    // when: detectBlockedTasks is called
    // then: returns the blocked task
    it("detects blocked tasks", () => {
      const entries = [
        makeEntry({ id: "t1", status: "in_progress" }),
        makeEntry({ id: "t2", status: "blocked", blockers: ["t1"] }),
      ]
      const blocked = detectBlockedTasks(entries)
      expect(blocked.length).toBe(1)
      expect(blocked[0].id).toBe("t2")
      expect(blocked[0].blockers).toEqual(["t1"])
    })

    // given: no blocked tasks
    // when: detectBlockedTasks is called
    // then: returns empty array
    it("returns empty array when no tasks are blocked", () => {
      const entries = [
        makeEntry({ id: "t1", status: "completed" }),
      ]
      const blocked = detectBlockedTasks(entries)
      expect(blocked.length).toBe(0)
    })
  })

  describe("TaskStateEntrySchema", () => {
    // given: a valid entry object
    // when: TaskStateEntrySchema.parse is called
    // then: succeeds
    it("accepts a valid entry", () => {
      const entry = makeEntry()
      const result = TaskStateEntrySchema.safeParse(entry)
      expect(result.success).toBe(true)
    })

    // given: an entry missing required fields
    // when: TaskStateEntrySchema.parse is called
    // then: fails validation
    it("rejects entry missing required fields", () => {
      const result = TaskStateEntrySchema.safeParse({ version: 1, id: "x" })
      expect(result.success).toBe(false)
    })

    // given: an entry with an invalid status
    // when: TaskStateEntrySchema.parse is called
    // then: fails validation
    it("rejects invalid status value", () => {
      const entry = makeEntry({ status: "unknown_status" as never })
      const result = TaskStateEntrySchema.safeParse(entry)
      expect(result.success).toBe(false)
    })

    // given: an entry with all optional fields populated
    // when: TaskStateEntrySchema.parse is called
    // then: succeeds and preserves all fields
    it("accepts entry with all optional fields", () => {
      const entry: TaskStateEntry = {
        version: 1,
        id: "full-task",
        timestamp: "2026-05-31T10:00:00.000Z",
        action: "create",
        title: "Full featured task",
        status: "planned",
        priority: "critical",
        owner_agent: "sisyphus",
        source_session_id: "ses_xyz",
        related_sessions: ["ses_aaa"],
        dependencies: ["task-dep-1"],
        blockers: ["task-block-1"],
        changed_files: ["src/foo.ts"],
        verification: "All tests pass",
        next_action: "Deploy to staging",
        notes: "This is a note",
        metadata: { source: "agent", tags: ["urgent"] },
      }
      const result = TaskStateEntrySchema.safeParse(entry)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.metadata).toEqual({ source: "agent", tags: ["urgent"] })
      }
    })
  })
})
