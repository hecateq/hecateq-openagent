import { getAgentConfigKey, stripAgentListSortPrefix } from "../agent-display-names"
import type { RoutingDecision } from "./routing-contract"
import type { AgentCandidate, ResolveAgentTargetInput } from "./routing-result"

type NormalizedAgentCandidate = AgentCandidate & {
  normalizedId: string
  lookupKeys: Set<string>
}

function normalizeAgentName(value: string): string {
  return getAgentConfigKey(stripAgentListSortPrefix(value).trim())
}

function tokenize(value: string): string[] {
  return stripAgentListSortPrefix(value)
    .trim()
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter(Boolean)
}

function dedupeStrings(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => typeof value === "string" && value.trim().length > 0)))
}

function toNormalizedCandidate(candidate: AgentCandidate): NormalizedAgentCandidate {
  const normalizedId = normalizeAgentName(candidate.id)
  const aliases = dedupeStrings([
    candidate.id,
    candidate.name,
    candidate.displayName,
    ...(candidate.aliases ?? []),
  ])

  return {
    ...candidate,
    normalizedId,
    lookupKeys: new Set(aliases.map((alias) => normalizeAgentName(alias))),
  }
}

function isCandidateVisible(candidate: NormalizedAgentCandidate): boolean {
  return candidate.hidden !== true || candidate.taskCallable === true
}

function isCandidateEnabled(candidate: NormalizedAgentCandidate, disabledAgents: Set<string>): boolean {
  return candidate.enabled !== false && !disabledAgents.has(candidate.normalizedId)
}

function matchesRequestedAgent(candidate: NormalizedAgentCandidate, requested: string): boolean {
  return candidate.lookupKeys.has(requested)
}

function buildOrderedCandidates(input: ResolveAgentTargetInput): NormalizedAgentCandidate[] {
  return [
    ...input.builtinAgents,
    ...input.customAgents,
    ...input.configAgents,
  ].map(toNormalizedCandidate)
}

function getIndexSuggestionBoosts(input: ResolveAgentTargetInput): Map<string, number> {
  const boosts = new Map<string, number>()
  if (!input.agentIndex?.available) {
    return boosts
  }

  for (const suggestion of input.agentIndex.suggestions ?? []) {
    const normalized = normalizeAgentName(suggestion.id)
    boosts.set(normalized, 200 + (suggestion.score ?? 0))
  }

  return boosts
}

function scoreSuggestion(
  requested: string,
  candidate: NormalizedAgentCandidate,
  indexBoosts: Map<string, number>,
): number {
  let score = indexBoosts.get(candidate.normalizedId) ?? 0

  if (candidate.lookupKeys.has(requested)) {
    return score + 1000
  }

  const requestedTokens = new Set(tokenize(requested))
  const candidateTokens = tokenize(candidate.normalizedId)
  const overlap = candidateTokens.filter((token) => requestedTokens.has(token)).length
  score += overlap * 20

  if (candidate.normalizedId.includes(requested) || requested.includes(candidate.normalizedId)) {
    score += 25
  }

  score += (candidate.agentIndex?.confidence ?? 0) * 40
  if (candidate.agentIndex?.primaryDomain) {
    score += 6
  }

  switch (candidate.agentIndex?.ambiguity) {
    case "low":
      score += 6
      break
    case "medium":
      score -= 4
      break
    case "high":
      score -= 12
      break
  }

  return score
}

function buildUnknownSuggestions(
  requested: string,
  candidates: NormalizedAgentCandidate[],
  disabledAgents: Set<string>,
  input: ResolveAgentTargetInput,
): string[] {
  const indexBoosts = getIndexSuggestionBoosts(input)
  const maxSuggestions = input.maxSuggestions === undefined
    ? candidates.length
    : Math.max(1, Math.trunc(input.maxSuggestions))

  return [...candidates]
    .filter((candidate) => isCandidateVisible(candidate))
    .filter((candidate) => candidate.taskCallable !== false)
    .filter((candidate) => isCandidateEnabled(candidate, disabledAgents))
    .sort((left, right) => {
      const diff = scoreSuggestion(requested, right, indexBoosts) - scoreSuggestion(requested, left, indexBoosts)
      if (diff !== 0) return diff
      return left.normalizedId.localeCompare(right.normalizedId)
    })
    .map((candidate) => candidate.normalizedId)
    .filter((id, index, values) => values.indexOf(id) === index)
    .slice(0, maxSuggestions)
}

