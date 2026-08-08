import { describe, expect, test } from "bun:test";
import { createHecateqPlannerV2Agent, createHecateqPlannerV2AgentFactory, HECATEQ_PLANNER_V2_PROMPT } from "./agent";
import { createHecateqPlannerAgent } from "../agent";
import { shouldUsePlannerV2, maybeCreateHecateqPlannerV2Config } from "./flag";

describe("hecateq-planner v2", () => {
  // given a model
  // when the v2 factory is invoked
  // then it returns the same base config shape as v1
  test("createHecateqPlannerV2Agent returns same base shape as v1", () => {
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

  // given the v2 agent config
  // when inspecting its permission map
  // then write/edit/patch/apply_patch/bash are all denied (read-only)
  test("v2 agent config enforces read-only tool permissions", () => {
    const v2 = createHecateqPlannerV2Agent("gpt-5.4");
    const permission = (v2.permission ?? {}) as Readonly<Record<string, unknown>>;
    expect(permission["write"]).toBe("deny");
    expect(permission["edit"]).toBe("deny");
    expect(permission["patch"]).toBe("deny");
    expect(permission["apply_patch"]).toBe("deny");
    expect(permission["bash"]).toBe("deny");
  });

  // given the v2 prompt
  // when inspecting its machine-readable output section
  // then it instructs JSON output, runtime-registry agent names,
  // Zod validation, and explicitly excludes momus
  test("v2 prompt includes machine-readable task graph contract", () => {
    expect(HECATEQ_PLANNER_V2_PROMPT).toContain("machine_readable_output");
    expect(HECATEQ_PLANNER_V2_PROMPT).toContain("runtime agent registry");
    expect(HECATEQ_PLANNER_V2_PROMPT).toContain("Zod-validated");
    expect(HECATEQ_PLANNER_V2_PROMPT).toContain("momus");
  });

  // given an empty config
  // when shouldUsePlannerV2 is called
  // then it reports enabled=false with source "default"
  test("flag helper returns enabled=false by default", () => {
    const result = shouldUsePlannerV2({});
    expect(result.enabled).toBe(false);
    expect(result.source).toBe("default");
  });

  // given a config with hecateq.experimental.planner_v2.enabled=true
  // when shouldUsePlannerV2 is called
  // then it reports enabled=true with source "config"
  test("flag helper reads planner_v2 config slice", () => {
    const result = shouldUsePlannerV2({
      hecateq: { experimental: { planner_v2: { enabled: true } } },
    });
    expect(result.enabled).toBe(true);
    expect(result.source).toBe("config");
  });

  // given any config and model
  // when maybeCreateHecateqPlannerV2Config is called with flag off
  // then it returns null
  test("v2 config factory returns null when flag is off", () => {
    const result = maybeCreateHecateqPlannerV2Config({}, "gpt-5.4");
    expect(result).toBeNull();
  });

  // given a config with the flag on
  // when maybeCreateHecateqPlannerV2Config is called
  // then it returns a v2 AgentConfig
  test("v2 config factory returns v2 agent when flag is on", () => {
    const result = maybeCreateHecateqPlannerV2Config(
      { hecateq: { experimental: { planner_v2: { enabled: true } } } },
      "gpt-5.4",
    );
    expect(result).not.toBeNull();
    expect(result?.model).toBe("gpt-5.4");
    const permission = (result?.permission ?? {}) as Readonly<Record<string, unknown>>;
    expect(permission["write"]).toBe("deny");
  });
});
