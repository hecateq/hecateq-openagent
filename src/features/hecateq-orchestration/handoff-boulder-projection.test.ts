import { describe, expect, test } from "bun:test"

import type { HandoffBlock } from "./handoff-parser"
import type { HandoffProjectionOptions, HandoffProjectionResult } from "./handoff-boulder-projection"

// These tests MUST fail until projectHandoffToBoulder is implemented.
// They lock the expected contract: a parsed handoff can be projected
// into Boulder task session state.

describe("projectHandoffToBoulder — contract tests", () => {
  // ─── Requirement 5: Parsed handoff can be projected into Boulder state ─────

  test("#given valid handoff block #then projects into boulder task session", () => {
    // given
    const handoff: HandoffBlock = {
      status: "DONE",
      signals: [{ signal: "tests_passed", payload: {} }],
      handoff: "return_to_caller",
      validationIssues: [],
      raw: "STATUS: DONE\nSIGNALS_EMITTED: [{\"signal\":\"tests_passed\",\"payload\":{}}]\nHANDOFF: return_to_caller",
    }
    const options: HandoffProjectionOptions = {
      workId: "plan-abc123",
      boulderDir: "/tmp/test-boulder",
    }

    // when
    const result: HandoffProjectionResult | null = (() => {
      try {
        const mod = require("./handoff-boulder-projection") as {
          projectHandoffToBoulder: (h: HandoffBlock, o: HandoffProjectionOptions) => HandoffProjectionResult
        }
        return mod.projectHandoffToBoulder(handoff, options)
      } catch {
        return null
      }
    })()

    // then
    expect(result).not.toBeNull()
    expect(result!.projected).toBe(true)
    expect(result!.status).toBe("DONE")
    expect(result!.signalCount).toBe(1)
    expect(result!.handoffTarget).toBe("return_to_caller")
    expect(result!.errors).toHaveLength(0)
  })

  test("#given IN_PROGRESS handoff with multi-signals #then projects correctly", () => {
    // given
    const handoff: HandoffBlock = {
      status: "IN_PROGRESS",
      signals: [
        { signal: "schema_ready", payload: { version: 2 } },
        { signal: "backend_ready", payload: {} },
      ],
      handoff: "nodejs-backend-developer",
      validationIssues: [],
      raw: "STATUS: IN_PROGRESS\nSIGNALS_EMITTED: [{\"signal\":\"schema_ready\",\"payload\":{\"version\":2}},{\"signal\":\"backend_ready\",\"payload\":{}}]\nHANDOFF: nodejs-backend-developer",
    }
    const options: HandoffProjectionOptions = {
      workId: "plan-def456",
      boulderDir: "/tmp/test-boulder",
    }

    // when
    const result: HandoffProjectionResult | null = (() => {
      try {
        const mod = require("./handoff-boulder-projection")
        return mod.projectHandoffToBoulder(handoff, options)
      } catch {
        return null
      }
    })()

    // then
    expect(result).not.toBeNull()
    expect(result!.projected).toBe(true)
    expect(result!.signalCount).toBe(2)
    expect(result!.status).toBe("IN_PROGRESS")
  })

  test("#given handoff with validation issues #then still projects with error list", () => {
    // given — the parser may still return issues but we can project anyway
    const handoff: HandoffBlock = {
      status: null,
      signals: [],
      handoff: null,
      validationIssues: [
        { field: "STATUS", message: "Missing STATUS line", severity: "warning" },
        { field: "HANDOFF", message: "Missing HANDOFF line", severity: "warning" },
      ],
      raw: "",
    }
    const options: HandoffProjectionOptions = {
      workId: "plan-ghi789",
      boulderDir: "/tmp/test-boulder",
    }

    // when
    const result: HandoffProjectionResult | null = (() => {
      try {
        const mod = require("./handoff-boulder-projection")
        return mod.projectHandoffToBoulder(handoff, options)
      } catch {
        return null
      }
    })()

    // then — should still project but with status null and error reflections
    expect(result).not.toBeNull()
    expect(result!.projected).toBe(true)
    expect(result!.status).toBeNull()
    expect(result!.handoffTarget).toBeNull()
  })

  test("#given BLOCKED handoff #then projects status correctly", () => {
    // given
    const handoff: HandoffBlock = {
      status: "BLOCKED",
      signals: [],
      handoff: "return_to_parent_for_routing",
      validationIssues: [],
      raw: "STATUS: BLOCKED\nSIGNALS_EMITTED: []\nHANDOFF: return_to_parent_for_routing",
    }
    const options: HandoffProjectionOptions = {
      workId: "plan-blocked-1",
      boulderDir: "/tmp/test-boulder",
    }

    // when
    const result: HandoffProjectionResult | null = (() => {
      try {
        const mod = require("./handoff-boulder-projection")
        return mod.projectHandoffToBoulder(handoff, options)
      } catch {
        return null
      }
    })()

    // then
    expect(result).not.toBeNull()
    expect(result!.projected).toBe(true)
    expect(result!.status).toBe("BLOCKED")
    expect(result!.handoffTarget).toBe("return_to_parent_for_routing")
  })
})

describe("readHandoffFromBoulder — contract test", () => {
  test("#given boulder dir with projected handoff #then reads handoff back", () => {
    // given
    const boulderDir = "/tmp/test-boulder-read"
    const workId = "plan-read-1"

    // when
    const result: HandoffBlock | null = (() => {
      try {
        const mod = require("./handoff-boulder-projection") as {
          readHandoffFromBoulder: (dir: string, id: string) => HandoffBlock | null
        }
        return mod.readHandoffFromBoulder(boulderDir, workId)
      } catch {
        return null
      }
    })()

    // then — round-trips through Boulder state
    expect(result).not.toBeNull()
    expect(result!.status).toBeOneOf(["DONE", "IN_PROGRESS", "BLOCKED", null])
    expect(Array.isArray(result!.signals)).toBe(true)
    expect(typeof result!.raw).toBe("string")
  })

  test("#given nonexistent boulder dir #then returns null gracefully", () => {
    // given
    const boulderDir = "/tmp/nonexistent-boulder"
    const workId = "nonexistent-work"

    // when — Must NOT throw, returns null
    const { readHandoffFromBoulder } = require("./handoff-boulder-projection") as {
      readHandoffFromBoulder: (dir: string, id: string) => HandoffBlock | null
    }
    const result = readHandoffFromBoulder(boulderDir, workId)

    // then
    expect(result).toBeNull()
  })
})
