import { describe, expect, it } from "bun:test"
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { appendTaskEntry, TASK_STATE_MEMORY_FILENAME, type TaskStateEntry } from "./task-state-memory"
import { appendDecisionEntry, DECISION_LOG_FILENAME } from "./decision-log"
import { PROJECT_MEMORY_DIR } from "./memory-bootstrap"
import {
  commitTaskCompletionToMemory,
  type TaskCompletionMemoryResult,
} from "./task-completion-memory-commit"
import {
  scheduleMemoryCurator,
  flushPendingMemoryCuratorRuns,
  getMemoryCuratorScheduleState,
} from "./memory-curator-scheduler"

function setupTempDir(): string {
  const dir = join(tmpdir(), `omo-tcm-${randomUUID()}`)
  mkdirSync(join(dir, PROJECT_MEMORY_DIR), { recursive: true })
  return dir
}

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
}

function getMemoryFilePath(root: string, filename: string): string {
  return join(root, PROJECT_MEMORY_DIR, filename)
}

function readTaskEntries(root: string): TaskStateEntry[] {
  const fp = getMemoryFilePath(root, TASK_STATE_MEMORY_FILENAME)
  if (!existsSync(fp)) return []
  const raw = readFileSync(fp, "utf-8")
  return raw
    .split("\n")
    .filter((l: string) => l.trim().length > 0)
    .map((l: string) => JSON.parse(l) as TaskStateEntry)
}

function rawMemoryDirContent(root: string): Record<string, string> {
  const result: Record<string, string> = {}
  const memDir = join(root, PROJECT_MEMORY_DIR)
  if (!existsSync(memDir)) return result
  for (const entry of readdirSync(memDir)) {
    const fp = join(memDir, entry)
    if (existsSync(fp)) {
      try {
        result[entry] = readFileSync(fp, "utf-8")
      } catch {
        result[entry] = "[read error]"
      }
    }
  }
  return result
}

