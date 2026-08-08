import { describe, expect, test } from "bun:test"
import { validateHandoffWithRepair } from "./handoff-runtime-validator"
import { parseHandoffBlock } from "./handoff-parser"

describe("validateHandoffWithRepair", () => {
  test("#given a valid handoff block #then accepts with repaired=false", () => {
    // given
    const input = [
      "STATUS: DONE",
      'SIGNALS_EMITTED: [{"signal":"schema_ready","payload":{}}]',
      "HANDOFF: return_to_caller",
    ].join("\n")
    // when
    const result = validateHandoffWithRepair(input)
    // then
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.repaired).toBe(false)
      expect(result.block.status).toBe("DONE")
      expect(result.block.handoff).toBe("return_to_caller")
    }
  })

  test("#given a block with only warnings #then accepts with repaired=false", () => {
    // given — missing STATUS/HANDOFF lines are warnings, not errors
    const input = "some free text without handoff lines"
    // when
    const result = validateHandoffWithRepair(input)
    // then
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.repaired).toBe(false)
    }
  })

  test("#given a malformed block repairable by loose parse #then accepts with repaired=true", () => {
    // given — SIGNALS_EMITTED is not valid JSON (error), but STATUS+HANDOFF are usable
    const input = [
      "STATUS: DONE",
      "SIGNALS_EMITTED: not-json",
      "HANDOFF: return_to_caller",
    ].join("\n")
    // when
    const result = validateHandoffWithRepair(input)
    // then
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.repaired).toBe(true)
      expect(result.block.status).toBe("DONE")
      expect(result.block.handoff).toBe("return_to_caller")
    }
  })

  test("#given a malformed block that fails even loose parse #then blocks", () => {
    // given — invalid STATUS value and empty HANDOFF survive loose parse as null
    const input = ["STATUS: BOGUS_STATUS", "HANDOFF:"].join("\n")
    // when
    const result = validateHandoffWithRepair(input)
    // then
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.block).toBeNull()
      expect(result.blocker).toMatch(/STATUS|HANDOFF/)
    }
  })

  test("#given a non-string input #then handles it without throwing", () => {
    // given
    const input = 12345
    // when
    const result = validateHandoffWithRepair(input)
    // then
    expect(result.ok).toBe(true)
  })
})

describe("parseHandoffBlock loose option", () => {
  test("#given loose=true #then strict errors are downgraded to warnings", () => {
    // given
    const input = ["STATUS: BOGUS_STATUS", "HANDOFF: return_to_caller"].join("\n")
    // when
    const strict = parseHandoffBlock(input)
    const loose = parseHandoffBlock(input, { loose: true })
    // then
    expect(strict.validationIssues.some((issue) => issue.severity === "error")).toBe(true)
    expect(loose.validationIssues.some((issue) => issue.severity === "error")).toBe(false)
    expect(loose.validationIssues.some((issue) => issue.severity === "warning")).toBe(true)
  })

  test("#given loose=true with non-string input #then errors are downgraded", () => {
    // given
    const input = null as unknown as string
    // when
    const strict = parseHandoffBlock(input)
    const loose = parseHandoffBlock(input, { loose: true })
    // then
    expect(strict.validationIssues.some((issue) => issue.severity === "error")).toBe(true)
    expect(loose.validationIssues.some((issue) => issue.severity === "error")).toBe(false)
  })
})
