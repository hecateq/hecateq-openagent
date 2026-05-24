/**
 * Routing Strategy Selection
 *
 * Deterministic runtime strategy classification that translates a task intent
 * classification and size estimate into a routing mode with structured
 * rationale. Aligned with Hecateq God's execution mode vocabulary
 * (SINGLE_AGENT_DELEGATION, MULTI_AGENT_SEQUENTIAL, etc.).
 *
 * This is NOT a full scheduler. It is a decision-support layer that provides
 * deterministic recommendations for how to route a task before delegation.
 */

import type { TaskIntentCategory, TaskIntentClassification } from "./task-intent-classifier"

// ─── Strategy Modes ──────────────────────────────────────────────────────────

export const ROUTING_STRATEGY_MODES = [
  "single-owner",
  "research-first",
  "plan-first",
  "contract-first",
  "sequential-multi-agent",
  "parallel-after-contract",
  "analysis-only",
  "blocked",
] as const

export type RoutingStrategyMode = (typeof ROUTING_STRATEGY_MODES)[number]

// ─── Task Size ───────────────────────────────────────────────────────────────

export const TASK_SIZES = ["small", "medium", "large", "unknown"] as const
export type TaskSize = (typeof TASK_SIZES)[number]

// ─── Strategy Output ─────────────────────────────────────────────────────────

export interface RoutingStrategy {
  /** The recommended routing strategy mode. */
  mode: RoutingStrategyMode
  /** Human-readable explanation of why this strategy was selected. */
  rationale: string
  /**
   * Which domain(s) this strategy applies to.
   * Used by Hecateq to validate that the strategy fits the task.
   */
  applicableDomains: TaskIntentCategory[]
  /**
   * Executable guidance for the orchestrator.
   */
  recommendedApproach: string
  /**
   * References to Hecateq policy sections that govern this mode.
   */
  policyHooks: string[]
  /**
   * Confidence in this strategy recommendation (0.0 – 1.0).
   * Lower confidence suggests the orchestrator should verify before acting.
   */
  confidence: number
}

// ─── Domain-to-Strategy Mapping ──────────────────────────────────────────────

type StrategyRule = {
  modes: RoutingStrategyMode[]
  rationaleTemplate: string
  approachTemplate: string
  policyHooks: string[]
}

