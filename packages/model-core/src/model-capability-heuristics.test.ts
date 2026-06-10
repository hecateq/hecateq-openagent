import { describe, expect, test } from "bun:test"

import { detectHeuristicModelFamily, HEURISTIC_MODEL_FAMILY_REGISTRY } from "./model-capability-heuristics"

describe("detectHeuristicModelFamily", () => {
  // #given a set of Qwen model IDs across different naming patterns
  const qwenModels = [
    "qwen-plus",
    "qwen-max",
    "qwen3.5-plus",
    "qwen3-235b-a22b",
    "qwen-flash",
    "qwen-vl-plus",
    "qwq-32b",
  ]

  test.each(qwenModels)("detects bare Qwen model ID %s as qwen family", (modelID) => {
    // #when
    const result = detectHeuristicModelFamily(modelID)

    // #then
    expect(result).toBeDefined()
    expect(result!.family).toBe("qwen")
  })

  test("detects provider-prefixed Qwen model IDs", () => {
    // #given
    const modelIDs = [
      "dashscope/qwen-plus",
      "alibaba/qwen-max",
    ]

    for (const modelID of modelIDs) {
      // #when
      const result = detectHeuristicModelFamily(modelID)

      // #then
      expect(result).toBeDefined()
      expect(result!.family).toBe("qwen")
    }
  })

  test("detects dotted Qwen version as qwen family (normalization test)", () => {
    // #given — the normalizeModelID function replaces dots with dashes
    const modelID = "qwen3.5-plus"

    // #when
    const result = detectHeuristicModelFamily(modelID)

    // #then
    expect(result).toBeDefined()
    expect(result!.family).toBe("qwen")
  })

  test("detects QwQ reasoning models as qwen family", () => {
    // #given
    const modelID = "qwq-32b"

    // #when
    const result = detectHeuristicModelFamily(modelID)

    // #then
    expect(result).toBeDefined()
    expect(result!.family).toBe("qwen")
  })

  test("returns qwen family definition with correct properties", () => {
    // #given
    const modelID = "qwen-plus"

    // #when
    const result = detectHeuristicModelFamily(modelID)

    // #then
    expect(result).toBeDefined()
    expect(result!.family).toBe("qwen")
    expect(result!.includes).toContain("qwen")
    expect(result!.includes).toContain("qwq")
    expect(result!.variants).toEqual(["low", "medium", "high"])
    expect(result!.reasoningEfforts).toEqual(["low", "medium", "high"])
    expect(result!.supportsThinking).toBe(true)
  })

  test("does not detect non-Qwen models as qwen family", () => {
    // #given
    const modelIDs = [
      "gpt-4o",
      "claude-opus-4-7",
      "gemini-2.5-pro",
      "deepseek-v3",
      "mistral-large",
      "llama-4",
    ]

    for (const modelID of modelIDs) {
      // #when
      const result = detectHeuristicModelFamily(modelID)

      // #then — these should all match other families, not qwen
      if (result) {
        expect(result.family).not.toBe("qwen")
      }
    }
  })

  test("deepseek-r1-distill-qwen-32b matches deepseek family, not qwen (registry order)", () => {
    // #given: distill models contain "deepseek" AND "qwen" as substrings
    // deepseek entry comes before qwen in HEURISTIC_MODEL_FAMILY_REGISTRY
    const modelID = "deepseek-r1-distill-qwen-32b"

    // #when
    const result = detectHeuristicModelFamily(modelID)

    // #then
    expect(result).toBeDefined()
    expect(result!.family).toBe("deepseek")
  })

  test("returns undefined for unknown model IDs", () => {
    // #given
    const modelID = "some-random-model-v2"

    // #when
    const result = detectHeuristicModelFamily(modelID)

    // #then
    expect(result).toBeUndefined()
  })
})

describe("HEURISTIC_MODEL_FAMILY_REGISTRY", () => {
  test("includes the qwen entry", () => {
    // #when
    const qwenEntry = HEURISTIC_MODEL_FAMILY_REGISTRY.find(
      (entry) => entry.family === "qwen",
    )

    // #then
    expect(qwenEntry).toBeDefined()
    expect(qwenEntry!.includes).toContain("qwen")
    expect(qwenEntry!.includes).toContain("qwq")
    expect(qwenEntry!.variants).toEqual(["low", "medium", "high"])
    expect(qwenEntry!.supportsThinking).toBe(true)
  })
})
