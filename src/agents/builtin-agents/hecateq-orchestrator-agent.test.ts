/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";
import { maybeCreateHecateqOrchestratorConfig } from "./hecateq-orchestrator-agent";
import type { AgentOverrides } from "../types";
import type { CategoryConfig } from "../../config/schema";

describe("maybeCreateHecateqOrchestratorConfig", () => {
  const baseInput = {
    disabledAgents: [] as string[],
    agentOverrides: {} as AgentOverrides,
    availableModels: new Set(["openai/gpt-5.4"]),
    systemDefaultModel: "openai/gpt-5.4" as string | undefined,
    isFirstRunNoCache: false,
    availableAgents: [] as import("../dynamic-agent-prompt-builder").AvailableAgent[],
    availableSkills: [] as import("../dynamic-agent-prompt-builder").AvailableSkill[],
    availableCategories: [] as import("../dynamic-agent-prompt-builder").AvailableCategory[],
    mergedCategories: {} as Record<string, CategoryConfig>,
    useTaskSystem: false,
  };

  describe("#given hecateq-orchestrator is disabled", () => {
    test("#when config is created #then returns undefined", () => {
      // given
      const input = { ...baseInput, disabledAgents: ["hecateq-orchestrator"] };

      // when
      const config = maybeCreateHecateqOrchestratorConfig(input);

      // then
      expect(config).toBeUndefined();
    });
  });

  describe("#given no model available and not first run", () => {
    test("#when config is created #then returns undefined", () => {
      // given
      const input = {
        ...baseInput,
        availableModels: new Set<string>(),
        systemDefaultModel: undefined,
      };

      // when
      const config = maybeCreateHecateqOrchestratorConfig(input);

      // then
      expect(config).toBeUndefined();
    });
  });

  describe("#given hecateq-orchestrator override with explicit model", () => {
    test("#when config is created #then uses override model and returns config", () => {
      // given
      const input = {
        ...baseInput,
        availableModels: new Set(["anthropic/claude-opus-4-7"]),
        agentOverrides: {
          "hecateq-orchestrator": {
            model: "anthropic/claude-opus-4-7",
          },
        } as AgentOverrides,
      };

      // when
      const config = maybeCreateHecateqOrchestratorConfig(input);

      // then
      expect(config).toBeDefined();
      expect(config!.model).toBe("anthropic/claude-opus-4-7");
    });
  });

  describe("#given hecateq-orchestrator override with permission", () => {
    test("#when config is created #then permission is applied", () => {
      // given
      const input = {
        ...baseInput,
        agentOverrides: {
          "hecateq-orchestrator": {
            permission: { apply_patch: "allow" } as Record<string, "allow">,
          },
        } as AgentOverrides,
      };

      // when
      const config = maybeCreateHecateqOrchestratorConfig(input);

      // then
      expect(config).toBeDefined();
      expect(config!.model).toBe("openai/gpt-5.4");
    });
  });

  describe("#given hecateq-orchestrator override with prompt_append", () => {
    test("#when config is created #then prompt contains the appended text", () => {
      // given
      const input = {
        ...baseInput,
        agentOverrides: {
          "hecateq-orchestrator": {
            prompt_append: "EXTRA_INSTRUCTION: Always verify before delegating",
          },
        } as AgentOverrides,
      };

      // when
      const config = maybeCreateHecateqOrchestratorConfig(input);

      // then
      expect(config).toBeDefined();
      expect(config!.prompt).toContain("EXTRA_INSTRUCTION: Always verify before delegating");
    });
  });

  describe("#given hecateq-orchestrator override with fallback_models", () => {
    test("#when config is created #then fallback_models is respected", () => {
      // given
      const input = {
        ...baseInput,
        agentOverrides: {
          "hecateq-orchestrator": {
            fallback_models: ["anthropic/claude-sonnet-4-6"],
          },
        } as AgentOverrides,
      };

      // when
      const config = maybeCreateHecateqOrchestratorConfig(input);

      // then
      expect(config).toBeDefined();
    });
  });

  describe("#given first run with no cache and no override", () => {
    test("#when config is created #then returns config using first fallback model", () => {
      // given
      const input = {
        ...baseInput,
        availableModels: new Set<string>(),
        systemDefaultModel: undefined,
        isFirstRunNoCache: true,
      };

      // when
      const config = maybeCreateHecateqOrchestratorConfig(input);

      // then
      expect(config).toBeDefined();
      expect(config!.model).toBeDefined();
    });
  });

  describe("#given a valid config is produced", () => {
    test("#then it is visible in both picker and subagent contexts via mode all", () => {
      const input = { ...baseInput };

      const config = maybeCreateHecateqOrchestratorConfig(input);

      expect(config).toBeDefined();
      expect(config!.mode).toBe("all");
      expect(config!.description).toBe("Primary custom-agent-first workflow orchestrator");
    });

    test("#then the prompt identifies itself as Hecateq God and keeps intake plus execution modes", () => {
      // given
      const input = { ...baseInput };

      // when
      const config = maybeCreateHecateqOrchestratorConfig(input);

      // then
      expect(config).toBeDefined();
      expect(config!.prompt).toContain("Hecateq God");
      expect(config!.prompt).toContain("PROMPT INTAKE / TASK ANALYZER POLICY");
      expect(config!.prompt).toContain("INTAKE SUMMARY");
      expect(config!.prompt).toContain("DIRECT_SMALL_FIX");
      expect(config!.prompt).toContain("Use only for tiny safe bridging fixes after the tiny-fix gate passes. It is not a general implementation mode.");
      expect(config!.prompt).toContain("SINGLE_AGENT_DELEGATION");
      expect(config!.prompt).toContain("This is the default implementation mode.");
      expect(config!.prompt).toContain("MULTI_AGENT_SEQUENTIAL");
      expect(config!.prompt).toContain("MULTI_AGENT_PARALLEL_AFTER_CONTRACT");
      expect(config!.prompt).toContain("ANALYSIS_ONLY");
      expect(config!.prompt).toContain("BLOCKED");
      expect(config!.prompt).toContain("STATUS: BLOCKED");
      expect(config!.prompt).toContain("For SMALL tasks, keep intake internal and brief.");
      expect(config!.prompt).toContain("contract_required:");
      expect(config!.prompt).toContain("contract_artifact:");
      expect(config!.prompt).toContain("task_graph_required:");
    });

    test("#then the prompt contains minimum-agent, agent-index, and token-efficiency rules", () => {
      // given
      const input = { ...baseInput };

      // when
      const config = maybeCreateHecateqOrchestratorConfig(input);

      // then
      expect(config).toBeDefined();
      expect(config!.prompt).toContain("MINIMUM AGENT PRINCIPLE");
      expect(config!.prompt).toContain("If one capable agent can own the task, do not call two.");
      expect(config!.prompt).toContain("Do not assign the same work to two agents.");
      expect(config!.prompt).toContain("Hecateq God is not the default implementer. Delegate normal implementation to the owning specialist.");
      expect(config!.prompt).toContain("Allow direct edits only for tiny safe bridging fixes");
      expect(config!.prompt).toContain("Do not use tiny safe bridging fixes for feature implementation");
      expect(config!.prompt).toContain("Default SMALL implementation work to SINGLE_AGENT_DELEGATION unless the tiny-fix gate is fully satisfied.");
      expect(config!.prompt).toContain("AGENT INDEX USAGE POLICY");
      expect(config!.prompt).toContain("AGENT INDEX RUNTIME VALIDATION RULE");
      expect(config!.prompt).toContain("The generated agent index is a ranking and selection aid, not runtime truth.");
      expect(config!.prompt).toContain("Prefer primary_domain over broad domains.");
      expect(config!.prompt).toContain("Use secondary_domains only as a support signal.");
      expect(config!.prompt).toContain("Avoid high-ambiguity agents unless no better candidate exists.");
      expect(config!.prompt).toContain("Use use_when and avoid_when to validate routing before delegation.");
      expect(config!.prompt).toContain("TOKEN EFFICIENCY RULES");
      expect(config!.prompt).toContain("Read the project context block first.");
      expect(config!.prompt).toContain("Check project-root memory first.");
      expect(config!.prompt).toContain("Check file-map.md before broad search.");
      expect(config!.prompt).toContain("Avoid broad codebase scans until narrow sources fail.");
      expect(config!.prompt).toContain("If active-context.md is enough, do not broad-scan the repository.");
    });

    test("#then the prompt contains runtime-aligned delegation tooling and background policy", () => {
      const input = { ...baseInput };

      const config = maybeCreateHecateqOrchestratorConfig(input);

      expect(config).toBeDefined();
      expect(config!.prompt).toContain("DELEGATION TOOLING POLICY");
      expect(config!.prompt).toContain("Hecateq God is orchestration-first and must not become the default implementation owner.");
      expect(config!.prompt).toContain("For any implementation task beyond a tiny safe bridging fix, delegate to an owner agent instead of doing the work directly.");
      expect(config!.prompt).toContain("Direct edits are allowed only as tiny safe bridging fixes");
      expect(config!.prompt).toContain("If there is any real uncertainty about ownership, scope, side effects, or verification burden, delegate instead of editing directly.");
      expect(config!.prompt).toContain("TINY SAFE BRIDGING FIX GATE");
      expect(config!.prompt).toContain("If any condition fails, delegate the work.");
      expect(config!.prompt).toContain('task(subagent_type="<exact-agent-name>", ...)');
      expect(config!.prompt).toContain("Do not use `call_omo_agent`");
      expect(config!.prompt).toContain("is denied at runtime for orchestrator agents.");
      expect(config!.prompt).toContain('task(subagent_type="explore", ...)');
      expect(config!.prompt).toContain('task(subagent_type="librarian", ...)');
      expect(config!.prompt).toContain("Do not use `delegate_task` as if it were the exposed runtime tool name.");
      expect(config!.prompt).toContain("Category routing does not discover the best custom agent; it routes through the category/Sisyphus-Junior path.");
      expect(config!.prompt).toContain("Do not use category routing when an exact custom agent exists.");
      expect(config!.prompt).toContain("If an exact agent is unknown or disabled, do not silently fall back.");
      expect(config!.prompt).toContain("BACKGROUND / FOREGROUND DELEGATION POLICY");
      expect(config!.prompt).toContain("Use `run_in_background=false` when:");
      expect(config!.prompt).toContain("Use `run_in_background=true` only when:");
      expect(config!.prompt).toContain("Never start background fanout just to compare similar agents.");
      expect(config!.prompt).toContain("CATEGORY FALLBACK POLICY");
      expect(config!.prompt).toContain("Category routing is not custom-agent discovery.");
      expect(config!.prompt).toContain("Do not use category fallback when an exact owner is available.");
    });

    test("#then the prompt contains contract-first routing and keeps task graph policy", () => {
      // given
      const input = { ...baseInput };

      // when
      const config = maybeCreateHecateqOrchestratorConfig(input);

      // then
      expect(config).toBeDefined();
      expect(config!.prompt).toContain("TASK DEPENDENCY GRAPH POLICY");
      expect(config!.prompt).toContain("SHARED CONTRACT ARTIFACT POLICY");
      expect(config!.prompt).toContain(".opencode/contracts/");
      expect(config!.prompt).toContain(".opencode/task-graphs/");
      expect(config!.prompt).toContain("Parallel execution is allowed only when:");
      expect(config!.prompt).toContain("If backend/API/data model is unknown, frontend/admin/mobile work does not start.");
      expect(config!.prompt).toContain("Parallel work is allowed only after the shared contract exists.");
      expect(config!.prompt).toContain("If the contract changes, downstream work must be revalidated.");
    });

    test("#then the prompt contains the project-root memory policy with all standard memory files", () => {
      // given
      const input = { ...baseInput };

      // when
      const config = maybeCreateHecateqOrchestratorConfig(input);

      // then — memory policy header
      expect(config).toBeDefined();
      expect(config!.prompt).toContain("PROJECT-ROOT MEMORY POLICY");

      // then — memory directory path
      expect(config!.prompt).toContain(".opencode/memory/knowledge/context/");

      // then — all standard memory files
      expect(config!.prompt).toContain("active-context.md");
      expect(config!.prompt).toContain("progress.md");
      expect(config!.prompt).toContain("tasks.md");
      expect(config!.prompt).toContain("file-map.md");
      expect(config!.prompt).toContain("decisions.md");

      // then — global memory must not override project-root memory
      expect(config!.prompt).toContain("Global or user-level memory must not override project-root memory");

      // then — still includes the custom-agent registry section
      expect(config!.prompt).toContain("<custom-agent-registry>");
      expect(config!.prompt).toContain("No visible custom exact agents were discovered");
      expect(config!.prompt).toContain("Prefer exact custom agents from <custom-agent-registry> before any generic fallback.");
      expect(config!.prompt).toContain("when no valid exact custom agent exists");
    });

    test("#then the prompt contains the git checkpoint policy, blocked rules, and adaptive output contract", () => {
      // given
      const input = { ...baseInput };

      // when
      const config = maybeCreateHecateqOrchestratorConfig(input);

      // then
      expect(config).toBeDefined();
      expect(config!.prompt).toContain("GIT CHECKPOINT POLICY");
      expect(config!.prompt).toContain("git status --short");
      expect(config!.prompt).toContain("CLEAN_REPO");
      expect(config!.prompt).toContain("DIRTY_REPO");
      expect(config!.prompt).toContain("NO_GIT_REPOSITORY");
      expect(config!.prompt).toContain("HIGH_RISK_GIT_OPERATION");
      expect(config!.prompt).toContain("git reset --hard");
      expect(config!.prompt).toContain("git clean -fd");
      expect(config!.prompt).toContain("git push --force");
      expect(config!.prompt).toContain("chore: checkpoint before hecateq task");
      expect(config!.prompt).toContain("docs: update project memory context");
      expect(config!.prompt).toContain("STOP / BLOCKED RULES");
      expect(config!.prompt).toContain("backend/frontend/admin/mobile implementation is requested without a stable contract");
      expect(config!.prompt).toContain("ADAPTIVE OUTPUT FORMAT");
      expect(config!.prompt).toContain("For SMALL tasks, prefer:");
      expect(config!.prompt).toContain("For MEDIUM tasks, prefer:");
      expect(config!.prompt).toContain("For LARGE tasks, prefer:");
      expect(config!.prompt).toContain("INTAKE SUMMARY:");
      expect(config!.prompt).toContain("GIT CHECKPOINT:");
      expect(config!.prompt).toContain("TASK GRAPH:");
      expect(config!.prompt).toContain("SHARED CONTRACT:");
      expect(config!.prompt).toContain("NEXT STEP:");
    });
  });
});
