/**
 * Task Intent Classifier
 *
 * Runtime, signal-based task intent classification for routing decisions.
 * Uses weighted keyword matching to infer the likely domain and shape of a task
 * from its natural-language description. Deterministic, testable, no LLM calls.
 *
 * The classifier powers routing-mode guidance in Hecateq God by providing
 * structured domain signal data instead of relying on prompt-only heuristics.
 */

// ─── Domain Categories ───────────────────────────────────────────────────────

export const TASK_INTENT_CATEGORIES = [
  "backend",
  "frontend",
  "docs",
  "security",
  "refactor",
  "debugging",
  "planning",
  "research",
  "multi-domain",
  "unknown",
] as const

export type TaskIntentCategory = (typeof TASK_INTENT_CATEGORIES)[number]

// ─── Signal Definition ───────────────────────────────────────────────────────

export interface IntentSignal {
  /** The keyword or short phrase that triggered this signal. */
  keyword: string
  /** Which domain category this signal votes for. */
  category: TaskIntentCategory
  /** Relative weight of this signal. Higher = stronger classifier vote. */
  weight: number
}

// ─── Classification Result ───────────────────────────────────────────────────

export interface TaskIntentClassification {
  /** The highest-confidence domain match. */
  primaryDomain: TaskIntentCategory
  /**
   * Normalised confidence score (0.0 – 1.0).
   * Computed from the primary score relative to total possible score.
   */
  confidence: number
  /** Other domains that received non-trivial signal weight. */
  secondaryDomains: TaskIntentCategory[]
  /** All signals that matched the input text, in match order. */
  matchedSignals: IntentSignal[]
  /** Raw aggregate scores per category (unnormalised vote totals). */
  categoryScores: Record<TaskIntentCategory, number>
  /** True when the top-two scores are close enough to suggest overlapping domains. */
  isMultiDomain: boolean
}

// ─── Signal Registry ─────────────────────────────────────────────────────────

/**
 * Weighted keyword signals organised by domain category.
 * Each signal is a case-insensitive substring match against the task prompt.
 * Higher weight = stronger vote toward that category.
 *
 * Weights are tuned so that 2–3 clear signals in a domain produce a confident
 * classification, while 1 weak signal leaves room for ambiguity detection.
 */
