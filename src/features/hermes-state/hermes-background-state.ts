import type { BackgroundTask, BackgroundTaskStatus } from "../background-agent/types"
import { HermesStateWriter } from "./hermes-state-writer"

const BACKGROUND_TASKS_FILE = "background-tasks.json"
const HISTORY_MAX = 500
const DEBOUNCE_MS = 500

interface HermesTaskEntry {
  id: string
  parentSessionId: string | null
  sessionId: string | null
  agent: string
  status: "queued" | "running" | "completed" | "error" | "cancelled"
  description: string
  queuedAt: string | null
  startedAt: string | null
  completedAt: string | null
  error: string | null
}

interface BackgroundTasksSchema {
  schema_version: number
  updated_at: string
  active: HermesTaskEntry[]
  history: HermesTaskEntry[]
  concurrency_limits: Record<string, number>
}

type TaskLifecycleEvent = "task.queued" | "task.started" | "task.completed" | "task.error" | "task.cancelled"

function mapStatus(status: BackgroundTaskStatus): HermesTaskEntry["status"] {
  switch (status) {
    case "pending": return "queued"
    case "running": return "running"
    case "completed": return "completed"
    case "error": return "error"
    case "cancelled": return "cancelled"
    case "interrupt": return "cancelled"
    default: return "queued"
  }
}

function taskToEntry(task: BackgroundTask): HermesTaskEntry {
  return {
    id: task.id,
    parentSessionId: task.parentSessionId ?? null,
    sessionId: task.sessionId ?? null,
    agent: task.agent,
    status: mapStatus(task.status),
    description: HermesStateWriter.truncateDescription(task.description),
    queuedAt: HermesStateWriter.toISO(task.queuedAt),
    startedAt: HermesStateWriter.toISO(task.startedAt),
    completedAt: HermesStateWriter.toISO(task.completedAt),
    error: task.error ? HermesStateWriter.truncateDescription(task.error, 200) : null,
  }
}

export class HermesBackgroundState {
  private writer: HermesStateWriter
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private pendingWrite = false
  private active: HermesTaskEntry[] = []
  private history: HermesTaskEntry[] = []
  private concurrencyLimits: Record<string, number> = {}
  private tasks: BackgroundTask[] = []

  constructor(projectRoot: string) {
    this.writer = new HermesStateWriter(projectRoot)
  }

  setConcurrencyLimits(limits: Record<string, number>): void {
    this.concurrencyLimits = limits
    this.scheduleWrite()
  }

  trackTask(task: BackgroundTask): void {
    this.tasks.push(task)
    this.rebuildAndWrite()
  }

  updateTask(task: BackgroundTask): void {
    const idx = this.tasks.findIndex((t) => t.id === task.id)
    if (idx !== -1) {
      this.tasks[idx] = task
    } else {
      this.tasks.push(task)
    }
    this.rebuildAndWrite()
  }

  private rebuildAndWrite(): void {
    this.active = []
    this.history = []
    for (const task of this.tasks) {
      const entry = taskToEntry(task)
      if (entry.status === "completed" || entry.status === "error" || entry.status === "cancelled") {
        this.history.push(entry)
      } else {
        this.active.push(entry)
      }
    }
    if (this.history.length > HISTORY_MAX) {
      this.history = this.history.slice(-HISTORY_MAX)
    }
    this.scheduleWrite()
  }

  private scheduleWrite(): void {
    this.pendingWrite = true
    if (this.debounceTimer) return
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      this.pendingWrite = false
      this.writeToDisk()
    }, DEBOUNCE_MS)
  }

  private writeToDisk(): void {
    const doc: BackgroundTasksSchema = {
      schema_version: 1,
      updated_at: new Date().toISOString(),
      active: this.active,
      history: this.history,
      concurrency_limits: this.concurrencyLimits,
    }
    this.writer.writeAtomically(BACKGROUND_TASKS_FILE, JSON.stringify(doc, null, 2))
  }

  /**
   * Flush any pending debounced write immediately.
   */
  flush(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    if (this.pendingWrite) {
      this.pendingWrite = false
      this.writeToDisk()
    }
  }

  // ── JSONL event emission ────────────────────────────────────────────────

  emitTaskEvent(event: TaskLifecycleEvent, task: BackgroundTask): void {
    const base = {
      type: event,
      timestamp: new Date().toISOString(),
      task_id: task.id,
      parent_session_id: task.parentSessionId ?? null,
      agent: task.agent,
    }
    let data: Record<string, unknown>
    switch (event) {
      case "task.queued":
        data = { ...base, description: HermesStateWriter.truncateDescription(task.description) }
        break
      case "task.started":
        data = { ...base, session_id: task.sessionId ?? null }
        break
      case "task.completed":
        data = {
          ...base,
          session_id: task.sessionId ?? null,
          duration_ms: task.startedAt && task.completedAt
            ? task.completedAt.getTime() - task.startedAt.getTime()
            : null,
        }
        break
      case "task.error":
        data = {
          ...base,
          session_id: task.sessionId ?? null,
          error: task.error ? HermesStateWriter.truncateDescription(task.error, 200) : null,
        }
        break
      case "task.cancelled":
        data = { ...base, session_id: task.sessionId ?? null }
        break
      default:
        data = base
    }
    const dateStr = new Date().toISOString().slice(0, 10)
    this.writer.appendJSONL(`events/events-${dateStr}.jsonl`, data)
  }
}
