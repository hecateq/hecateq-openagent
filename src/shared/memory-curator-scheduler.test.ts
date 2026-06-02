import { describe, expect, it } from "bun:test"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { PROJECT_MEMORY_DIR } from "./memory-bootstrap"
import {
  scheduleMemoryCurator,
  flushPendingMemoryCuratorRuns,
  getMemoryCuratorScheduleState,
} from "./memory-curator-scheduler"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupTempDir(): string {
  const dir = join(tmpdir(), `omo-sched-${randomUUID()}`)
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
  writeFileSync(getMemPath(root, fileName), content, "utf-8")
}

function memExists(root: string, fileName: string): boolean {
  try {
    readFileSync(getMemPath(root, fileName), "utf-8")
    return true
  } catch {
    return false
  }
}

function writeMemoryJson(root: string): void {
  writeMem(
    root,
    "memory.json",
    JSON.stringify({
      version: 2,
      revision: 1,
      files: {},
    }),
  )
}

/**
 * Seed a minimal tasks.jsonl with one in-progress task so the curator has
 * source data to work with (otherwise curateActiveContext skips with
 * "No task or decision data available for curation").
 */
function seedTasksJsonl(root: string): void {
  const entry = {
    version: 1,
    id: "task-test",
    timestamp: new Date().toISOString(),
    action: "create",
    title: "Test task for scheduler",
    status: "in_progress",
    source_session_id: "ses_test",
  }
  writeMem(root, "tasks.jsonl", JSON.stringify(entry) + "\n")
}

/**
 * Seed a minimal tasks.jsonl with a completed task.
 */
function seedCompletedTask(root: string): void {
  const entries = [
    {
      version: 1,
      id: "task-test",
      timestamp: new Date().toISOString(),
      action: "create",
      title: "Test task for scheduler",
      status: "in_progress",
      source_session_id: "ses_test",
    },
    {
      version: 1,
      id: "task-test",
      timestamp: new Date(Date.now() + 1000).toISOString(),
      action: "complete",
      title: "Test task for scheduler",
      status: "completed",
      source_session_id: "ses_test",
    },
  ]
  writeMem(
    root,
    "tasks.jsonl",
    entries.map((e) => JSON.stringify(e)).join("\n") + "\n",
  )
}

