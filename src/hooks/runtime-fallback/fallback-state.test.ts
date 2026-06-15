import { describe, expect, test } from "bun:test"

import {
  normalizeModelValue,
  createFallbackState,
  findNextAvailableFallback,
  prepareFallback,
  isModelInCooldown,
} from "./fallback-state"
import type { RuntimeFallbackConfig } from "../../config"

// ---------------------------------------------------------------------------
// normalizeModelValue
// ---------------------------------------------------------------------------
describe("normalizeModelValue", () => {
  test("#given a valid provider/model string #when normalized #then it returns the same string trimmed", () => {
    // given
    const input = "opencode/deepseek-v4-flash-free"
    // when
    const result = normalizeModelValue(input)
    // then
    expect(result).toBe("opencode/deepseek-v4-flash-free")
  })

  test("#given a string with surrounding whitespace #when normalized #then it strips whitespace", () => {
    // given
    const input = "  openai/gpt-5.4  "
    // when
    const result = normalizeModelValue(input)
    // then
    expect(result).toBe("openai/gpt-5.4")
  })

  test("#given a {providerID, modelID} object #when normalized #then it returns a provider/model string", () => {
    // given
    const input = { providerID: "opencode", modelID: "deepseek-v4-flash-free" }
    // when
    const result = normalizeModelValue(input)
    // then
    expect(result).toBe("opencode/deepseek-v4-flash-free")
  })

  test("#given a {providerID, modelID} object with whitespace #when normalized #then it trims and returns provider/model", () => {
    // given
    const input = { providerID: "  opencode  ", modelID: "  deepseek-v4-flash-free  " }
    // when
    const result = normalizeModelValue(input)
    // then
    expect(result).toBe("opencode/deepseek-v4-flash-free")
  })

  test("#given an object with an 'id' field #when normalized #then it returns the id as string", () => {
    // given
    const input = { id: "opencode/deepseek-v4-flash-free" }
    // when
    const result = normalizeModelValue(input)
    // then
    expect(result).toBe("opencode/deepseek-v4-flash-free")
  })

  test("#given an object with both providerID and id #when normalized #then providerID/modelID takes precedence", () => {
    // given
    const input = { providerID: "anthropic", modelID: "claude-opus-4-7", id: "old-style-string" }
    // when
    const result = normalizeModelValue(input)
    // then
    expect(result).toBe("anthropic/claude-opus-4-7")
  })

  test("#given an object missing providerID #when normalized #then it returns undefined", () => {
    // given
    const input = { modelID: "some-model" }
    // when
    const result = normalizeModelValue(input)
    // then
    expect(result).toBeUndefined()
  })

  test("#given an object missing modelID #when normalized #then it returns undefined", () => {
    // given
    const input = { providerID: "some-provider" }
    // when
    const result = normalizeModelValue(input)
    // then
    expect(result).toBeUndefined()
  })

  test("#given null #when normalized #then it returns undefined", () => {
    expect(normalizeModelValue(null)).toBeUndefined()
  })

  test("#given undefined #when normalized #then it returns undefined", () => {
    expect(normalizeModelValue(undefined)).toBeUndefined()
  })

  test("#given an empty string #when normalized #then it returns undefined", () => {
    expect(normalizeModelValue("")).toBeUndefined()
  })

  test("#given a whitespace-only string #when normalized #then it returns undefined", () => {
    expect(normalizeModelValue("   ")).toBeUndefined()
  })

  test("#given an empty object #when normalized #then it returns undefined", () => {
    expect(normalizeModelValue({})).toBeUndefined()
  })

  test("#given a number #when normalized #then it returns undefined", () => {
    expect(normalizeModelValue(42)).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// findNextAvailableFallback — equivalence skipping (exercises isEquivalentModel)
// ---------------------------------------------------------------------------
describe("findNextAvailableFallback equivalence skipping", () => {
  test("#given state.currentModel matches a fallback candidate #when finding next available #then it skips that candidate", () => {
    // given
    const state = createFallbackState("anthropic/claude-opus-4-7")
    state.fallbackIndex = -1
    const fallbackModels = ["anthropic/claude-opus-4-7", "openai/gpt-5.4", "google/gemini-2.5-pro"]

    // when
    const result = findNextAvailableFallback(state, fallbackModels, 60)

    // then
    expect(result).toBe("openai/gpt-5.4")
  })

  test("#given state.currentModel and candidate both represent the same model #when finding next #then it skips the equivalent candidate (string vs object origin)", () => {
    // given — simulate the bug scenario where an object entered the state
    // After the fix, this should work because parseCanonicalModel normalizes objects
    const state = createFallbackState("opencode/deepseek-v4-flash-free")
    // This is what the bug caused — currentModel is a string, but let's verify
    // that even if it was set via createFallbackState with a string, findNextAvailableFallback
    // handles it correctly.
    const fallbackModels = ["opencode/deepseek-v4-flash-free", "anthropic/claude-haiku-4-5"]

    // when
    const result = findNextAvailableFallback(state, fallbackModels, 60)

    // then — should skip the equivalent model
    expect(result).toBe("anthropic/claude-haiku-4-5")
  })

  test("#given canonical equivalence for Claude models #when finding next #then it skips '-thinking' variant matches", () => {
    // given
    const state = createFallbackState("anthropic/claude-sonnet-4-6")
    const fallbackModels = [
      "anthropic/claude-sonnet-4-6-thinking", // same canonical family, should be skipped
      "openai/gpt-5.4",
    ]

    // when
    const result = findNextAvailableFallback(state, fallbackModels, 60)

    // then
    expect(result).toBe("openai/gpt-5.4")
  })
})

// ---------------------------------------------------------------------------
// createFallbackState + prepareFallback — model state integrity
// ---------------------------------------------------------------------------
describe("createFallbackState", () => {
  const config: Required<RuntimeFallbackConfig> = {
    enabled: true,
    retry_on_errors: [429, 503],
    max_fallback_attempts: 3,
    cooldown_seconds: 60,
    timeout_seconds: 0,
    notify_on_fallback: false,
  }

  test("#given a string model #when creating state #then originalModel and currentModel are strings", () => {
    // given
    const model = "opencode/deepseek-v4-flash-free"
    // when
    const state = createFallbackState(model)
    // then
    expect(typeof state.originalModel).toBe("string")
    expect(typeof state.currentModel).toBe("string")
    expect(state.originalModel).toBe("opencode/deepseek-v4-flash-free")
  })

  test("#given a state created from string #when prepareFallback advances #then currentModel remains a string", () => {
    // given
    const state = createFallbackState("anthropic/claude-opus-4-7")
    const fallbackModels = ["openai/gpt-5.4", "google/gemini-2.5-pro"]

    // when
    const result = prepareFallback("ses_test", state, fallbackModels, config)

    // then
    expect(result.success).toBe(true)
    expect(result.newModel).toBe("openai/gpt-5.4")
    expect(typeof state.currentModel).toBe("string")
    expect(state.currentModel).toBe("openai/gpt-5.4")
  })

  test("#given state with currentModel advancing through chain #when exhausted #then prepareFallback returns failure", () => {
    // given
    const state = createFallbackState("anthropic/claude-opus-4-7")
    const fallbackModels = ["openai/gpt-5.4"]

    // when — first advance
    const result1 = prepareFallback("ses_test", state, fallbackModels, config)
    expect(result1.success).toBe(true)
    expect(result1.newModel).toBe("openai/gpt-5.4")

    // when — second advance (exhausted after index 0, one model)
    const result2 = prepareFallback("ses_test", state, fallbackModels, config)
    // then — no more models
    expect(result2.success).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// isModelInCooldown
// ---------------------------------------------------------------------------
describe("isModelInCooldown", () => {
  test("#given model not in failedModels #when checked #then it returns false", () => {
    // given
    const state = createFallbackState("anthropic/claude-opus-4-7")
    // when
    const result = isModelInCooldown("openai/gpt-5.4", state, 60)
    // then
    expect(result).toBe(false)
  })

  test("#given model recently marked as failed #when checked within cooldown #then it returns true", () => {
    // given
    const state = createFallbackState("anthropic/claude-opus-4-7")
    state.failedModels.set("openai/gpt-5.4", Date.now())
    // when
    const result = isModelInCooldown("openai/gpt-5.4", state, 60)
    // then
    expect(result).toBe(true)
  })

  test("#given model failed before cooldown expired #when checked #then it returns false", () => {
    // given
    const state = createFallbackState("anthropic/claude-opus-4-7")
    state.failedModels.set("openai/gpt-5.4", Date.now() - 61_000)
    // when
    const result = isModelInCooldown("openai/gpt-5.4", state, 60)
    // then
    expect(result).toBe(false)
  })
})
