import { describe, expect, test } from "bun:test";
import { createHecateqPlannerV2Agent, createHecateqPlannerV2AgentFactory } from "./agent";
import { createHecateqPlannerAgent } from "../agent";
import { shouldUsePlannerV2, maybeCreateHecateqPlannerV2Config } from "./flag";

describe("hecateq-planner v2 (PR-A skeleton)", () => {
  // given a model
  // when the v2 factory is invoked
  // then it returns the same config shape as v1
  test("createHecateqPlannerV2Agent returns same shape as v1", () => {
    const model = "gpt-5.4";
    const v1 = createHecateqPlannerAgent(model);
    const v2 = createHecateqPlannerV2Agent(model);
    expect(v2.description).toBe(v1.description);
    expect(v2.mode).toBe(v1.mode);
    expect(v2.temperature).toBe(v1.temperature);
    expect(v2.color).toBe(v1.color);
    expect(v2.model).toBe(v1.model);
  });

  // given a v2 factory
  // when accessing its static mode
  // then it is "subagent" (matches v1)
  test("v2 factory exposes static mode = subagent", () => {
    expect(createHecateqPlannerV2AgentFactory.mode).toBe("subagent");
  });

  // given any config
  // when shouldUsePlannerV2 is called
  // then it always reports enabled: false in PR-A
  test("flag helper always returns enabled=false in PR-A", () => {
    const result = shouldUsePlannerV2({});
    expect(result.enabled).toBe(false);
    expect(result.source).toBe("stub-pr-a");
  });

  // given any config and model
  // when maybeCreateHecateqPlannerV2Config is called
  // then it returns null in PR-A
  test("v2 config factory returns null in PR-A", () => {
    const result = maybeCreateHecateqPlannerV2Config({}, "gpt-5.4");
    expect(result).toBeNull();
  });
});