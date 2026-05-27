import { DEFAULT_CONFIG, RETRYABLE_ERROR_PATTERNS } from "./constants"

export { extractAutoRetrySignal } from "./auto-retry-signal"

export function getErrorMessage(error: unknown): string {
  if (!error) return ""
  if (typeof error === "string") return error.toLowerCase()

  const errorObj = error as Record<string, unknown>
  const paths = [
    errorObj.data,
    errorObj.error,
    errorObj,
    (errorObj.data as Record<string, unknown>)?.error,
  ]

  for (const obj of paths) {
    if (obj && typeof obj === "object") {
      const msg = (obj as Record<string, unknown>).message
      if (typeof msg === "string" && msg.length > 0) {
        return msg.toLowerCase()
      }
    }
  }

  const errorObj2 = error as Record<string, unknown>
  const name = errorObj2.name
  if (typeof name === "string" && name.length > 0) {
    const nameColonMatch = name.match(/:\s*(.+)/)
    if (nameColonMatch) return nameColonMatch[1].trim().toLowerCase()
  }

  try {
    return JSON.stringify(error).toLowerCase()
  } catch {
    return ""
  }
}

const DEFAULT_RETRY_PATTERN = new RegExp(`\\b(${DEFAULT_CONFIG.retry_on_errors.join("|")})\\b`)

export function extractStatusCode(error: unknown, retryOnErrors?: number[]): number | undefined {
  if (!error) return undefined

  const errorObj = error as Record<string, unknown>

  const statusCode = [
    errorObj.statusCode,
    errorObj.status,
    (errorObj.data as Record<string, unknown>)?.statusCode,
    (errorObj.error as Record<string, unknown>)?.statusCode,
    (errorObj.cause as Record<string, unknown>)?.statusCode,
  ].find((code): code is number => typeof code === "number")

  if (statusCode !== undefined) {
    return statusCode
  }

  const pattern = retryOnErrors && retryOnErrors.length > 0
    ? new RegExp(`\\b(${retryOnErrors.join("|")})\\b`)
    : DEFAULT_RETRY_PATTERN
  const message = getErrorMessage(error)
  const statusMatch = message.match(pattern)
  if (statusMatch) {
    const parsed = parseInt(statusMatch[1] ?? "", 10)
    return Number.isFinite(parsed) ? parsed : undefined
  }

  return undefined
}

export function extractErrorName(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined

  const errorObj = error as Record<string, unknown>
  const directName = errorObj.name
  if (typeof directName === "string" && directName.length > 0) {
    return directName
  }

  const dataName = (errorObj.data as Record<string, unknown> | undefined)?.name
  if (typeof dataName === "string" && dataName.length > 0) {
    return dataName
  }

  const nestedError = errorObj.error as Record<string, unknown> | undefined
  const nestedName = nestedError?.name
  if (typeof nestedName === "string" && nestedName.length > 0) {
    return nestedName
  }

  const dataError = (errorObj.data as Record<string, unknown> | undefined)?.error as Record<string, unknown> | undefined
  const dataErrorName = dataError?.name
  if (typeof dataErrorName === "string" && dataErrorName.length > 0) {
    return dataErrorName
  }

  return undefined
}

function isLocalizedQuotaExhaustionMessage(message: string): boolean {
  return (
    (/预扣费额度失败/i.test(message) && /用户剩余额度/i.test(message)) ||
    (/用户剩余额度/i.test(message) && /需要预扣费额度/i.test(message))
  )
}

export function classifyErrorType(error: unknown): string | undefined {
  const message = getErrorMessage(error)
  // Normalize by stripping underscores and dashes so snake_case / kebab-case
  // provider error names (e.g. "insufficient_quota", "RESOURCE_EXHAUSTED")
  // match the existing alphanumeric .includes() checks below.
  const errorName = extractErrorName(error)?.toLowerCase()?.replace(/[_-]/g, "")

  if (
    errorName?.includes("ailoadapikeyerror") ||
    errorName?.includes("loadapi") ||
    (/api.?key.?is.?missing/i.test(message) && /environment variable/i.test(message))
  ) {
    return "missing_api_key"
  }

  if (/api.?key/i.test(message) && /must be a string/i.test(message)) {
    return "invalid_api_key"
  }

  if (
    errorName?.includes("providermodelnotfounderror") ||
    errorName?.includes("modelnotfounderror") ||
    (errorName?.includes("unknownerror") && /model\s+not\s+found/i.test(message))
  ) {
    return "model_not_found"
  }

  if (
    errorName?.includes("quotaexceeded") ||
    errorName?.includes("insufficientquota") ||
    errorName?.includes("billingerror") ||
    errorName?.includes("resourceexhausted") ||
    /quota.?exceeded/i.test(message) ||
    /exceeded.*quota/i.test(message) ||
    /usage\s*quota/i.test(message) ||
    /subscription.*quota/i.test(message) ||
    /insufficient.?(?:quota|balance|funds?)/i.test(message) ||
    /billing.?(?:hard.?)?limit/i.test(message) ||
    /exhausted\s+your\s+capacity/i.test(message) ||
    /resource.?exhausted/i.test(message) ||
    /out\s+of\s+credits?/i.test(message) ||
    /payment.?required/i.test(message) ||
    /usage\s+limit/i.test(message) ||
    /credit\s+balance.*too\s+low/i.test(message) ||
    /使用上限/.test(message) ||
    /达到.*限制/.test(message) ||
    /额度.*不足/.test(message) ||
    /余额.*不足/.test(message) ||
    /已耗尽/.test(message) ||
    isLocalizedQuotaExhaustionMessage(message)
  ) {
    return "quota_exceeded"
  }

  return undefined
}