const DOMAIN_STRATEGY_MAP: Record<string, StrategyRule> = {
  backend: {
    modes: ["single-owner", "sequential-multi-agent"],
    rationaleTemplate: "Backend task with clear domain ownership. Default to single-agent delegation unless multiple services or data layers are involved.",
    approachTemplate: "Delegate to a backend-capable exact agent via task(subagent_type=\"...\"). Prefer a single owner. Use sequential steps when the task spans API, data, and infrastructure layers.",
    policyHooks: [
      "SINGLE_AGENT_DELEGATION — default implementation mode",
      "TINY SAFE BRIDGING FIX GATE — only for trivial one-file changes",
    ],
  },
  frontend: {
    modes: ["single-owner", "sequential-multi-agent"],
    rationaleTemplate: "Frontend task with clear visual/component ownership. Default to single-agent delegation.",
    approachTemplate: "Delegate to a frontend-capable exact agent via task(subagent_type=\"...\"). Include design references or existing component patterns in the prompt.",
    policyHooks: [
      "SINGLE_AGENT_DELEGATION — default implementation mode",
      "TINY SAFE BRIDGING FIX GATE — only for trivial one-file changes",
    ],
  },
  docs: {
    modes: ["single-owner"],
    rationaleTemplate: "Documentation task. Single-agent delegation is sufficient.",
    approachTemplate: "Delegate to a writing-capable agent. Include existing doc patterns and style conventions.",
    policyHooks: [
      "SINGLE_AGENT_DELEGATION — documentation is typically single-owner work",
    ],
  },
  security: {
    modes: ["research-first", "single-owner"],
    rationaleTemplate: "Security task requires investigation before action. Research first, then delegate remediation.",
    approachTemplate: "Start with analysis using a research agent. Produce findings before delegating fixes to an implementation agent.",
    policyHooks: [
      "ANALYSIS_ONLY — start with non-destructive review",
      "SINGLE_AGENT_DELEGATION — remediate after findings are clear",
    ],
  },
  refactor: {
    modes: ["plan-first", "single-owner"],
    rationaleTemplate: "Refactor task benefits from planning before execution. Assess scope first.",
    approachTemplate: "Use plan-first: assess the full refactor scope, then delegate to a single owner agent with explicit before/after expectations.",
    policyHooks: [
      "TASK DEPENDENCY GRAPH POLICY — medium refactors benefit from a task graph",
      "SINGLE_AGENT_DELEGATION — single owner keeps the refactor coherent",
    ],
  },
  debugging: {
    modes: ["research-first", "single-owner"],
    rationaleTemplate: "Debugging task: investigate root cause before applying the fix.",
    approachTemplate: "Start with analysis (reproduce, isolate root cause). Once root cause is clear, delegate the fix to the owning domain agent.",
    policyHooks: [
      "ANALYSIS_ONLY — investigate before modifying",
      "SINGLE_AGENT_DELEGATION — fix after root cause is known",
    ],
  },
  planning: {
    modes: ["plan-first"],
    rationaleTemplate: "Planning/architecture task. Use Prometheus-style interview and produce a structured plan before any implementation.",
    approachTemplate: "Use plan-first: produce a structured plan with task graph, dependency map, and owner identification before any code changes.",
    policyHooks: [
      "PROMPT INTAKE / TASK ANALYZER POLICY — classify before executing",
      "TASK DEPENDENCY GRAPH POLICY — large tasks require a task graph",
    ],
  },
  research: {
    modes: ["research-first"],
    rationaleTemplate: "Research/investigation task. No implementation expected until findings are complete.",
    approachTemplate: "Use research-first: delegate to explore or librarian agents. Collect findings. If implementation is needed afterward, reassess routing.",
    policyHooks: [
      "BACKGROUND / FOREGROUND DELEGATION POLICY — use background agents for parallel research",
    ],
  },
}

const MULTI_DOMAIN_STRATEGY: StrategyRule = {
  modes: ["contract-first", "sequential-multi-agent", "parallel-after-contract"],
  rationaleTemplate: "Multi-domain task detected. Establish a shared contract before parallel implementation.",
  approachTemplate: "1. Identify contract boundary (API, data model, schema). 2. Produce shared contract artifact. 3. Route backend/frontend to separate agents with the same contract. 4. Use parallel-after-contract for independent work.",
  policyHooks: [
    "SHARED CONTRACT ARTIFACT POLICY — required for multi-domain work",
    "TASK DEPENDENCY GRAPH POLICY — create a task graph before broad delegation",
    "MULTI_AGENT_PARALLEL_AFTER_CONTRACT — only after contract is stable",
  ],
}

const UNKNOWN_STRATEGY: StrategyRule = {
  modes: ["blocked", "research-first"],
  rationaleTemplate: "Task domain could not be classified. Start with research or return BLOCKED.",
  approachTemplate: "If the task description is ambiguous, read targeted context or ask clarifying questions before routing. If still unclear, return STATUS: BLOCKED.",
  policyHooks: [
    "STOP / BLOCKED RULES — return BLOCKED when scope is ambiguous",
  ],
}

function domainStrategy(domain: TaskIntentCategory): StrategyRule {
  if (domain === "multi-domain") return MULTI_DOMAIN_STRATEGY
  if (domain === "unknown") return UNKNOWN_STRATEGY
  return DOMAIN_STRATEGY_MAP[domain] ?? UNKNOWN_STRATEGY
}

// ─── Strategy Selection ──────────────────────────────────────────────────────

/**
 * Select a routing strategy based on task intent classification and optional
 * size estimate.
 *
 * The strategy is deterministic: same inputs always produce the same output.
 * It does not execute anything — it provides a recommendation and rationale
 * that an orchestrator (like Hecateq God) can validate and act on.
 *
 * @param classification - Result from classifyTaskIntent().
 * @param taskSize - Optional size estimate. Defaults to "medium".
 * @returns A structured routing strategy recommendation.
 */
