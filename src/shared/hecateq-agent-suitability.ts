/**
 * Hecateq agent suitability scoring helper.
 * Provides a testable scoring function for evaluating whether an agent is
 * suitable for a given work classification, with hard gates (eligibility)
 * and soft signals (suitability score).
 *
 * This helper is consumed by the Hecateq orchestrator prompt/policy builder
 * and by tests to assert scoring invariants. It does NOT drive runtime
 * truth — the actual subagent resolution path in subagent-resolver.ts /
 * subagent-discovery.ts remains the authoritative runtime gate.
 *
 * Agent index data is advisory: stale or missing index metadata is warned
 * but does not hard-block eligibility.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Work classification dimensions mirroring the Flexible Work Classification policy. */
export type WorkClassification = {
  /** Task size: SMALL | MEDIUM | LARGE */
  taskSize: "SMALL" | "MEDIUM" | "LARGE"
  /** Primary domain of the work (e.g. "backend", "frontend", "security") */
  domain: string
  /** Whether the work spans multiple domains */
  isMultiDomain: boolean
  /** Whether the task involves implementation (code changes) */
  isImplementation: boolean
  /** Whether the task is read-only analysis / research only */
  isAnalysisOnly: boolean
  /** Risk level */
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "DESTRUCTIVE"
  /** Whether the task is a scan/research-style task */
  isScanTask: boolean
  /** Whether the task is a specialized kind ("docs", "test", "refactor", "review", etc.) */
  taskKind?: string
  /** Execution mode hint for multi-domain work */
  executionMode?: "sequential" | "parallel-safe" | "contract-first" | "blocked"
}

/** Input describing a single agent candidate for suitability scoring. */
export type AgentSuitabilityInput = {
  /** Agent name (e.g. "nodejs-backend-developer", "security-architect") */
  name: string
  /** Whether the agent is currently enabled (not in disabled list) */
  enabled: boolean
  /** Whether the agent is callable (exists in runtime registry) */
  callable: boolean
  /** Whether the target is the coordinator/self (must be forbidden) */
  isCoordinatorTarget: boolean
  /** Primary domain from the agent index */
  primaryDomain?: string
  /** Secondary domains from the agent index */
  secondaryDomains?: string[]
  /** When to use this agent (free-text hints from the index) */
  useWhen?: string[]
  /** When to avoid this agent (free-text hints from the index) */
  avoidWhen?: string[]
  /** Index confidence (0..1) */
  confidence?: number
  /** Index ambiguity level */
  ambiguity?: "low" | "medium" | "high"
  /** Whether the index is stale */
  stale?: boolean
  /** Whether a dependency prerequisite has failed or is unmet */
  dependencyPrerequisiteUnmet?: boolean
  /** Domain hints from the agent description (fallback when no index) */
  descriptionDomainHints?: string[]
}