export function containsErrorContent(
  parts: Array<{ type?: string; text?: string }> | undefined
): { hasError: boolean; errorMessage?: string } {
  if (!parts || parts.length === 0) return { hasError: false }

  const errorParts = parts.filter((p) => p.type === "error")
  if (errorParts.length > 0) {
    const errorMessages = errorParts.map((p) => p.text).filter((text): text is string => typeof text === "string")
    const errorMessage = errorMessages.length > 0 ? errorMessages.join("\n") : undefined
    return { hasError: true, errorMessage }
  }

  return { hasError: false }
}

function extractProviderRetryableFlag(error: unknown): boolean | undefined {
  if (!error || typeof error !== "object") {
    return undefined
  }

  const candidates: unknown[] = [
    error,
    (error as Record<string, unknown>).data,
    (error as Record<string, unknown>).error,
    (error as Record<string, unknown>).cause,
  ]

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") {
      continue
    }

    const candidateRecord = candidate as Record<string, unknown>
    for (const key of ["isRetryable", "is_retryable", "retryable"]) {
      const retryable = candidateRecord[key]
      if (typeof retryable === "boolean") {
        return retryable
      }
    }
  }

  return undefined
}

/**
 * Classify HTTP status code category for retry decisions.
 *
 * - 4xx (client errors): Only retry specific codes like 429 (rate limit)
 *   or 408 (timeout). Most 4xx errors (400, 401, 403, 404) indicate a
 *   configuration problem that no number of retries will fix.
 * - 5xx (server errors): Always retryable — the provider may recover.
 * - No status: Treat as potentially retryable but log a warning and
 *   require at least one retryable pattern match to avoid infinite loops.
 *
 * Returns one of "client_error", "server_error", or undefined.
 */
export function classifyStatusCategory(statusCode: number | undefined): "client_error" | "server_error" | undefined {
  if (statusCode === undefined) return undefined
  if (statusCode >= 400 && statusCode < 500) return "client_error"
  if (statusCode >= 500 && statusCode < 600) return "server_error"
  return undefined
}

/**
 * Status-aware retryability check.
 *
 * Unlike the flat `isRetryableError()` below, this function is aware of
 * the HTTP status category and applies different heuristics:
 *
 * - No status code: Only retry if an error type or message pattern matches
 *   (avoids infinite retry on completely unknown failures).
 * - 4xx (except 429/408): NOT retryable — client misconfiguration.
 * - 429 (rate limit): Retryable (the cooldown + fallback chain applies).
 * - 408 (timeout): Retryable — transient network issue.
 * - 5xx: Retryable — server-side error may be temporary.
 *
 * Used by `handleSessionError` and `session-status-handler` to decide
 * whether to enter the fallback retry flow.
 */
export function isStatusRetryable(
  statusCode: number | undefined,
  retryOnErrors: number[],
): boolean {
  const category = classifyStatusCategory(statusCode)

  if (category === undefined) {
    return false
  }

  if (category === "client_error") {
    if (statusCode === undefined) {
      return false
    }

    return statusCode === 408
      || statusCode === 425
      || statusCode === 429
      || retryOnErrors.includes(statusCode)
  }

  if (category === "server_error") {
    return true
  }

  return false
}

export function isRetryableError(error: unknown, retryOnErrors: number[]): boolean {
  const statusCode = extractStatusCode(error, retryOnErrors)
  const message = getErrorMessage(error)
  const errorType = classifyErrorType(error)
  const providerRetryable = extractProviderRetryableFlag(error)

  if (errorType === "missing_api_key") {
    return true
  }

  if (errorType === "model_not_found") {
    return true
  }

  if (errorType === "quota_exceeded") {
    return true
  }

  if (statusCode === undefined) {
    if (providerRetryable !== undefined) {
      return providerRetryable
    }

    return RETRYABLE_ERROR_PATTERNS.some((pattern) => pattern.test(message))
  }

  return isStatusRetryable(statusCode, retryOnErrors)
}
