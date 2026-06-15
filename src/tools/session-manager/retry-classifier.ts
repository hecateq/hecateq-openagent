import { isAbortError } from "../../shared/is-abort-error"
import { isSessionSdkUnavailableError } from "./sdk-unavailable"

/**
 * Session-read transient retry error classification.
 *
 * Unlike the general-purpose runtime-fallback error classifier
 * (src/hooks/runtime-fallback/error-classifier.ts), this classifier is
 * narrowly scoped to session-read SDK calls. It answers three questions:
 *
 * 1. Can I retry this error immediately? (retryable-transient)
 * 2. Should I fall through to file-based reading?  (fallbackable)
 * 3. Should I give up and let the caller handle it?  (non-retryable-fatal)
 */

export type RetryClassification = "retryable-transient" | "fallbackable" | "non-retryable-fatal"

const RETRYABLE_HTTP_STATUSES = new Set([429, 500, 502, 503, 504])

const RETRYABLE_TRANSPORT_PATTERNS = [
  "econnrefused",
  "etimedout",
  "fetch failed",
  "network error",
  "socket hang up",
  "unable to connect",
  "network request failed",
] as const

const NON_RETRYABLE_PATTERNS = [
  "session not found",
  "not found",
  "unauthorized",
  "forbidden",
  "invalid session",
  "validation error",
  "invalid request",
  "bad request",
] as const

function extractStatusCode(error: unknown): number | undefined {
  if (!error) return undefined

  const errorObj = error as Record<string, unknown>

  const code = [
    errorObj.statusCode,
    errorObj.status,
    (errorObj.data as Record<string, unknown> | undefined)?.statusCode,
    (errorObj.error as Record<string, unknown> | undefined)?.statusCode,
    (errorObj.cause as Record<string, unknown> | undefined)?.statusCode,
  ].find((c): c is number => typeof c === "number")

  if (code !== undefined) return code

  // Fallback: parse status codes from the error message string
  const message = collectErrorTexts(error).join(" ").toLowerCase()
  const statusMatch = message.match(/\b(4\d{2}|5\d{2})\b/)
  if (statusMatch) {
    const parsed = parseInt(statusMatch[1], 10)
    return Number.isFinite(parsed) ? parsed : undefined
  }

  return undefined
}

function collectErrorTexts(value: unknown): string[] {
  if (value instanceof Error) {
    return [value.message, value.name, ...collectErrorTexts(value.cause)]
  }

  if (typeof value === "string") {
    return [value]
  }

  if (!value || typeof value !== "object") {
    return []
  }

  const record = value as Record<string, unknown>
  return [
    typeof record.message === "string" ? record.message : "",
    typeof record.code === "string" ? record.code : "",
    typeof record.name === "string" ? record.name : "",
    ...collectErrorTexts(record.cause),
    ...collectErrorTexts(record.error),
  ].filter(Boolean)
}

/**
 * Classify a thrown error for session-read retry decisions.
 *
 * Priority order (first match wins):
 * 1. Abort / cancel errors → non-retryable-fatal (never retry)
 * 2. Session-not-found / 404 → non-retryable-fatal
 * 3. Auth errors (401, 403) → non-retryable-fatal
 * 4. Rate-limit (429) → retryable-transient
 * 5. Server errors (500–504) → retryable-transient
 * 6. Transport errors (ECONNREFUSED, etc.) → retryable-transient
 * 7. SDK completely unavailable → fallbackable
 * 8. Everything else → non-retryable-fatal
 */
export function classifySessionReadError(error: unknown): RetryClassification {
  if (isAbortError(error)) {
    return "non-retryable-fatal"
  }

  const statusCode = extractStatusCode(error)
  const haystack = collectErrorTexts(error).join(" ").toLowerCase()

  if (statusCode === 404 || haystack.includes("session not found")) {
    return "non-retryable-fatal"
  }

  if (statusCode === 401 || statusCode === 403) {
    return "non-retryable-fatal"
  }
  if (haystack.includes("unauthorized") || haystack.includes("forbidden")) {
    return "non-retryable-fatal"
  }

  if (statusCode === 429) {
    return "retryable-transient"
  }

  if (statusCode !== undefined && RETRYABLE_HTTP_STATUSES.has(statusCode)) {
    return "retryable-transient"
  }

  if (RETRYABLE_TRANSPORT_PATTERNS.some((p) => haystack.includes(p))) {
    return "retryable-transient"
  }

  if (isSessionSdkUnavailableError(error)) {
    return "fallbackable"
  }

  if (NON_RETRYABLE_PATTERNS.some((p) => haystack.includes(p))) {
    return "non-retryable-fatal"
  }

  return "non-retryable-fatal"
}


