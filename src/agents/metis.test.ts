import { describe, test, expect } from "bun:test"
import { createMetisAgent, metisPromptMetadata, METIS_SYSTEM_PROMPT } from "./metis"

describe("createMetisAgent", () => {
  test("returns an object with agent configuration", () => {
    // given
    const model = "anthropic/claude-sonnet-4-6"

    // when
    const config = createMetisAgent(model)

    // then
    expect(config).toBeDefined()
    expect(typeof config).toBe("object")
  })

  test("mode is subagent", () => {
    // given
    const model = "anthropic/claude-sonnet-4-6"

    // when
    const config = createMetisAgent(model)

    // then
    expect(config.mode).toBe("subagent")
  })

  test("static mode property is subagent", () => {
    // given / when / then
    expect(createMetisAgent.mode).toBe("subagent")
  })

  test("description contains pre-planning consultant text", () => {
    // given
    const model = "anthropic/claude-sonnet-4-6"

    // when
    const config = createMetisAgent(model)

    // then
    expect(config.description).toContain("Pre-planning consultant")
    expect(config.description).toContain("Metis")
  })

  test("model is passed through", () => {
    // given
    const model = "openai/gpt-5.4"

    // when
    const config = createMetisAgent(model)

    // then
    expect(config.model).toBe("openai/gpt-5.4")
  })

  test("temperature is 0.3", () => {
    // given
    const model = "anthropic/claude-sonnet-4-6"

    // when
    const config = createMetisAgent(model)

    // then
    expect(config.temperature).toBe(0.3)
  })

  test("has a prompt string containing Metis identity", () => {
    // given
    const model = "anthropic/claude-sonnet-4-6"

    // when
    const config = createMetisAgent(model)

    // then
    expect(config.prompt).toBeDefined()
    expect(typeof config.prompt).toBe("string")
    expect((config.prompt as string)).toContain("Metis")
    expect((config.prompt as string)).toContain("Pre-Planning Consultant")
  })

  test("has thinking config with budget tokens", () => {
    // given
    const model = "anthropic/claude-sonnet-4-6"

    // when
    const config = createMetisAgent(model)

    // then
    expect(config.thinking).toBeDefined()
    expect(config.thinking).toEqual({ type: "enabled", budgetTokens: 32000 })
  })

  test("has tool restrictions blocking write, edit, apply_patch", () => {
    // given
    const model = "anthropic/claude-sonnet-4-6"

    // when
    const config = createMetisAgent(model)

    // then
    expect(config.permission).toHaveProperty("write", "deny")
    expect(config.permission).toHaveProperty("edit", "deny")
    expect(config.permission).toHaveProperty("apply_patch", "deny")
  })

  test("does not block task tool (allowed by default)", () => {
    // given
    const model = "anthropic/claude-sonnet-4-6"

    // when
    const config = createMetisAgent(model)

    // then
    // Metis only blocks write, edit, apply_patch — task and call_omo_agent are not restricted
    expect(config.permission).not.toHaveProperty("task")
    expect(config.permission).not.toHaveProperty("call_omo_agent")
  })
})

describe("metisPromptMetadata", () => {
  test("has expected category and cost", () => {
    // given / when / then
    expect(metisPromptMetadata.category).toBe("advisor")
    expect(metisPromptMetadata.cost).toBe("EXPENSIVE")
    expect(metisPromptMetadata.promptAlias).toBe("Metis")
  })

  test("has triggers defined", () => {
    // given / when / then
    expect(metisPromptMetadata.triggers).toBeDefined()
    expect(metisPromptMetadata.triggers.length).toBeGreaterThanOrEqual(1)
    expect(metisPromptMetadata.triggers[0]).toHaveProperty("domain")
    expect(metisPromptMetadata.triggers[0]).toHaveProperty("trigger")
  })

  test("has useWhen and avoidWhen sections", () => {
    // given / when / then
    expect(metisPromptMetadata.useWhen).toBeDefined()
    expect(metisPromptMetadata.useWhen!.length).toBeGreaterThanOrEqual(1)
    expect(metisPromptMetadata.avoidWhen).toBeDefined()
    expect(metisPromptMetadata.avoidWhen!.length).toBeGreaterThanOrEqual(1)
  })
})

describe("METIS_SYSTEM_PROMPT", () => {
  test("contains core sections", () => {
    // given / when / then
    expect(METIS_SYSTEM_PROMPT).toContain("Metis")
    expect(METIS_SYSTEM_PROMPT).toContain("Pre-Planning Consultant")
    expect(METIS_SYSTEM_PROMPT).toContain("PHASE 0: INTENT CLASSIFICATION")
    expect(METIS_SYSTEM_PROMPT).toContain("CRITICAL RULES")
  })
})