const SIGNAL_REGISTRY: { pattern: string; category: TaskIntentCategory; weight: number }[] = [
  // ── Backend ──────────────────────────────────────────────────────────────
  { pattern: "backend", category: "backend", weight: 10 },
  { pattern: "api", category: "backend", weight: 10 },
  { pattern: "endpoint", category: "backend", weight: 10 },
  { pattern: "database", category: "backend", weight: 10 },
  { pattern: "prisma", category: "backend", weight: 10 },
  { pattern: "sql", category: "backend", weight: 10 },
  { pattern: "server", category: "backend", weight: 8 },
  { pattern: "controller", category: "backend", weight: 8 },
  { pattern: "service layer", category: "backend", weight: 10 },
  { pattern: "repository", category: "backend", weight: 8 },
  { pattern: "migration", category: "backend", weight: 8 },
  { pattern: "schema", category: "backend", weight: 8 },
  { pattern: "middleware", category: "backend", weight: 8 },
  { pattern: "rest", category: "backend", weight: 8 },
  { pattern: "graphql", category: "backend", weight: 8 },
  { pattern: "webhook", category: "backend", weight: 7 },
  { pattern: "route", category: "backend", weight: 7 },
  { pattern: "express", category: "backend", weight: 8 },
  { pattern: "nestjs", category: "backend", weight: 8 },
  { pattern: "prisma schema", category: "backend", weight: 12 },
  { pattern: "data model", category: "backend", weight: 10 },
  { pattern: "model", category: "backend", weight: 5 },
  { pattern: "jwt", category: "backend", weight: 7 },

  // ── Frontend ─────────────────────────────────────────────────────────────
  { pattern: "frontend", category: "frontend", weight: 10 },
  { pattern: "ui", category: "frontend", weight: 10 },
  { pattern: "component", category: "frontend", weight: 10 },
  { pattern: "react", category: "frontend", weight: 10 },
  { pattern: "vue", category: "frontend", weight: 10 },
  { pattern: "css", category: "frontend", weight: 9 },
  { pattern: "tailwind", category: "frontend", weight: 9 },
  { pattern: "html", category: "frontend", weight: 8 },
  { pattern: "layout", category: "frontend", weight: 8 },
  { pattern: "page", category: "frontend", weight: 6 },
  { pattern: "design", category: "frontend", weight: 7 },
  { pattern: "style", category: "frontend", weight: 6 },
  { pattern: "theme", category: "frontend", weight: 7 },
  { pattern: "responsive", category: "frontend", weight: 8 },
  { pattern: "dom", category: "frontend", weight: 7 },
  { pattern: "render", category: "frontend", weight: 7 },
  { pattern: "client-side", category: "frontend", weight: 8 },
  { pattern: "shadcn", category: "frontend", weight: 8 },
  { pattern: "app-router", category: "frontend", weight: 8 },
  { pattern: "page-router", category: "frontend", weight: 8 },
  { pattern: "nextjs", category: "frontend", weight: 10 },
  { pattern: "next.js", category: "frontend", weight: 6 },
  { pattern: "vue", category: "frontend", weight: 10 },
  { pattern: "angular", category: "frontend", weight: 10 },

  // ── Documentation ────────────────────────────────────────────────────────
  { pattern: "readme", category: "docs", weight: 10 },
  { pattern: "documentation", category: "docs", weight: 10 },
  { pattern: "doc", category: "docs", weight: 7 },
  { pattern: "api doc", category: "docs", weight: 10 },
  { pattern: "swagger", category: "docs", weight: 9 },
  { pattern: "openapi", category: "docs", weight: 9 },
  { pattern: "changelog", category: "docs", weight: 8 },
  { pattern: "guide", category: "docs", weight: 7 },
  { pattern: "tutorial", category: "docs", weight: 7 },
  { pattern: "wiki", category: "docs", weight: 8 },
  { pattern: "jsdoc", category: "docs", weight: 8 },
  { pattern: "tsdoc", category: "docs", weight: 8 },
  { pattern: "markdown", category: "docs", weight: 6 },

  // ── Security ─────────────────────────────────────────────────────────────
  { pattern: "security", category: "security", weight: 12 },
  { pattern: "vulnerability", category: "security", weight: 12 },
  { pattern: "xss", category: "security", weight: 12 },
  { pattern: "sqli", category: "security", weight: 12 },
  { pattern: "sql injection", category: "security", weight: 10 },
  { pattern: "csrf", category: "security", weight: 12 },
  { pattern: "injection", category: "security", weight: 11 },
  { pattern: "auth", category: "security", weight: 8 },
  { pattern: "permission", category: "security", weight: 10 },
  { pattern: "encrypt", category: "security", weight: 10 },
  { pattern: "hash", category: "security", weight: 8 },
  { pattern: "oauth", category: "security", weight: 10 },
  { pattern: "owasp", category: "security", weight: 12 },
  { pattern: "threat", category: "security", weight: 8 },
  { pattern: "exploit", category: "security", weight: 10 },
  { pattern: "cve", category: "security", weight: 12 },
  { pattern: "secret", category: "security", weight: 8 },
  { pattern: "token", category: "security", weight: 5 },

  // ── Refactor ─────────────────────────────────────────────────────────────
  { pattern: "refactor", category: "refactor", weight: 10 },
  { pattern: "clean up", category: "refactor", weight: 8 },
  { pattern: "rename", category: "refactor", weight: 8 },
  { pattern: "extract", category: "refactor", weight: 8 },
  { pattern: "restructure", category: "refactor", weight: 10 },
  { pattern: "simplify", category: "refactor", weight: 9 },
  { pattern: "tech debt", category: "refactor", weight: 10 },
  { pattern: "deduplicate", category: "refactor", weight: 10 },
  { pattern: "consolidate", category: "refactor", weight: 8 },
  { pattern: "reorganize", category: "refactor", weight: 8 },
  { pattern: "rewrite", category: "refactor", weight: 7 },
  { pattern: "modularize", category: "refactor", weight: 9 },

  // ── Debugging ────────────────────────────────────────────────────────────
  { pattern: "bug", category: "debugging", weight: 10 },
  { pattern: "fix", category: "debugging", weight: 10 },
  { pattern: "error", category: "debugging", weight: 10 },
  { pattern: "crash", category: "debugging", weight: 10 },
  { pattern: "debug", category: "debugging", weight: 10 },
  { pattern: "issue", category: "debugging", weight: 7 },
  { pattern: "broken", category: "debugging", weight: 9 },
  { pattern: "not working", category: "debugging", weight: 11 },
  { pattern: "fails", category: "debugging", weight: 9 },
  { pattern: "failing", category: "debugging", weight: 9 },
  { pattern: "exception", category: "debugging", weight: 10 },
  { pattern: "stack trace", category: "debugging", weight: 10 },
  { pattern: "freeze", category: "debugging", weight: 9 },
  { pattern: "hang", category: "debugging", weight: 9 },
  { pattern: "wrong", category: "debugging", weight: 7 },
  { pattern: "incorrect", category: "debugging", weight: 8 },

  // ── Planning ─────────────────────────────────────────────────────────────
  { pattern: "plan", category: "planning", weight: 10 },
  { pattern: "architecture", category: "planning", weight: 10 },
  { pattern: "design", category: "planning", weight: 7 },
  { pattern: "strateg", category: "planning", weight: 9 },
  { pattern: "roadmap", category: "planning", weight: 9 },
  { pattern: "propose", category: "planning", weight: 8 },
  { pattern: "spec", category: "planning", weight: 8 },
  { pattern: "requirement", category: "planning", weight: 8 },
  { pattern: "milestone", category: "planning", weight: 8 },
  { pattern: "scope", category: "planning", weight: 7 },
  { pattern: "goal", category: "planning", weight: 6 },

  // ── Research ─────────────────────────────────────────────────────────────
  { pattern: "research", category: "research", weight: 10 },
  { pattern: "investigate", category: "research", weight: 10 },
  { pattern: "explore", category: "research", weight: 9 },
  { pattern: "find", category: "research", weight: 6 },
  { pattern: "understand", category: "research", weight: 8 },
  { pattern: "learn", category: "research", weight: 8 },
  { pattern: "search", category: "research", weight: 7 },
  { pattern: "study", category: "research", weight: 8 },
  { pattern: "analyze", category: "research", weight: 8 },
  { pattern: "compare", category: "research", weight: 8 },
  { pattern: "evaluate", category: "research", weight: 8 },
  { pattern: "identify", category: "research", weight: 6 },
]

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Maximum possible score if every single signal in the registry matched.
 * Used for confidence scaling.
 */
