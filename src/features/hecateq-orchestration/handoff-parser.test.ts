import { describe, expect, test } from "bun:test"

import type { HandoffBlock } from "./handoff-parser"

// These tests MUST fail until parseHandoffBlock is implemented.
// They lock the expected contract for a real runtime handoff parser.

describe("parseHandoffBlock — contract tests", () => {
  // ─── Requirement 1: Parse valid handoff block ──────────────────────────────

  test("#given complete valid handoff block #then normalizes all fields", () => {
    // given
    const input = [
      "STATUS: DONE",
      'SIGNALS_EMITTED: [{"signal":"schema_ready","payload":{"version":1}}]',
      "HANDOFF: return_to_caller",
    ].join("\n")

    // when
    const result: HandoffBlock = (() => {
      try {
        const { parseHandoffBlock } = require("./handoff-parser") as { parseHandoffBlock: (s: string) => HandoffBlock }
        return parseHandoffBlock(input)
      } catch {
        return null as unknown as HandoffBlock
      }
    })()

    // then
    expect(result).not.toBeNull()
    expect(result.status).toBe("DONE")
    expect(result.signals).toHaveLength(1)
    expect(result.signals[0]?.signal).toBe("schema_ready")
    expect(result.signals[0]?.payload).toEqual({ version: 1 })
    expect(result.handoff).toBe("return_to_caller")
    expect(result.validationIssues).toHaveLength(0)
    expect(result.raw).toBe(input)
  })

  test("#given handoff block with multi-signal #then parses all signals", () => {
    // given
    const input = [
      "STATUS: IN_PROGRESS",
      'SIGNALS_EMITTED: [{"signal":"tests_passed","payload":{}},{"signal":"performance_verified","payload":{"score":0.95}}]',
      "HANDOFF: return_to_parent_for_routing",
    ].join("\n")

    // when
    const result: HandoffBlock = (() => {
      try {
        const { parseHandoffBlock } = require("./handoff-parser")
        return parseHandoffBlock(input)
      } catch {
        return null as unknown as HandoffBlock
      }
    })()

    // then
    expect(result).not.toBeNull()
    expect(result.status).toBe("IN_PROGRESS")
    expect(result.signals).toHaveLength(2)
    expect(result.signals[0]?.signal).toBe("tests_passed")
    expect(result.signals[1]?.signal).toBe("performance_verified")
    expect(result.signals[1]?.payload).toEqual({ score: 0.95 })
    expect(result.handoff).toBe("return_to_parent_for_routing")
    expect(result.validationIssues).toHaveLength(0)
  })

  test("#given handoff block with agent-id target #then parses agent string", () => {
    // given
    const input = [
      "STATUS: DONE",
      "SIGNALS_EMITTED: []",
      "HANDOFF: nodejs-backend-developer",
    ].join("\n")

    // when
    const result: HandoffBlock = (() => {
      try {
        const { parseHandoffBlock } = require("./handoff-parser")
        return parseHandoffBlock(input)
      } catch {
        return null as unknown as HandoffBlock
      }
    })()

    // then
    expect(result).not.toBeNull()
    expect(result.handoff).toBe("nodejs-backend-developer")
    expect(result.validationIssues).toHaveLength(0)
  })

  test("#given BLOCKED status #then parses correctly", () => {
    // given
    const input = [
      "STATUS: BLOCKED",
      "SIGNALS_EMITTED: []",
      "HANDOFF: return_to_caller",
    ].join("\n")

    // when
    const result: HandoffBlock = (() => {
      try {
        const { parseHandoffBlock } = require("./handoff-parser")
        return parseHandoffBlock(input)
      } catch {
        return null as unknown as HandoffBlock
      }
    })()

    // then
    expect(result).not.toBeNull()
    expect(result.status).toBe("BLOCKED")
    expect(result.validationIssues).toHaveLength(0)
  })

  // ─── Requirement 2: Missing or invalid STATUS degrades safely ──────────────

  test("#given missing STATUS line #then degrades to null with warning", () => {
    // given
    const input = [
      "SIGNALS_EMITTED: []",
      "HANDOFF: return_to_caller",
    ].join("\n")

    // when
    const result: HandoffBlock = (() => {
      try {
        const { parseHandoffBlock } = require("./handoff-parser")
        return parseHandoffBlock(input)
      } catch {
        return null as unknown as HandoffBlock
      }
    })()

    // then
    expect(result).not.toBeNull()
    expect(result.status).toBeNull()
    expect(result.validationIssues).toHaveLength(1)
    expect(result.validationIssues[0]?.field).toBe("STATUS")
    expect(result.validationIssues[0]?.severity).toBe("warning")
  })

  test("#given unknown STATUS value #then degrades to null with error", () => {
    // given
    const input = [
      "STATUS: MAYBE",
      "SIGNALS_EMITTED: []",
      "HANDOFF: return_to_caller",
    ].join("\n")

    // when
    const result: HandoffBlock = (() => {
      try {
        const { parseHandoffBlock } = require("./handoff-parser")
        return parseHandoffBlock(input)
      } catch {
        return null as unknown as HandoffBlock
      }
    })()

    // then
    expect(result).not.toBeNull()
    expect(result.status).toBeNull()
    expect(result.validationIssues).toHaveLength(1)
    expect(result.validationIssues[0]?.field).toBe("STATUS")
    expect(result.validationIssues[0]?.severity).toBe("error")
  })

  test("#given empty STATUS value #then degrades to null with error", () => {
    // given
    const input = [
      "STATUS: ",
      "SIGNALS_EMITTED: []",
      "HANDOFF: return_to_caller",
    ].join("\n")

    // when
    const result: HandoffBlock = (() => {
      try {
        const { parseHandoffBlock } = require("./handoff-parser")
        return parseHandoffBlock(input)
      } catch {
        return null as unknown as HandoffBlock
      }
    })()

    // then
    expect(result).not.toBeNull()
    expect(result.status).toBeNull()
    expect(result.validationIssues.some((i) => i.field === "STATUS")).toBe(true)
  })

  test("#given STATUS with case variation #then normalizes case-insensitively", () => {
    // given
    const input = [
      "STATUS: done",
      "SIGNALS_EMITTED: []",
      "HANDOFF: return_to_caller",
    ].join("\n")

    // when
    const result: HandoffBlock = (() => {
      try {
        const { parseHandoffBlock } = require("./handoff-parser")
        return parseHandoffBlock(input)
      } catch {
        return null as unknown as HandoffBlock
      }
    })()

    // then — lowercase status should be accepted as DONE
    expect(result).not.toBeNull()
    expect(result.status).toBe("DONE")
    expect(result.validationIssues).toHaveLength(0)
  })

  // ─── Requirement 3: Invalid SIGNALS_EMITTED JSON is captured, not crash ───

  test("#given malformed JSON in SIGNALS_EMITTED #then captures validation issue", () => {
    // given
    const input = [
      "STATUS: DONE",
      "SIGNALS_EMITTED: [{signal: broken}]",
      "HANDOFF: return_to_caller",
    ].join("\n")

    // when
    const result: HandoffBlock = (() => {
      try {
        const { parseHandoffBlock } = require("./handoff-parser")
        return parseHandoffBlock(input)
      } catch {
        return null as unknown as HandoffBlock
      }
    })()

    // then
    expect(result).not.toBeNull()
    // Must NOT crash — field is captured as validation issue
    expect(result.validationIssues.some((i) => i.field === "SIGNALS_EMITTED")).toBe(true)
    // Signals should be empty array on failure
    expect(result.signals).toEqual([])
  })

  test("#given non-array JSON in SIGNALS_EMITTED #then captures validation issue", () => {
    // given
    const input = [
      "STATUS: DONE",
      'SIGNALS_EMITTED: {"signal":"test"}',
      "HANDOFF: return_to_caller",
    ].join("\n")

    // when
    const result: HandoffBlock = (() => {
      try {
        const { parseHandoffBlock } = require("./handoff-parser")
        return parseHandoffBlock(input)
      } catch {
        return null as unknown as HandoffBlock
      }
    })()

    // then
    expect(result).not.toBeNull()
    expect(result.validationIssues.some((i) => i.field === "SIGNALS_EMITTED")).toBe(true)
    expect(result.signals).toEqual([])
  })

  test("#given missing SIGNALS_EMITTED line #then defaults to empty array", () => {
    // given
    const input = [
      "STATUS: DONE",
      "HANDOFF: return_to_caller",
    ].join("\n")

    // when
    const result: HandoffBlock = (() => {
      try {
        const { parseHandoffBlock } = require("./handoff-parser")
        return parseHandoffBlock(input)
      } catch {
        return null as unknown as HandoffBlock
      }
    })()

    // then
    expect(result).not.toBeNull()
    expect(result.signals).toEqual([])
    expect(result.validationIssues).toHaveLength(0)
  })

  // ─── Requirement 4: Unknown HANDOFF target is flagged invalid ──────────────

  test("#given empty HANDOFF target #then flagged invalid with error", () => {
    // given
    const input = [
      "STATUS: DONE",
      "SIGNALS_EMITTED: []",
      "HANDOFF: ",
    ].join("\n")

    // when
    const result: HandoffBlock = (() => {
      try {
        const { parseHandoffBlock } = require("./handoff-parser")
        return parseHandoffBlock(input)
      } catch {
        return null as unknown as HandoffBlock
      }
    })()

    // then
    expect(result).not.toBeNull()
    expect(result.handoff).toBeNull()
    expect(result.validationIssues.some((i) => i.field === "HANDOFF")).toBe(true)
  })

  test("#given missing HANDOFF line #then handoff is null with warning", () => {
    // given
    const input = [
      "STATUS: DONE",
      "SIGNALS_EMITTED: []",
    ].join("\n")

    // when
    const result: HandoffBlock = (() => {
      try {
        const { parseHandoffBlock } = require("./handoff-parser")
        return parseHandoffBlock(input)
      } catch {
        return null as unknown as HandoffBlock
      }
    })()

    // then
    expect(result).not.toBeNull()
    expect(result.handoff).toBeNull()
    expect(result.validationIssues.some((i) => i.field === "HANDOFF")).toBe(true)
  })

  // ─── Never-throw guarantee ─────────────────────────────────────────────────

  test("#given completely empty input #then produces valid block with null values", () => {
    // given
    const input = ""

    // when
    const result: HandoffBlock = (() => {
      try {
        const { parseHandoffBlock } = require("./handoff-parser")
        return parseHandoffBlock(input)
      } catch {
        return null as unknown as HandoffBlock
      }
    })()

    // then
    expect(result).not.toBeNull()
    expect(result.raw).toBe("")
    expect(result.status).toBeNull()
    expect(result.signals).toEqual([])
    expect(result.handoff).toBeNull()
    // Should have at least 1 validation issue (missing STATUS)
    expect(result.validationIssues.length).toBeGreaterThanOrEqual(1)
  })

  test("#given input with extra whitespace #then trims and parses", () => {
    // given
    const input = [
      "   STATUS:   DONE   ",
      "  SIGNALS_EMITTED: []",
      "  HANDOFF: return_to_caller  ",
    ].join("\n")

    // when
    const result: HandoffBlock = (() => {
      try {
        const { parseHandoffBlock } = require("./handoff-parser")
        return parseHandoffBlock(input)
      } catch {
        return null as unknown as HandoffBlock
      }
    })()

    // then
    expect(result).not.toBeNull()
    expect(result.status).toBe("DONE")
    expect(result.handoff).toBe("return_to_caller")
  })

  test("#given input with extra lines #then ignores unknown lines", () => {
    // given
    const input = [
      "Some preamble content",
      "STATUS: DONE",
      "SIGNALS_EMITTED: []",
      "Some commentary in between",
      "HANDOFF: return_to_caller",
      "trailing content",
    ].join("\n")

    // when
    const result: HandoffBlock = (() => {
      try {
        const { parseHandoffBlock } = require("./handoff-parser")
        return parseHandoffBlock(input)
      } catch {
        return null as unknown as HandoffBlock
      }
    })()

    // then
    expect(result).not.toBeNull()
    expect(result.status).toBe("DONE")
    expect(result.handoff).toBe("return_to_caller")
    expect(result.signals).toEqual([])
    expect(result.validationIssues).toHaveLength(0)
  })

  test("#given input containing multiple STATUS lines #then last one wins", () => {
    // given
    const input = [
      "STATUS: DONE",
      "STATUS: IN_PROGRESS",
      "SIGNALS_EMITTED: []",
      "HANDOFF: return_to_caller",
    ].join("\n")

    // when
    const result: HandoffBlock = (() => {
      try {
        const { parseHandoffBlock } = require("./handoff-parser")
        return parseHandoffBlock(input)
      } catch {
        return null as unknown as HandoffBlock
      }
    })()

    // then
    expect(result).not.toBeNull()
    expect(result.status).toBe("IN_PROGRESS")
  })
})

describe("getKnownAgentIds — contract test", () => {
  test("#given no stub agents #then returns minimal known set", () => {
    // when
    const { getKnownAgentIds } = require("./handoff-parser") as { getKnownAgentIds: () => string[] }
    const ids = getKnownAgentIds()

    // then
    expect(ids).toBeDefined()
    expect(Array.isArray(ids)).toBe(true)
    // At minimum should include the canonical handoff targets
    expect(ids.length).toBeGreaterThan(0)
  })
})
