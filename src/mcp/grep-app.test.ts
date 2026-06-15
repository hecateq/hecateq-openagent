/// <reference types="bun-types" />

import { describe, test, expect, spyOn, beforeEach, afterEach } from "bun:test"
import * as logger from "../shared/logger"

let logSpy: ReturnType<typeof spyOn>
let createGrepAppConfig: (typeof import("./grep-app"))["createGrepAppConfig"]

async function importFreshGrepAppModule(): Promise<typeof import("./grep-app")> {
  return import(`./grep-app?test=${Date.now()}-${Math.random()}`)
}

beforeEach(async () => {
  logSpy = spyOn(logger, "log").mockImplementation(() => {})
  ;({ createGrepAppConfig } = await importFreshGrepAppModule())
})

afterEach(() => {
  logSpy.mockRestore()
})

describe("createGrepAppConfig default behavior", () => {
  test("returns valid remote config with default URL when no arguments provided", () => {
    // when
    const config = createGrepAppConfig()

    // then
    expect(config).toBeDefined()
    expect(config?.type).toBe("remote")
    expect(config?.url).toBe("https://mcp.grep.app")
    expect(config?.enabled).toBe(true)
    expect(config?.oauth).toBe(false)
  })

  test("logs registration message on successful config creation", () => {
    // when
    createGrepAppConfig()

    // then
    expect(logSpy).toHaveBeenCalledWith("[grep_app] Registering grep_app remote MCP")
  })
})

describe("createGrepAppConfig custom URL", () => {
  test("uses custom URL when provided in config", () => {
    // when
    const config = createGrepAppConfig({ url: "https://custom-grep.example.com" })

    // then
    expect(config).toBeDefined()
    expect(config?.url).toBe("https://custom-grep.example.com")
  })

  test("accepts HTTP URLs (not just HTTPS)", () => {
    // when
    const config = createGrepAppConfig({ url: "http://localhost:3000" })

    // then
    expect(config).toBeDefined()
    expect(config?.url).toBe("http://localhost:3000")
  })
})

describe("createGrepAppConfig disabled state", () => {
  test("returns undefined when explicitly disabled", () => {
    // when
    const config = createGrepAppConfig({ enabled: false })

    // then
    expect(config).toBeUndefined()
  })

  test("logs skip message when explicitly disabled", () => {
    // when
    createGrepAppConfig({ enabled: false })

    // then
    expect(logSpy).toHaveBeenCalledWith("[grep_app] grep_app MCP explicitly disabled via config")
  })

  test("returns config when enabled is explicitly true", () => {
    // when
    const config = createGrepAppConfig({ enabled: true })

    // then
    expect(config).toBeDefined()
    expect(config?.enabled).toBe(true)
  })
})

describe("createGrepAppConfig URL validation", () => {
  test("returns undefined for empty string URL", () => {
    // when
    const config = createGrepAppConfig({ url: "" })

    // then
    expect(config).toBeUndefined()
  })

  test("logs warning for invalid URL", () => {
    // when
    createGrepAppConfig({ url: "" })

    // then
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("[grep_app] Invalid MCP URL"))
  })

  test("returns undefined for non-HTTP protocol (ftp)", () => {
    // when
    const config = createGrepAppConfig({ url: "ftp://files.example.com" })

    // then
    expect(config).toBeUndefined()
  })

  test("returns undefined for javascript: protocol", () => {
    // when
    const config = createGrepAppConfig({ url: "javascript:alert(1)" })

    // then
    expect(config).toBeUndefined()
  })

  test("returns undefined for completely malformed URL", () => {
    // when
    const config = createGrepAppConfig({ url: "not a url at all" })

    // then
    expect(config).toBeUndefined()
  })

  test("includes the invalid URL in the log message", () => {
    // when
    createGrepAppConfig({ url: "ftp://bad.example.com" })

    // then
    expect(logSpy).toHaveBeenCalledWith("[grep_app] Invalid MCP URL \"ftp://bad.example.com\", skipping grep_app MCP")
  })
})

describe("createGrepAppConfig config shape", () => {
  test("does not include headers field when no auth is needed", () => {
    // when
    const config = createGrepAppConfig()

    // then
    expect(config).not.toHaveProperty("headers")
  })

  test("returns oauth: false to disable OAuth flow", () => {
    // when
    const config = createGrepAppConfig()

    // then
    expect(config?.oauth).toBe(false)
  })
})

describe("grep_app static export backward compatibility", () => {
  test("static export is defined and has correct shape", async () => {
    // when
    const { grep_app } = await importFreshGrepAppModule()

    // then
    expect(grep_app).toBeDefined()
    expect(grep_app?.type).toBe("remote")
    expect(grep_app?.url).toBe("https://mcp.grep.app")
    expect(grep_app?.enabled).toBe(true)
    expect(grep_app?.oauth).toBe(false)
  })
})
