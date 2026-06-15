import { log } from "../../shared"

/**
 * All wake event types emitted by the bus.
 *
 * - "wake:dispatched"  — a wake notification was dispatched into the parent session
 * - "wake:completed"   — the wake was acknowledged / processed by the parent
 * - "wake:failed"      — the wake dispatch failed (e.g., session gone, permission)
 * - "wake:retry"       — the wake is being retried after a transient failure
 */
export type WakeEventType =
  | "wake:dispatched"
  | "wake:completed"
  | "wake:failed"
  | "wake:retry"

/**
 * A single wake event emitted by the bus.
 */
export interface WakeEvent {
  type: WakeEventType
  sessionID: string
  timestamp: number
  metadata?: Record<string, unknown>
}

/**
 * Callback invoked when a wake event is emitted.
 * May be sync or async (Promise-returning).
 */
export type WakeEventCallback = (event: WakeEvent) => void | Promise<void>

/**
 * Public interface for the wake event bus.
 */
export interface WakeEventBus {
  /**
   * Subscribe to a specific wake event type.
   * Returns an unsubscribe function.
   */
  subscribe(eventType: WakeEventType, callback: WakeEventCallback): () => void

  /**
   * Emit a wake event to all subscribers of its type.
   * Awaits all callbacks (sync and async).
   * Errors in individual callbacks are caught and logged — one subscriber
   * failure never breaks other subscribers.
   */
  emit(event: WakeEvent): Promise<void>

  /**
   * Remove every subscription across all event types.
   */
  clear(): void
}

/**
 * Type-safe pub/sub EventEmitter for background-agent wake events.
 *
 * Each BackgroundManager owns its own WakeEventBus instance (NOT a global
 * singleton).  This keeps per-parent-session event wiring self-contained
 * and avoids stale subscribers leaking across test runs.
 */
export class WakeEventBusImpl implements WakeEventBus {
  private readonly subscribers: Map<WakeEventType, Set<WakeEventCallback>>

  constructor() {
    this.subscribers = new Map()
  }

  subscribe(eventType: WakeEventType, callback: WakeEventCallback): () => void {
    if (!this.subscribers.has(eventType)) {
      this.subscribers.set(eventType, new Set())
    }
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion — set just above
    this.subscribers.get(eventType)!.add(callback)

    return () => {
      this.subscribers.get(eventType)?.delete(callback)
    }
  }

  async emit(event: WakeEvent): Promise<void> {
    const callbacks = this.subscribers.get(event.type)
    if (!callbacks || callbacks.size === 0) return

    const tasks: Promise<void>[] = []
    for (const callback of callbacks) {
      tasks.push(
        (async () => {
          try {
            await callback(event)
          } catch (error) {
            log("[background-agent] WakeEventBus: subscriber error isolated", {
              eventType: event.type,
              sessionID: event.sessionID,
              error: error instanceof Error ? error.message : String(error),
            })
          }
        })(),
      )
    }
    await Promise.all(tasks)
  }

  clear(): void {
    this.subscribers.clear()
  }
}

/**
 * Factory for creating a WakeEventBus instance.
 */
export function createWakeEventBus(): WakeEventBus {
  return new WakeEventBusImpl()
}