export function selectRoutingStrategy(
  classification: TaskIntentClassification,
  taskSize: TaskSize = "medium",
): RoutingStrategy {
  const rule = domainStrategy(classification.primaryDomain)

  // Pick the most appropriate mode based on domain + size
  const mode = pickMode(rule.modes, classification.primaryDomain, taskSize, classification)
  const confidence = computeStrategyConfidence(mode, classification, taskSize)
  const applicableDomains = buildApplicableDomains(classification)

  return {
    mode,
    rationale: buildRationale(mode, rule, classification, taskSize),
    applicableDomains,
    recommendedApproach: rule.approachTemplate,
    policyHooks: rule.policyHooks,
    confidence,
  }
}

function pickMode(
  availableModes: RoutingStrategyMode[],
  domain: TaskIntentCategory,
  taskSize: TaskSize,
  classification: TaskIntentClassification,
): RoutingStrategyMode {
  // Unknown domain
  if (domain === "unknown") {
    if (taskSize === "small") return "analysis-only"
    return "blocked"
  }

  // Multi-domain
  if (domain === "multi-domain") {
    if (taskSize === "small") return "single-owner"
    if (taskSize === "large") return "contract-first"
    // medium multi-domain — check if secondary domains include frontend/backend
    const hasFrontendBackendMix =
      classification.secondaryDomains.includes("frontend") ||
      classification.secondaryDomains.includes("backend")
    if (hasFrontendBackendMix) return "contract-first"
    return "sequential-multi-agent"
  }

  // Domain-specific
  if (domain === "planning" || domain === "refactor") {
    if (taskSize === "small") return "single-owner"
    return "plan-first"
  }

  if (domain === "security" || domain === "debugging" || domain === "research") {
    if (taskSize === "small" && classification.confidence > 0.7) return "single-owner"
    return "research-first"
  }

  // backend, frontend, docs
  if (taskSize === "large") return "sequential-multi-agent"
  return "single-owner"
}

function buildRationale(
  mode: RoutingStrategyMode,
  rule: StrategyRule,
  classification: TaskIntentClassification,
  taskSize: TaskSize,
): string {
  const base = rule.rationaleTemplate

  const sizeNote = taskSize === "large"
    ? " Task is large — plan for multi-step execution."
    : taskSize === "small"
      ? " Task is small — single-step delegation should suffice."
      : ""

  const confidenceNote = classification.confidence < 0.4
    ? " Low classification confidence — verify domain ownership before delegating."
    : ""

  return `${base}${sizeNote}${confidenceNote}`
}

function computeStrategyConfidence(
  mode: RoutingStrategyMode,
  classification: TaskIntentClassification,
  taskSize: TaskSize,
): number {
  // Start from task classification confidence
  let score = classification.confidence

  // Penalise strategy-mode uncertainty
  if (mode === "blocked") score *= 0.3
  if (mode === "research-first" && taskSize === "large") score *= 0.8

  // Bonus for well-matched domain and size
  if (classification.primaryDomain !== "unknown" && classification.primaryDomain !== "multi-domain") {
    score += 0.08
  }

  return Math.min(score, 1.0)
}

function buildApplicableDomains(classification: TaskIntentClassification): TaskIntentCategory[] {
  const domains: TaskIntentCategory[] = [classification.primaryDomain]
  for (const secondary of classification.secondaryDomains) {
    if (!domains.includes(secondary)) {
      domains.push(secondary)
    }
  }
  return domains
}

// ─── Formatting ──────────────────────────────────────────────────────────────

/**
 * Produce a structured summary of the routing strategy for use in Hecateq
 * intake summaries or routing explanations.
 */
export function formatRoutingStrategy(strategy: RoutingStrategy): string {
  const lines: string[] = [
    `routing_mode: ${strategy.mode}`,
    `rationale: ${strategy.rationale}`,
    `approach: ${strategy.recommendedApproach}`,
    `confidence: ${(strategy.confidence * 100).toFixed(0)}%`,
  ]

  if (strategy.policyHooks.length > 0) {
    lines.push("policy:")
    for (const hook of strategy.policyHooks) {
      lines.push(`  - ${hook}`)
    }
  }

  return lines.join("\n")
}