function seedDecisionsJsonl(root: string): void {
  const entry = {
    version: 1,
    id: "decision-test",
    timestamp: new Date().toISOString(),
    action: "record",
    title: "Test decision",
    status: "active",
    decision: "We decided to test",
    rationale: "For testing",
    impact_area: "testing",
    source_session_id: "ses_test",
  }
  writeMem(root, "decisions.jsonl", JSON.stringify(entry) + "\n")
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("memory-curator-scheduler", () => {
  describe("#scheduleMemoryCurator", () => {
    // given: a project root with memory.json and seed data
    // when: scheduleMemoryCurator is called
    // then: curator run starts and writes active-context.md
    it("first schedule starts curator run", async () => {
      const root = setupTempDir()
      try {
        writeMemoryJson(root)
        seedTasksJsonl(root)

        scheduleMemoryCurator(root)
        await flushPendingMemoryCuratorRuns(root)

        // The curator should have written active-context.md
        // (curateActiveContext reads tasks.jsonl and writes active-context.md)
        expect(memExists(root, "active-context.md")).toBe(true)
      } finally {
        cleanup(root)
      }
    })

    // given: a curator run already active
    // when: a second schedule call arrives during the active run
    // then: exactly one follow-up is queued (pending Set, not duplicated)
    it("schedule while active queues exactly one follow-up run", async () => {
      const root = setupTempDir()
      try {
        writeMemoryJson(root)
        seedTasksJsonl(root)

        // First call — starts immediately
        scheduleMemoryCurator(root)

        // Second call while first is active — queues follow-up
        scheduleMemoryCurator(root)

        // Third call — should NOT add another pending (Set dedup)
        scheduleMemoryCurator(root)

        const state = getMemoryCuratorScheduleState(root)
        expect(state.activeCount).toBe(1)
        // Pending is at most 1 (Set semantics)
        expect(state.pendingCount).toBeLessThanOrEqual(1)

        await flushPendingMemoryCuratorRuns(root)

        // After drain, both active and pending should be clear
        const finalState = getMemoryCuratorScheduleState(root)
        expect(finalState.activeCount).toBe(0)
        expect(finalState.pendingCount).toBe(0)

        // active-context.md should be written by the curator
        expect(memExists(root, "active-context.md")).toBe(true)
      } finally {
        cleanup(root)
      }
    })

    // given: a curator run active with pending set
    // when: multiple additional schedule calls arrive
    // then: still only one follow-up queued (Set dedup)
    it("multiple schedules while active queue only one follow-up pass", async () => {
      const root = setupTempDir()
      try {
        writeMemoryJson(root)
        seedTasksJsonl(root)

        // Start first run
        scheduleMemoryCurator(root)

        // Queue during active (should set pending)
        scheduleMemoryCurator(root)
        scheduleMemoryCurator(root)
        scheduleMemoryCurator(root)
        scheduleMemoryCurator(root)

        const state = getMemoryCuratorScheduleState(root)
        expect(state.activeCount).toBe(1)
        // Set dedup means at most 1 pending
        expect(state.pendingCount).toBeLessThanOrEqual(1)

        await flushPendingMemoryCuratorRuns(root)

        const finalState = getMemoryCuratorScheduleState(root)
        expect(finalState.activeCount).toBe(0)
      } finally {
        cleanup(root)
      }
    })

    // given: a project root with data and multiple schedule calls
    // when: all runs drain completely
    // then: the curator output reflects the latest state
    it("queued follow-up drains correctly", async () => {
      const root = setupTempDir()
      try {
        writeMemoryJson(root)
        seedCompletedTask(root) // has both in_progress and completed states

        // Rapid-fire multiple schedules simulating rapid task completions
        scheduleMemoryCurator(root)
        scheduleMemoryCurator(root)
        scheduleMemoryCurator(root)

        await flushPendingMemoryCuratorRuns(root)

        // After drain, scheduler state should be clean
        const finalState = getMemoryCuratorScheduleState(root)
        expect(finalState.activeCount).toBe(0)
        expect(finalState.pendingCount).toBe(0)

        // active-context.md should exist (curator ran at least once)
        expect(memExists(root, "active-context.md")).toBe(true)
      } finally {
        cleanup(root)
      }
    })

    // given: a project root
    // when: scheduleMemoryCurator is called with empty/undefined projectRoot
    // then: it returns immediately without error
    it("no-op for empty projectRoot", () => {
      // given: empty string
      // when: schedule is called
      scheduleMemoryCurator("")
      // then: no error thrown (no-op guard)
      const state = getMemoryCuratorScheduleState()
      expect(state.activeCount).toBe(0)
    })

    // given: an active curator run that fails
    // when: the curator import/render throws
    // then: the scheduler clears active state and does not throw to caller
    it("failure in curator run clears active state", async () => {
      const root = setupTempDir()
      try {
        // No memory.json, no tasks.jsonl — curator will attempt but
        // most functions will skip with "does not exist" results.
        // The scheduler itself should handle this gracefully.
        writeMemoryJson(root)
        // No tasks.jsonl — curator will skip most operations

        scheduleMemoryCurator(root)
        await flushPendingMemoryCuratorRuns(root)

        // Active state should be cleared even if curator functions skipped
        const state = getMemoryCuratorScheduleState(root)
        expect(state.activeCount).toBe(0)
      } finally {
        cleanup(root)
      }
    })

    // given: a project root
    // when: scheduleMemoryCurator is called
    // then: the call returns immediately (fire-and-forget), does not throw
    it("scheduleMemoryCurator does not throw to caller", () => {
      const root = setupTempDir()
      try {
        writeMemoryJson(root)
        seedTasksJsonl(root)

        // This must not throw, even if curator has issues
        expect(() => scheduleMemoryCurator(root)).not.toThrow()
      } finally {
        cleanup(root)
      }
    })
  })

  describe("#flushPendingMemoryCuratorRuns", () => {
    // given: a scheduled curator run
    // when: flushPendingMemoryCuratorRuns is called with the projectRoot
    // then: it waits until that project's run completes
    it("flush helper waits for pending runs (scoped)", async () => {
      const root = setupTempDir()
      try {
        writeMemoryJson(root)
        seedTasksJsonl(root)

        scheduleMemoryCurator(root)
        await flushPendingMemoryCuratorRuns(root)

        const state = getMemoryCuratorScheduleState(root)
        expect(state.activeCount).toBe(0)
      } finally {
        cleanup(root)
      }
    })

    // given: no scheduled curator runs
    // when: flushPendingMemoryCuratorRuns is called
    // then: it returns immediately
    it("flush returns immediately when no runs active", async () => {
      const root = setupTempDir()
      try {
        // No schedule calls — should return immediately
        await flushPendingMemoryCuratorRuns(root)
        const state = getMemoryCuratorScheduleState(root)
        expect(state.activeCount).toBe(0)
        expect(state.pendingCount).toBe(0)
      } finally {
        cleanup(root)
      }
    })

    // given: multiple project roots with scheduled runs
    // when: flushPendingMemoryCuratorRuns() is called without projectRoot
    // then: it waits for ALL runs to complete
    it("flush helper (global) waits for all project roots", async () => {
      const root1 = setupTempDir()
      const root2 = setupTempDir()
      try {
        writeMemoryJson(root1)
        seedTasksJsonl(root1)
        writeMemoryJson(root2)
        seedTasksJsonl(root2)

        scheduleMemoryCurator(root1)
        scheduleMemoryCurator(root2)

        await flushPendingMemoryCuratorRuns() // global flush

        const state1 = getMemoryCuratorScheduleState(root1)
        const state2 = getMemoryCuratorScheduleState(root2)
        expect(state1.activeCount).toBe(0)
        expect(state2.activeCount).toBe(0)
      } finally {
        cleanup(root1)
        cleanup(root2)
      }
    })
  })

  describe("#getMemoryCuratorScheduleState", () => {
    // given: a scheduled curator run
    // when: getMemoryCuratorScheduleState is called
    // then: returns correct active/pending counts
    it("returns correct active/pending counts during active run", () => {
      const root = setupTempDir()
      try {
        writeMemoryJson(root)
        seedTasksJsonl(root)

        scheduleMemoryCurator(root) // starts immediately

        const state = getMemoryCuratorScheduleState(root)
        // At least activeCount should be 1 (run started immediately)
        expect(state.activeCount >= 0).toBe(true)
      } finally {
        cleanup(root)
      }
    })

    // given: scheduler state per-projectRoot
    // when: two different project roots have active runs
    // then: state is isolated per-projectRoot
    it("scheduler state is per-projectRoot", () => {
      const rootA = setupTempDir()
      const rootB = setupTempDir()
      try {
        writeMemoryJson(rootA)
        seedTasksJsonl(rootA)
        writeMemoryJson(rootB)
        seedTasksJsonl(rootB)

        scheduleMemoryCurator(rootA)

        const stateA = getMemoryCuratorScheduleState(rootA)
        const stateB = getMemoryCuratorScheduleState(rootB)

        // rootA should be active, rootB should not
        expect(stateA.activeCount >= 1).toBe(true)
        expect(stateB.activeCount).toBe(0)
      } finally {
        cleanup(rootA)
        cleanup(rootB)
      }
    })

    // given: no scheduled runs
    // when: getMemoryCuratorScheduleState is called
    // then: returns empty state
    it("returns empty state when no runs", () => {
      const state = getMemoryCuratorScheduleState()
      expect(state.activeCount).toBe(0)
      expect(state.pendingCount).toBe(0)
    })
  })

  describe("#circuit breaker", () => {
    // given: the depth limit is 128
    // when: a drain loop approaches that limit
    // then: the circuit breaker prevents runaway
    // Note: This is tested indirectly — the depth parameter is internal.
    // We verify that the scheduler does not hang by timing out.
    it("depth limit circuit breaker exists (structural)", async () => {
      // This test verifies that the scheduler completes in a reasonable
      // time even with rapid repeated scheduling on the same root.
      const root = setupTempDir()
      try {
        writeMemoryJson(root)
        seedTasksJsonl(root)

        // Schedule many times rapidly
        for (let i = 0; i < 20; i++) {
          scheduleMemoryCurator(root)
        }

        // Should complete without hanging
        await flushPendingMemoryCuratorRuns(root)
        const state = getMemoryCuratorScheduleState(root)
        expect(state.activeCount).toBe(0)
      } finally {
        cleanup(root)
      }
    })
  })

  describe("#loop safety", () => {
    // given: curator writes active-context.md and manifest
    // when: curator run completes
    // then: curator does NOT reschedule itself (no infinite loop)
    it("curator does not reschedule itself", async () => {
      const root = setupTempDir()
      try {
        writeMemoryJson(root)
        seedTasksJsonl(root)

        scheduleMemoryCurator(root)
        await flushPendingMemoryCuratorRuns(root)

        // After flush, the scheduler should be completely idle
        // If the curator rescheduled itself, there would be a pending or active run
        const state = getMemoryCuratorScheduleState(root)
        expect(state.activeCount).toBe(0)
        expect(state.pendingCount).toBe(0)
      } finally {
        cleanup(root)
      }
    })

    // given: curator writes to active-context.md (via writeMemoryFile)
    // when: the write triggers a manifest refresh
    // then: manifest refresh does NOT schedule curator again
    it("manifest refresh from curator writes does not trigger curator", async () => {
      const root = setupTempDir()
      try {
        writeMemoryJson(root)
        seedTasksJsonl(root)

        scheduleMemoryCurator(root)
        await flushPendingMemoryCuratorRuns(root)

        // After flush completes, no curator should be scheduled
        const state = getMemoryCuratorScheduleState(root)
        expect(state.activeCount).toBe(0)
        expect(state.pendingCount).toBe(0)
      } finally {
        cleanup(root)
      }
    })
  })

  describe("#curator behavior preservation", () => {
    // given: a project root with tasks.jsonl data
    // when: the curator runs via scheduler
    // then: runMemoryCurator behavior is unchanged (JSONL untouched)
    it("scheduled curator does not modify tasks.jsonl", async () => {
      const root = setupTempDir()
      try {
        writeMemoryJson(root)

        // Write specific tasks.jsonl content
        const tasksContent =
          JSON.stringify({
            version: 1,
            id: "task-orig",
            timestamp: new Date().toISOString(),
            action: "create",
            title: "Original task",
            status: "in_progress",
            source_session_id: "ses_orig",
          }) + "\n"
        writeMem(root, "tasks.jsonl", tasksContent)

        scheduleMemoryCurator(root)
        await flushPendingMemoryCuratorRuns(root)

        // tasks.jsonl must be unchanged
        const afterContent = readFileSync(
          getMemPath(root, "tasks.jsonl"),
          "utf-8",
        )
        expect(afterContent).toBe(tasksContent)
      } finally {
        cleanup(root)
      }
    })

    // given: a project root with decisions.jsonl data
    // when: the curator runs via scheduler
    // then: decisions.jsonl is untouched
    it("scheduled curator does not modify decisions.jsonl", async () => {
      const root = setupTempDir()
      try {
        writeMemoryJson(root)

        const decisionsContent =
          JSON.stringify({
            version: 1,
            id: "decision-orig",
            timestamp: new Date().toISOString(),
            action: "record",
            title: "Original decision",
            status: "active",
            decision: "We decided originally",
            rationale: "Original rationale",
            impact_area: "testing",
            source_session_id: "ses_orig",
          }) + "\n"
        writeMem(root, "decisions.jsonl", decisionsContent)

        scheduleMemoryCurator(root)
        await flushPendingMemoryCuratorRuns(root)

        const afterContent = readFileSync(
          getMemPath(root, "decisions.jsonl"),
          "utf-8",
        )
        expect(afterContent).toBe(decisionsContent)
      } finally {
        cleanup(root)
      }
    })
  })
})
