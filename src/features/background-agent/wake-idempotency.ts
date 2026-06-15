import { log } from "../../shared"

/**
 * Key identifying a unique parent-wake event for deduplication.
 * Composed of taskID + parentSessionID + completionStatus to prevent
 * the same task completion from triggering multiple wake dispatches
 * via different code paths (poll + event, retry + poll, etc.).
 */
export type WakeDedupeKey = string

const DEFAULT_MAX_ENTRIES = 100
const DEFAULT_TTL_MS = 5 * 60 * 1000

/**
 * Per-instance duplicate wake suppressor.
 *
 * Prevents the same background-task completion from triggering
 * multiple parent-wake dispatches. Poll completions and event-driven
 * completions can both fire for the same task; this suppressor
 * ensures only the first attempt dispatches.
 *
 * NOT a global singleton — each BackgroundManager owns its own instance.
 */
export class WakeDuplicateSuppressor {
  private readonly dispatched: Map<WakeDedupeKey, number>
  private readonly maxEntries: number
  private readonly ttlMs: number

  constructor(options?: { maxEntries?: number; ttlMs?: number }) {
    this.dispatched = new Map()
    this.maxEntries = options?.maxEntries ?? DEFAULT_MAX_ENTRIES
    this.ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS
  }

  /**
   * Build a deduplication key from task metadata.
   */
  static buildKey(taskID: string, parentSessionID: string, completionStatus: string): WakeDedupeKey {
    return `${taskID}:${parentSessionID}:${completionStatus}`
  }

  /**
   * Check whether a wake for the given key should be dispatched.
   * Returns false if a wake with the same key was already dispatched
   * and hasn't expired.
   */
  shouldDispatch(key: WakeDedupeKey): boolean {
    this.pruneExpired()
    return !this.dispatched.has(key)
  }

  /**
   * Record that a wake was dispatched for the given key.
   * Evicts the oldest entry if the cache exceeds maxEntries.
   */
  markDispatched(key: WakeDedupeKey): void {
    this.pruneExpired()
    this.dispatched.set(key, Date.now())

    if (this.dispatched.size > this.maxEntries) {
      const oldestKey = this.dispatched.keys().next().value
      if (oldestKey !== undefined) {
        this.dispatched.delete(oldestKey)
      }
    }
  }

  /**
   * Remove a specific key from the dispatched set.
   */
  clear(key: WakeDedupeKey): void {
    this.dispatched.delete(key)
  }

  /**
   * Remove all tracked entries.
   */
  clearAll(): void {
    this.dispatched.clear()
  }

  /**
   * Current count of tracked entries.
   */
  get size(): number {
    this.pruneExpired()
    return this.dispatched.size
  }

  private pruneExpired(): void {
    const now = Date.now()
    for (const [key, timestamp] of this.dispatched) {
      if (now - timestamp > this.ttlMs) {
        this.dispatched.delete(key)
        log("[background-agent] WakeDuplicateSuppressor: expired dedupe entry", {
          key,
          ageMs: now - timestamp,
        })
      }
    }
  }
}

/**
 * Factory for creating a WakeDuplicateSuppressor instance.
 */
export function createWakeDuplicateSuppressor(options?: {
  maxEntries?: number
  ttlMs?: number
}): WakeDuplicateSuppressor {
  return new WakeDuplicateSuppressor(options)
}
