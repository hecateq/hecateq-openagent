import { describe, expect, test } from "bun:test"
import {
  DEFAULT_MAX_AGE_MS,
  isAgentInLiveRegistry,
  isIndexFresh,
} from "./agent-index-freshness"

const MS_PER_DAY = 86_400_000

// ─── isAgentInLiveRegistry ────────────────────────────────────────────────────

describe("isAgentInLiveRegistry", () => {
  test("#given agent in registry #then returns true", () => {
    const result = isAgentInLiveRegistry(
      "nodejs-backend-developer",
      new Set(["nodejs-backend-developer", "hephaestus"]),
    )
    expect(result).toBe(true)
  })

  test("#given agent NOT in registry #then returns false", () => {
    const result = isAgentInLiveRegistry(
      "missing-agent",
      new Set(["hephaestus"]),
    )
    expect(result).toBe(false)
  })

  test("#given case mismatch #then returns true (case-insensitive)", () => {
    const result = isAgentInLiveRegistry(
      "NODEJS-Backend-Developer",
      new Set(["nodejs-backend-developer"]),
    )
    expect(result).toBe(true)
  })

  test("#given empty registry #then returns false", () => {
    const result = isAgentInLiveRegistry(
      "any-agent",
      new Set<string>(),
    )
    expect(result).toBe(false)
  })

  test("#given agent with surrounding spaces #then returns false (exact match)", () => {
    const result = isAgentInLiveRegistry(
      " nodejs-backend-developer ",
      new Set(["nodejs-backend-developer"]),
    )
    expect(result).toBe(false)
  })
})

// ─── isIndexFresh ─────────────────────────────────────────────────────────────

describe("isIndexFresh", () => {
  test("#given requireFresh=false #then always returns fresh regardless of timestamp", () => {
    const eightDaysAgo = new Date(Date.now() - 8 * MS_PER_DAY).toISOString()
    const result = isIndexFresh(eightDaysAgo, false)
    expect(result).toEqual({ fresh: true, ageMs: 0 })
  })

  test("#given current timestamp and requireFresh=true #then returns fresh with near-zero age", () => {
    const now = new Date().toISOString()
    const result = isIndexFresh(now, true)
    expect(result.fresh).toBe(true)
    expect(result.ageMs).toBeGreaterThanOrEqual(0)
    expect(result.ageMs).toBeLessThan(10_000) // within 10 seconds
  })

  test("#given 8 days ago and default 7-day maxAge #then returns stale", () => {
    const eightDaysAgo = new Date(Date.now() - 8 * MS_PER_DAY).toISOString()
    const result = isIndexFresh(eightDaysAgo, true)
    expect(result.fresh).toBe(false)
    // ~8 days in ms, allow +-1 hour for test timing
    expect(result.ageMs).toBeGreaterThan(7 * MS_PER_DAY)
    expect(result.ageMs).toBeLessThan(9 * MS_PER_DAY)
  })

  test("#given 8 days ago and 14-day custom maxAge #then returns fresh", () => {
    const eightDaysAgo = new Date(Date.now() - 8 * MS_PER_DAY).toISOString()
    const result = isIndexFresh(eightDaysAgo, true, 14 * MS_PER_DAY)
    expect(result.fresh).toBe(true)
    expect(result.ageMs).toBeGreaterThan(7 * MS_PER_DAY)
  })

  test("#given 1 hour ago and default 7-day maxAge #then returns fresh", () => {
    const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString()
    const result = isIndexFresh(oneHourAgo, true)
    expect(result.fresh).toBe(true)
    expect(result.ageMs).toBeGreaterThan(0)
    expect(result.ageMs).toBeLessThan(7_200_000) // within 2 hours
  })

  test("#given malformed timestamp #then returns not fresh with NaN age", () => {
    const result = isIndexFresh("not-a-timestamp", true)
    expect(result.fresh).toBe(false)
    expect(Number.isNaN(result.ageMs)).toBe(true)
  })

  test("#given empty string timestamp #then returns not fresh with NaN age", () => {
    const result = isIndexFresh("", true)
    expect(result.fresh).toBe(false)
    expect(Number.isNaN(result.ageMs)).toBe(true)
  })

  test("#given exact boundary: age equals maxAge #then returns fresh", () => {
    const exactlySevenDaysAgo = new Date(Date.now() - DEFAULT_MAX_AGE_MS).toISOString()
    const result = isIndexFresh(exactlySevenDaysAgo, true)
    expect(result.fresh).toBe(true)
  })

  test("#given one millisecond over maxAge #then returns stale", () => {
    const justOver = new Date(Date.now() - (DEFAULT_MAX_AGE_MS + 1)).toISOString()
    const result = isIndexFresh(justOver, true)
    expect(result.fresh).toBe(false)
  })
})
