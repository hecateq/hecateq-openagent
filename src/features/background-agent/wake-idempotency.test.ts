import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import {
  WakeDuplicateSuppressor,
  createWakeDuplicateSuppressor,
  type WakeDedupeKey,
} from "./wake-idempotency"

describe("WakeDuplicateSuppressor", () => {
  describe("shouldDispatch", () => {
    test("returns true for a new key", async () => {
      // given
      const suppressor = createWakeDuplicateSuppressor()

      // when
      const result = await suppressor.shouldDispatch("task1:parent1:completed")

      // then
      expect(result).toBe(true)
    })

    test("returns false after markDispatched for the same key", async () => {
      // given
      const suppressor = createWakeDuplicateSuppressor()
      const key = "task1:parent1:completed"
      await suppressor.markDispatched(key)

      // when
      const result = await suppressor.shouldDispatch(key)

      // then
      expect(result).toBe(false)
    })

    test("returns true for a different key after marking another", async () => {
      // given
      const suppressor = createWakeDuplicateSuppressor()
      await suppressor.markDispatched("task1:parent1:completed")

      // when
      const result = await suppressor.shouldDispatch("task2:parent1:completed")

      // then
      expect(result).toBe(true)
    })

    test("returns true for same task but different completion status", async () => {
      // given
      const suppressor = createWakeDuplicateSuppressor()
      await suppressor.markDispatched("task1:parent1:completed")

      // when
      const result = await suppressor.shouldDispatch("task1:parent1:error")

      // then
      expect(result).toBe(true)
    })

    test("returns true for same task but different parent session", async () => {
      // given
      const suppressor = createWakeDuplicateSuppressor()
      await suppressor.markDispatched("task1:parent1:completed")

      // when
      const result = await suppressor.shouldDispatch("task1:parent2:completed")

      // then
      expect(result).toBe(true)
    })
  })

  describe("markDispatched", () => {
    test("increments size after marking", async () => {
      // given
      const suppressor = createWakeDuplicateSuppressor()

      // when
      await suppressor.markDispatched("task1:parent1:completed")

      // then
      expect(suppressor.size).toBe(1)
    })

    test("does not double-count same key", async () => {
      // given
      const suppressor = createWakeDuplicateSuppressor()

      // when
      await suppressor.markDispatched("task1:parent1:completed")
      await suppressor.markDispatched("task1:parent1:completed")

      // then
      expect(suppressor.size).toBe(1)
    })
  })

  describe("clear", () => {
    test("removes a specific key", async () => {
      // given
      const suppressor = createWakeDuplicateSuppressor()
      await suppressor.markDispatched("key-a")
      await suppressor.markDispatched("key-b")

      // when
      suppressor.clear("key-a")

      // then
      expect(await suppressor.shouldDispatch("key-a")).toBe(true)
      expect(await suppressor.shouldDispatch("key-b")).toBe(false)
    })
  })

  describe("clearAll", () => {
    test("removes all entries", async () => {
      // given
      const suppressor = createWakeDuplicateSuppressor()
      await suppressor.markDispatched("key-a")
      await suppressor.markDispatched("key-b")

      // when
      suppressor.clearAll()

      // then
      expect(suppressor.size).toBe(0)
      expect(await suppressor.shouldDispatch("key-a")).toBe(true)
      expect(await suppressor.shouldDispatch("key-b")).toBe(true)
    })
  })

  describe("buildKey", () => {
    test("builds key from taskID, parentSessionID, and completionStatus", async () => {
      // when
      const key = WakeDuplicateSuppressor.buildKey("bg_abc123", "parent-ses-1", "completed")

      // then — SHA-256 hash format: "sha256:<64-char-hex>"
      expect(key).toMatch(/^sha256:[a-f0-9]{64}$/)
    })
  })

  describe("bounded size", () => {
    test("evicts oldest entry when exceeding maxEntries", async () => {
      // given
      const suppressor = createWakeDuplicateSuppressor({ maxEntries: 3 })

      // when
      await suppressor.markDispatched("key-1")
      await suppressor.markDispatched("key-2")
      await suppressor.markDispatched("key-3")
      await suppressor.markDispatched("key-4")

      // then — key-1 should be evicted (oldest)
      expect(suppressor.size).toBe(3)
      expect(await suppressor.shouldDispatch("key-1")).toBe(true)
      expect(await suppressor.shouldDispatch("key-2")).toBe(false)
      expect(await suppressor.shouldDispatch("key-3")).toBe(false)
      expect(await suppressor.shouldDispatch("key-4")).toBe(false)
    })

    test("does not evict when exactly at maxEntries", async () => {
      // given
      const suppressor = createWakeDuplicateSuppressor({ maxEntries: 3 })

      // when
      await suppressor.markDispatched("key-1")
      await suppressor.markDispatched("key-2")
      await suppressor.markDispatched("key-3")

      // then
      expect(suppressor.size).toBe(3)
      expect(await suppressor.shouldDispatch("key-1")).toBe(false)
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

    test("entries expire after TTL", async () => {
      // given
      const suppressor = createWakeDuplicateSuppressor({ ttlMs: 1000 })
      await suppressor.markDispatched("key-1")

      // when — within TTL
      advanceTime(500)
      expect(await suppressor.shouldDispatch("key-1")).toBe(false)

      // when — after TTL
      advanceTime(600)
      expect(await suppressor.shouldDispatch("key-1")).toBe(true)
    })

    test("shouldDispatch prunes expired entries", async () => {
      // given
      const suppressor = createWakeDuplicateSuppressor({ ttlMs: 500 })
      await suppressor.markDispatched("key-1")
      await suppressor.markDispatched("key-2")

      // when — advance past TTL
      advanceTime(1000)

      // then — both entries should be expired and dispatchable
      expect(suppressor.size).toBe(0)
      expect(await suppressor.shouldDispatch("key-1")).toBe(true)
      expect(await suppressor.shouldDispatch("key-2")).toBe(true)
    })

    test("only expired entries are removed, active ones remain", async () => {
      // given
      const suppressor = createWakeDuplicateSuppressor({ ttlMs: 1000 })
      await suppressor.markDispatched("key-1") // will expire
      advanceTime(600)
      await suppressor.markDispatched("key-2") // still fresh

      // when — advance to expire key-1 but not key-2
      advanceTime(500)

      // then
      expect(await suppressor.shouldDispatch("key-1")).toBe(true)
      expect(await suppressor.shouldDispatch("key-2")).toBe(false)
    })
  })

  describe("factory", () => {
    test("createWakeDuplicateSuppressor returns an instance", async () => {
      const suppressor = createWakeDuplicateSuppressor()
      expect(suppressor).toBeInstanceOf(WakeDuplicateSuppressor)
    })

    test("factory accepts options", async () => {
      const suppressor = createWakeDuplicateSuppressor({ maxEntries: 50, ttlMs: 60000 })
      expect(suppressor).toBeInstanceOf(WakeDuplicateSuppressor)
    })
  })
})
