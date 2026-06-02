import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"

import { log } from "./logger"
import { PROJECT_MEMORY_DIR } from "./memory-bootstrap"
import {
  canWriteMemoryFile,
  type WriterIdentity,
} from "./memory-writer-ownership"
import { writeFileAtomically } from "./write-file-atomically"
import { pruneJsonlFileByLimits } from "./jsonl-retention"
import {
  TASKS_JSONL_MAX_LINES,
  TASKS_JSONL_MAX_BYTES,
} from "./memory-retention-policy"
import { refreshManifestAfterWrite } from "./memory-manifest-updater"

// ---------------------------------------------------------------------------
// Phase 4B / 4B.1: Auto-render guard with queued follow-up
// ---------------------------------------------------------------------------

/**
 * Guards against concurrent renders of tasks.md for the same project root.
 * Implements queued follow-up rendering: when a JSONL write occurs during an
 * active render, a follow-up is queued. The render loop drains pending until
 * no pending remains — every successful JSONL write eventually results in an
 * updated tasks.md.
 *
 * No infinite render loops: renders write tasks.md, not tasks.jsonl. Only
 * appendTaskEntry() (called from external code) can set the pending flag.
 * The drain loop terminates when no new writes occur during a render pass.
 *
 * No render is triggered for duplicate/no-op JSONL appends.
 * Render failures never block JSONL writes.
 */
const _activeTaskRender = new Set<string>()
const _pendingTaskRerender = new Set<string>()

/**
 * Runs one render pass for tasks.md, then drains any follow-up renders
 * queued by writes that occurred during this pass. Recurses until no
 * pending writes remain. Bounded by maxDepth (128) as a circuit breaker.
 *
 * Renders never write tasks.jsonl → cannot self-sustain → loop terminates
 * naturally when external writes stop.
 */
function _renderTaskDrain(projectRoot: string, depth = 0): void {
  const MAX_DEPTH = 128
  if (depth >= MAX_DEPTH) {
    log("task-state-memory: Render drain depth limit reached", { projectRoot, depth })
    _activeTaskRender.delete(projectRoot)
    _pendingTaskRerender.delete(projectRoot)
    return
  }

  import("./memory-curated-renderer")
    .then(({ renderTasksMarkdownFromJsonl }) =>
      renderTasksMarkdownFromJsonl(projectRoot),
    )
    .catch((err) => {
      log("task-state-memory: Auto-render tasks.md failed", {
        projectRoot,
        depth,
        error: err instanceof Error ? err.message : String(err),
      })
    })
    .finally(() => {
      if (_pendingTaskRerender.has(projectRoot)) {
        // Follow-up needed — drain pending and recurse
        _pendingTaskRerender.delete(projectRoot)
        _renderTaskDrain(projectRoot, depth + 1)
      } else {
        // No pending writes — drain complete
        _activeTaskRender.delete(projectRoot)
      }
    })
}

/**
 * Internal helper: starts the render drain loop for tasks.md.
 * Only called when _activeTaskRender does NOT already contain the root.
 */
function _startTaskRender(projectRoot: string): void {
  _activeTaskRender.add(projectRoot)
  _renderTaskDrain(projectRoot)
}

/**
 * Writer identity for the task state memory module.
 * This module writes tasks.jsonl and is owned by task_completion_writer.
 * @see src/shared/memory-writer-ownership.ts
 */
export const TASK_STATE_WRITER_IDENTITY: WriterIdentity = "task_completion_writer"

export const TASK_STATE_MEMORY_FILENAME = "tasks.jsonl"

export const DEFAULT_STALE_TASK_HOURS = 24

export const TASK_STATUSES = [
  "planned",
  "in_progress",
  "blocked",
  "completed",
  "cancelled",
  "stale",
] as const

export type TaskStatus = (typeof TASK_STATUSES)[number]

export const TASK_ACTIONS = [
  "create",
  "update",
  "complete",
  "block",
  "unblock",
  "cancel",
  "mark_stale",
] as const

export type TaskAction = (typeof TASK_ACTIONS)[number]

export const PRIORITY_LEVELS = ["low", "medium", "high", "critical"] as const

export type PriorityLevel = (typeof PRIORITY_LEVELS)[number]

