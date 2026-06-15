import { describe, it, expect } from "bun:test"
import { isModuleResolutionFailure } from "./is-module-resolution-failure"

function createResolveMessage(): object {
  return Object.assign(Object.create(null), {
    name: "ResolveMessage",
    message: "Cannot find module '@ast-grep/napi'",
    code: "ERR_MODULE_NOT_FOUND",
    stack: "ResolveMessage: Cannot find module '@ast-grep/napi'",
    specifier: "@ast-grep/napi",
    referrer: "/some/file.ts",
  })
}

describe("isModuleResolutionFailure", () => {
  describe("#given MODULE_NOT_FOUND code (Node.js CJS)", () => {
    it("#then returns true", () => {
      //#given
      const error = new Error("Cannot find module 'foo'")
      ;(error as NodeJS.ErrnoException).code = "MODULE_NOT_FOUND"

      //#when
      const result = isModuleResolutionFailure(error)

      //#then
      expect(result).toBe(true)
    })
  })

  describe("#given ERR_MODULE_NOT_FOUND code (Node.js ESM)", () => {
    it("#then returns true", () => {
      //#given
      const error = new Error("Cannot find module 'foo'")
      ;(error as NodeJS.ErrnoException).code = "ERR_MODULE_NOT_FOUND"

      //#when
      const result = isModuleResolutionFailure(error)

      //#then
      expect(result).toBe(true)
    })
  })

  describe("#given Bun ResolveMessage (non-Error object)", () => {
    it("#then returns true via name check", () => {
      //#given
      const error = createResolveMessage()

      //#when
      const result = isModuleResolutionFailure(error)

      //#then
      expect(result).toBe(true)
    })

    it("#then returns true via constructor name check", () => {
      //#given — ResolveMessage-like with no name property, only constructor.name
      class ResolveMessage {
        message = "Cannot find module 'bar'"
        code = "ERR_MODULE_NOT_FOUND"
      }
      const error = new ResolveMessage()

      //#when
      const result = isModuleResolutionFailure(error)

      //#then
      expect(result).toBe(true)
    })
  })

  describe("#given require.resolve() failure", () => {
    it("#then returns true", () => {
      //#given — typical createRequire().resolve() failure
      const error = new Error("Cannot find module '@code-yeongyu/comment-checker/package.json'")
      ;(error as NodeJS.ErrnoException).code = "MODULE_NOT_FOUND"

      //#when
      const result = isModuleResolutionFailure(error)

      //#then
      expect(result).toBe(true)
    })
  })

  describe("#given dynamic import() failure", () => {
    it("#then returns true when message matches 'Cannot find module'", () => {
      //#given
      const error = new Error("Cannot find module '@ast-grep/napi'")
      ;(error as NodeJS.ErrnoException).code = "ERR_MODULE_NOT_FOUND"

      //#when
      const result = isModuleResolutionFailure(error)

      //#then
      expect(result).toBe(true)
    })

    it("#then returns true when message matches 'Module not found'", () => {
      //#given — Bun's dynamic import error message pattern
      const error = Object.assign(Object.create(null), {
        name: "ResolveMessage",
        message: "Module not found: ./nonexistent",
      })

      //#when
      const result = isModuleResolutionFailure(error)

      //#then
      expect(result).toBe(true)
    })
  })

  describe("#given optional dependency not found scenario", () => {
    it("#then returns true for @ast-grep/napi", () => {
      //#given — typical scenario when @ast-grep/napi is not installed
      const error = new Error("Cannot find module '@ast-grep/napi'")
      ;(error as NodeJS.ErrnoException).code = "MODULE_NOT_FOUND"

      //#when
      const result = isModuleResolutionFailure(error)

      //#then
      expect(result).toBe(true)
    })
  })

  describe("#given permission error (EACCES)", () => {
    it("#then returns false", () => {
      //#given
      const error = new Error("EACCES: permission denied")
      ;(error as NodeJS.ErrnoException).code = "EACCES"
      ;(error as NodeJS.ErrnoException).errno = -13

      //#when
      const result = isModuleResolutionFailure(error)

      //#then
      expect(result).toBe(false)
    })
  })

  describe("#given permission error (EPERM)", () => {
    it("#then returns false", () => {
      //#given
      const error = new Error("EPERM: operation not permitted")
      ;(error as NodeJS.ErrnoException).code = "EPERM"

      //#when
      const result = isModuleResolutionFailure(error)

      //#then
      expect(result).toBe(false)
    })
  })

  describe("#given syntax error in loaded module", () => {
    it("#then returns false (SyntaxError)", () => {
      //#given
      const error = new SyntaxError("Unexpected token 'export'")

      //#when
      const result = isModuleResolutionFailure(error)

      //#then
      expect(result).toBe(false)
    })

    it("#then returns false even when message mentions module", () => {
      //#given — a real SyntaxError whose message happens to contain "module"
      const error = new SyntaxError("Unexpected token 'export' in module 'foo'")

      //#when
      const result = isModuleResolutionFailure(error)

      //#then
      expect(result).toBe(false)
    })
  })

  describe("#given runtime TypeError in loaded module", () => {
    it("#then returns false", () => {
      //#given
      const error = new TypeError("Cannot read properties of undefined (reading 'config')")

      //#when
      const result = isModuleResolutionFailure(error)

      //#then
      expect(result).toBe(false)
    })
  })

  describe("#given filesystem error (ENOENT)", () => {
    it("#then returns false", () => {
      //#given — ENOENT is a filesystem error, NOT module resolution
      const error = new Error("ENOENT: no such file or directory, open 'foo.json'")
      ;(error as NodeJS.ErrnoException).code = "ENOENT"

      //#when
      const result = isModuleResolutionFailure(error)

      //#then
      expect(result).toBe(false)
    })
  })

  describe("#given corrupt package runtime error", () => {
    it("#then returns false", () => {
      //#given — module loaded but threw during init
      const error = new Error("Cannot find module 'lodash/merge'")
      ;(error as NodeJS.ErrnoException).code = "MODULE_NOT_FOUND"

      //#when
      const result = isModuleResolutionFailure(error)

      //#then this IS a module resolution failure — the sub-path doesn't exist
      expect(result).toBe(true)
    })
  })

  describe("#given null or undefined", () => {
    it("#then returns false for null", () => {
      expect(isModuleResolutionFailure(null)).toBe(false)
    })

    it("#then returns false for undefined", () => {
      expect(isModuleResolutionFailure(undefined)).toBe(false)
    })
  })

  describe("#given string throw", () => {
    it("#then returns false for generic string", () => {
      //#given
      const error = "something bad happened"

      //#when
      const result = isModuleResolutionFailure(error)

      //#then
      expect(result).toBe(false)
    })

    it("#then returns true for 'Cannot find module' string", () => {
      //#given — string throw with resolution-like message
      const error = "Cannot find module 'foo'"

      //#when
      const result = isModuleResolutionFailure(error)

      //#then message pattern catches it
      expect(result).toBe(true)
    })
  })

  describe("#given unknown object throw", () => {
    it("#then returns false", () => {
      //#given
      const error = { type: "unknown", detail: "something broke" }

      //#when
      const result = isModuleResolutionFailure(error)

      //#then
      expect(result).toBe(false)
    })
  })
})
