import { describe, expect, it, afterEach, beforeEach } from "bun:test"
import { existsSync, mkdirSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"

import { cleanupContinuationMarkers } from "./memory-run-continuation-cleanup"

function tmpProjectDir(): string {
  const dir = join(tmpdir(), "continuation-cleanup-test-" + randomUUID())
  mkdirSync(dir, { recursive: true })
  return dir
}

function createMarker(projectRoot: string, sessionId: string, state: string, ageDays: number, options?: { active?: boolean }): void {
  const markerDir = join(projectRoot, ".omo", "run-continuation")
  mkdirSync(markerDir, { recursive: true })
  const now = Date.now()
  const mtime = now - ageDays * 86_400_000
  const marker = {
    sessionID: sessionId,
    updatedAt: new Date(mtime).toISOString(),
    sources: options?.active
      ? { todo: { state: "active", updatedAt: new Date(mtime).toISOString() } }
      : { todo: { state: "completed", updatedAt: new Date(mtime).toISOString() } },
  }
  const filePath = join(markerDir, `${sessionId}.json`)
  writeFileSync(filePath, JSON.stringify(marker, null, 2), "utf-8")
  utimesSync(filePath, mtime / 1000, mtime / 1000)
}

function countMarkers(projectRoot: string): number {
  const markerDir = join(projectRoot, ".omo", "run-continuation")
  if (!existsSync(markerDir)) return 0
  try {
    return readdirSync(markerDir).filter((n: string) => n.endsWith(".json")).length
  } catch {
    return 0
  }
}

describe("cleanupContinuationMarkers", () => {
  let projectRoot = ""

  beforeEach(() => {
    projectRoot = tmpProjectDir()
  })

  afterEach(() => {
    try {
      if (existsSync(projectRoot)) rmSync(projectRoot, { recursive: true })
    } catch {
      // cleanup
    }
  })

  describe("#given a project with no marker directory", () => {
    it("returns attempted=false", () => {
      const result = cleanupContinuationMarkers(projectRoot)
      expect(result.attempted).toBe(false)
      expect(result.removed).toBe(0)
    })
  })

  describe("#given a project with an empty marker directory", () => {
    it("returns attempted=false", () => {
      mkdirSync(join(projectRoot, ".omo", "run-continuation"), { recursive: true })
      const result = cleanupContinuationMarkers(projectRoot)
      expect(result.attempted).toBe(false)
      expect(result.removed).toBe(0)
    })
  })

  describe("#given stale markers older than max age", () => {
    it("removes stale markers", () => {
      createMarker(projectRoot, "old-session", "completed", 60)
      createMarker(projectRoot, "recent-session", "completed", 5)
      expect(countMarkers(projectRoot)).toBe(2)
      const result = cleanupContinuationMarkers(projectRoot, undefined, 30, 200)
      expect(result.removed).toBe(1)
      expect(countMarkers(projectRoot)).toBe(1)
    })
  })

  describe("#given an active marker that is also stale by age", () => {
    it("preserves the active marker", () => {
      createMarker(projectRoot, "active-old", "active", 60, { active: true })
      createMarker(projectRoot, "stale-old", "completed", 60)
      expect(countMarkers(projectRoot)).toBe(2)
      const result = cleanupContinuationMarkers(projectRoot, undefined, 30, 200)
      expect(result.removed).toBe(1)
      expect(countMarkers(projectRoot)).toBe(1)
    })
  })

  describe("#given more markers than max count", () => {
    it("removes oldest non-active markers to stay within limit", () => {
      for (let i = 0; i < 10; i++) {
        createMarker(projectRoot, `session-${i}`, "completed", 1)
      }
      expect(countMarkers(projectRoot)).toBe(10)
      const result = cleanupContinuationMarkers(projectRoot, undefined, 30, 5)
      expect(result.removed).toBe(5)
      expect(countMarkers(projectRoot)).toBe(5)
    })
  })

  describe("#given an active marker among excess markers", () => {
    it("preserves active marker even when count exceeds limit", () => {
      createMarker(projectRoot, "active-keep", "active", 1, { active: true })
      for (let i = 0; i < 9; i++) {
        createMarker(projectRoot, `session-${i}`, "completed", 1)
      }
      expect(countMarkers(projectRoot)).toBe(10)
      const result = cleanupContinuationMarkers(projectRoot, undefined, 30, 5)
      expect(result.removed).toBeGreaterThanOrEqual(4)
      expect(countMarkers(projectRoot)).toBeLessThanOrEqual(6)
    })
  })

  describe("#given a malformed marker file", () => {
    it("tolerates and still processes other markers", () => {
      createMarker(projectRoot, "valid-marker", "completed", 60)
      const markerDir = join(projectRoot, ".omo", "run-continuation")
      writeFileSync(join(markerDir, "broken.json"), "not valid json", "utf-8")
      expect(countMarkers(projectRoot)).toBe(2)
      const result = cleanupContinuationMarkers(projectRoot, undefined, 30, 200)
      expect(result.removed).toBe(1)
    })
  })

  describe("#given markers within age and count limits", () => {
    it("removes nothing", () => {
      createMarker(projectRoot, "recent-1", "completed", 5)
      createMarker(projectRoot, "recent-2", "completed", 10)
      expect(countMarkers(projectRoot)).toBe(2)
      const result = cleanupContinuationMarkers(projectRoot, undefined, 30, 200)
      expect(result.removed).toBe(0)
      expect(countMarkers(projectRoot)).toBe(2)
    })
  })
})
