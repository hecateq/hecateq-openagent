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
  getTaskRenderGuardState,
  flushPendingTaskRenders,
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

  // -----------------------------------------------------------------------
  // Phase 4B: Auto-render tests
  // -----------------------------------------------------------------------

  /**
   * Flush multiple microtask queue layers to ensure fire-and-forget
   * dynamic-import renders complete before assertions.
   *
   * Each dynamic import + .then() chain adds at least one microtask layer;
   * flushing several layers ensures the render chain has settled.
   */
  async function flushMicrotasks(): Promise<void> {
    // Flush up to 5 layers of microtasks
    for (let i = 0; i < 5; i++) {
      await new Promise<void>((r) => queueMicrotask(r))
    }
  }

  describe("Phase 4B: appendTaskEntry auto-renders tasks.md", () => {
    // given: a temp directory with memory dir, no tasks.md yet
    // when: appendTaskEntry writes successfully
    // then: tasks.md is created via auto-render (best-effort, fire-and-forget)
    it("writes tasks.jsonl and auto-renders tasks.md", async () => {
      const root = setupTempDir()
      try {
        const entry = makeEntry({ id: "task-auto-1", title: "Auto render test task" })
        const written = appendTaskEntry(root, entry)
        await flushMicrotasks()

        expect(written).toBe(true)

        const tasksMdPath = join(root, PROJECT_MEMORY_DIR, "tasks.md")
        expect(existsSync(tasksMdPath)).toBe(true)
        const mdContent = readFileSync(tasksMdPath, "utf-8")
        expect(mdContent).toContain("Auto render test task")
        expect(mdContent).toContain("## Pending")
      } finally {
        cleanup(root)
      }
    })

    // given: a temp directory with existing tasks.jsonl containing same entry
    // when: appendTaskEntry is called with duplicate content
    // then: returns false, tasks.md not re-rendered (content unchanged)
    it("duplicate entry does not trigger re-render", async () => {
      const root = setupTempDir()
      try {
        const entry = makeEntry({ id: "task-dup-1", title: "Duplicate test task" })
        const first = appendTaskEntry(root, entry)
        await flushMicrotasks()
        expect(first).toBe(true)

        // Capture tasks.md content after first write
        const tasksMdPath = join(root, PROJECT_MEMORY_DIR, "tasks.md")
        const contentAfterFirst = readFileSync(tasksMdPath, "utf-8")

        // Second write with same entry (duplicate)
        const second = appendTaskEntry(root, entry)
        await flushMicrotasks()
        expect(second).toBe(false)

        const contentAfterSecond = readFileSync(tasksMdPath, "utf-8")
        expect(contentAfterSecond).toBe(contentAfterFirst)
      } finally {
        cleanup(root)
      }
    })

    // given: a temp directory with pre-existing tasks.md containing user notes
    // when: appendTaskEntry writes and auto-renders
    // then: user-authored content outside controlled sections is preserved
    it("preserves user-authored content outside controlled sections", async () => {
      const root = setupTempDir()
      try {
        // Pre-create tasks.md with user content
        const tasksMdPath = join(root, PROJECT_MEMORY_DIR, "tasks.md")
        const userContent =
          "# Tasks\n\n## My Custom Section\nThese are my notes.\n\n## Pending\n_No pending tasks._\n\n## Blocked\n_No blocked tasks._\n\n## Done\n_No completed tasks yet._\n"
        writeFileSync(tasksMdPath, userContent, "utf-8")

        const entry = makeEntry({ id: "task-user-1", title: "User notes test task" })
        appendTaskEntry(root, entry)
        await flushMicrotasks()

        const updatedContent = readFileSync(tasksMdPath, "utf-8")
        expect(updatedContent).toContain("## My Custom Section")
        expect(updatedContent).toContain("These are my notes.")
        expect(updatedContent).toContain("User notes test task")
      } finally {
        cleanup(root)
      }
    })

    // given: a valid write succeeding
    // when: the auto-render encounters an error (e.g., bad projectRoot in render)
    // then: the appendTaskEntry still returns true and does not throw
    it("render failure does not block JSONL write", async () => {
      const root = setupTempDir()
      try {
        const entry = makeEntry({ id: "task-no-throw-1", title: "Render failure test" })
        const written = appendTaskEntry(root, entry)
        await flushMicrotasks()
        expect(written).toBe(true)
        // tasks.jsonl was written regardless
        const tasksJsonlPath = join(root, PROJECT_MEMORY_DIR, "tasks.jsonl")
        expect(existsSync(tasksJsonlPath)).toBe(true)
      } finally {
        cleanup(root)
      }
    })

    // given: multiple sequential writes to tasks.jsonl
    // when: appendTaskEntry is called multiple times
    // then: tasks.md reflects the latest state (idempotent runs)
    it("multiple sequential writes produce consistent tasks.md", async () => {
      const root = setupTempDir()
      try {
        const entry1 = makeEntry({ id: "task-seq-1", title: "First sequential task" })
        appendTaskEntry(root, entry1)
        // Flush enough microtasks for dynamic import + render chain
        await flushMicrotasks()

        // Write a second task with completed status (goes to Done section)
        const entry2 = makeEntry({
          id: "task-seq-2",
          title: "Second sequential task",
          status: "completed",
          timestamp: "2026-05-31T11:00:00.000Z",
        })
        appendTaskEntry(root, entry2)
        await flushMicrotasks()

        const tasksMdPath = join(root, PROJECT_MEMORY_DIR, "tasks.md")
        const content = readFileSync(tasksMdPath, "utf-8")
        expect(content).toContain("First sequential task")
        // Second task is completed, appears under Done with strikethrough
        expect(content).toContain("Second sequential task")
        // Verify no duplicate entries
        const firstCount = content.split("First sequential task").length - 1
        expect(firstCount).toBe(1)
      } finally {
        cleanup(root)
      }
    })
  })

  // -----------------------------------------------------------------------
  // Phase 4B.1: Auto-render stability tests
  // -----------------------------------------------------------------------

  describe("Phase 4B.1: task render stability with queued follow-up", () => {
    // given: three rapid task writes before initial render completes
    // when: all renders settle
    // then: tasks.md contains all three task titles
    it("rapid sequential task writes eventually render all latest task states", async () => {
      const root = setupTempDir()
      try {
        const entry1 = makeEntry({ id: "task-rapid-1", title: "Rapid task one", status: "planned" })
        const entry2 = makeEntry({ id: "task-rapid-2", title: "Rapid task two", status: "in_progress" })
        const entry3 = makeEntry({ id: "task-rapid-3", title: "Rapid task three", status: "completed" })

        // Write all three rapidly without waiting for renders between
        appendTaskEntry(root, entry1)
        appendTaskEntry(root, entry2)
        appendTaskEntry(root, entry3)

        // Wait for all renders (including follow-up) to complete
        await flushPendingTaskRenders()

        const tasksMdPath = join(root, PROJECT_MEMORY_DIR, "tasks.md")
        expect(existsSync(tasksMdPath)).toBe(true)
        const content = readFileSync(tasksMdPath, "utf-8")
        expect(content).toContain("Rapid task one")
        expect(content).toContain("Rapid task two")
        expect(content).toContain("Rapid task three")
      } finally {
        cleanup(root)
      }
    })

    // given: an active render and a new write
    // when: the write occurs during the active render
    // then: pending flag is set, and exactly one follow-up render occurs
    it("write during active render queues exactly one follow-up render", async () => {
      const root = setupTempDir()
      try {
        const entry1 = makeEntry({ id: "task-queue-1", title: "Queue test task one" })
        appendTaskEntry(root, entry1)
        // Don't wait for render — immediately write second entry
        const entry2 = makeEntry({ id: "task-queue-2", title: "Queue test task two" })
        appendTaskEntry(root, entry2)

        // After all renders settle, both tasks should appear
        await flushPendingTaskRenders()

        const tasksMdPath = join(root, PROJECT_MEMORY_DIR, "tasks.md")
        expect(existsSync(tasksMdPath)).toBe(true)
        const content = readFileSync(tasksMdPath, "utf-8")
        expect(content).toContain("Queue test task one")
        expect(content).toContain("Queue test task two")

        // Guard state should be clean (no active renders, no pending)
        const guardState = getTaskRenderGuardState()
        expect(guardState.active.length).toBe(0)
        expect(guardState.pending.length).toBe(0)
      } finally {
        cleanup(root)
      }
    })

    // given: initial render active, follow-up pending, a third write during follow-up
    // when: the drain loop runs
    // then: third write is captured without requiring a later write
    it("write during follow-up render is captured by drain loop", async () => {
      const root = setupTempDir()
      try {
        // Write entry1 — starts initial render
        const entry1 = makeEntry({ id: "task-drain-1", title: "Drain test one" })
        appendTaskEntry(root, entry1)

        // Write entry2 immediately — pending set for follow-up
        const entry2 = makeEntry({ id: "task-drain-2", title: "Drain test two" })
        appendTaskEntry(root, entry2)

        // Advance microtasks so initial render completes and follow-up starts
        for (let i = 0; i < 3; i++) await new Promise<void>((r) => queueMicrotask(r))

        // Write entry3 during follow-up render — drain loop must capture it
        const entry3 = makeEntry({ id: "task-drain-3", title: "Drain test three" })
        appendTaskEntry(root, entry3)

        // Wait for complete drain
        await flushPendingTaskRenders()

        const tasksMdPath = join(root, PROJECT_MEMORY_DIR, "tasks.md")
        expect(existsSync(tasksMdPath)).toBe(true)
        const content = readFileSync(tasksMdPath, "utf-8")
        expect(content).toContain("Drain test one")
        expect(content).toContain("Drain test two")
        expect(content).toContain("Drain test three")

        // Guard state clean — drain fully settled
        const guardState = getTaskRenderGuardState()
        expect(guardState.active.length).toBe(0)
        expect(guardState.pending.length).toBe(0)
      } finally {
        cleanup(root)
      }
    })

    // given: a duplicate write (same content hash) after initial write
    // when: appendTaskEntry returns false
    // then: pending rerender is NOT queued (no-op write is ignored)
    it("duplicate/no-op task write does not queue rerender", async () => {
      const root = setupTempDir()
      try {
        const entry = makeEntry({ id: "task-noqueue-1", title: "No queue dup test" })
        const first = appendTaskEntry(root, entry)
        expect(first).toBe(true)

        // Wait for render to start
        await new Promise<void>((r) => queueMicrotask(r))

        // Duplicate write — should return false, NOT queue a rerender
        const second = appendTaskEntry(root, entry)
        expect(second).toBe(false)

        await flushPendingTaskRenders()

        // Guard state should be clean
        const guardState = getTaskRenderGuardState()
        expect(guardState.active.length).toBe(0)
        expect(guardState.pending.length).toBe(0)
      } finally {
        cleanup(root)
      }
    })

    // given: a render failure (for any reason)
    // when: the render's finally block runs
    // then: the active guard is cleared, pending guard not leaked
    it("render failure clears active guard", async () => {
      const root = setupTempDir()
      try {
        const entry = makeEntry({ id: "task-guard-1", title: "Guard clear test" })
        appendTaskEntry(root, entry)
        await flushPendingTaskRenders()

        // After all renders settle (pass or fail), guard must be clean
        const guardState = getTaskRenderGuardState()
        expect(guardState.active.length).toBe(0)
        // pending may be 0 or more, but after flushPendingTaskRenders
        // the active set must be empty regardless of render outcome
        expect(guardState.pending.length).toBe(0)
      } finally {
        cleanup(root)
      }
    })

    // given: a valid JSONL write that succeeds
    // when: the auto-render path is triggered but encounters an error
    // then: appendTaskEntry still returns true (JSONL write unblocked)
    it("render failure does not block JSONL write", async () => {
      const root = setupTempDir()
      try {
        const entry = makeEntry({ id: "task-noblock-1", title: "No block test" })
        const written = appendTaskEntry(root, entry)
        await flushPendingTaskRenders()
        expect(written).toBe(true)
        // tasks.jsonl was written regardless
        const tasksJsonlPath = join(root, PROJECT_MEMORY_DIR, "tasks.jsonl")
        expect(existsSync(tasksJsonlPath)).toBe(true)
        const jsonlContent = readFileSync(tasksJsonlPath, "utf-8")
        expect(jsonlContent).toContain("No block test")
      } finally {
        cleanup(root)
      }
    })

    // given: pre-existing tasks.md with user-authored custom sections
    // when: rapid writes trigger initial + follow-up renders
    // then: user-authored sections outside controlled headings are preserved
    it("user-authored sections remain preserved after queued rerender", async () => {
      const root = setupTempDir()
      try {
        // Pre-create tasks.md with user content
        const tasksMdPath = join(root, PROJECT_MEMORY_DIR, "tasks.md")
        const userContent =
          "# Tasks\n\n## My Custom Section\nDo not touch this.\n\n## Pending\n_No pending tasks._\n\n## Blocked\n_No blocked tasks._\n\n## Done\n_No completed tasks yet._\n"
        writeFileSync(tasksMdPath, userContent, "utf-8")

        // Rapid writes that will trigger render + follow-up
        const entry1 = makeEntry({ id: "task-preserve-1", title: "Preserve test one" })
        appendTaskEntry(root, entry1)
        // Write second entry without waiting for first render
        const entry2 = makeEntry({ id: "task-preserve-2", title: "Preserve test two", status: "completed" })
        appendTaskEntry(root, entry2)

        await flushPendingTaskRenders()

        const content = readFileSync(tasksMdPath, "utf-8")
        expect(content).toContain("## My Custom Section")
        expect(content).toContain("Do not touch this.")
        expect(content).toContain("Preserve test one")
        expect(content).toContain("Preserve test two")
      } finally {
        cleanup(root)
      }
    })
  })
})