const MAX_POSSIBLE_SCORE = SIGNAL_REGISTRY.reduce((sum, signal) => sum + signal.weight, 0)

/**
 * Threshold ratio: when the top score is this close to the second-top score,
 * the task is flagged as multi-domain.
 */
const MULTI_DOMAIN_RATIO_THRESHOLD = 0.65

/**
 * Minimum absolute score for a category to appear in secondaryDomains.
 */
const SECONDARY_SCORE_MINIMUM = 8

// ─── Classification ──────────────────────────────────────────────────────────

function computeCategoryScores(
  input: string,
  signals: typeof SIGNAL_REGISTRY,
): {
  scores: Record<TaskIntentCategory, number>
  matched: IntentSignal[]
} {
  const lowerInput = input.toLowerCase()
  const scores: Record<string, number> = {}
  const matched: IntentSignal[] = []
  const seenSignals = new Set<string>()

  for (const signal of signals) {
    const patternLower = signal.pattern.toLowerCase()
    if (lowerInput.includes(patternLower)) {
      // Deduplicate identical pattern matches to avoid overcounting
      const signalKey = `${signal.category}:${patternLower}`
      if (seenSignals.has(signalKey)) continue
      seenSignals.add(signalKey)

      scores[signal.category] = (scores[signal.category] ?? 0) + signal.weight
      matched.push({ keyword: signal.pattern, category: signal.category, weight: signal.weight })
    }
  }

  // Fill zero-scores for all categories
  const fullScores: Record<TaskIntentCategory, number> = {} as Record<TaskIntentCategory, number>
  for (const category of TASK_INTENT_CATEGORIES) {
    fullScores[category as TaskIntentCategory] = scores[category] ?? 0
  }

  return { scores: fullScores, matched }
}

