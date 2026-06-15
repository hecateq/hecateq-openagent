import { isAbortError } from "../../shared/is-abort-error"
import { log } from "../../shared"
import { classifySessionReadError } from "./retry-classifier"
import type { RetryClassification } from "./retry-classifier"

export interface RetryOptions {
  maxAttempts?: number
  initialDelayMs?: number
  backoffFactor?: number
  maxDelayMs?: number
  signal?: AbortSignal
  /** Inject a delay function for testing. Defaults to setTimeout-based promise. */
  delay?: (ms: number) => Promise<void>
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, "signal" | "delay">> = {
  maxAttempts: 3,
  initialDelayMs: 500,
  backoffFactor: 2,
  maxDelayMs: 5000,
}

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function withTransientRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_OPTIONS.maxAttempts
  const initialDelayMs = options.initialDelayMs ?? DEFAULT_OPTIONS.initialDelayMs
  const backoffFactor = options.backoffFactor ?? DEFAULT_OPTIONS.backoffFactor
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_OPTIONS.maxDelayMs
  const signal = options.signal
  const delay = options.delay ?? defaultDelay

  let lastError: unknown
  let lastClassification: RetryClassification | undefined

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      lastClassification = classifySessionReadError(error)

      if (lastClassification === "non-retryable-fatal") {
        throw error
      }

      if (lastClassification === "fallbackable") {
        throw error
      }

      if (attempt >= maxAttempts) {
        break
      }

      if (signal?.aborted) {
        throw error
      }

      const delayMs = Math.min(initialDelayMs * Math.pow(backoffFactor, attempt - 1), maxDelayMs)

      log(
        `[session-manager] transient retry attempt ${attempt}/${maxAttempts}, waiting ${delayMs}ms`,
        { error: String(error) },
      )

      if (signal?.aborted) {
        throw error
      }

      await delay(delayMs)

      if (signal?.aborted) {
        throw error
      }
    }
  }

  throw lastError
}
