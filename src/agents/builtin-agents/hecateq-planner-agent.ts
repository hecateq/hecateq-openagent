import type { AgentConfig } from "@opencode-ai/sdk";
import type { AgentOverrides } from "../types";
import type { CategoryConfig } from "../../config/schema";
import { AGENT_MODEL_REQUIREMENTS, isAnyFallbackModelAvailable } from "../../shared";
import { createHecateqPlannerAgent } from "../hecateq-planner";
import { applyEnvironmentContext } from "./environment-context";
import { applyOverrides } from "./agent-overrides";
import { applyModelResolution, getFirstFallbackModel } from "./model-resolution";

export function maybeCreateHecateqPlannerConfig(input: {
  disabledAgents: string[];
  agentOverrides: AgentOverrides;
  availableModels: Set<string>;
  systemDefaultModel?: string;
  isFirstRunNoCache: boolean;
  mergedCategories: Record<string, CategoryConfig>;
  directory?: string;
  disableOmoEnv?: boolean;
}): AgentConfig | undefined {
  const {
    disabledAgents,
    agentOverrides,
    availableModels,
    systemDefaultModel,
    isFirstRunNoCache,
    mergedCategories,
    directory,
    disableOmoEnv = false,
  } = input;

  const override = agentOverrides["hecateq-planner"];
  const requirement = AGENT_MODEL_REQUIREMENTS["hecateq-planner"];
  const hasExplicitConfig = override !== undefined;
  const meetsRequirement =
    !requirement?.requiresAnyModel
    || hasExplicitConfig
    || isFirstRunNoCache
    || isAnyFallbackModelAvailable(requirement.fallbackChain, availableModels);

  if (disabledAgents.includes("hecateq-planner") || !meetsRequirement) return undefined;

  let resolution = applyModelResolution({
    userModel: override?.model,
    requirement,
    availableModels,
    systemDefaultModel,
  });

  if (isFirstRunNoCache && !override?.model) {
    resolution = getFirstFallbackModel(requirement);
  }

  if (!resolution) return undefined;
  const { model, variant } = resolution;

  let config = createHecateqPlannerAgent(model);

  if (variant) {
    config = { ...config, variant };
  }

  config = applyOverrides(config, override, mergedCategories, directory);
  config = applyEnvironmentContext(config, directory, { disableOmoEnv });

  return config;
}
