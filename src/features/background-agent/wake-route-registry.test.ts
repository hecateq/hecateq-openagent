import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { tmpdir } from "node:os"
import {
  WakeRouteRegistry,
  createWakeRouteRegistry,
  createPersistentWakeRouteRegistry,
  type WakeRoute,
} from "./wake-route-registry"

describe("WakeRouteRegistry", () => {
  describe("registerRoute", () => {
    test("registers a route that can be resolved", () => {
      // given
      const registry = createWakeRouteRegistry()

      // when
      registry.registerRoute("parent-ses-1", {
        sessionID: "parent-ses-1",
        promptContext: { agent: "sisyphus" },
      })

      // then
      const route = registry.resolveRoute("parent-ses-1")
      expect(route).toBeDefined()
      expect(route!.sessionID).toBe("parent-ses-1")
      expect(route!.promptContext.agent).toBe("sisyphus")
    })

    test("overwrites existing route for same session", () => {
      // given
      const registry = createWakeRouteRegistry()
      registry.registerRoute("parent-ses-1", {
        sessionID: "parent-ses-1",
        promptContext: { agent: "sisyphus" },
      })

      // when
      registry.registerRoute("parent-ses-1", {
        sessionID: "parent-ses-1",
        promptContext: { agent: "hephaestus" },
      })

      // then
      const route = registry.resolveRoute("parent-ses-1")
      expect(route!.promptContext.agent).toBe("hephaestus")
    })
  })

  describe("resolveRoute", () => {
    test("returns undefined for unregistered session", () => {
      // given
      const registry = createWakeRouteRegistry()

      // when
      const route = registry.resolveRoute("nonexistent")

      // then
      expect(route).toBeUndefined()
    })

    test("returns route with registeredAt timestamp set", () => {
      // given
      const registry = createWakeRouteRegistry()
      registry.registerRoute("parent-ses-1", {
        sessionID: "parent-ses-1",
        promptContext: {},
      })

      // when
      const route = registry.resolveRoute("parent-ses-1")

      // then
      expect(route).toBeDefined()
      expect(typeof route!.registeredAt).toBe("number")
      expect(route!.registeredAt).toBeGreaterThan(0)
    })
  })

  describe("removeRoute", () => {
    test("removes a registered route", () => {
      // given
      const registry = createWakeRouteRegistry()
      registry.registerRoute("parent-ses-1", {
        sessionID: "parent-ses-1",
        promptContext: {},
      })

      // when
      registry.removeRoute("parent-ses-1")

      // then
      expect(registry.resolveRoute("parent-ses-1")).toBeUndefined()
      expect(registry.size).toBe(0)
    })

    test("is a no-op for unregistered session", () => {
      // given
      const registry = createWakeRouteRegistry()

      // when
      registry.removeRoute("nonexistent")

      // then — should not throw
      expect(registry.size).toBe(0)
    })
  })

  describe("clear", () => {
    test("removes all routes", () => {
      // given
      const registry = createWakeRouteRegistry()
      registry.registerRoute("a", { sessionID: "a", promptContext: {} })
      registry.registerRoute("b", { sessionID: "b", promptContext: {} })

      // when
      registry.clear()

      // then
      expect(registry.size).toBe(0)
      expect(registry.resolveRoute("a")).toBeUndefined()
      expect(registry.resolveRoute("b")).toBeUndefined()
    })
  })

  describe("size", () => {
    test("reflects number of registered routes", () => {
      // given
      const registry = createWakeRouteRegistry()

      // when
      registry.registerRoute("a", { sessionID: "a", promptContext: {} })
      registry.registerRoute("b", { sessionID: "b", promptContext: {} })

      // then
      expect(registry.size).toBe(2)
    })
  })

  describe("TTL expiry", () => {
    let originalNow: () => number
    let fakeTime: number

    beforeEach(() => {
      originalNow = Date.now.bind(Date)
      fakeTime = 1700000000000
      Date.now = () => fakeTime
    })

    afterEach(() => {
      Date.now = originalNow
    })

    function advanceTime(ms: number): void {
      fakeTime += ms
    }

    test("routes expire after TTL", () => {
      // given
      const registry = createWakeRouteRegistry({ ttlMs: 5000 })
      registry.registerRoute("parent-ses-1", {
        sessionID: "parent-ses-1",
        promptContext: {},
      })

      // when — within TTL
      advanceTime(3000)
      expect(registry.resolveRoute("parent-ses-1")).toBeDefined()

      // when — after TTL
      advanceTime(3000)
      expect(registry.resolveRoute("parent-ses-1")).toBeUndefined()
    })

    test("size reflects expired route removal", () => {
      // given
      const registry = createWakeRouteRegistry({ ttlMs: 1000 })
      registry.registerRoute("x", { sessionID: "x", promptContext: {} })

      // when — advance past TTL and resolve (which triggers eviction)
      advanceTime(2000)
      registry.resolveRoute("x")

      // then
      expect(registry.size).toBe(0)
    })
  })

  describe("factory", () => {
    test("createWakeRouteRegistry returns an instance", () => {
      const registry = createWakeRouteRegistry()
      expect(registry).toBeInstanceOf(WakeRouteRegistry)
    })

    test("factory accepts options", () => {
      const registry = createWakeRouteRegistry({ ttlMs: 30000 })
      expect(registry).toBeInstanceOf(WakeRouteRegistry)
    })
  })

  describe("route content", () => {
    test("preserves full promptContext", () => {
      // given
      const registry = createWakeRouteRegistry()
      const context = {
        agent: "sisyphus",
        model: { providerID: "anthropic", modelID: "claude-sonnet-4-6" },
        tools: { task: true },
      }

      // when
      registry.registerRoute("parent-ses-1", {
        sessionID: "parent-ses-1",
        promptContext: context,
      })

      // then
      const route = registry.resolveRoute("parent-ses-1")
      expect(route!.promptContext).toEqual(context)
    })
  })
})

