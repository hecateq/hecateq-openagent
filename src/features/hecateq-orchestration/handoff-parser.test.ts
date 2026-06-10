import { describe, expect, test } from "bun:test"

import type { HandoffBlock } from "./handoff-parser"
import { parseHandoffBlock, createDefaultHandoffBlock, KNOWN_SIGNAL_NAMES } from "./handoff-parser"
import { getAllSignalNames } from "./signal-registry"

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

// ─── v2 parser coverage (merged from handoff-parser-v2.test.ts) ───────────

describe("parseHandoffBlock v2", () => {
  test("#given v1 block #then parses without v2 fields", () => {
    const input = [
      "STATUS: DONE",
      "SIGNALS_EMITTED: [{\"signal\":\"schema_ready\",\"payload\":{}}]",
      "HANDOFF: return_to_caller",
    ].join("\n")
    const result = parseHandoffBlock(input)
    expect(result.status).toBe("DONE")
    expect(result.signals).toHaveLength(1)
    expect(result.handoff).toBe("return_to_caller")
    expect(result.confidence).toBeNull()
    expect(result.changedFiles).toEqual([])
    expect(result.qualityNotes).toBeNull()
    expect(result.blockers).toEqual([])
    expect(result.nextRecommendedAgent).toBeNull()
  })

  test("#given v2 block with all fields #then parses correctly", () => {
    const input = [
      "STATUS: IN_PROGRESS",
      "SIGNALS_EMITTED: [{\"signal\":\"tests_passed\",\"payload\":{\"count\":42}}]",
      "HANDOFF: hephaestus",
      "CONFIDENCE: 0.85",
      "CHANGED_FILES: [{\"path\":\"src/auth.ts\",\"changeType\":\"modified\"},{\"path\":\"src/types.ts\",\"changeType\":\"modified\"}]",
      "QUALITY_NOTES: Lint checks pass, test coverage at 92%",
      "BLOCKERS: [\"Awaiting PR review on auth module\"]",
      "NEXT_RECOMMENDED_AGENT: oracle",
    ].join("\n")
    const result = parseHandoffBlock(input)
    expect(result.status).toBe("IN_PROGRESS")
    expect(result.signals).toHaveLength(1)
    expect(result.handoff).toBe("hephaestus")
    expect(result.confidence).toBe(0.85)
    expect(result.changedFiles).toHaveLength(2)
    expect(result.changedFiles[0].path).toBe("src/auth.ts")
    expect(result.changedFiles[0].changeType).toBe("modified")
    expect(result.qualityNotes).toContain("92%")
    expect(result.blockers).toHaveLength(1)
    expect(result.blockers[0]).toContain("PR review")
    expect(result.nextRecommendedAgent).toBe("oracle")
  })

  test("#given invalid confidence #then null and warning", () => {
    const input = "CONFIDENCE: not-a-number"
    const result = parseHandoffBlock(input)
    expect(result.confidence).toBeNull()
    expect(result.validationIssues.some((i) => i.field === "CONFIDENCE")).toBe(true)
  })

  test("#given out-of-range confidence #then null and warning", () => {
    const input = "CONFIDENCE: 42"
    const result = parseHandoffBlock(input)
    expect(result.confidence).toBeNull()
    expect(result.validationIssues.some((i) => i.field === "CONFIDENCE")).toBe(true)
  })

  test("#given confidence zero #then valid", () => {
    const input = "CONFIDENCE: 0"
    const result = parseHandoffBlock(input)
    expect(result.confidence).toBe(0)
  })

  test("#given invalid changed files JSON #then empty array and warning", () => {
    const input = 'CHANGED_FILES: {not: "an array"}'
    const result = parseHandoffBlock(input)
    expect(result.changedFiles).toEqual([])
    expect(result.validationIssues.some((i) => i.field === "CHANGED_FILES")).toBe(true)
  })

  test("#given empty blockers #then empty array", () => {
    const input = "BLOCKERS: []"
    const result = parseHandoffBlock(input)
    expect(result.blockers).toEqual([])
  })

  test("#given non-string blockers #then filtered out", () => {
    const input = 'BLOCKERS: ["real blocker", 42, null]'
    const result = parseHandoffBlock(input)
    expect(result.blockers).toEqual(["real blocker"])
  })

  test("#given empty quality notes #then null", () => {
    const input = "QUALITY_NOTES: "
    const result = parseHandoffBlock(input)
    expect(result.qualityNotes).toBeNull()
  })

  test("#given empty next agent #then null", () => {
    const input = "NEXT_RECOMMENDED_AGENT: "
    const result = parseHandoffBlock(input)
    expect(result.nextRecommendedAgent).toBeNull()
  })
})

