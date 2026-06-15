import { describe, it, expect } from "bun:test"
import { normalizeError } from "./normalize-error"

describe("normalizeError", () => {
  describe("#given Error instance", () => {
    it("#then preserves message, name, stack, and code", () => {
      //#given
      const original = new Error("boom")
      ;(original as NodeJS.ErrnoException).code = "MODULE_NOT_FOUND"

      //#when
      const result = normalizeError(original)

      //#then
      expect(result.message).toBe("boom")
      expect(result.name).toBe("Error")
      expect(result.code).toBe("MODULE_NOT_FOUND")
      expect(result.stack).toBeTruthy()
      expect(result.original).toBe(original)
    })

    it("#then preserves custom error name", () => {
      //#given
      class CustomError extends Error {
        name = "CustomError"
      }
      const original = new CustomError("custom")

      //#when
      const result = normalizeError(original)

      //#then
      expect(result.name).toBe("CustomError")
      expect(result.message).toBe("custom")
    })

    it("#then handles error with no code", () => {
      //#given
      const original = new TypeError("bad type")

      //#when
      const result = normalizeError(original)

      //#then
      expect(result.message).toBe("bad type")
      expect(result.name).toBe("TypeError")
      expect(result.code).toBeUndefined()
    })
  })

  describe("#given non-Error object throw", () => {
    it("#then preserves message, name, code, stack from object shape", () => {
      //#given — Bun-like ResolveMessage
      const original = Object.assign(Object.create(null), {
        name: "ResolveMessage",
        message: "Cannot find module '@ast-grep/napi'",
        code: "ERR_MODULE_NOT_FOUND",
        stack: "ResolveMessage: ...",
        specifier: "@ast-grep/napi",
        referrer: "/some/file.ts",
      })

      //#when
      const result = normalizeError(original)

      //#then
      expect(result.message).toBe("Cannot find module '@ast-grep/napi'")
      expect(result.name).toBe("ResolveMessage")
      expect(result.code).toBe("ERR_MODULE_NOT_FOUND")
      expect(result.stack).toBe("ResolveMessage: ...")
      expect(result.original).toBe(original)
    })

    it("#then falls back to String representation when message is missing", () => {
      //#given
      const original = { code: 42 }

      //#when
      const result = normalizeError(original)

      //#then
      expect(result.message).toBe("[object Object]")
      expect(result.code).toBeUndefined()
      expect(result.name).toBe("Error")
    })

    it("#then handles object with non-string message", () => {
      //#given
      const original = { message: 123, name: 456 }

      //#when
      const result = normalizeError(original)

      //#then
      expect(result.message).toBe("[object Object]")
      expect(result.name).toBe("Error")
    })

    it("#then captures code even when name/message are missing", () => {
      //#given
      const original = { code: "ENOENT" }

      //#when
      const result = normalizeError(original)

      //#then
      expect(result.code).toBe("ENOENT")
      expect(result.message).toBe("[object Object]")
    })

    it("#then handles null-prototype object", () => {
      //#given
      const original = Object.create(null)
      original.message = "from null proto"

      //#when
      const result = normalizeError(original)

      //#then
      expect(result.message).toBe("from null proto")
      expect(result.name).toBe("Error")
    })
  })

  describe("#given primitive throw", () => {
    it("#then uses string as message", () => {
      //#given
      const original = "something went wrong"

      //#when
      const result = normalizeError(original)

      //#then
      expect(result.message).toBe("something went wrong")
      expect(result.name).toBe("Error")
      expect(result.code).toBeUndefined()
      expect(result.original).toBe(original)
    })

    it("#then converts number to string", () => {
      //#given
      const original = 42

      //#when
      const result = normalizeError(original)

      //#then
      expect(result.message).toBe("42")
    })

    it("#then converts boolean to string", () => {
      //#given
      const original = false

      //#when
      const result = normalizeError(original)

      //#then
      expect(result.message).toBe("false")
    })
  })

  describe("#given null or undefined", () => {
    it("#then returns generic message for null", () => {
      //#given
      const original = null

      //#when
      const result = normalizeError(original)

      //#then
      expect(result.message).toBe("Unknown error (null or undefined)")
      expect(result.name).toBe("Error")
      expect(result.original).toBeNull()
    })

    it("#then returns generic message for undefined", () => {
      //#given
      const original = undefined

      //#when
      const result = normalizeError(original)

      //#then
      expect(result.message).toBe("Unknown error (null or undefined)")
      expect(result.original).toBeUndefined()
    })
  })
})