function computeConfidence(
  primaryScore: number,
  categoryScores: Record<TaskIntentCategory, number>,
): number {
  // Confidence = primary score / (primary + non-zero secondary + noise floor)
  // This gives higher confidence when the primary is clearly dominant.
  const nonZeroCategories = Object.values(categoryScores).filter((s) => s > 0).length
  if (nonZeroCategories === 0) return 0

  // Normalize by: primaryScore / max(observed max, small floor)
  const observedMax = Math.max(...Object.values(categoryScores))
  if (observedMax === 0) return 0

  // Scale: use ratio of observed to a moderate upper bound
  // A score of ~30 (3 good keywords) = ~0.7 confidence
  const rawConfidence = Math.min(primaryScore / 40, 1.0)

  // Bonus for clearly dominant primary (primary > 2x second)
  const sorted = [...Object.entries(categoryScores)]
    .filter(([c]) => c !== "unknown" && c !== "multi-domain")
    .sort(([, a], [, b]) => b - a)
  const secondScore = sorted.length > 1 ? sorted[1][1] : 0
  const dominanceBonus = secondScore > 0 && primaryScore > secondScore * 2 ? 0.12 : 0

  return Math.min(rawConfidence + dominanceBonus, 1.0)
}

function determineSecondaryDomains(
  primaryCategory: TaskIntentCategory,
  categoryScores: Record<TaskIntentCategory, number>,
): TaskIntentCategory[] {
  return (Object.entries(categoryScores) as [TaskIntentCategory, number][])
    .filter(([category]) => category !== primaryCategory)
    .filter(([category]) => category !== "unknown" && category !== "multi-domain")
    .filter(([, score]) => score >= SECONDARY_SCORE_MINIMUM)
    .sort(([, a], [, b]) => b - a)
    .map(([category]) => category)
    .slice(0, 3)
}

function detectMultiDomain(
  primaryCategory: TaskIntentCategory,
  categoryScores: Record<TaskIntentCategory, number>,
): boolean {
  const sorted = (Object.entries(categoryScores) as [TaskIntentCategory, number][])
    .filter(([c]) => c !== "unknown" && c !== "multi-domain")
    .sort(([, a], [, b]) => b - a)

  if (sorted.length < 2) return false
  const [topCat, topScore] = sorted[0]
  const [, secondScore] = sorted[1]

  if (topScore <= 0) return false
  return secondScore / topScore >= MULTI_DOMAIN_RATIO_THRESHOLD
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Classify a task description into a domain intent category.
 *
 * Uses weighted signal matching to produce a deterministic, runtime-safe
 * classification that routing logic can consume without an LLM call.
 *
 * @param input - The raw task description text to classify.
 * @returns A structured classification result.
 */
export function classifyTaskIntent(input: string): TaskIntentClassification {
  const trimmed = input.trim()
  if (trimmed.length === 0) {
    return {
      primaryDomain: "unknown",
      confidence: 0,
      secondaryDomains: [],
      matchedSignals: [],
      categoryScores: {} as Record<TaskIntentCategory, number>,
      isMultiDomain: false,
    }
  }

  const { scores, matched } = computeCategoryScores(trimmed, SIGNAL_REGISTRY)

  // Determine primary domain
  const sorted = (Object.entries(scores) as [TaskIntentCategory, number][])
    .filter(([c]) => c !== "unknown" && c !== "multi-domain")
    .sort(([, a], [, b]) => b - a)

  const primaryScore = sorted.length > 0 ? sorted[0][1] : 0
  const primaryCategory: TaskIntentCategory = primaryScore > 0
    ? sorted[0][0]
    : "unknown"

  const confidence = computeConfidence(primaryScore, scores)
  const secondaryDomains = determineSecondaryDomains(primaryCategory, scores)
  const isMultiDomain = detectMultiDomain(primaryCategory, scores)

  return {
    primaryDomain: isMultiDomain ? "multi-domain" : primaryCategory,
    confidence,
    secondaryDomains: isMultiDomain ? [primaryCategory, ...secondaryDomains].slice(0, 3) : secondaryDomains,
    matchedSignals: matched,
    categoryScores: scores,
    isMultiDomain,
  }
}

/**
 * Returns a human-readable summary of the classification suitable for including
 * in an agent's routing rationale or intake summary.
 */
export function formatIntentClassification(classification: TaskIntentClassification): string {
  const parts: string[] = [
    `domain: ${classification.primaryDomain}`,
    `confidence: ${(classification.confidence * 100).toFixed(0)}%`,
  ]

  if (classification.secondaryDomains.length > 0) {
    parts.push(`secondary: ${classification.secondaryDomains.join(", ")}`)
  }

  if (classification.isMultiDomain) {
    parts.push("multi-domain: true")
  }

  if (classification.matchedSignals.length > 0) {
    const signals = classification.matchedSignals
      .slice(0, 5)
      .map((s) => `"${s.keyword}"→${s.category}`)
    parts.push(`top signals: ${signals.join(", ")}`)
  }

  return parts.join(" | ")
}
