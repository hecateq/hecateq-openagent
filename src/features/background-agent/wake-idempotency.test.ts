import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import {
  WakeDuplicateSuppressor,
  createWakeDuplicateSuppressor,
  type WakeDedupeKey,
} from "./wake-idempotency"

describe("WakeDuplicateSuppressor", () => {
  describe("shouldDispatch", () => {
    test("returns true for a new key", () => {
      // given
      const suppressor = createWakeDuplicateSuppressor()

      // when
      const result = suppressor.shouldDispatch("task1:parent1:completed")

      // then
      expect(result).toBe(true)
    })

    test("returns false after markDispatched for the same key", () => {
      // given
      const suppressor = createWakeDuplicateSuppressor()
      const key = "task1:parent1:completed"
      suppressor.markDispatched(key)

      // when
      const result = suppressor.shouldDispatch(key)

      // then
      expect(result).toBe(false)
    })

    test("returns true for a different key after marking another", () => {
      // given
      const suppressor = createWakeDuplicateSuppressor()
      suppressor.markDispatched("task1:parent1:completed")

      // when
      const result = suppressor.shouldDispatch("task2:parent1:completed")

      // then
      expect(result).toBe(true)
    })

    test("returns true for same task but different completion status", () => {
      // given
      const suppressor = createWakeDuplicateSuppressor()
      suppressor.markDispatched("task1:parent1:completed")

      // when
      const result = suppressor.shouldDispatch("task1:parent1:error")

      // then
      expect(result).toBe(true)
    })

    test("returns true for same task but different parent session", () => {
      // given
      const suppressor = createWakeDuplicateSuppressor()
      suppressor.markDispatched("task1:parent1:completed")

      // when
      const result = suppressor.shouldDispatch("task1:parent2:completed")

      // then
      expect(result).toBe(true)
    })
  })

  describe("markDispatched", () => {
    test("increments size after marking", () => {
      // given
      const suppressor = createWakeDuplicateSuppressor()

      // when
      suppressor.markDispatched("task1:parent1:completed")

      // then
      expect(suppressor.size).toBe(1)
    })

    test("does not double-count same key", () => {
      // given
      const suppressor = createWakeDuplicateSuppressor()

      // when
      suppressor.markDispatched("task1:parent1:completed")
      suppressor.markDispatched("task1:parent1:completed")

      // then
      expect(suppressor.size).toBe(1)
    })
  })

  describe("clear", () => {
    test("removes a specific key", () => {
      // given
      const suppressor = createWakeDuplicateSuppressor()
      suppressor.markDispatched("key-a")
      suppressor.markDispatched("key-b")

      // when
      suppressor.clear("key-a")

      // then
      expect(suppressor.shouldDispatch("key-a")).toBe(true)
      expect(suppressor.shouldDispatch("key-b")).toBe(false)
    })
  })

  describe("clearAll", () => {
    test("removes all entries", () => {
      // given
      const suppressor = createWakeDuplicateSuppressor()
      suppressor.markDispatched("key-a")
      suppressor.markDispatched("key-b")

      // when
      suppressor.clearAll()

      // then
      expect(suppressor.size).toBe(0)
      expect(suppressor.shouldDispatch("key-a")).toBe(true)
      expect(suppressor.shouldDispatch("key-b")).toBe(true)
    })
  })

  describe("buildKey", () => {
    test("builds key from taskID, parentSessionID, and completionStatus", () => {
      // when
      const key = WakeDuplicateSuppressor.buildKey("bg_abc123", "parent-ses-1", "completed")

      // then
      expect(key).toBe("bg_abc123:parent-ses-1:completed")
    })
  })

  describe("bounded size", () => {
    test("evicts oldest entry when exceeding maxEntries", () => {
      // given
      const suppressor = createWakeDuplicateSuppressor({ maxEntries: 3 })

      // when
      suppressor.markDispatched("key-1")
      suppressor.markDispatched("key-2")
      suppressor.markDispatched("key-3")
      suppressor.markDispatched("key-4")

      // then — key-1 should be evicted (oldest)
      expect(suppressor.size).toBe(3)
      expect(suppressor.shouldDispatch("key-1")).toBe(true)
      expect(suppressor.shouldDispatch("key-2")).toBe(false)
      expect(suppressor.shouldDispatch("key-3")).toBe(false)
      expect(suppressor.shouldDispatch("key-4")).toBe(false)
    })

    test("does not evict when exactly at maxEntries", () => {
      // given
      const suppressor = createWakeDuplicateSuppressor({ maxEntries: 3 })

      // when
      suppressor.markDispatched("key-1")
      suppressor.markDispatched("key-2")
      suppressor.markDispatched("key-3")

      // then
      expect(suppressor.size).toBe(3)
      expect(suppressor.shouldDispatch("key-1")).toBe(false)
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

    test("entries expire after TTL", () => {
      // given
      const suppressor = createWakeDuplicateSuppressor({ ttlMs: 1000 })
      suppressor.markDispatched("key-1")

      // when — within TTL
      advanceTime(500)
      expect(suppressor.shouldDispatch("key-1")).toBe(false)

      // when — after TTL
      advanceTime(600)
      expect(suppressor.shouldDispatch("key-1")).toBe(true)
    })

    test("shouldDispatch prunes expired entries", () => {
      // given
      const suppressor = createWakeDuplicateSuppressor({ ttlMs: 500 })
      suppressor.markDispatched("key-1")
      suppressor.markDispatched("key-2")

      // when — advance past TTL
      advanceTime(1000)

      // then — both entries should be expired and dispatchable
      expect(suppressor.size).toBe(0)
      expect(suppressor.shouldDispatch("key-1")).toBe(true)
      expect(suppressor.shouldDispatch("key-2")).toBe(true)
    })

    test("only expired entries are removed, active ones remain", () => {
      // given
      const suppressor = createWakeDuplicateSuppressor({ ttlMs: 1000 })
      suppressor.markDispatched("key-1") // will expire
      advanceTime(600)
      suppressor.markDispatched("key-2") // still fresh

      // when — advance to expire key-1 but not key-2
      advanceTime(500)

      // then
      expect(suppressor.shouldDispatch("key-1")).toBe(true)
      expect(suppressor.shouldDispatch("key-2")).toBe(false)
    })
  })

  describe("factory", () => {
    test("createWakeDuplicateSuppressor returns an instance", () => {
      const suppressor = createWakeDuplicateSuppressor()
      expect(suppressor).toBeInstanceOf(WakeDuplicateSuppressor)
    })

    test("factory accepts options", () => {
      const suppressor = createWakeDuplicateSuppressor({ maxEntries: 50, ttlMs: 60000 })
      expect(suppressor).toBeInstanceOf(WakeDuplicateSuppressor)
    })
  })
})