describe("createDefaultHandoffBlock", () => {
  test("#given minimal overrides #then fills defaults", () => {
    const block = createDefaultHandoffBlock({ status: "DONE", handoff: "return_to_caller" })
    expect(block.status).toBe("DONE")
    expect(block.handoff).toBe("return_to_caller")
    expect(block.signals).toEqual([])
    expect(block.confidence).toBeNull()
    expect(block.changedFiles).toEqual([])
    expect(block.qualityNotes).toBeNull()
    expect(block.blockers).toEqual([])
    expect(block.nextRecommendedAgent).toBeNull()
    expect(block.validationIssues).toEqual([])
    expect(block.raw).toBe("")
  })

  test("#given full overrides #then merges correctly", () => {
    const block = createDefaultHandoffBlock({
      status: "IN_PROGRESS",
      handoff: "hephaestus",
      confidence: 0.9,
      changedFiles: [{ path: "test.ts", changeType: "modified" }],
      qualityNotes: "All good",
      blockers: ["blocker"],
      nextRecommendedAgent: "oracle",
    })
    expect(block.confidence).toBe(0.9)
    expect(block.changedFiles).toHaveLength(1)
    expect(block.qualityNotes).toBe("All good")
    expect(block.blockers).toEqual(["blocker"])
    expect(block.nextRecommendedAgent).toBe("oracle")
  })
})

// ─── Scope area 4: Signal validation & robustness ──────────────────────────

describe("parseHandoffBlock — signal validation (scope area 4)", () => {
  test("#given unknown signal name #then warns but does not crash", () => {
    // given
    const input = [
      "STATUS: DONE",
      'SIGNALS_EMITTED: [{"signal":"not_a_real_signal","payload":{}}]',
      "HANDOFF: return_to_caller",
    ].join("\n")

    // when
    const result = parseHandoffBlock(input)

    // then
    expect(result).not.toBeNull()
    // Unknown signal produces a warning (not an error)
    const signalIssues = result.validationIssues.filter((i) => i.field === "SIGNALS_EMITTED")
    expect(signalIssues.length).toBeGreaterThanOrEqual(1)
    expect(signalIssues.some((i) => i.message.includes("not_a_real_signal") && i.severity === "warning")).toBe(true)
    // Signal is still parsed (not dropped)
    expect(result.signals).toHaveLength(1)
    expect(result.signals[0]?.signal).toBe("not_a_real_signal")
  })

  test("#given known signal name #then no warnings", () => {
    // given
    const input = [
      "STATUS: DONE",
      'SIGNALS_EMITTED: [{"signal":"tests_passed","payload":{"count":42}}]',
      "HANDOFF: return_to_caller",
    ].join("\n")

    // when
    const result = parseHandoffBlock(input)

    // then
    const signalWarnings = result.validationIssues.filter(
      (i) => i.field === "SIGNALS_EMITTED" && i.severity === "warning",
    )
    expect(signalWarnings).toHaveLength(0)
    expect(result.signals).toHaveLength(1)
    expect(result.signals[0]?.signal).toBe("tests_passed")
  })

  test("#given signal missing 'signal' field #then error and skipped", () => {
    // given
    const input = [
      "STATUS: DONE",
      'SIGNALS_EMITTED: [{"payload":{}}]',
      "HANDOFF: return_to_caller",
    ].join("\n")

    // when
    const result = parseHandoffBlock(input)

    // then
    expect(result.signals).toHaveLength(0)
    const signalErrors = result.validationIssues.filter(
      (i) => i.field === "SIGNALS_EMITTED" && i.severity === "error",
    )
    expect(signalErrors.length).toBeGreaterThanOrEqual(1)
    expect(signalErrors.some((i) => i.message.includes("missing required"))).toBe(true)
  })

  test("#given non-object signal element #then error and skipped", () => {
    // given
    const input = [
      "STATUS: DONE",
      'SIGNALS_EMITTED: ["just a string", 42]',
      "HANDOFF: return_to_caller",
    ].join("\n")

    // when
    const result = parseHandoffBlock(input)

    // then
    expect(result.signals).toHaveLength(0)
    const signalErrors = result.validationIssues.filter(
      (i) => i.field === "SIGNALS_EMITTED" && i.severity === "error",
    )
    expect(signalErrors.length).toBeGreaterThanOrEqual(2)
  })

  test("#given unknown handoff target #then warning with structured issue", () => {
    // given
    const input = [
      "STATUS: DONE",
      "SIGNALS_EMITTED: []",
      "HANDOFF: completely_unknown_agent_xyz",
    ].join("\n")

    // when
    const result = parseHandoffBlock(input)

    // then
    expect(result).not.toBeNull()
    expect(result.handoff).toBe("completely_unknown_agent_xyz")
    // Must surface structured issue
    const handoffIssues = result.validationIssues.filter((i) => i.field === "HANDOFF")
    expect(handoffIssues.some((i) => i.message.includes("Unknown handoff target"))).toBe(true)
    expect(handoffIssues.some((i) => i.severity === "warning")).toBe(true)
  })

  test("#given valid agent-id target #then no handoff issues", () => {
    // given
    const input = [
      "STATUS: DONE",
      "SIGNALS_EMITTED: []",
      "HANDOFF: nodejs-backend-developer",
    ].join("\n")

    // when
    const result = parseHandoffBlock(input)

    // then
    const handoffIssues = result.validationIssues.filter((i) => i.field === "HANDOFF")
    expect(handoffIssues).toHaveLength(0)
  })

  test("#given known routing directive target #then no handoff issues", () => {
    // given
    const input = [
      "STATUS: DONE",
      "SIGNALS_EMITTED: []",
      "HANDOFF: return_to_parent_for_routing",
    ].join("\n")

    // when
    const result = parseHandoffBlock(input)

    // then
    const handoffIssues = result.validationIssues.filter((i) => i.field === "HANDOFF")
    expect(handoffIssues).toHaveLength(0)
  })
})

