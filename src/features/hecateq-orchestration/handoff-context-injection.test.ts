import { describe, expect, test } from "bun:test"

import type { HandoffBlock } from "./handoff-parser"
import type { HandoffContextSummary } from "./handoff-context-injection"

// These tests MUST fail until buildHandoffContextSummary is implemented.
// They lock the expected contract for Hecateq context injection.

describe("buildHandoffContextSummary — contract tests", () => {
  // ─── Requirement 7: Context injection surfaces compact handoff summary ─────

  test("#given complete HandoffBlock with DONE status #then summary contains status and target", () => {
    // given
    const handoff: HandoffBlock = {
      status: "DONE",
      signals: [{ signal: "tests_passed", payload: {} }],
      handoff: "return_to_caller",
      validationIssues: [],
      raw: "STATUS: DONE\nSIGNALS_EMITTED: [{\"signal\":\"tests_passed\",\"payload\":{}}]\nHANDOFF: return_to_caller",
    }

    // when
    const result: HandoffContextSummary | null = (() => {
      try {
        const { buildHandoffContextSummary } = require("./handoff-context-injection") as {
          buildHandoffContextSummary: (h: HandoffBlock | null) => HandoffContextSummary
        }
        return buildHandoffContextSummary(handoff)
      } catch {
        return null
      }
    })()

    // then — produces a compact summary with key handoff fields
    expect(result).not.toBeNull()
    expect(result!.hasHandoff).toBe(true)
    expect(result!.signalCount).toBe(1)
    expect(result!.summary.length).toBeGreaterThan(0)
    // Summary should mention the status
    expect(result!.summary).toMatch(/DONE/)
    // Summary should mention the target
    expect(result!.summary).toMatch(/return_to_caller/)
  })

  test("#given null handoff #then summary has hasHandoff=false and empty text", () => {
    // given
    const handoff = null

    // when
    const result: HandoffContextSummary | null = (() => {
      try {
        const { buildHandoffContextSummary } = require("./handoff-context-injection")
        return buildHandoffContextSummary(handoff)
      } catch {
        return null
      }
    })()

    // then
    expect(result).not.toBeNull()
    expect(result!.hasHandoff).toBe(false)
    expect(result!.signalCount).toBe(0)
    expect(result!.summary).toBe("")
  })

  test("#given IN_PROGRESS handoff with agent target #then summary contains agent id", () => {
    // given
    const handoff: HandoffBlock = {
      status: "IN_PROGRESS",
      signals: [{ signal: "backend_ready", payload: {} }],
      handoff: "nodejs-backend-developer",
      validationIssues: [],
      raw: "STATUS: IN_PROGRESS\nSIGNALS_EMITTED: [{\"signal\":\"backend_ready\",\"payload\":{}}]\nHANDOFF: nodejs-backend-developer",
    }

    // when
    const result: HandoffContextSummary | null = (() => {
      try {
        const { buildHandoffContextSummary } = require("./handoff-context-injection")
        return buildHandoffContextSummary(handoff)
      } catch {
        return null
      }
    })()

    // then
    expect(result).not.toBeNull()
    expect(result!.hasHandoff).toBe(true)
    expect(result!.summary).toMatch(/IN_PROGRESS/)
    expect(result!.summary).toMatch(/nodejs-backend-developer/)
  })

  test("#given BLOCKED handoff with multiple signals #then summary includes signal count", () => {
    // given
    const handoff: HandoffBlock = {
      status: "BLOCKED",
      signals: [
        { signal: "schema_ready", payload: {} },
        { signal: "performance_verified", payload: { score: 0.9 } },
      ],
      handoff: "return_to_parent_for_routing",
      validationIssues: [],
      raw: "STATUS: BLOCKED\nSIGNALS_EMITTED: [{\"signal\":\"schema_ready\",\"payload\":{}},{\"signal\":\"performance_verified\",\"payload\":{\"score\":0.9}}]\nHANDOFF: return_to_parent_for_routing",
    }

    // when
    const result: HandoffContextSummary | null = (() => {
      try {
        const { buildHandoffContextSummary } = require("./handoff-context-injection")
        return buildHandoffContextSummary(handoff)
      } catch {
        return null
      }
    })()

    // then
    expect(result).not.toBeNull()
    expect(result!.hasHandoff).toBe(true)
    expect(result!.signalCount).toBe(2)
    expect(result!.summary).toMatch(/BLOCKED/)
  })

  test("#given handoff with validation issues #then summary includes issue count", () => {
    // given
    const handoff: HandoffBlock = {
      status: null,
      signals: [],
      handoff: null,
      validationIssues: [
        { field: "STATUS", message: "Invalid status value", severity: "error" },
        { field: "HANDOFF", message: "Missing handoff target", severity: "error" },
      ],
      raw: "",
    }

    // when
    const result: HandoffContextSummary | null = (() => {
      try {
        const { buildHandoffContextSummary } = require("./handoff-context-injection")
        return buildHandoffContextSummary(handoff)
      } catch {
        return null
      }
    })()

    // then
    expect(result).not.toBeNull()
    expect(result!.hasHandoff).toBe(true)
    expect(result!.summary.length).toBeGreaterThan(0)
    // Should mention validation issues
    expect(result!.summary).toMatch(/validation/i)
  })
})
