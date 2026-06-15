/**
 * Normalized shape for any thrown value — Error, object, string, null, undefined.
 *
 * Preserves as much structured information as the original value carries:
 * - Error instances: message, name, code, stack
 * - Non-Error objects: message/code/stack properties if present
 * - Primitives (string, number, boolean, symbol): String representation
 * - null / undefined: generic placeholder message
 */
export interface NormalizedError {
  message: string
  code?: string
  stack?: string
  name: string
  original: unknown
}

/**
 * Convert any thrown value into a safe, uniform Error-like shape.
 *
 * This function never throws. Every possible JavaScript value (including
 * null, undefined, plain objects, and primitives) maps to a defined shape.
 */
export function normalizeError(error: unknown): NormalizedError {
  // null / undefined — no information to extract
  if (error === null || error === undefined) {
    return {
      message: "Unknown error (null or undefined)",
      name: "Error",
      original: error,
    }
  }

  // primitive throws: string, number, boolean, symbol, bigint
  if (typeof error !== "object") {
    return {
      message: String(error),
      name: "Error",
      original: error,
    }
  }

  // Error instance — richest path
  if (error instanceof Error) {
    return {
      message: error.message,
      code: (error as NodeJS.ErrnoException).code,
      stack: error.stack,
      name: error.name,
      original: error,
    }
  }

  // non-Error object throw (e.g. Bun ResolveMessage)
  const obj = error as Record<string, unknown>
  return {
    message: typeof obj.message === "string" ? obj.message : String(error),
    code: typeof obj.code === "string" ? obj.code : undefined,
    stack: typeof obj.stack === "string" ? obj.stack : undefined,
    name: typeof obj.name === "string" ? obj.name : "Error",
    original: error,
  }
}