/** Scoring result for a single agent candidate. */
export type AgentSuitabilityResult = {
  /** Agent name */
  name: string
  /** Whether the agent passes all hard gates */
  eligible: boolean
  /** Reason(s) for ineligibility when eligible is false */
  blockReasons: string[]
  /** Numeric suitability score (0..1) — only meaningful when eligible=true */
  score: number
  /** Warnings (non-blocking issues such as stale/missing index) */
  warnings: string[]
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Agent types that are considered scan/research style agents.
 *  These receive a bonus for mixed/unknown work where scanning first is preferred. */
const SCAN_AGENT_PATTERNS = [
  "explore",
  "librarian",
  "oracle",
  "librarian-tr",
  "backend-frontend-scanner",
  "assumption-breaker",
  "web-scraper",
]

/** Baseline weights for scoring signals. */
const WEIGHTS = {
  primaryDomainMatch: 0.35,
  secondaryDomainMatch: 0.12,
  descriptionHintMatch: 0.08,
  useWhenMatch: 0.10,
  taskKindFit: 0.10,
  riskFit: 0.05,
  executionModeFit: 0.05,
  confidenceBonus: 0.05,
  lowAmbiguityBonus: 0.05,
  scanBonusForMixed: 0.05,
} as const

// ---------------------------------------------------------------------------
// Hard gates
// ---------------------------------------------------------------------------

function checkHardGates(input: AgentSuitabilityInput, work: WorkClassification): {
  eligible: boolean
  blockReasons: string[]
  warnings: string[]
} {
  const blockReasons: string[] = []
  const warnings: string[] = []

  // Gate 1: disabled agent
  if (!input.enabled) {
    blockReasons.push("agent is disabled")
    return { eligible: false, blockReasons, warnings }
  }

  // Gate 2: not callable
  if (!input.callable) {
    blockReasons.push("agent is not callable (not in runtime registry)")
    return { eligible: false, blockReasons, warnings }
  }

  // Gate 3: coordinator / self target forbidden
  if (input.isCoordinatorTarget) {
    blockReasons.push("coordinator/self target forbidden — cannot delegate to yourself")
    return { eligible: false, blockReasons, warnings }
  }

  // Gate 4: dependency prerequisite unmet
  if (input.dependencyPrerequisiteUnmet) {
    blockReasons.push("dependency prerequisite is unmet — upstream work must complete first")
    return { eligible: false, blockReasons, warnings }
  }

  // Non-blocking warnings
  if (input.stale) {
    warnings.push("agent index is stale — suitability signals may be outdated")
  }

  return { eligible: true, blockReasons, warnings }
}

// ---------------------------------------------------------------------------
// Soft signal scoring
// ---------------------------------------------------------------------------

function isScanStyleAgent(input: AgentSuitabilityInput): boolean {
  const nameLower = input.name.toLowerCase()
  return SCAN_AGENT_PATTERNS.some((p) => nameLower.includes(p))
}

function hasDomainMatch(domain: string | undefined, target: string): boolean {
  if (!domain) return false
  return domain.toLowerCase() === target.toLowerCase()
}

function hasAnyDomainMatch(
  domains: string[] | undefined,
  target: string,
): boolean {
  if (!domains) return false
  const targetLower = target.toLowerCase()
  return domains.some((d) => d.toLowerCase() === targetLower)
}

function hasTextualSignal(
  signals: string[] | undefined,
  workClassification: WorkClassification,
): boolean {
  if (!signals || signals.length === 0) return false
  const combined = signals.join(" ").toLowerCase()

  // Check if the work's domain or task kind appears in the signals
  if (combined.includes(workClassification.domain.toLowerCase())) return true
  if (workClassification.taskKind && combined.includes(workClassification.taskKind.toLowerCase())) return true

  return false
}

function isRiskAppropriate(input: AgentSuitabilityInput, riskLevel: string): boolean {
  // For DESTRUCTIVE risk, any agent with high ambiguity should be penalized
  if (riskLevel === "DESTRUCTIVE" && input.ambiguity === "high") return false
  // For HIGH risk, prefer confidence ≥ 0.5 when index is available
  if (riskLevel === "HIGH" && input.confidence !== undefined && input.confidence < 0.4) return false
  return true
}

function computeSuitabilityScore(
  input: AgentSuitabilityInput,
  work: WorkClassification,
  warnings: string[],
): number {
  let score = 0

  // Primary domain match
  if (hasDomainMatch(input.primaryDomain, work.domain)) {
    score += WEIGHTS.primaryDomainMatch
  }

  // Secondary domain match
  if (hasAnyDomainMatch(input.secondaryDomains, work.domain)) {
    score += WEIGHTS.secondaryDomainMatch
  }

  // Description hint fallback (when no index primary/secondary)
  if (!input.primaryDomain && !input.secondaryDomains?.length) {
    if (hasTextualSignal(input.descriptionDomainHints, work)) {
      score += WEIGHTS.descriptionHintMatch
    }
  }

  // useWhen / avoidWhen signals
  if (hasTextualSignal(input.useWhen, work)) {
    score += WEIGHTS.useWhenMatch
  }
  if (hasTextualSignal(input.avoidWhen, work)) {
    score -= WEIGHTS.useWhenMatch // penalize
  }

  // Task kind fit
  if (work.taskKind && hasTextualSignal(input.useWhen, work)) {
    score += WEIGHTS.taskKindFit
  }

  // Risk appropriateness
  if (isRiskAppropriate(input, work.riskLevel)) {
    score += WEIGHTS.riskFit
  }

  // Execution mode fit (lightweight)
  if (work.executionMode === "sequential") {
    // Sequential work slightly prefers lower-ambiguity agents
    if (input.ambiguity === "low") score += WEIGHTS.executionModeFit
  } else if (work.executionMode === "parallel-safe") {
    // Parallel-safe work is less sensitive to ambiguity
    score += WEIGHTS.executionModeFit * 0.5
  }

  // Index confidence bonus
  if (input.confidence !== undefined && input.confidence > 0.5) {
    score += WEIGHTS.confidenceBonus * input.confidence
  }

  // Low ambiguity bonus
  if (input.ambiguity === "low") {
    score += WEIGHTS.lowAmbiguityBonus
  }

  // Mixed/unknown work: scan/research-style agents get a slight boost
  if (work.isScanTask || work.domain === "unknown" || work.isMultiDomain) {
    if (isScanStyleAgent(input)) {
      score += WEIGHTS.scanBonusForMixed
    }
  }

  // Cap to 1.0
  return Math.min(score, 1.0)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Score an agent candidate against a work classification.
 *
 * Hard gates (any failure → eligible=false, score=0):
 *  - disabled agent
 *  - not callable
 *  - coordinator/self target
 *  - dependency prerequisite unmet
 *
 * Soft signals (affect score when eligible):
 *  - primary domain match
 *  - secondary domain match
 *  - description hints (fallback when no index)
 *  - useWhen / avoidWhen hints
 *  - task kind fit
 *  - risk level appropriateness
 *  - index confidence
 *  - index ambiguity
 *  - scan-style bonus for mixed/unknown work
 *
 * Agent index metadata is advisory: stale or missing index data produces
 * warnings but never hard-blocks eligibility.
 */
export function scoreAgentSuitability(
  agent: AgentSuitabilityInput,
  work: WorkClassification,
): AgentSuitabilityResult {
  const { eligible, blockReasons, warnings } = checkHardGates(agent, work)

  if (!eligible) {
    return {
      name: agent.name,
      eligible: false,
      blockReasons,
      score: 0,
      warnings,
    }
  }

  const score = computeSuitabilityScore(agent, work, warnings)

  return {
    name: agent.name,
    eligible: true,
    blockReasons,
    score,
    warnings,
  }
}

/**
 * Score multiple agent candidates and return them sorted by descending suitability.
 * Agents that fail hard gates are still included (with eligible=false and score=0).
 */
export function rankAgentSuitability(
  agents: AgentSuitabilityInput[],
  work: WorkClassification,
): AgentSuitabilityResult[] {
  return agents
    .map((agent) => scoreAgentSuitability(agent, work))
    .sort((a, b) => {
      // Eligible agents first
      if (a.eligible !== b.eligible) return a.eligible ? -1 : 1
      // Then by score descending
      return b.score - a.score
    })
}