function hasLowerPrecedenceCollision(candidate: NormalizedAgentCandidate, candidates: NormalizedAgentCandidate[]): boolean {
  const firstIndex = candidates.findIndex((entry) => entry.normalizedId === candidate.normalizedId)
  const lastIndex = candidates.length - 1 - [...candidates].reverse().findIndex((entry) => entry.normalizedId === candidate.normalizedId)
  return firstIndex !== lastIndex
}

export function resolveAgentTarget(input: ResolveAgentTargetInput): RoutingDecision {
  const requestedSubagentType = input.requestedSubagentType?.trim()
  const requestedCategory = input.requestedCategory?.trim()
  const disabledAgents = new Set((input.disabledAgents ?? []).map((value) => normalizeAgentName(value)))
  const disabledCategories = new Set((input.disabledCategories ?? []).map((value) => value.trim().toLowerCase()))
  const candidates = buildOrderedCandidates(input)

  if (requestedSubagentType) {
    const normalizedRequested = normalizeAgentName(requestedSubagentType)
    const matchedCandidate = candidates.find((candidate) => isCandidateVisible(candidate) && matchesRequestedAgent(candidate, normalizedRequested))

    if (matchedCandidate && !isCandidateEnabled(matchedCandidate, disabledAgents)) {
      return {
        status: "exact_agent_disabled",
        target: matchedCandidate.normalizedId,
        normalizedTarget: normalizedRequested,
        indexFresh: input.agentIndex?.fresh,
        indexReason: input.agentIndex?.available
          ? "Agent Index remained advisory-only while exact disabled filtering was resolved from live runtime candidates."
          : undefined,
        reason: "Exact subagent exists but is disabled by config.",
      }
    }

    if (matchedCandidate) {
      const collisionSuffix = hasLowerPrecedenceCollision(matchedCandidate, candidates)
        ? " Lower-precedence candidates with the same canonical id were ignored."
        : ""

      return {
        status: "exact_agent_found",
        target: matchedCandidate.normalizedId,
        normalizedTarget: normalizedRequested,
        source: matchedCandidate.source,
        indexUsed: false,
        indexFresh: input.agentIndex?.fresh,
        reason: `Exact subagent matched live ${matchedCandidate.source} agent registry.${collisionSuffix}`,
      }
    }

    const suggestions = buildUnknownSuggestions(normalizedRequested, candidates, disabledAgents, input)
    const indexUsed = (input.agentIndex?.available ?? false) && suggestions.length > 0

    return {
      status: "exact_agent_unknown",
      requested: requestedSubagentType,
      normalizedTarget: normalizedRequested,
      suggestions,
      indexUsed,
      indexFresh: input.agentIndex?.fresh,
      indexReason: indexUsed
        ? "Suggestions were enriched by advisory Agent Index metadata attached to live runtime candidates."
        : input.agentIndex?.available
          ? "Agent Index was available but did not alter the runtime exact-resolution outcome."
          : "Agent Index was unavailable, so suggestions were derived from live runtime candidates only.",
      reason: "No live runtime agent matched the requested exact subagent. Category fallback was not used because subagent_type was explicit.",
    }
  }

  if (requestedCategory) {
    const normalizedCategory = requestedCategory.toLowerCase()
    const categoryDisabled = disabledCategories.has(normalizedCategory)
    return {
      status: "category_fallback",
      category: requestedCategory,
      executor: input.categoryExecutor ?? "sisyphus-junior",
      normalizedTarget: normalizedCategory,
      reason: categoryDisabled
        ? "No exact subagent was requested. Explicit category routing selected the category executor, but category enablement must still be validated by the category resolver."
        : "No exact subagent was requested; explicit category routing selected the configured category executor.",
    }
  }

  throw new Error("Either requestedSubagentType or requestedCategory must be provided.")
}
