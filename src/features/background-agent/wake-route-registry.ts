import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from "node:fs"
import { dirname } from "node:path"
import { log } from "../../shared"
import type { ParentWakePromptContext } from "./parent-wake-notifier"

/**
 * A resolved route for delivering a parent-wake notification.
 * Contains the session ID and the prompt context (agent, model, tools)
 * needed to dispatch the wake into the correct session.
 */
export interface WakeRoute {
  sessionID: string
  promptContext: ParentWakePromptContext
  registeredAt: number
}

const DEFAULT_TTL_MS = 10 * 60 * 1000

/**
 * Per-instance wake route registry.
 *
 * Maps parent session IDs to their WakeRoute, enabling reliable
 * wake delivery even when the parent session has moved or changed
 * identity (e.g., after compaction or session migration).
 *
 * Routes have a TTL; stale routes are evicted on access.
 * If no live route is found, the caller falls back to the existing
 * ParentWakeNotifier path.
 *
 * NOT a global singleton — each BackgroundManager owns its own instance.
 */
export class WakeRouteRegistry {
  private readonly routes: Map<string, WakeRoute>
  private readonly ttlMs: number

  constructor(options?: { ttlMs?: number }) {
    this.routes = new Map()
    this.ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS
  }

  /**
   * Register a route for a parent session.
   * Overwrites any existing route for the same session.
   */
  registerRoute(sessionID: string, route: Omit<WakeRoute, "registeredAt">): void {
    this.routes.set(sessionID, {
      ...route,
      registeredAt: Date.now(),
    })
    log("[background-agent] WakeRouteRegistry: registered route", {
      sessionID,
      routeSessionID: route.sessionID,
    })
  }

  /**
   * Resolve the current route for a parent session.
   * Returns undefined if no route is registered or if the route has expired.
   */
  resolveRoute(sessionID: string): WakeRoute | undefined {
    const route = this.routes.get(sessionID)
    if (!route) return undefined

    if (Date.now() - route.registeredAt > this.ttlMs) {
      this.routes.delete(sessionID)
      log("[background-agent] WakeRouteRegistry: route expired", {
        sessionID,
        ageMs: Date.now() - route.registeredAt,
      })
      return undefined
    }

    return route
  }

  /**
   * Remove a route for a session.
   */
  removeRoute(sessionID: string): void {
    this.routes.delete(sessionID)
  }

  /**
   * Clear all registered routes.
   */
  clear(): void {
    this.routes.clear()
  }

  /**
   * Current number of registered routes.
   */
  get size(): number {
    return this.routes.size
  }

  /**
   * Returns all registered routes as [sessionID, WakeRoute] pairs.
   * Used by persistence wrappers to snapshot state.
   */
  entries(): Array<[string, WakeRoute]> {
    return Array.from(this.routes.entries())
  }
}

/**
 * Factory for creating a WakeRouteRegistry instance.
 */
export function createWakeRouteRegistry(options?: {
  ttlMs?: number
}): WakeRouteRegistry {
  return new WakeRouteRegistry(options)
}

interface SerializedRoute {
  sessionID: string
  promptContext: ParentWakePromptContext
  registeredAt: number
}

export interface PersistentWakeRouteRegistryOptions {
  ttlMs?: number
  persistPath: string
}

export function createPersistentWakeRouteRegistry(
  options: PersistentWakeRouteRegistryOptions
): WakeRouteRegistry {
  const inner = new WakeRouteRegistry({ ttlMs: options.ttlMs })
  const persistPath = options.persistPath
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS

  function isSerializedRoute(value: unknown): value is SerializedRoute {
    if (value === null || typeof value !== "object") return false
    const v = value as Record<string, unknown>
    return (
      typeof v.sessionID === "string" &&
      typeof v.registeredAt === "number" &&
      typeof v.promptContext === "object" &&
      v.promptContext !== null
    )
  }

  function save(): void {
    try {
      const entries = inner.entries()
      const data: SerializedRoute[] = entries.map(([sessionID, route]) => ({
        sessionID,
        promptContext: route.promptContext,
        registeredAt: route.registeredAt,
      }))

      const dir = dirname(persistPath)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }

      const tmpPath = `${persistPath}.tmp`
      writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8")
      renameSync(tmpPath, persistPath)
    } catch (err) {
      log("[background-agent] PersistentWakeRouteRegistry: save error", {
        error: String(err),
      })
    }
  }

  function load(): void {
    try {
      if (!existsSync(persistPath)) return

      const raw = readFileSync(persistPath, "utf-8")
      const parsed: unknown = JSON.parse(raw)

      if (!Array.isArray(parsed)) {
        log(
          "[background-agent] PersistentWakeRouteRegistry: invalid JSON structure, starting fresh"
        )
        return
      }

      const now = Date.now()

      for (const item of parsed) {
        if (!isSerializedRoute(item)) continue

        if (now - item.registeredAt > ttlMs) {
          log(
            "[background-agent] PersistentWakeRouteRegistry: skipping stale route on load",
            { sessionID: item.sessionID, ageMs: now - item.registeredAt }
          )
          continue
        }

        inner.registerRoute(item.sessionID, {
          sessionID: item.sessionID,
          promptContext: item.promptContext,
        })
      }
    } catch (err) {
      log("[background-agent] PersistentWakeRouteRegistry: load error", {
        error: String(err),
      })
    }
  }

  load()

  const originalRegister = inner.registerRoute.bind(inner)
  const originalRemove = inner.removeRoute.bind(inner)
  const originalClear = inner.clear.bind(inner)

  inner.registerRoute = (
    sessionID: string,
    route: Omit<WakeRoute, "registeredAt">
  ): void => {
    originalRegister(sessionID, route)
    save()
  }

  inner.removeRoute = (sessionID: string): void => {
    originalRemove(sessionID)
    save()
  }

  inner.clear = (): void => {
    originalClear()
    save()
  }

  return inner
}
