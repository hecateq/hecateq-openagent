import { createHash } from "node:crypto"
import { log } from "../../shared"

/**
 * Key identifying a unique parent-wake event for deduplication.
 * Composed of taskID + parentSessionID + completionStatus to prevent
 * the same task completion from triggering multiple wake dispatches
 * via different code paths (poll + event, retry + poll, etc.).
 *
 * Now uses SHA-256 hash of canonical fields for deterministic,
 * fixed-length keys that prevent unbounded growth from notification content.
 */
export type WakeDedupeKey = string

const DEFAULT_MAX_ENTRIES = 100
const DEFAULT_TTL_MS = 5 * 60 * 1000

/**
 * Persistence interface for crash-safe wake deduplication.
 *
 * When provided, the suppressor persists dispatched keys to a durable
 * store (e.g., file-based JSONL) so that a process restart does not
 * allow duplicate wake dispatches.
 */
export interface WakeDedupePersistence {
  /** Read all persisted keys. Called once at initialization and memoized. */
  readKeys(): Promise<string[]>
  /** Persist a newly dispatched key. Must be atomic (no partial writes). */
  addKey(key: string): Promise<void>
  /** Whether the persistence layer is currently available. */
  isAvailable(): boolean
}

/**
 * Per-instance duplicate wake suppressor.
 *
 * Prevents the same background-task completion from triggering
 * multiple parent-wake dispatches. Poll completions and event-driven
 * completions can both fire for the same task; this suppressor
 * ensures only the first attempt dispatches.
 *
 * Supports optional crash-safe persistence: when a WakeDedupePersistence
 * implementation is provided, dispatched keys survive process restarts
 * and the suppressor will consult the backing store on initialization.
 *
 * NOT a global singleton — each BackgroundManager owns its own instance.
 */
export class WakeDuplicateSuppressor {
  private readonly dispatched: Map<WakeDedupeKey, number>
  private readonly maxEntries: number
  private readonly ttlMs: number
  private readonly persistence?: WakeDedupePersistence
  private persistedKeysMemo: Set<string> | null = null
  private persistencePopulated = false

  constructor(options?: { maxEntries?: number; ttlMs?: number; persistence?: WakeDedupePersistence }) {
    this.dispatched = new Map()
    this.maxEntries = options?.maxEntries ?? DEFAULT_MAX_ENTRIES
    this.ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS
    this.persistence = options?.persistence
  }

  /**
   * Build a SHA-256 based deduplication key from task metadata.
   * The key is a deterministic hash of the canonical fields (taskID,
   * parentSessionID, completionStatus), producing a fixed-length
   * 64-character hex string prefixed with "sha256:".
   */
  static buildKey(taskID: string, parentSessionID: string, completionStatus: string): WakeDedupeKey {
    const canonicalPayload = JSON.stringify({
      taskID,
      parentSessionID,
      completionStatus,
    })
    return `sha256:${createHash("sha256").update(canonicalPayload).digest("hex")}`
  }

  /**
   * Check whether a wake for the given key should be dispatched.
   * Returns false if a wake with the same key was already dispatched
   * and hasn't expired. Also consults persistent backing if configured.
   */
  async shouldDispatch(key: WakeDedupeKey): Promise<boolean> {
    this.pruneExpired()
    if (this.dispatched.has(key)) return false

    if (this.persistence?.isAvailable()) {
      await this.ensurePersistenceLoaded()
      if (this.persistedKeysMemo?.has(key)) return false
    }

    return true
  }

  /**
   * Synchronous variant of shouldDispatch that only checks in-memory state.
   * Does not consult persistent backing. Used in hot paths where async is
   * not available (e.g., parent-wake-notifier queuePendingParentWake).
   */
  shouldDispatchSync(key: WakeDedupeKey): boolean {
    this.pruneExpired()
    return !this.dispatched.has(key)
  }

  /**
   * Record that a wake was dispatched for the given key.
   * Evicts the oldest entry if the cache exceeds maxEntries.
   * Also persists to backing store if configured.
   */
  async markDispatched(key: WakeDedupeKey): Promise<void> {
    this.pruneExpired()
    this.dispatched.set(key, Date.now())

    if (this.dispatched.size > this.maxEntries) {
      const oldestKey = this.dispatched.keys().next().value
      if (oldestKey !== undefined) {
        this.dispatched.delete(oldestKey)
      }
    }

    // Persist to backing store (best-effort: failure logs but does not block)
    if (this.persistence?.isAvailable()) {
      try {
        await this.persistence.addKey(key)
        await this.ensurePersistenceLoaded()
        this.persistedKeysMemo?.add(key)
      } catch (err) {
        log("[background-agent] WakeDuplicateSuppressor: persistence addKey failed", {
          key,
          error: String(err),
        })
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

  /** Whether crash-safe persistence is configured. */
  get hasPersistence(): boolean {
    return this.persistence?.isAvailable() ?? false
  }

  private async ensurePersistenceLoaded(): Promise<void> {
    if (this.persistencePopulated) return
    if (!this.persistence?.isAvailable()) return

    try {
      const keys = await this.persistence.readKeys()
      this.persistedKeysMemo = new Set(keys)
      this.persistencePopulated = true
    } catch (err) {
      log("[background-agent] WakeDuplicateSuppressor: persistence readKeys failed, falling back to in-memory only", {
        error: String(err),
      })
      this.persistedKeysMemo = new Set()
      this.persistencePopulated = true
    }
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
  persistence?: WakeDedupePersistence
}): WakeDuplicateSuppressor {
  return new WakeDuplicateSuppressor(options)
}