describe("KNOWN_SIGNAL_NAMES — scope area 4", () => {
  test("#given signal registry #then matches expected known signals", () => {
    expect(KNOWN_SIGNAL_NAMES.has("schema_ready")).toBe(true)
    expect(KNOWN_SIGNAL_NAMES.has("backend_ready")).toBe(true)
    expect(KNOWN_SIGNAL_NAMES.has("tests_passed")).toBe(true)
    expect(KNOWN_SIGNAL_NAMES.has("performance_verified")).toBe(true)
    expect(KNOWN_SIGNAL_NAMES.has("compliance_signed")).toBe(true)
    expect(KNOWN_SIGNAL_NAMES.has("nonexistent_signal")).toBe(false)
  })

  test("#given signal-registry #then KNOWN_SIGNAL_NAMES exactly mirrors getAllSignalNames()", () => {
    // given
    const registryNames = getAllSignalNames()

    // when — compare the parser mirror to the canonical registry
    const parserNames = [...KNOWN_SIGNAL_NAMES]
    const parserSet = new Set(parserNames)
    const registrySet = new Set(registryNames)

    // then — exact match: no signals missing from parser, no extra signals in parser
    const missingFromParser = registryNames.filter((n) => !parserSet.has(n))
    const extraInParser = parserNames.filter((n) => !registrySet.has(n))

    expect(missingFromParser).toEqual([])
    expect(extraInParser).toEqual([])
    expect(parserNames.length).toBe(registryNames.length)
  })
})

// ─── Scope area 4: Parser never throws guarantee ────────────────────────────

describe("parseHandoffBlock — never-throw guarantee (scope area 4)", () => {
  test("#given null input #then returns structured result", () => {
    const result = parseHandoffBlock(null as unknown as string)
    expect(result).not.toBeNull()
    expect(result.status).toBeNull()
    expect(result.validationIssues.length).toBeGreaterThanOrEqual(1)
  })

  test("#given undefined input #then returns structured result", () => {
    const result = parseHandoffBlock(undefined as unknown as string)
    expect(result).not.toBeNull()
    expect(result.validationIssues.length).toBeGreaterThanOrEqual(1)
  })

  test("#given huge input with garbage #then does not throw", () => {
    const hugeGarbage = "x".repeat(10000) + "\n" + "STATUS: RANDOM" + "\n" + "y".repeat(10000)
    expect(() => parseHandoffBlock(hugeGarbage)).not.toThrow()
  })

  test("#given input with only unknown lines #then returns structured result with issues", () => {
    const input = [
      "This is not a handoff block",
      "Neither is this",
      "Just some random text",
    ].join("\n")
    const result = parseHandoffBlock(input)
    expect(result).not.toBeNull()
    // Missing STATUS should produce a warning
    expect(result.validationIssues.some((i) => i.field === "STATUS")).toBe(true)
    // Missing HANDOFF should produce a warning
    expect(result.validationIssues.some((i) => i.field === "HANDOFF")).toBe(true)
  })
})