export const TaskStateEntrySchema = z.object({
  version: z.literal(1),
  id: z.string().min(1),
  timestamp: z.string().datetime(),
  action: z.enum(TASK_ACTIONS),
  title: z.string().min(1),
  status: z.enum(TASK_STATUSES),
  priority: z.enum(PRIORITY_LEVELS).optional(),
  owner_agent: z.string().optional(),
  source_session_id: z.string().optional(),
  related_sessions: z.array(z.string()).optional(),
  dependencies: z.array(z.string()).optional(),
  blockers: z.array(z.string()).optional(),
  changed_files: z.array(z.string()).optional(),
  verification: z.string().optional(),
  next_action: z.string().optional(),
  notes: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export type TaskStateEntry = z.infer<typeof TaskStateEntrySchema>

function getTaskStatePath(projectRoot: string): string {
  return join(projectRoot, PROJECT_MEMORY_DIR, TASK_STATE_MEMORY_FILENAME)
}

function contentHash(entry: TaskStateEntry): string {
  const { timestamp: _ts, ...rest } = entry
  const serialized = JSON.stringify(rest)
  let hash = 0
  for (let i = 0; i < serialized.length; i++) {
    const ch = serialized.charCodeAt(i)
    hash = ((hash << 5) - hash) + ch
    hash |= 0
  }
  return hash.toString(36)
}

export function readTaskState(projectRoot: string): TaskStateEntry[] | null {
  const filePath = getTaskStatePath(projectRoot)

  if (!existsSync(filePath)) return null

  try {
    const raw = readFileSync(filePath, "utf-8")
    if (raw.trim().length === 0) return []

    const lines = raw.split("\n")
    const entries: TaskStateEntry[] = []
    let malformedCount = 0

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      if (line.length === 0) continue

      try {
        const parsed = JSON.parse(line)
        const result = TaskStateEntrySchema.safeParse(parsed)
        if (result.success) {
          entries.push(result.data)
        } else {
          malformedCount++
          log(
            "task-state-memory: Skipping malformed JSONL line",
            { line: i + 1, errors: result.error.flatten() },
          )
        }
      } catch {
        malformedCount++
        log("task-state-memory: Skipping invalid JSON line", { line: i + 1 })
      }
    }

    if (malformedCount > 0) {
      log("task-state-memory: Skipped malformed lines", {
        malformedCount,
        totalLines: lines.length,
      })
    }

    return entries
  } catch (error) {
    log("task-state-memory: Failed to read file", {
      projectRoot,
      error: error instanceof Error ? error.message : String(error),
    })
    return []
  }
}

export function appendTaskEntry(
  projectRoot: string,
  entry: TaskStateEntry,
  writer?: WriterIdentity,
): boolean {
  // Phase 3A: Ownership guard — best-effort, skip+log on violation
  const effectiveWriter = writer ?? TASK_STATE_WRITER_IDENTITY
  const ownershipCheck = canWriteMemoryFile(effectiveWriter, TASK_STATE_MEMORY_FILENAME)
  if (!ownershipCheck.authorized) {
    log("task-state-memory: Ownership violation — write skipped", {
      writer: effectiveWriter,
      file: TASK_STATE_MEMORY_FILENAME,
      reason: ownershipCheck.reason,
    })
    return false
  }

  const filePath = getTaskStatePath(projectRoot)

  TaskStateEntrySchema.parse(entry)

  try {
    let existing: TaskStateEntry[] = []
    if (existsSync(filePath)) {
      try {
        const raw = readFileSync(filePath, "utf-8")
        if (raw.trim().length > 0) {
          existing = raw
            .split("\n")
            .filter((l) => l.trim().length > 0)
            .map((l) => {
              try {
                const parsed = JSON.parse(l)
                const result = TaskStateEntrySchema.safeParse(parsed)
                return result.success ? result.data : null
              } catch {
                return null
              }
            })
            .filter((e): e is TaskStateEntry => e !== null)
        }
      } catch {
        // proceed with append even if read fails
      }
    }

    const newHash = contentHash(entry)
    const latestForId = existing
      .filter((e) => e.id === entry.id)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0]

    if (latestForId && contentHash(latestForId) === newHash) {
      return false
    }

    const line = JSON.stringify(entry) + "\n"
    const existingContent = existsSync(filePath)
      ? readFileSync(filePath, "utf-8")
      : ""

    writeFileAtomically(filePath, existingContent + line)

    // Phase 6: JSONL retention — prune tasks.jsonl when line/byte thresholds exceeded.
    // Best-effort only; pruning failure never blocks append or render.
    try {
      const pruning = pruneJsonlFileByLimits(filePath, {
        maxLines: TASKS_JSONL_MAX_LINES,
        maxBytes: TASKS_JSONL_MAX_BYTES,
        preserveNewest: true,
      })
      if (pruning.pruned) {
        refreshManifestAfterWrite(projectRoot, filePath)
      }
    } catch {
      // best-effort — never block append
    }

    // Phase 4B.1: Auto-render tasks.md after successful JSONL write.
    // Implements queued follow-up rendering:
    // - If no render active: start render immediately.
    // - If render active: mark pending rerender (at most one follow-up).
    // - When active render finishes and pending is set: run exactly one follow-up.
    // - Follow-up render does NOT chain further.
    // Best-effort, fire-and-forget — never throws, never blocks caller.
    // Dynamic import avoids circular dependency with memory-curated-renderer.
    if (!_activeTaskRender.has(projectRoot)) {
      _activeTaskRender.add(projectRoot)
      _startTaskRender(projectRoot)
    } else {
      _pendingTaskRerender.add(projectRoot)
    }

    return true
  } catch (error) {
    log("task-state-memory: Failed to append entry", {
      projectRoot,
      taskId: entry.id,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

export function resolveLatestTaskState(
  entries: TaskStateEntry[],
): Map<string, TaskStateEntry> {
  const latest = new Map<string, TaskStateEntry>()

  for (const entry of entries) {
    const existing = latest.get(entry.id)
    if (!existing || entry.timestamp >= existing.timestamp) {
      latest.set(entry.id, entry)
    }
  }

  return latest
}

export interface TaskStateSummary {
  totalTasks: number
  byStatus: Record<TaskStatus, number>
  active: TaskStateEntry[]
  blocked: TaskStateEntry[]
  recentlyCompleted: TaskStateEntry[]
  nextActions: TaskStateEntry[]
}

export function buildCompactTaskSummary(
  entries: TaskStateEntry[],
  recentCount = 5,
): TaskStateSummary {
  const latest = resolveLatestTaskState(entries)
  const allTasks = [...latest.values()]

  const byStatus: Record<TaskStatus, number> = {
    planned: 0,
    in_progress: 0,
    blocked: 0,
    completed: 0,
    cancelled: 0,
    stale: 0,
  }

  const active: TaskStateEntry[] = []
  const blocked: TaskStateEntry[] = []
  const completed: TaskStateEntry[] = []
  const nextActions: TaskStateEntry[] = []

  for (const task of allTasks) {
    byStatus[task.status] = (byStatus[task.status] || 0) + 1

    if (task.status === "in_progress") active.push(task)
    if (task.status === "blocked") blocked.push(task)
    if (task.status === "completed") completed.push(task)
    if (task.next_action) nextActions.push(task)
  }

  completed.sort((a, b) => b.timestamp.localeCompare(a.timestamp))

  return {
    totalTasks: allTasks.length,
    byStatus,
    active,
    blocked,
    recentlyCompleted: completed.slice(0, recentCount),
    nextActions,
  }
}

export function formatTaskSummary(summary: TaskStateSummary): string {
  const parts: string[] = []

  const baseLine =
    `Tasks: ${summary.byStatus.planned} planned, ${summary.byStatus.in_progress} in_progress, ${summary.byStatus.blocked} blocked, ${summary.byStatus.completed} completed` +
    (summary.byStatus.stale > 0 ? `, ${summary.byStatus.stale} stale` : "") +
    (summary.byStatus.cancelled > 0 ? `, ${summary.byStatus.cancelled} cancelled` : "")

  parts.push(baseLine)

  if (summary.active.length > 0) {
    parts.push("Active:")
    for (const t of summary.active) {
      const prio = t.priority ? ` [${t.priority}]` : ""
      parts.push(`  - ${t.id}: ${t.title}${prio}`)
    }
  }

  if (summary.blocked.length > 0) {
    parts.push("Blocked:")
    for (const t of summary.blocked) {
      const blockerList = t.blockers?.length
        ? ` (blocked by: ${t.blockers.join(", ")})`
        : ""
      parts.push(`  - ${t.id}: ${t.title}${blockerList}`)
    }
  }

  if (summary.recentlyCompleted.length > 0) {
    parts.push("Recently Completed:")
    for (const t of summary.recentlyCompleted) {
      parts.push(`  - ${t.id}: ${t.title}`)
    }
  }

  if (summary.nextActions.length > 0) {
    parts.push("Next Actions:")
    for (const t of summary.nextActions) {
      parts.push(`  - [${t.id}] ${t.next_action}`)
    }
  }

  return parts.join("\n")
}

export function detectStaleTasks(
  entries: TaskStateEntry[],
  staleThresholdHours = DEFAULT_STALE_TASK_HOURS,
): TaskStateEntry[] {
  const latest = resolveLatestTaskState(entries)
  const staleThresholdMs = staleThresholdHours * 60 * 60 * 1000
  const now = Date.now()

  const stale: TaskStateEntry[] = []

  for (const [, entry] of latest) {
    if (entry.status !== "in_progress") continue
    const ageMs = now - new Date(entry.timestamp).getTime()
    if (ageMs > staleThresholdMs) {
      stale.push(entry)
    }
  }

  return stale
}

export function detectBlockedTasks(
  entries: TaskStateEntry[],
): TaskStateEntry[] {
  const latest = resolveLatestTaskState(entries)
  const blocked: TaskStateEntry[] = []

  for (const [, entry] of latest) {
    if (entry.status === "blocked") {
      blocked.push(entry)
    }
  }

  return blocked
}

// ---------------------------------------------------------------------------
// Phase 4B.1: Observability helpers (test/internal use)
// ---------------------------------------------------------------------------

/**
 * Returns the current render guard state for tasks.md auto-render.
 * For observability/testing only — do not use in production paths.
 */
export function getTaskRenderGuardState(): {
  active: string[]
  pending: string[]
} {
  return {
    active: [..._activeTaskRender],
    pending: [..._pendingTaskRerender],
  }
}

/**
 * Flushes pending task renders by polling microtask queue until the
 * active render set is empty. Caps at 20 microtask layers to prevent
 * infinite waits in edge cases.
 *
 * For test/internal use only — production writes are fire-and-forget.
 */
export async function flushPendingTaskRenders(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await new Promise<void>((r) => queueMicrotask(r))
    if (_activeTaskRender.size === 0) return
  }
}
