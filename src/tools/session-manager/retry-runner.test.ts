import { describe, test, expect, mock } from "bun:test"
import { withTransientRetry } from "./retry-runner"

describe("retry-runner", () => {
  describe("success on first attempt", () => {
    test("does not retry when fn succeeds immediately", async () => {
      const fn = mock(() => Promise.resolve("success"))

      const result = await withTransientRetry(fn)

      expect(result).toBe("success")
      expect(fn).toHaveBeenCalledTimes(1)
    })
  })

  describe("success on retry", () => {
    test("retries and succeeds on 2nd attempt", async () => {
      const delays: number[] = []
      const fn = mock()
        .mockImplementationOnce(() => Promise.reject(new Error("fetch failed ECONNREFUSED")))
        .mockImplementationOnce(() => Promise.resolve("retry-success"))

      const result = await withTransientRetry(fn, {
        initialDelayMs: 10,
        backoffFactor: 2,
        maxDelayMs: 100,
        delay: async (ms) => { delays.push(ms) },
      })

      expect(result).toBe("retry-success")
      expect(fn).toHaveBeenCalledTimes(2)
      expect(delays.length).toBe(1)
      expect(delays[0]).toBe(10)
    })

    test("retries and succeeds on 3rd attempt", async () => {
      const fn = mock()
        .mockImplementationOnce(() => Promise.reject(new Error("ETIMEDOUT")))
        .mockImplementationOnce(() => Promise.reject(new Error("ETIMEDOUT")))
        .mockImplementationOnce(() => Promise.resolve("third-time-lucky"))

      const result = await withTransientRetry(fn, {
        initialDelayMs: 10,
        backoffFactor: 2,
        maxDelayMs: 100,
        delay: async () => {},
      })

      expect(result).toBe("third-time-lucky")
      expect(fn).toHaveBeenCalledTimes(3)
    })
  })

  describe("retry exhaustion", () => {
    test("throws after all attempts fail", async () => {
      const fn = mock(() => Promise.reject(new Error("fetch failed")))

      await expect(
        withTransientRetry(fn, {
          maxAttempts: 3,
          initialDelayMs: 1,
          maxDelayMs: 1,
          delay: async () => {},
        }),
      ).rejects.toThrow("fetch failed")

      expect(fn).toHaveBeenCalledTimes(3)
    })

    test("throws after maxAttempts fail with 5xx", async () => {
      const fn = mock(() => Promise.reject({ statusCode: 503, message: "service unavailable" }))

      await expect(
        withTransientRetry(fn, {
          maxAttempts: 3,
          initialDelayMs: 1,
          maxDelayMs: 1,
          delay: async () => {},
        }),
      ).rejects.toEqual({ statusCode: 503, message: "service unavailable" })

      expect(fn).toHaveBeenCalledTimes(3)
    })
  })

  describe("non-retryable errors", () => {
    test("does not retry on auth error (401)", async () => {
      const fn = mock(() => Promise.reject({ statusCode: 401, message: "unauthorized" }))

      await expect(
        withTransientRetry(fn, {
          maxAttempts: 3,
          initialDelayMs: 1,
          delay: async () => {},
        }),
      ).rejects.toEqual({ statusCode: 401, message: "unauthorized" })

      expect(fn).toHaveBeenCalledTimes(1)
    })

    test("does not retry on session not found", async () => {
      const fn = mock(() => Promise.reject(new Error("session not found")))

      await expect(
        withTransientRetry(fn, {
          maxAttempts: 3,
          initialDelayMs: 1,
          delay: async () => {},
        }),
      ).rejects.toThrow("session not found")

      expect(fn).toHaveBeenCalledTimes(1)
    })

    test("does not retry on unknown generic error", async () => {
      const fn = mock(() => Promise.reject(new Error("something random")))

      await expect(
        withTransientRetry(fn, {
          maxAttempts: 3,
          initialDelayMs: 1,
          delay: async () => {},
        }),
      ).rejects.toThrow("something random")

      expect(fn).toHaveBeenCalledTimes(1)
    })

    test("does not retry on validation error", async () => {
      const fn = mock(() => Promise.reject(new Error("validation error")))

      await expect(
        withTransientRetry(fn, {
          maxAttempts: 3,
          initialDelayMs: 1,
          delay: async () => {},
        }),
      ).rejects.toThrow("validation error")

      expect(fn).toHaveBeenCalledTimes(1)
    })
  })

  describe("fallbackable errors", () => {
    test("does not retry on SDK unavailable error (throws immediately for caller to fall back)", async () => {
      const fn = mock(() => Promise.reject(new Error("server unreachable")))

      await expect(
        withTransientRetry(fn, {
          maxAttempts: 3,
          initialDelayMs: 1,
          delay: async () => {},
        }),
      ).rejects.toThrow("server unreachable")

      expect(fn).toHaveBeenCalledTimes(1)
    })
  })

  describe("abort signal", () => {
    test("throws without retrying when already aborted", async () => {
      const controller = new AbortController()
      controller.abort()
      const fn = mock(() => Promise.reject(new Error("fetch failed")))

      await expect(
        withTransientRetry(fn, {
          maxAttempts: 3,
          initialDelayMs: 1,
          delay: async () => {},
          signal: controller.signal,
        }),
      ).rejects.toThrow("fetch failed")

      expect(fn).toHaveBeenCalledTimes(1)
    })

    test("stops retrying when aborted between attempts", async () => {
      const controller = new AbortController()
      const fn = mock()
        .mockImplementationOnce(() => {
          controller.abort()
          return Promise.reject(new Error("ETIMEDOUT"))
        })
        .mockImplementationOnce(() => Promise.resolve("should-not-reach"))

      await expect(
        withTransientRetry(fn, {
          maxAttempts: 3,
          initialDelayMs: 10,
          backoffFactor: 2,
          delay: async () => {},
          signal: controller.signal,
        }),
      ).rejects.toThrow("ETIMEDOUT")

      expect(fn).toHaveBeenCalledTimes(1)
    })
  })

  describe("backoff timing", () => {
    test("uses exponential backoff", async () => {
      const delays: number[] = []
      const fn = mock()
        .mockImplementationOnce(() => Promise.reject(new Error("ETIMEDOUT")))
        .mockImplementationOnce(() => Promise.reject(new Error("ETIMEDOUT")))
        .mockImplementationOnce(() => Promise.resolve("ok"))

      await withTransientRetry(fn, {
        maxAttempts: 3,
        initialDelayMs: 100,
        backoffFactor: 2,
        delay: async (ms) => { delays.push(ms) },
      })

      expect(delays).toEqual([100, 200])
    })

    test("caps delay at maxDelayMs", async () => {
      const delays: number[] = []
      const fn = mock()
        .mockImplementationOnce(() => Promise.reject(new Error("ETIMEDOUT")))
        .mockImplementationOnce(() => Promise.reject(new Error("ETIMEDOUT")))
        .mockImplementationOnce(() => Promise.reject(new Error("ETIMEDOUT")))
        .mockImplementationOnce(() => Promise.reject(new Error("ETIMEDOUT")))
        .mockImplementationOnce(() => Promise.resolve("ok"))

      await withTransientRetry(fn, {
        maxAttempts: 5,
        initialDelayMs: 100,
        backoffFactor: 2,
        maxDelayMs: 250,
        delay: async (ms) => { delays.push(ms) },
      })

      expect(delays).toEqual([100, 200, 250, 250])
    })
  })

  describe("custom maxAttempts", () => {
    test("respects custom maxAttempts of 2", async () => {
      const fn = mock()
        .mockImplementationOnce(() => Promise.reject(new Error("fetch failed")))
        .mockImplementationOnce(() => Promise.reject(new Error("fetch failed")))

      await expect(
        withTransientRetry(fn, {
          maxAttempts: 2,
          initialDelayMs: 1,
          delay: async () => {},
        }),
      ).rejects.toThrow("fetch failed")

      expect(fn).toHaveBeenCalledTimes(2)
    })

    test("respects custom maxAttempts of 1 (no retry)", async () => {
      const fn = mock(() => Promise.reject(new Error("ETIMEDOUT")))

      await expect(
        withTransientRetry(fn, {
          maxAttempts: 1,
          delay: async () => {},
        }),
      ).rejects.toThrow("ETIMEDOUT")

      expect(fn).toHaveBeenCalledTimes(1)
    })
  })
})
