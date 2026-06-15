import { describe, test, expect } from "bun:test"
import { classifySessionReadError } from "./retry-classifier"

describe("retry-classifier", () => {
  describe("retryable-transient", () => {
    test("transport error ECONNREFUSED", () => {
      expect(classifySessionReadError(new Error("connect ECONNREFUSED 127.0.0.1:4096"))).toBe("retryable-transient")
    })

    test("transport error ETIMEDOUT", () => {
      expect(classifySessionReadError(new Error("ETIMEDOUT while connecting"))).toBe("retryable-transient")
    })

    test("fetch failed", () => {
      expect(classifySessionReadError(new Error("fetch failed"))).toBe("retryable-transient")
    })

    test("network error", () => {
      expect(classifySessionReadError(new Error("network error"))).toBe("retryable-transient")
    })

    test("socket hang up", () => {
      expect(classifySessionReadError(new Error("socket hang up"))).toBe("retryable-transient")
    })

    test("HTTP 429", () => {
      expect(classifySessionReadError({ statusCode: 429, message: "too many requests" })).toBe("retryable-transient")
    })

    test("HTTP 500", () => {
      expect(classifySessionReadError({ statusCode: 500, message: "internal server error" })).toBe("retryable-transient")
    })

    test("HTTP 502", () => {
      expect(classifySessionReadError({ statusCode: 502, message: "bad gateway" })).toBe("retryable-transient")
    })

    test("HTTP 503", () => {
      expect(classifySessionReadError({ statusCode: 503, message: "service unavailable" })).toBe("retryable-transient")
    })

    test("HTTP 504", () => {
      expect(classifySessionReadError({ statusCode: 504, message: "gateway timeout" })).toBe("retryable-transient")
    })

    test("statusCode in nested error.data", () => {
      expect(classifySessionReadError({ data: { statusCode: 503 } })).toBe("retryable-transient")
    })

    test("statusCode in nested error.error", () => {
      expect(classifySessionReadError({ error: { statusCode: 500 } })).toBe("retryable-transient")
    })
  })

  describe("fallbackable", () => {
    test("server unreachable", () => {
      expect(classifySessionReadError(new Error("server unreachable"))).toBe("fallbackable")
    })

    test("server unreachable in cause chain", () => {
      const cause = new Error("server unreachable")
      expect(classifySessionReadError(new Error("request failed", { cause }))).toBe("fallbackable")
    })

    test("timed out message", () => {
      expect(classifySessionReadError(new Error("The request timed out"))).toBe("fallbackable")
    })

    test("fallbackable via error object with message", () => {
      expect(classifySessionReadError({ error: { message: "timeout" } })).toBe("fallbackable")
    })
  })

  describe("non-retryable-fatal", () => {
    test("session not found message", () => {
      expect(classifySessionReadError(new Error("session not found"))).toBe("non-retryable-fatal")
    })

    test("HTTP 401", () => {
      expect(classifySessionReadError({ statusCode: 401 })).toBe("non-retryable-fatal")
    })

    test("HTTP 403", () => {
      expect(classifySessionReadError({ statusCode: 403 })).toBe("non-retryable-fatal")
    })

    test("HTTP 404", () => {
      expect(classifySessionReadError({ statusCode: 404 })).toBe("non-retryable-fatal")
    })

    test("AbortError by name", () => {
      const error = new Error("The operation was aborted")
      ;(error as unknown as Record<string, unknown>).name = "AbortError"
      expect(classifySessionReadError(error)).toBe("non-retryable-fatal")
    })

    test("MessageAbortedError by name", () => {
      const error = new Error("cancelled")
      ;(error as unknown as Record<string, unknown>).name = "MessageAbortedError"
      expect(classifySessionReadError(error)).toBe("non-retryable-fatal")
    })

    test("aborted in message", () => {
      expect(classifySessionReadError(new Error("Request was aborted"))).toBe("non-retryable-fatal")
    })

    test("cancelled in message", () => {
      expect(classifySessionReadError(new Error("Operation cancelled"))).toBe("non-retryable-fatal")
    })

    test("unauthorized in message", () => {
      expect(classifySessionReadError(new Error("Unauthorized access"))).toBe("non-retryable-fatal")
    })

    test("forbidden in message", () => {
      expect(classifySessionReadError(new Error("Forbidden: insufficient permissions"))).toBe("non-retryable-fatal")
    })

    test("validation error", () => {
      expect(classifySessionReadError(new Error("validation error: invalid session id"))).toBe("non-retryable-fatal")
    })

    test("invalid request", () => {
      expect(classifySessionReadError(new Error("invalid request"))).toBe("non-retryable-fatal")
    })

    test("bad request", () => {
      expect(classifySessionReadError(new Error("bad request"))).toBe("non-retryable-fatal")
    })

    test("unknown generic error", () => {
      expect(classifySessionReadError(new Error("something went wrong"))).toBe("non-retryable-fatal")
    })

    test("null input", () => {
      expect(classifySessionReadError(null)).toBe("non-retryable-fatal")
    })

    test("undefined input", () => {
      expect(classifySessionReadError(undefined)).toBe("non-retryable-fatal")
    })
  })

  describe("priority order", () => {
    test("abort takes priority over transport error", () => {
      const error = new Error("fetch failed ECONNREFUSED")
      ;(error as unknown as Record<string, unknown>).name = "AbortError"
      expect(classifySessionReadError(error)).toBe("non-retryable-fatal")
    })

    test("session not found takes priority over transport error", () => {
      expect(classifySessionReadError(new Error("session not found: fetch failed"))).toBe("non-retryable-fatal")
    })

    test("auth error takes priority over 5xx", () => {
      expect(classifySessionReadError({ statusCode: 401, message: "service unavailable" })).toBe("non-retryable-fatal")
    })
  })
})
