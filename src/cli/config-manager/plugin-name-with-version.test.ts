/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test"

import { getPluginNameWithVersion } from "../config-manager"
import { unsafeTestValue } from "../../testing/unsafe-test-value"

describe("getPluginNameWithVersion", () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test("returns the canonical latest tag when current version matches latest", async () => {
    //#given
    globalThis.fetch = unsafeTestValue<typeof fetch>(mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ latest: "3.13.1", beta: "3.14.0-beta.1" }),
      } as Response)
    ))

    //#when
    const result = await getPluginNameWithVersion("3.13.1")

    //#then
    expect(result).toBe("oh-my-openagent@latest")
  })

  test("preserves the canonical prerelease channel when fetch fails", async () => {
    //#given
    globalThis.fetch = unsafeTestValue<typeof fetch>(mock(() => Promise.reject(new Error("Network error"))))

    //#when
    const result = await getPluginNameWithVersion("3.14.0-beta.1")

    //#then
    expect(result).toBe("oh-my-openagent@beta")
  })

  test("returns the canonical bare package name for stable fallback", async () => {
    //#given
    globalThis.fetch = unsafeTestValue<typeof fetch>(mock(() =>
      Promise.resolve({
        ok: false,
        status: 404,
      } as Response)
    ))

    //#when
    const result = await getPluginNameWithVersion("3.13.1")

    //#then
    expect(result).toBe("oh-my-openagent")
  })

  test("returns Hecateq scoped package with prerelease tag for beta version", async () => {
    //#given
    globalThis.fetch = unsafeTestValue<typeof fetch>(mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ latest: "3.13.1", beta: "0.1.0-beta.2" }),
      } as Response)
    ))

    //#when
    const result = await getPluginNameWithVersion("0.1.0-beta.2", "@hecateq/hecateq-openagent")

    //#then
    expect(result).toBe("@hecateq/hecateq-openagent@beta")
  })

  test("returns Hecateq scoped package for stable fallback when fetch fails", async () => {
    //#given
    globalThis.fetch = unsafeTestValue<typeof fetch>(mock(() => Promise.reject(new Error("Network error"))))

    //#when
    const result = await getPluginNameWithVersion("0.1.0", "@hecateq/hecateq-openagent")

    //#then
    expect(result).toBe("@hecateq/hecateq-openagent")
  })

  test("returns Hecateq scoped package with prerelease tag for hecateq alpha version", async () => {
    //#given
    globalThis.fetch = unsafeTestValue<typeof fetch>(mock(() => Promise.reject(new Error("Network error"))))

    //#when
    const result = await getPluginNameWithVersion("0.1.0-alpha.3", "@hecateq/hecateq-openagent")

    //#then
    expect(result).toBe("@hecateq/hecateq-openagent@alpha")
  })
})
