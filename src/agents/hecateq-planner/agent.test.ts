import { describe, test, expect } from "bun:test"
import { createHecateqPlannerAgent, HECATEQ_PLANNER_PROMPT } from "./agent"

describe("createHecateqPlannerAgent", () => {
  test("returns an object with agent configuration", () => {
    // given
    const model = "openai/gpt-5.4"

    // when
    const config = createHecateqPlannerAgent(model)

    // then
    expect(config).toBeDefined()
    expect(typeof config).toBe("object")
  })

  test("mode is subagent", () => {
    // given
    const model = "openai/gpt-5.4"

    // when
    const config = createHecateqPlannerAgent(model)

    // then
    expect(config.mode).toBe("subagent")
  })

  test("static mode property is subagent", () => {
    // given / when / then
    expect(createHecateqPlannerAgent.mode).toBe("subagent")
  })

  test("description contains planning specialist text", () => {
    // given
    const model = "openai/gpt-5.4"

    // when
    const config = createHecateqPlannerAgent(model)

    // then
    expect(config.description).toContain("Planning specialist")
    expect(config.description).toContain("task decomposition")
  })

  test("model is passed through", () => {
    // given
    const model = "anthropic/claude-sonnet-4-6"

    // when
    const config = createHecateqPlannerAgent(model)

    // then
    expect(config.model).toBe("anthropic/claude-sonnet-4-6")
  })

  test("temperature is 0.3", () => {
    // given
    const model = "openai/gpt-5.4"

    // when
    const config = createHecateqPlannerAgent(model)

    // then
    expect(config.temperature).toBe(0.3)
  })

  test("color is #8B5CF6", () => {
    // given
    const model = "openai/gpt-5.4"

    // when
    const config = createHecateqPlannerAgent(model)

    // then
    expect(config.color).toBe("#8B5CF6")
  })

  test("has a prompt string containing Hecateq Planner identity", () => {
    // given
    const model = "openai/gpt-5.4"

    // when
    const config = createHecateqPlannerAgent(model)

    // then
    expect(config.prompt).toBeDefined()
    expect(typeof config.prompt).toBe("string")
    expect((config.prompt as string)).toContain("Hecateq Planner")
    expect((config.prompt as string)).toContain("planning specialist")
  })

  test("has tool restrictions blocking write, edit, apply_patch, task", () => {
    // given
    const model = "openai/gpt-5.4"

    // when
    const config = createHecateqPlannerAgent(model)

    // then
    expect(config.permission).toHaveProperty("write", "deny")
    expect(config.permission).toHaveProperty("edit", "deny")
    expect(config.permission).toHaveProperty("apply_patch", "deny")
    expect(config.permission).toHaveProperty("task", "deny")
  })

  test("does not have thinking config or reasoningEffort", () => {
    // given
    const model = "openai/gpt-5.4"

    // when
    const config = createHecateqPlannerAgent(model)

    // then
    // Hecateq Planner currently does not set thinking or reasoningEffort
    expect(config.thinking).toBeUndefined()
    expect(config.reasoningEffort).toBeUndefined()
  })
})

describe("HECATEQ_PLANNER_PROMPT", () => {
  test("contains core planning sections", () => {
    // given / when / then
    expect(HECATEQ_PLANNER_PROMPT).toContain("Hecateq Planner")
    expect(HECATEQ_PLANNER_PROMPT).toContain("core_responsibilities")
    expect(HECATEQ_PLANNER_PROMPT).toContain("planning_framework")
    expect(HECATEQ_PLANNER_PROMPT).toContain("output_format")
    expect(HECATEQ_PLANNER_PROMPT).toContain("parallelization_rules")
    expect(HECATEQ_PLANNER_PROMPT).toContain("agent_selection_guide")
    expect(HECATEQ_PLANNER_PROMPT).toContain("scope_discipline")
  })
})