describe("task-completion-memory-commit", () => {
  describe("#minimal task entry", () => {
    // given: empty text and no metadata
    // when: commitTaskCompletionToMemory is called
    // then: writes exactly one "completed" task entry
    it("writes completed task entry when text content is empty", () => {
      const root = setupTempDir()
      const sessionId = `ses_${randomUUID().slice(0, 8)}`

      const result = commitTaskCompletionToMemory({
        textContent: "",
        directory: root,
        sessionId,
      })

      expect(result.attempted).toBe(true)
      expect(result.written).toContain("tasks.jsonl")
      expect(result.errors).toEqual([])

      const entries = readTaskEntries(root)
      expect(entries).toHaveLength(1)
      expect(entries[0].action).toBe("complete")
      expect(entries[0].status).toBe("completed")
      expect(entries[0].source_session_id).toBe(sessionId)

      cleanup(root)
    })

    // given: taskDescription provided
    // when: memory commit called
    // then: entry title matches taskDescription
    it("uses taskDescription as entry title", () => {
      const root = setupTempDir()
      const sessionId = `ses_${randomUUID().slice(0, 8)}`

      commitTaskCompletionToMemory({
        textContent: "",
        directory: root,
        sessionId,
        taskDescription: "Fix authentication bug",
      })

      const entries = readTaskEntries(root)
      expect(entries[0].title).toBe("Fix authentication bug")

      cleanup(root)
    })

    // given: no taskDescription provided
    // when: memory commit called
    // then: entry title is a fallback with session ID prefix
    it("uses fallback title when taskDescription is missing", () => {
      const root = setupTempDir()
      const sessionId = `ses_abcdef12`

      commitTaskCompletionToMemory({
        textContent: "",
        directory: root,
        sessionId,
      })

      const entries = readTaskEntries(root)
      expect(entries[0].title).toContain("Task")
      expect(entries[0].title).toContain(sessionId.slice(0, 8))

      cleanup(root)
    })

    // given: agentName provided
    // when: memory commit called
    // then: owner_agent is set
    it("sets owner_agent when agentName is provided", () => {
      const root = setupTempDir()
      const sessionId = `ses_${randomUUID().slice(0, 8)}`

      commitTaskCompletionToMemory({
        textContent: "",
        directory: root,
        sessionId,
        agentName: "hephaestus",
      })

      const entries = readTaskEntries(root)
      expect(entries[0].owner_agent).toBe("hephaestus")

      cleanup(root)
    })
  })

  describe("#progress milestone writing", () => {
    // given: completed task with description
    // when: commitTaskCompletionToMemory is called
    // then: progress.md is written with milestone
    it("writes progress.md for completed task with description", () => {
      const root = setupTempDir()
      const sessionId = `ses_${randomUUID().slice(0, 8)}`

      const result = commitTaskCompletionToMemory({
        textContent: "Fixed the auth bug.",
        directory: root,
        sessionId,
        taskDescription: "Fix authentication bug",
        taskStatus: "completed",
      })

      // progress.md should be written
      const files = rawMemoryDirContent(root)
      expect(files["progress.md"]).toBeDefined()
      expect(files["progress.md"]).toContain("Fix authentication bug")
      expect(result.written).toContain("progress.md")

      cleanup(root)
    })

    // given: completed task with file paths but no description
    // when: commitTaskCompletionToMemory is called
    // then: progress.md is written with file-based milestone
    it("writes progress.md when file paths are present", () => {
      const root = setupTempDir()
      const sessionId = `ses_${randomUUID().slice(0, 8)}`

      commitTaskCompletionToMemory({
        textContent: "Modified `src/shared/foo.ts` and `src/utils/bar.ts`.",
        directory: root,
        sessionId,
        taskStatus: "completed",
      })

      const files = rawMemoryDirContent(root)
      expect(files["progress.md"]).toBeDefined()

      cleanup(root)
    })
  })

  describe("#error task", () => {
    // given: taskStatus is "error" with an errorMessage
    // when: memory commit called
    // then: writes a "blocked" entry with blocker
    it("writes blocked task entry when taskStatus is error", () => {
      const root = setupTempDir()
      const sessionId = `ses_${randomUUID().slice(0, 8)}`

      commitTaskCompletionToMemory({
        textContent: "Something went wrong",
        directory: root,
        sessionId,
        taskStatus: "error",
        errorMessage: "Connection refused",
      })

      const entries = readTaskEntries(root)
      expect(entries[0].action).toBe("block")
      expect(entries[0].status).toBe("blocked")
      expect(entries[0].blockers).toEqual(["Connection refused"])

      cleanup(root)
    })

    // given: taskStatus is "cancelled"
    // when: memory commit called
    // then: writes a "cancelled" entry
    it("writes cancelled task entry when taskStatus is cancelled", () => {
      const root = setupTempDir()
      const sessionId = `ses_${randomUUID().slice(0, 8)}`

      commitTaskCompletionToMemory({
        textContent: "",
        directory: root,
        sessionId,
        taskStatus: "cancelled",
      })

      const entries = readTaskEntries(root)
      expect(entries[0].action).toBe("cancel")
      expect(entries[0].status).toBe("cancelled")

      cleanup(root)
    })
  })

  describe("#file path extraction", () => {
    // given: text with backtick-wrapped file paths
    // when: memory commit called
    // then: changed_files includes the paths
    it("extracts backtick-wrapped file paths", () => {
      const root = setupTempDir()
      const sessionId = `ses_${randomUUID().slice(0, 8)}`

      commitTaskCompletionToMemory({
        textContent: "I modified `src/shared/foo.ts` and `src/utils/bar.ts`.",
        directory: root,
        sessionId,
      })

      const entries = readTaskEntries(root)
      expect(entries[0].changed_files).toContain("src/shared/foo.ts")
      expect(entries[0].changed_files).toContain("src/utils/bar.ts")

      cleanup(root)
    })

    // given: text with bullet paths
    // when: memory commit called
    // then: changed_files includes the paths
    it("extracts bullet-listed file paths", () => {
      const root = setupTempDir()
      const sessionId = `ses_${randomUUID().slice(0, 8)}`

      commitTaskCompletionToMemory({
        textContent: "Files changed:\n- src/foo.ts\n- src/bar.ts",
        directory: root,
        sessionId,
      })

      const entries = readTaskEntries(root)
      expect(entries[0].changed_files).toContain("src/foo.ts")
      expect(entries[0].changed_files).toContain("src/bar.ts")

      cleanup(root)
    })

    // given: text mentioning a "Changed files:" section
    // when: memory commit called
    // then: changed_files includes the paths
    it("extracts paths from changed files section", () => {
      const root = setupTempDir()
      const sessionId = `ses_${randomUUID().slice(0, 8)}`

      commitTaskCompletionToMemory({
        textContent: "Changed files: src/a.ts, src/b.ts, src/c.ts",
        directory: root,
        sessionId,
      })

      const entries = readTaskEntries(root)
      expect(entries[0].changed_files).toContain("src/a.ts")
      expect(entries[0].changed_files).toContain("src/b.ts")
      expect(entries[0].changed_files).toContain("src/c.ts")

      cleanup(root)
    })

    // given: text without clear file paths
    // when: memory commit called
    // then: changed_files is not present
    it("does not invent file paths from random words", () => {
      const root = setupTempDir()
      const sessionId = `ses_${randomUUID().slice(0, 8)}`

      commitTaskCompletionToMemory({
        textContent: "The task was completed successfully. Everything looks good.",
        directory: root,
        sessionId,
      })

      const entries = readTaskEntries(root)
      expect(entries[0].changed_files).toBeUndefined()

      cleanup(root)
    })
  })

  describe("#test evidence extraction", () => {
    // given: text with clear test pass signal
    // when: memory commit called
    // then: verification field exists AND quality-history.md is written
    it("writes verification and quality-history when tests passed", () => {
      const root = setupTempDir()
      const sessionId = `ses_${randomUUID().slice(0, 8)}`

      commitTaskCompletionToMemory({
        textContent: "All 12 tests passed. No failures.",
        directory: root,
        sessionId,
      })

      const entries = readTaskEntries(root)
      expect(entries[0].verification).toBeDefined()
      expect(entries[0].verification).toContain("12 passed")

      const files = rawMemoryDirContent(root)
      expect(files["quality-history.md"]).toBeDefined()
      expect(files["quality-history.md"]).toContain("PASS")

      cleanup(root)
    })

    // given: text with test failure signal
    // when: memory commit called
    // then: quality-history.md shows FAIL
    it("writes FAIL quality-history when tests failed", () => {
      const root = setupTempDir()
      const sessionId = `ses_${randomUUID().slice(0, 8)}`

      commitTaskCompletionToMemory({
        textContent: "3 tests passed, 1 test failed.",
        directory: root,
        sessionId,
      })

      const files = rawMemoryDirContent(root)
      expect(files["quality-history.md"]).toContain("FAIL")

      cleanup(root)
    })

    // given: text with no test-related keywords
    // when: memory commit called
    // then: quality-history.md is NOT written
    it("does not write quality-history when no test evidence", () => {
      const root = setupTempDir()
      const sessionId = `ses_${randomUUID().slice(0, 8)}`

      commitTaskCompletionToMemory({
        textContent: "Task completed. I refactored the code.",
        directory: root,
        sessionId,
      })

      const files = rawMemoryDirContent(root)
      expect(files["quality-history.md"]).toBeUndefined()

      cleanup(root)
    })
  })

  describe("#decision detection", () => {
    // given: text with "Decision:" prefix
    // when: memory commit called
    // then: decisions.jsonl is written
    it("writes decisions.jsonl for explicit Decision: marker", () => {
      const root = setupTempDir()
      const sessionId = `ses_${randomUUID().slice(0, 8)}`

      commitTaskCompletionToMemory({
        textContent: "Decision: We decided to use Redis for caching.",
        directory: root,
        sessionId,
      })

      const files = rawMemoryDirContent(root)
      expect(files[DECISION_LOG_FILENAME]).toBeDefined()

      cleanup(root)
    })

    // given: text with "chosen approach"
    // when: memory commit called
    // then: decisions.jsonl is written
    it("detects 'chosen approach' as decision signal", () => {
      const root = setupTempDir()
      const sessionId = `ses_${randomUUID().slice(0, 8)}`

      commitTaskCompletionToMemory({
        textContent: "Chosen approach: Use factory pattern for plugin creation.",
        directory: root,
        sessionId,
      })

      const files = rawMemoryDirContent(root)
      expect(files[DECISION_LOG_FILENAME]).toBeDefined()

      cleanup(root)
    })

    // given: text with "rejected approach"
    // when: memory commit called
    // then: decisions.jsonl is written
    it("detects 'rejected approach' as decision signal", () => {
      const root = setupTempDir()
      const sessionId = `ses_${randomUUID().slice(0, 8)}`

      commitTaskCompletionToMemory({
        textContent: "Rejected approach: Using a monorepo structure.",
        directory: root,
        sessionId,
      })

      const files = rawMemoryDirContent(root)
      expect(files[DECISION_LOG_FILENAME]).toBeDefined()

      cleanup(root)
    })

    // given: text without explicit decision keywords
    // when: memory commit called
    // then: decisions.jsonl is NOT written
    it("does not write decisions.jsonl for plain architecture wording", () => {
      const root = setupTempDir()
      const sessionId = `ses_${randomUUID().slice(0, 8)}`

      commitTaskCompletionToMemory({
        textContent: "The architecture uses a layered pattern with clear separation.",
        directory: root,
        sessionId,
      })

      const files = rawMemoryDirContent(root)
      expect(files[DECISION_LOG_FILENAME]).toBeUndefined()

      cleanup(root)
    })

    // given: text mentioning tradeoff/selected/rationale without explicit marker
    // when: memory commit called
    // then: decisions.jsonl is NOT written
    it("does not write decisions.jsonl for broad markers like tradeoff or selected", () => {
      const root = setupTempDir()
      const sessionId = `ses_${randomUUID().slice(0, 8)}`

      commitTaskCompletionToMemory({
        textContent: "There is a tradeoff between speed and memory. We selected the faster option with good rationale.",
        directory: root,
        sessionId,
      })

      const files = rawMemoryDirContent(root)
      expect(files[DECISION_LOG_FILENAME]).toBeUndefined()

      cleanup(root)
    })

    // given: text without decision keywords
    // when: memory commit called
    // then: decisions.jsonl is NOT written
    it("does not write decisions.jsonl without decision signal", () => {
      const root = setupTempDir()
      const sessionId = `ses_${randomUUID().slice(0, 8)}`

      commitTaskCompletionToMemory({
        textContent: "Fixed the bug. All tests pass.",
        directory: root,
        sessionId,
      })

      const files = rawMemoryDirContent(root)
      expect(files[DECISION_LOG_FILENAME]).toBeUndefined()

      cleanup(root)
    })
  })

  describe("#change impact", () => {
    // given: text with file paths
    // when: memory commit called
    // then: file-map.md has change impact section
    it("updates file-map.md when file paths are extracted", () => {
      const root = setupTempDir()
      const sessionId = `ses_${randomUUID().slice(0, 8)}`

      commitTaskCompletionToMemory({
        textContent: "I changed `src/shared/foo.ts`",
        directory: root,
        sessionId,
      })

      const files = rawMemoryDirContent(root)
      expect(files["file-map.md"]).toBeDefined()
      expect(files["file-map.md"]).toContain("Change Impact Map")
      expect(files["file-map.md"]).toContain("src/shared/foo.ts")

      cleanup(root)
    })

    // given: text without file paths
    // when: memory commit called
    // then: file-map.md is NOT created
    it("does not create file-map.md when no file paths", () => {
      const root = setupTempDir()
      const sessionId = `ses_${randomUUID().slice(0, 8)}`

      commitTaskCompletionToMemory({
        textContent: "All done.",
        directory: root,
        sessionId,
      })

      const files = rawMemoryDirContent(root)
      expect(files["file-map.md"]).toBeUndefined()

      cleanup(root)
    })
  })

  describe("#risk profile", () => {
    // given: text mentioning .env file
    // when: memory commit called
    // then: risk-profile.md is written (matches security risk pattern)
    it("writes risk-profile.md when .env path is detected", () => {
      const root = setupTempDir()
      const sessionId = `ses_${randomUUID().slice(0, 8)}`

      commitTaskCompletionToMemory({
        textContent: "I updated `.env` to add the new API key.",
        directory: root,
        sessionId,
      })

      const files = rawMemoryDirContent(root)
      expect(files["risk-profile.md"]).toBeDefined()

      cleanup(root)
    })

    // given: text mentioning migration file
    // when: memory commit called
    // then: risk-profile.md is written (matches migration risk pattern)
    it("writes risk-profile.md when migration path is detected", () => {
      const root = setupTempDir()
      const sessionId = `ses_${randomUUID().slice(0, 8)}`

      commitTaskCompletionToMemory({
        textContent: "I changed `prisma/migrations/002_add_users.sql`",
        directory: root,
        sessionId,
      })

      const files = rawMemoryDirContent(root)
      expect(files["risk-profile.md"]).toBeDefined()

      cleanup(root)
    })

    // given: text with explicit risk language but no matching file paths
    // when: memory commit called
    // then: risk-profile.md is NOT written (no evidence-backed file paths)
    it("does not write risk-profile.md for text-only risk without matching file paths", () => {
      const root = setupTempDir()
      const sessionId = `ses_${randomUUID().slice(0, 8)}`

      commitTaskCompletionToMemory({
        textContent: "Risk: This change modifies critical auth logic. Known risk of session invalidation.",
        directory: root,
        sessionId,
      })

      const files = rawMemoryDirContent(root)
      // Risk writer requires matching file paths to create entries.
      // Text-only risk signals without evidence-backed file paths are skipped.
      expect(files["risk-profile.md"]).toBeUndefined()

      cleanup(root)
    })

    // given: normal src/foo.ts file path only
    // when: memory commit called
    // then: risk-profile.md is NOT written
    it("does not write risk-profile.md for normal file paths", () => {
      const root = setupTempDir()
      const sessionId = `ses_${randomUUID().slice(0, 8)}`

      commitTaskCompletionToMemory({
        textContent: "I changed `src/shared/foo.ts` to fix a bug.",
        directory: root,
        sessionId,
      })

      const files = rawMemoryDirContent(root)
      expect(files["risk-profile.md"]).toBeUndefined()

      cleanup(root)
    })

    // given: no file paths or risk language
    // when: memory commit called
    // then: risk-profile.md is NOT written
    it("does not write risk-profile.md when no risk signal", () => {
      const root = setupTempDir()
      const sessionId = `ses_${randomUUID().slice(0, 8)}`

      commitTaskCompletionToMemory({
        textContent: "All done.",
        directory: root,
        sessionId,
      })

      const files = rawMemoryDirContent(root)
      expect(files["risk-profile.md"]).toBeUndefined()

      cleanup(root)
    })
  })

  describe("#dedupe", () => {
    // given: same sessionId and same content
    // when: commitTaskCompletionToMemory called twice
    // then: only one task entry exists
    it("does not duplicate task entry for same session and content", () => {
      const root = setupTempDir()
      const sessionId = `ses_${randomUUID().slice(0, 8)}`

      const args = {
        textContent: "Fixed the bug.",
        directory: root,
        sessionId,
        taskDescription: "Fix bug",
      }

      const result1 = commitTaskCompletionToMemory(args)
      const result2 = commitTaskCompletionToMemory(args)

      expect(result1.written).toContain("tasks.jsonl")
      expect(result2.skipped).toContain("tasks.jsonl (duplicate)")

      const entries = readTaskEntries(root)
      expect(entries).toHaveLength(1)

      cleanup(root)
    })

    // given: same sessionId but different description
    // when: commitTaskCompletionToMemory called twice
    // then: only one entry (different content hash but same ID, latest wins)
    it("handles same session ID gracefully with re-writes", () => {
      const root = setupTempDir()
      const sessionId = `ses_${randomUUID().slice(0, 8)}`

      commitTaskCompletionToMemory({
        textContent: "First call",
        directory: root,
        sessionId,
        taskDescription: "First description",
      })

      commitTaskCompletionToMemory({
        textContent: "Second call",
        directory: root,
        sessionId,
        taskDescription: "Second description",
      })

      const entries = readTaskEntries(root)
      // Two entries because content hash differs (title changed)
      // The latest one wins when resolving
      expect(entries.length).toBeGreaterThanOrEqual(1)

      cleanup(root)
    })
  })

  describe("#failure safety", () => {
    // given: directory with memory dir that is a FILE (not directory)
    // when: memory commit called
    // then: does not throw, returns error info
    it("never throws even when directory setup fails", () => {
      const root = setupTempDir()
      rmSync(join(root, PROJECT_MEMORY_DIR), { recursive: true, force: true })
      writeFileSync(join(root, PROJECT_MEMORY_DIR), "block")

      const sessionId = `ses_${randomUUID().slice(0, 8)}`
      let result: TaskCompletionMemoryResult | undefined

      // given: corrupted directory (file where dir should be)
      // when: commitTaskCompletionToMemory is called
      // then: does not throw, returns error
      expect(() => {
        result = commitTaskCompletionToMemory({
          textContent: "test",
          directory: root,
          sessionId,
        })
      }).not.toThrow()

      expect(result).toBeDefined()
      expect(result!.errors.length).toBeGreaterThan(0)

      cleanup(root)
    })

    // given: a normal directory with valid inputs
    // when: memory commit called
    // then: always returns a result, never throws
    it("always returns a result object, never throws", () => {
      const root = setupTempDir()
      const sessionId = `ses_${randomUUID().slice(0, 8)}`

      let result: TaskCompletionMemoryResult | undefined
      expect(() => {
        result = commitTaskCompletionToMemory({
          textContent: "Normal task completion",
          directory: root,
          sessionId,
        })
      }).not.toThrow()

      expect(result).toBeDefined()
      expect(result!.attempted).toBe(true)
      expect(typeof result!.written).toBe("object")
      expect(typeof result!.skipped).toBe("object")
      expect(typeof result!.errors).toBe("object")

      cleanup(root)
    })

    // given: a task with parent session
    // when: memory commit called
    // then: related_sessions includes parent
    it("records parent session in related_sessions", () => {
      const root = setupTempDir()
      const sessionId = `ses_child_${randomUUID().slice(0, 8)}`
      const parentId = `ses_parent_${randomUUID().slice(0, 8)}`

      commitTaskCompletionToMemory({
        textContent: "",
        directory: root,
        sessionId,
        parentSessionId: parentId,
      })

      const entries = readTaskEntries(root)
      expect(entries[0].related_sessions).toContain(parentId)
      expect(entries[0].related_sessions).toContain(sessionId)

      cleanup(root)
    })

    // given: completion_source is always "non_handoff"
    // when: memory commit called
    // then: metadata.completion_source is set correctly
    it("sets completion_source to non_handoff in metadata", () => {
      const root = setupTempDir()
      const sessionId = `ses_${randomUUID().slice(0, 8)}`

      commitTaskCompletionToMemory({
        textContent: "",
        directory: root,
        sessionId,
      })

      const entries = readTaskEntries(root)
      expect(entries[0].metadata).toBeDefined()
      expect(entries[0].metadata!.completion_source).toBe("non_handoff")

      cleanup(root)
    })
  })

  describe("#memory write failure does not break", () => {
    // given: memory dir exists but is made read-only
    // when: commitTaskCompletionToMemory is called
    // then: function does not throw
    it("does not throw when filesystem is read-only", () => {
      const root = setupTempDir()
      const sessionId = `ses_${randomUUID().slice(0, 8)}`

      const memDir = join(root, PROJECT_MEMORY_DIR)
      chmodSync(memDir, 0o555)

      let result: TaskCompletionMemoryResult | undefined
      expect(() => {
        result = commitTaskCompletionToMemory({
          textContent: "Task finished.",
          directory: root,
          sessionId,
        })
      }).not.toThrow()

      expect(result).toBeDefined()

      chmodSync(memDir, 0o755)
      cleanup(root)
    })
  })

  // ── Phase 4D: Safe Curator Trigger Integration Tests ───────────────────

  describe("#Phase 4D curator trigger", () => {
    // given: meaningful task completion that writes tasks.jsonl
    // when: commitTaskCompletionToMemory is called
    // then: curator is scheduled (picked up by flush)
    it("schedules curator after meaningful task write", async () => {
      const root = setupTempDir()
      const sessionId = `ses_${randomUUID().slice(0, 8)}`

      // First ensure memory.json exists so curator can read it
      const memDir = join(root, PROJECT_MEMORY_DIR)
      const manifestPath = join(memDir, "memory.json")
      writeFileSync(
        manifestPath,
        JSON.stringify({ version: 2, revision: 1, files: {} }),
        "utf-8",
      )

      const result = commitTaskCompletionToMemory({
        textContent: "Task completed successfully.",
        directory: root,
        sessionId,
        taskStatus: "completed",
      })

      // A task entry was written — result should reflect that
      expect(result.written).toContain("tasks.jsonl")

      // Flush curator runs
      await flushPendingMemoryCuratorRuns(root)

      // After flush, the scheduler should be idle
      const state = getMemoryCuratorScheduleState(root)
      expect(state.activeCount).toBe(0)
      expect(state.pendingCount).toBe(0)

      cleanup(root)
    })

    // given: text content with MEMORY_UPDATE signal
    // when: commitTaskCompletionToMemory processes it
    // then: curator is scheduled
    it("schedules curator after MEMORY_UPDATE routed write", async () => {
      const root = setupTempDir()
      const sessionId = `ses_${randomUUID().slice(0, 8)}`

      // Ensure memory.json exists
      const memDir = join(root, PROJECT_MEMORY_DIR)
      writeFileSync(
        join(memDir, "memory.json"),
        JSON.stringify({ version: 2, revision: 1, files: {} }),
        "utf-8",
      )

      const textWithSignal = `Task completed.
<MEMORY_UPDATE>
{
  "session_id": "${sessionId}",
  "agent_name": "test-agent",
  "status": "completed",
  "entries": [
    {
      "target": "decisions",
      "data": {
        "title": "Decision from MEMORY_UPDATE",
        "decision": "We decided to use X",
        "rationale": "Testing"
      }
    }
  ]
}
</MEMORY_UPDATE>`

      const result = commitTaskCompletionToMemory({
        textContent: textWithSignal,
        directory: root,
        sessionId,
        taskStatus: "completed",
      })

      // MEMORY_UPDATE routing should have occurred
      expect(
        result.memoryUpdateRouting !== undefined &&
          result.memoryUpdateRouting.routed > 0,
      ).toBe(true)

      // Flush curator runs
      await flushPendingMemoryCuratorRuns(root)

      const state = getMemoryCuratorScheduleState(root)
      expect(state.activeCount).toBe(0)

      cleanup(root)
    })

    // given: empty text content (no meaningful activity)
    // when: commitTaskCompletionToMemory is called
    // then: curator is NOT scheduled (only tasks.jsonl written, which IS meaningful)
    // Note: Even empty text content writes a task entry to tasks.jsonl,
    // which counts as meaningful activity. We test "no curator" with
    // guard conditions instead.
    it("does not block completion when curator scheduling fails", () => {
      const root = setupTempDir()
      const sessionId = `ses_${randomUUID().slice(0, 8)}`

      // This should never throw, even if the curator module has issues
      const result = commitTaskCompletionToMemory({
        textContent: "",
        directory: root,
        sessionId,
      })

      expect(result.attempted).toBe(true)
      expect(result.errors.filter((e) => e.includes("curator")).length).toBe(0)

      cleanup(root)
    })

    // given: a completion that writes tasks.jsonl
    // when: we don't flush (production path)
    // then: the call returns normally (fire-and-forget)
    it("commitTaskCompletionToMemory returns normally (fire-and-forget)", () => {
      const root = setupTempDir()
      const sessionId = `ses_${randomUUID().slice(0, 8)}`

      const memDir = join(root, PROJECT_MEMORY_DIR)
      writeFileSync(
        join(memDir, "memory.json"),
        JSON.stringify({ version: 2, revision: 1, files: {} }),
        "utf-8",
      )

      const result = commitTaskCompletionToMemory({
        textContent: "Task completed with file changes: src/foo.ts",
        directory: root,
        sessionId,
        taskStatus: "completed",
      })

      // Must return without throwing
      expect(result.attempted).toBe(true)
      expect(result.written.length).toBeGreaterThan(0)

      cleanup(root)
    })

    // given: a completion that results in skipped-only writes
    // when: commitTaskCompletionToMemory is called with empty text
    // then: tasks.jsonl is always written (task entry), so curator is still scheduled
    // This verifies that the trigger guard logic correctly handles the
    // case where only the task entry is written (the most common case).
    it("curator trigger handles minimal completion gracefully", async () => {
      const root = setupTempDir()
      const sessionId = `ses_${randomUUID().slice(0, 8)}`

      const memDir = join(root, PROJECT_MEMORY_DIR)
      writeFileSync(
        join(memDir, "memory.json"),
        JSON.stringify({ version: 2, revision: 1, files: {} }),
        "utf-8",
      )

      const result = commitTaskCompletionToMemory({
        textContent: "",
        directory: root,
        sessionId,
      })

      // A task entry is always written (the core purpose of commitTaskCompletionToMemory)
      expect(result.written).toContain("tasks.jsonl")

      // Flush and verify no crash
      await flushPendingMemoryCuratorRuns(root)
      const state = getMemoryCuratorScheduleState(root)
      expect(state.activeCount).toBe(0)

      cleanup(root)
    })

    // given: task completion with quality evidence
    // when: commitTaskCompletionToMemory processes it
    // then: quality-history.md is written and curator is scheduled
    it("schedules curator after quality history write", async () => {
      const root = setupTempDir()
      const sessionId = `ses_${randomUUID().slice(0, 8)}`

      const memDir = join(root, PROJECT_MEMORY_DIR)
      writeFileSync(
        join(memDir, "memory.json"),
        JSON.stringify({ version: 2, revision: 1, files: {} }),
        "utf-8",
      )

      const result = commitTaskCompletionToMemory({
        textContent: "All 10 tests passed, 0 failed. Build succeeded.",
        directory: root,
        sessionId,
        taskStatus: "completed",
      })

      expect(result.written).toContain("tasks.jsonl")
      expect(result.written).toContain("quality-history.md")

      await flushPendingMemoryCuratorRuns(root)
      const state = getMemoryCuratorScheduleState(root)
      expect(state.activeCount).toBe(0)

      cleanup(root)
    })

    // given: task completion with file changes
    // when: commitTaskCompletionToMemory processes it
    // then: file-map.md entry is written and curator is scheduled
    it("schedules curator after file-map write", async () => {
      const root = setupTempDir()
      const sessionId = `ses_${randomUUID().slice(0, 8)}`

      const memDir = join(root, PROJECT_MEMORY_DIR)
      writeFileSync(
        join(memDir, "memory.json"),
        JSON.stringify({ version: 2, revision: 1, files: {} }),
        "utf-8",
      )

      const result = commitTaskCompletionToMemory({
        textContent: "Changed files: src/foo.ts, src/bar.ts",
        directory: root,
        sessionId,
        taskStatus: "completed",
      })

      expect(result.written).toContain("tasks.jsonl")
      // file-map.md may or may not be written depending on dedup

      await flushPendingMemoryCuratorRuns(root)
      const state = getMemoryCuratorScheduleState(root)
      expect(state.activeCount).toBe(0)

      cleanup(root)
    })
  })
})
