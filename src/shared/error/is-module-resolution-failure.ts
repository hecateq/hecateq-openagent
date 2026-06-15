import { normalizeError, type NormalizedError } from "./normalize-error"

/**
 * Known module-resolution error codes from Node.js and Bun.
 */
const MODULE_RESOLUTION_CODES = new Set([
  "MODULE_NOT_FOUND",
  "ERR_MODULE_NOT_FOUND",
])

/**
 * Known non-resolution error codes that may co-occur during module loading.
 * These must NOT be reported as resolution failures.
 */
const FILESYSTEM_ERROR_CODES = new Set([
  "EACCES",
  "EPERM",
  "EISDIR",
  "ENOTDIR",
])

/**
 * Known real error names that indicate the loaded module had a runtime
 * problem — not a resolution failure.
 */
const RUNTIME_ERROR_NAMES = new Set([
  "SyntaxError",
  "TypeError",
  "ReferenceError",
  "RangeError",
  "URIError",
])

/**
 * Patterns found in module resolution error messages that reliably indicate
 * a resolution failure rather than a runtime error inside the loaded module.
 */
const RESOLUTION_MESSAGE_PATTERNS = [
  /^Cannot find (?:module|package)/i,
  /^Cannot resolve module/i,
  /is not a module/i,
  /^Cannot load module/i,
  /^Module not found/i,
]

function isResolveMessageObject(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false
  if (error instanceof Error) return false
  const ctorName = (error as Record<string, unknown>).constructor?.name
  return ctorName === "ResolveMessage"
}

/**
 * Determine whether a thrown value represents a module-resolution failure
 * (package not found, import path invalid) as opposed to a genuine runtime
 * error inside the loaded module.
 *
 * Detection strategy (by priority):
 * 1. Error code (`code` field) — most reliable structured signal
 * 2. Error name / constructor name — detects Bun `ResolveMessage` objects
 * 3. Known non-resolution signals (syntax errors, permissions) — exclusion
 * 4. Message patterns — least reliable, used as fallback for dynamic import()
 *
 * @returns `true` when the error is definitely a module-resolution failure.
 */
export function isModuleResolutionFailure(error: unknown): boolean {
  if (error === null || error === undefined) return false

  const normalized = normalizeError(error)

  // === STEP 1: Non-Error ResolveMessage (Bun) — strongest signal ===
  if (normalized.name === "ResolveMessage") return true
  if (isResolveMessageObject(error)) return true

  // === STEP 2: Error code based — most reliable structured signal ===
  if (normalized.code && MODULE_RESOLUTION_CODES.has(normalized.code)) {
    // Verify this isn't a false positive from filesystem or runtime error
    return true
  }

  // === STEP 3: Exclusion — known non-resolution error signals ===
  if (normalized.code && FILESYSTEM_ERROR_CODES.has(normalized.code)) {
    return false
  }

  if (RUNTIME_ERROR_NAMES.has(normalized.name)) {
    return false
  }

  // === STEP 4: Message-based fallback for dynamic import() ===
  const msg = normalized.message
  for (const pattern of RESOLUTION_MESSAGE_PATTERNS) {
    if (pattern.test(msg)) return true
  }

  return false
}
