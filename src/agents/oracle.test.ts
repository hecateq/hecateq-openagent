import { describe, test, expect } from "bun:test"
import { createOracleAgent } from "./oracle"

describe("createOracleAgent", () => {
  test("returns an object with agent configuration", () => {
    // given
    const model = "openai/gpt-5.4"

    // when
    const config = createOracleAgent(model)

    // then
    expect(config).toBeDefined()
    expect(typeof config).toBe("object")
  })

  test("mode is subagent", () => {
    // given
    const model = "openai/gpt-5.4"

    // when
    const config = createOracleAgent(model)

    // then
    expect(config.mode).toBe("subagent")
  })

  test("static mode property is subagent", () => {
    // given / when / then
    expect(createOracleAgent.mode).toBe("subagent")
  })

  test("description contains consultation agent text", () => {
    // given
    const model = "openai/gpt-5.4"

    // when
    const config = createOracleAgent(model)

    // then
    expect(config.description).toContain("Read-only consultation agent")
    expect(config.description).toContain("Oracle")
  })

  test("model is passed through", () => {
    // given
    const model = "openai/gpt-5.4"

    // when
    const config = createOracleAgent(model)

    // then
    expect(config.model).toBe("openai/gpt-5.4")
  })

  test("temperature is 0.1", () => {
    // given
    const model = "openai/gpt-5.4"

    // when
    const config = createOracleAgent(model)

    // then
    expect(config.temperature).toBe(0.1)
  })

  test("has a prompt string", () => {
    // given
    const model = "openai/gpt-5.4"

    // when
    const config = createOracleAgent(model)

    // then
    expect(config.prompt).toBeDefined()
    expect(typeof config.prompt).toBe("string")
    expect((config.prompt as string).length).toBeGreaterThan(100)
  })

  test("has tool restrictions blocking write, edit, apply_patch, task", () => {
    // given
    const model = "openai/gpt-5.4"

    // when
    const config = createOracleAgent(model)

    // then
    expect(config.permission).toHaveProperty("write", "deny")
    expect(config.permission).toHaveProperty("edit", "deny")
    expect(config.permission).toHaveProperty("apply_patch", "deny")
    expect(config.permission).toHaveProperty("task", "deny")
  })

  test("#given GPT-5.5 model #when agent is created #then uses reasoningEffort and textVerbosity", () => {
    // given
    const model = "openai/gpt-5.5"

    // when
    const config = createOracleAgent(model)

    // then
    expect(config.reasoningEffort).toBe("medium")
    expect(config.textVerbosity).toBe("high")
    expect(config.thinking).toBeUndefined()
  })

  test("#given GPT-5.2 model #when agent is created #then uses reasoningEffort and textVerbosity", () => {
    // given
    const model = "openai/gpt-5.2"

    // when
    const config = createOracleAgent(model)

    // then
    expect(config.reasoningEffort).toBe("medium")
    expect(config.textVerbosity).toBe("high")
    expect(config.thinking).toBeUndefined()
  })

  test("#given generic GPT model #when agent is created #then uses reasoningEffort and textVerbosity", () => {
    // given
    const model = "openai/gpt-4o"

    // when
    const config = createOracleAgent(model)

    // then
    expect(config.reasoningEffort).toBe("medium")
    expect(config.textVerbosity).toBe("high")
    expect(config.thinking).toBeUndefined()
  })

  test("#given Claude model #when agent is created #then uses thinking config", () => {
    // given
    const model = "anthropic/claude-opus-4-7"

    // when
    const config = createOracleAgent(model)

    // then
    expect(config.thinking).toBeDefined()
    expect(config.thinking).toEqual({ type: "enabled", budgetTokens: 32000 })
    expect(config.reasoningEffort).toBeUndefined()
    expect(config.textVerbosity).toBeUndefined()
  })

  test("#given Gemini model #when agent is created #then uses thinking config (non-GPT path)", () => {
    // given
    const model = "google/gemini-2.0-pro"

    // when
    const config = createOracleAgent(model)

    // then
    expect(config.thinking).toBeDefined()
    expect(config.thinking).toEqual({ type: "enabled", budgetTokens: 32000 })
    expect(config.reasoningEffort).toBeUndefined()
  })
})
