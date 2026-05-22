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
    test("#then the prompt contains the prompt intake analyzer policy, execution modes, and token efficiency rules", () => {
      // given
      const input = { ...baseInput };

      // when
      const config = maybeCreateHecateqOrchestratorConfig(input);

      // then
      expect(config).toBeDefined();
      expect(config!.prompt).toContain("PROMPT INTAKE / TASK ANALYZER POLICY");
      expect(config!.prompt).toContain("INTAKE SUMMARY");
      expect(config!.prompt).toContain("SMALL: localized, low-risk, 1-2 files, no architecture impact");
      expect(config!.prompt).toContain("MEDIUM: several files, clear domain, limited coordination");
      expect(config!.prompt).toContain("LARGE: multi-domain, project-wide, architecture-impacting, long-running, or risky");
      expect(config!.prompt).toContain("DIRECT_SMALL_FIX");
      expect(config!.prompt).toContain("SINGLE_AGENT_DELEGATION");
      expect(config!.prompt).toContain("MULTI_AGENT_SEQUENTIAL");
      expect(config!.prompt).toContain("MULTI_AGENT_PARALLEL_AFTER_CONTRACT");
      expect(config!.prompt).toContain("ANALYSIS_ONLY");
      expect(config!.prompt).toContain("BLOCKED");
      expect(config!.prompt).toContain("TOKEN EFFICIENCY RULES");
      expect(config!.prompt).toContain("Do not read the whole codebase by default.");
      expect(config!.prompt).toContain("Check project-root memory first.");
      expect(config!.prompt).toContain("Check file-map.md before broad search.");
      expect(config!.prompt).toContain("Do not start frontend/admin/mobile implementation before backend/API/shared contract is stable");
      expect(config!.prompt).toContain("Do not spawn parallel tasks until dependencies and shared contracts are explicit.");
      expect(config!.prompt).toContain("Prefer exact custom agents from <custom-agent-registry>.");
      expect(config!.prompt).toContain("Use category routing only when no exact custom agent exists.");
      expect(config!.prompt).toContain("contract_required:");
      expect(config!.prompt).toContain("contract_artifact:");
      expect(config!.prompt).toContain("task_graph_required:");
      expect(config!.prompt).toContain("TASK DEPENDENCY GRAPH POLICY");
      expect(config!.prompt).toContain("SHARED CONTRACT ARTIFACT POLICY");
      expect(config!.prompt).toContain(".opencode/contracts/");
      expect(config!.prompt).toContain(".opencode/task-graphs/");
      expect(config!.prompt).toContain("Parallel execution is allowed only when:");
      expect(config!.prompt).toContain("do not start dependent implementation blindly");
    });

    test("#then the prompt contains the dependency-aware backend/frontend contract routing rule", () => {
      // given
      const input = { ...baseInput };

      // when
      const config = maybeCreateHecateqOrchestratorConfig(input);

      // then
      expect(config).toBeDefined();
      expect(config!.prompt).toContain("If backend or API contract is unclear, establish the contract before frontend implementation");
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

      // then — still includes the dependency-aware routing section
      expect(config!.prompt).toContain("<dependency-aware-routing>");
      expect(config!.prompt).toContain("establish the contract before frontend implementation");
    });

    test("#then the prompt contains the git checkpoint policy and final output contract", () => {
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
      expect(config!.prompt).toContain("INTAKE SUMMARY:");
      expect(config!.prompt).toContain("GIT CHECKPOINT:");
      expect(config!.prompt).toContain("TASK GRAPH:");
      expect(config!.prompt).toContain("SHARED CONTRACT:");
      expect(config!.prompt).toContain("CHANGED FILES:");
      expect(config!.prompt).toContain("TESTS:");
      expect(config!.prompt).toContain("NEXT STEP:");
    });
  });
});
