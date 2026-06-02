import { describe, expect, it } from "bun:test"

import {
  CHANGE_IMPACT_MAX_ENTRIES,
  DECISIONS_JSONL_MAX_BYTES,
  DECISIONS_JSONL_MAX_LINES,
  QUALITY_HISTORY_MAX_ENTRIES,
  QUALITY_HISTORY_PRESERVE_LATEST_FAILURE,
  RISK_PROFILE_MAX_RESOLVED_RISKS,
  RUN_CONTINUATION_MARKER_MAX_AGE_DAYS,
  RUN_CONTINUATION_MAX_MARKERS,
  TASKS_JSONL_MAX_BYTES,
  TASKS_JSONL_MAX_LINES,
} from "./memory-retention-policy"

describe("memory-retention-policy", () => {
  describe("#given the retention policy constants", () => {
    it("tasks.jsonl line limit is 1000", () => {
      expect(TASKS_JSONL_MAX_LINES).toBe(1000)
    })

    it("tasks.jsonl byte limit is 1_000_000", () => {
      expect(TASKS_JSONL_MAX_BYTES).toBe(1_000_000)
    })

    it("decisions.jsonl line limit is 500", () => {
      expect(DECISIONS_JSONL_MAX_LINES).toBe(500)
    })

    it("decisions.jsonl byte limit is 750_000", () => {
      expect(DECISIONS_JSONL_MAX_BYTES).toBe(750_000)
    })

    it("quality history max entries is 20", () => {
      expect(QUALITY_HISTORY_MAX_ENTRIES).toBe(20)
    })

    it("quality history preserve latest failure is true", () => {
      expect(QUALITY_HISTORY_PRESERVE_LATEST_FAILURE).toBe(true)
    })

    it("risk profile max resolved risks is 50", () => {
      expect(RISK_PROFILE_MAX_RESOLVED_RISKS).toBe(50)
    })

    it("change impact max entries is 100", () => {
      expect(CHANGE_IMPACT_MAX_ENTRIES).toBe(100)
    })

    it("run-continuation marker max age is 30 days", () => {
      expect(RUN_CONTINUATION_MARKER_MAX_AGE_DAYS).toBe(30)
    })

    it("run-continuation max markers is 200", () => {
      expect(RUN_CONTINUATION_MAX_MARKERS).toBe(200)
    })

    it("all limits are positive integers", () => {
      const limits = [
        TASKS_JSONL_MAX_LINES,
        TASKS_JSONL_MAX_BYTES,
        DECISIONS_JSONL_MAX_LINES,
        DECISIONS_JSONL_MAX_BYTES,
        QUALITY_HISTORY_MAX_ENTRIES,
        RISK_PROFILE_MAX_RESOLVED_RISKS,
        CHANGE_IMPACT_MAX_ENTRIES,
        RUN_CONTINUATION_MARKER_MAX_AGE_DAYS,
        RUN_CONTINUATION_MAX_MARKERS,
      ]
      for (const limit of limits) {
        expect(limit).toBeGreaterThan(0)
      }
    })
  })
})