describe("createPersistentWakeRouteRegistry", () => {
  let testDir: string

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "wake-route-test-"))
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  function persistPath(filename = "wake-routes.json"): string {
    return join(testDir, ".omo", "background-agent", filename)
  }

  function writePersistFile(filename: string, data: unknown): void {
    const path = persistPath(filename)
    const dir = dirname(path)
    mkdirSync(dir, { recursive: true })
    writeFileSync(path, JSON.stringify(data, null, 2), "utf-8")
  }

  function readPersistFile(filename: string): unknown {
    return JSON.parse(readFileSync(persistPath(filename), "utf-8"))
  }

  describe("load on construction", () => {
    test("loads existing routes from persisted file", () => {
      // given — a persisted file with two routes
      writePersistFile("wake-routes.json", [
        {
          sessionID: "ses-a",
          promptContext: { agent: "sisyphus" },
          registeredAt: Date.now() - 1000,
        },
        {
          sessionID: "ses-b",
          promptContext: { agent: "hephaestus" },
          registeredAt: Date.now() - 500,
        },
      ])

      // when
      const registry = createPersistentWakeRouteRegistry({
        persistPath: persistPath(),
      })

      // then
      expect(registry.size).toBe(2)
      expect(registry.resolveRoute("ses-a")).toBeDefined()
      expect(registry.resolveRoute("ses-a")!.promptContext.agent).toBe("sisyphus")
      expect(registry.resolveRoute("ses-b")).toBeDefined()
    })

    test("cleans stale entries on load", () => {
      // given — a file with one fresh and one stale route
      const now = Date.now()
      writePersistFile("wake-routes.json", [
        {
          sessionID: "fresh",
          promptContext: {},
          registeredAt: now - 1000,
        },
        {
          sessionID: "stale",
          promptContext: {},
          registeredAt: now - 700_000,
        },
      ])

      // when — TTL is 5 minutes (300_000 ms), so stale route expires
      const registry = createPersistentWakeRouteRegistry({
        persistPath: persistPath(),
        ttlMs: 300_000,
      })

      // then
      expect(registry.size).toBe(1)
      expect(registry.resolveRoute("fresh")).toBeDefined()
      expect(registry.resolveRoute("stale")).toBeUndefined()
    })
  })

  describe("persist on mutation", () => {
    test("persists after registerRoute", () => {
      // given
      const registry = createPersistentWakeRouteRegistry({
        persistPath: persistPath(),
      })

      // when
      registry.registerRoute("ses-1", {
        sessionID: "ses-1",
        promptContext: { agent: "sisyphus" },
      })

      // then
      const data = readPersistFile("wake-routes.json") as Array<Record<string, unknown>>
      expect(data).toHaveLength(1)
      expect(data[0].sessionID).toBe("ses-1")
      expect((data[0].promptContext as Record<string, unknown>).agent).toBe("sisyphus")
    })

    test("persists after removeRoute", () => {
      // given
      const registry = createPersistentWakeRouteRegistry({
        persistPath: persistPath(),
      })
      registry.registerRoute("ses-1", {
        sessionID: "ses-1",
        promptContext: {},
      })
      registry.registerRoute("ses-2", {
        sessionID: "ses-2",
        promptContext: {},
      })

      // when
      registry.removeRoute("ses-1")

      // then
      const data = readPersistFile("wake-routes.json") as Array<Record<string, unknown>>
      expect(data).toHaveLength(1)
      expect(data[0].sessionID).toBe("ses-2")
    })

    test("persists after clear", () => {
      // given
      const registry = createPersistentWakeRouteRegistry({
        persistPath: persistPath(),
      })
      registry.registerRoute("ses-1", {
        sessionID: "ses-1",
        promptContext: {},
      })
      registry.registerRoute("ses-2", {
        sessionID: "ses-2",
        promptContext: {},
      })

      // when
      registry.clear()

      // then
      const data = readPersistFile("wake-routes.json") as Array<unknown>
      expect(data).toHaveLength(0)
    })
  })

  describe("resilience", () => {
    test("handles missing file gracefully", () => {
      // when — path points to nonexistent file
      const registry = createPersistentWakeRouteRegistry({
        persistPath: persistPath("nonexistent.json"),
      })

      // then
      expect(registry.size).toBe(0)
      // register/remove should still work
      registry.registerRoute("ses-1", {
        sessionID: "ses-1",
        promptContext: {},
      })
      expect(registry.resolveRoute("ses-1")).toBeDefined()
    })

    test("handles corrupted JSON gracefully", () => {
      // given — a file with invalid JSON
      writePersistFile("wake-routes.json", "not valid json {{{")

      // when
      const registry = createPersistentWakeRouteRegistry({
        persistPath: persistPath(),
      })

      // then — should start fresh without crashing
      expect(registry.size).toBe(0)
    })

    test("handles non-array JSON gracefully", () => {
      // given — a file with valid JSON that is not an array
      writePersistFile("wake-routes.json", { not: "an array" })

      // when
      const registry = createPersistentWakeRouteRegistry({
        persistPath: persistPath(),
      })

      // then
      expect(registry.size).toBe(0)
    })
  })

  describe("atomic write", () => {
    test("tmp file does not exist after successful write", () => {
      // given
      const registry = createPersistentWakeRouteRegistry({
        persistPath: persistPath(),
      })

      // when
      registry.registerRoute("ses-1", {
        sessionID: "ses-1",
        promptContext: {},
      })

      // then
      const tmpPath = `${persistPath()}.tmp`
      expect(existsSync(tmpPath)).toBe(false)
    })
  })

  describe("backward compatibility", () => {
    test("returns WakeRouteRegistry instance with same API", () => {
      // given
      const registry = createPersistentWakeRouteRegistry({
        persistPath: persistPath(),
      })

      // then
      expect(registry).toBeInstanceOf(WakeRouteRegistry)
      expect(typeof registry.registerRoute).toBe("function")
      expect(typeof registry.resolveRoute).toBe("function")
      expect(typeof registry.removeRoute).toBe("function")
      expect(typeof registry.clear).toBe("function")
      expect(typeof registry.size).toBe("number")
    })
  })
})
