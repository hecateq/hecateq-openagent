import type {
  TaskNode,
  AgentSelectorResult,
  AgentSelectionEntry,
  LocalAgentRegistryEntry,
  AgentCandidateStatus,
  AgentCandidateEntry,
} from "./types"

export type AgentRegistryReader = () => LocalAgentRegistryEntry[]

/**
 * Read local agent registry from disk, extracting rich frontmatter signals.
 * Captures: name, description, hidden, model, mode, priority, domains from name,
 * use_when/avoid_when lists.
 */
export function readLocalAgentRegistry(
  agentsDir: string,
  readFileSync: (path: string) => string,
  readdirSync: (path: string) => string[],
  existsSync: (path: string) => boolean,
): LocalAgentRegistryEntry[] {
  const entries: LocalAgentRegistryEntry[] = []

  if (!existsSync(agentsDir)) return entries

  const files = readdirSync(agentsDir).filter((f) => f.toLowerCase().endsWith(".md"))

  for (const file of files) {
    try {
      const content = readFileSync(`${agentsDir}/${file}`)
      const nameMatch = content.match(/^name:\s*(.+)$/m)
      if (!nameMatch) continue

      const descMatch = content.match(/^description:\s*(.+)$/m)
      const hiddenMatch = content.match(/^hidden:\s*(true|false)$/m)
      const modelMatch = content.match(/^model:\s*(.+)$/m)
      const modeMatch = content.match(/^mode:\s*(.+)$/m)
      const priorityMatch = content.match(/^priority:\s*(.+)$/m)
      const domainMatch = content.match(/^domain:\s*(.+)$/m)

      // Extract use_when/avoid_when as multi-value YAML lists
      const useWhen = extractListField(content, "use_when")
      const avoidWhen = extractListField(content, "avoid_when")
      const keywords = extractListField(content, "keywords")

      const domainHints: string[] = []
      if (domainMatch) {
        domainHints.push(domainMatch[1].trim().toLowerCase())
      }
      if (keywords.length > 0) {
        for (const kw of keywords) {
          const lower = kw.toLowerCase()
          if (/backend|api|server|express|graphql|grpc|rest/i.test(lower)) domainHints.push("backend")
          if (/frontend|ui|ux|react|nextjs|component|css/i.test(lower)) domainHints.push("frontend")
          if (/database|db|sql|query|schema|migration|prisma/i.test(lower)) domainHints.push("database")
          if (/deploy|docker|kubernetes|ci|cd|devops/i.test(lower)) domainHints.push("devops")
          if (/security|auth|vulnerability|owasp|jwt/i.test(lower)) domainHints.push("security")
          if (/test|qa|e2e|playwright|coverage/i.test(lower)) domainHints.push("qa")
        }
      }

      entries.push({
        name: nameMatch[1].trim(),
        description: descMatch ? descMatch[1].trim() : "",
        hidden: hiddenMatch ? hiddenMatch[1] === "true" : false,
        disabled: false,
        sourcePath: `${agentsDir}/${file}`,
        model: modelMatch ? modelMatch[1].trim() : undefined,
        mode: modeMatch ? modeMatch[1].trim() : undefined,
        priority: priorityMatch ? priorityMatch[1].trim().toLowerCase() : undefined,
        domainHints: domainHints.length > 0 ? [...new Set(domainHints)] : undefined,
        useWhen: useWhen.length > 0 ? useWhen : undefined,
        avoidWhen: avoidWhen.length > 0 ? avoidWhen : undefined,
      })
    } catch {
      // skip unparseable files
    }
  }

  return entries
}

function extractListField(content: string, field: string): string[] {
  const pattern = new RegExp(`^${field}:[\\s\\S]*?(?=\\n\\w|$)`, "m")
  const match = content.match(pattern)
  if (!match) return []

  const lines = match[0].split("\n")
  const values: string[] = []
  for (const line of lines.slice(1)) {
    const trimmed = line.replace(/^[-\s]+/, "").trim()
    if (trimmed && !trimmed.startsWith("#")) values.push(trimmed)
  }
  return values
}

const AGENT_ALIASES: Record<string, string[]> = {
  "nodejs-backend-developer": ["backend", "backend-dev", "node-backend"],
  "nodejs-backend-architect": ["backend-architect", "backend-arch"],
  "nextjs-ui-wizard": ["frontend", "frontend-dev", "react-dev", "nextjs-dev"],
  "database-specialist": ["database", "db-specialist", "dba"],
  "devops-engineer": ["devops", "infra", "devops-dev"],
  "security-architect": ["security", "sec", "infosec"],
  "qa-test-engineer": ["qa", "testing", "tester", "qa-engineer"],
}

/**
 * Score how well an agent matches a task domain, using all available signals.
 * Returns a score >= 1 for a direct domain match, or 0 for no match.
 */
function scoreAgentDomain(agent: LocalAgentRegistryEntry, targetDomain: string): number {
  const domainLower = targetDomain.toLowerCase()

  // Direct domain_hints match — strongest signal
  if (agent.domainHints?.includes(domainLower)) return 3
  if (agent.domainHints?.some((h) => h.includes(domainLower) || domainLower.includes(h))) return 2

  // use_when match — medium signal
  if (agent.useWhen?.some((u) => u.toLowerCase().includes(domainLower))) return 2

  // Description keyword match
  const desc = agent.description.toLowerCase()
  const domainKeywords: Record<string, RegExp> = {
    backend: /backend|api|server|controller|service|express|nestjs/i,
    frontend: /frontend|ui|ux|react|nextjs|component/i,
    database: /database|db|query|schema|migration|prisma|sql/i,
    devops: /devops|deploy|infra|docker|kubernetes|ci/i,
    security: /security|auth|vulnerability|hardening|owasp/i,
    qa: /test|qa|quality|e2e|playwright/i,
  }
  const kw = domainKeywords[domainLower as keyof typeof domainKeywords]
  if (kw && kw.test(desc)) return 1

  // Name-based fallback
  const name = agent.name.toLowerCase()
  const namePatterns: Record<string, RegExp> = {
    backend: /backend|api|server/i,
    frontend: /frontend|ui|ux/i,
    database: /database|db/i,
    devops: /devops|deploy|infra/i,
    security: /security|sec/i,
    qa: /test|qa/i,
  }
  const np = namePatterns[domainLower as keyof typeof namePatterns]
  if (np && np.test(name)) return 1

  return 0
}

/**
 * Map task nodes to agents from the local registry using rich signals.
 *
 * Algorithm:
 * 1. Score every visible agent against each task's domain
 * 2. Pick the highest-scoring agent (exact match)
 * 3. If disabled, try next-scoring agent with disabled reason
 * 4. If no match, use category fallback with explicit reason
 * 5. Record all fallback reasons precisely
 */
export function selectAgents(
  tasks: TaskNode[],
  registry: LocalAgentRegistryEntry[],
  disabledAgents: string[] = [],
): AgentSelectorResult {
  const visibleRegistry = registry.filter((a) => !a.hidden)
  const disabledSet = new Set(disabledAgents.map((a) => a.toLowerCase()))

  // Build name lookup including aliases
  const registryByName = new Map<string, LocalAgentRegistryEntry>()
  for (const agent of visibleRegistry) {
    registryByName.set(agent.name.toLowerCase(), agent)
    const aliases = AGENT_ALIASES[agent.name]
    if (aliases) {
      for (const alias of aliases) {
        if (!registryByName.has(alias)) registryByName.set(alias, agent)
      }
    }
  }

  const entries: AgentSelectionEntry[] = []
  const unassignedTasks: Array<{ taskId: string; reason: string }> = []

  for (const task of tasks) {
    const taskDomain = task.domain

    // Score all agents for this task domain
    const scored = visibleRegistry
      .map((agent) => ({
        agent,
        score: scoreAgentDomain(agent, taskDomain),
      }))
      .filter((s) => s.score > 0)
      .sort((a, b) => {
        // Higher priority first, then higher score, then alphabetically
        const prioOrder = { high: 0, medium: 1, low: 2 }
        const aPrio = prioOrder[a.agent.priority as keyof typeof prioOrder] ?? 1
        const bPrio = prioOrder[b.agent.priority as keyof typeof prioOrder] ?? 1
        if (aPrio !== bPrio) return aPrio - bPrio
        if (b.score !== a.score) return b.score - a.score
        return a.agent.name.localeCompare(b.agent.name)
      })

    let selectedAgent: string
    let exactMatch = false
    let fallbackReason: string | undefined
    let disabled = false
    let unknown = false

    if (scored.length > 0) {
      const best = scored[0]
      selectedAgent = best.agent.name
      exactMatch = true

      if (disabledSet.has(selectedAgent.toLowerCase())) {
        disabled = true
        // Try next best agent
        const alt = scored.find((s) => !disabledSet.has(s.agent.name.toLowerCase()))
        if (alt) {
          selectedAgent = alt.agent.name
          disabled = false
          fallbackReason = `Agent "${best.agent.name}" is disabled; fell back to "${alt.agent.name}" (score: ${alt.score})`
        } else {
          fallbackReason = `Agent "${best.agent.name}" is disabled in config and no alternative found`
        }
      } else if (best.agent.avoidWhen?.some((a) => a.toLowerCase().includes(taskDomain))) {
        // Agent says to avoid this domain — note it but still use (soft signal)
        fallbackReason = `Agent "${best.agent.name}" matched but has avoid_when matching "${taskDomain}"; used as best available`
      } else {
        fallbackReason = best.agent.useWhen
          ? `Exact match via domain signals (${best.agent.domainHints?.join(", ") ?? "description"})`
          : `Exact match via description/name`
      }
    } else {
      // No scored agent found — fallback to category/sisyphus-junior
      selectedAgent = "sisyphus-junior"
      fallbackReason = `No exact agent found for domain "${taskDomain}"; used category routing via sisyphus-junior`
    }

    entries.push({
      taskId: task.id,
      selectedAgent,
      exactMatch,
      fallbackReason,
      disabled,
      unknown,
    })

    if (!exactMatch && selectedAgent === "sisyphus-junior" && scored.length === 0) {
      unassignedTasks.push({
        taskId: task.id,
        reason: fallbackReason ?? "No suitable agent found",
      })
    }
  }

  return {
    entries,
    unassignedTasks,
    exactMatchCount: entries.filter((e) => e.exactMatch).length,
    fallbackCount: entries.filter((e) => !e.exactMatch).length,
  }
}

    // ─── Status-aware candidate pool ────────────────────────────────────────────

const CALLABLE_STATUSES: Set<AgentCandidateStatus> = new Set([
  "runtime_callable",
  "runtime_only",
  "hidden_internal",
])

/**
 * Classify an agent's runtime truth status by cross-referencing the
 * index registry, runtime-known agent set, disabled set, and hidden flag.
 *
 * Order of precedence (first match wins):
 *   1. disabled in config     → "disabled"
 *   2. hidden + runtime known → "hidden_internal"
 *   3. runtime known + index  → "runtime_callable"
 *   4. runtime known, no idx  → "runtime_only"
 *   5. in index, not runtime  → "index_only_stale"
 *   6. not in index, not rt   → "unknown"
 */
export function classifyAgentStatus(args: {
  agentName: string
  hidden: boolean
  runtimeAgentIds: Set<string>
  disabledSet: Set<string>
  indexHasAgent: boolean
}): { status: AgentCandidateStatus; reason?: string } {
  const { agentName, hidden, runtimeAgentIds, disabledSet, indexHasAgent } = args
  const lower = agentName.toLowerCase()

  if (disabledSet.has(lower)) {
    return { status: "disabled", reason: `Agent "${agentName}" is disabled in config` }
  }

  const runtimeKnows = runtimeAgentIds.has(lower)

  if (hidden && runtimeKnows) {
    return { status: "hidden_internal", reason: `Agent "${agentName}" is hidden but callable` }
  }

  if (runtimeKnows && indexHasAgent) {
    return { status: "runtime_callable" }
  }

  if (runtimeKnows && !indexHasAgent) {
    return { status: "runtime_only", reason: `Agent "${agentName}" is callable via runtime but has no index metadata` }
  }

  if (!runtimeKnows && indexHasAgent) {
    return { status: "index_only_stale", reason: `Agent "${agentName}" appears in index but is not callable via runtime` }
  }

  return { status: "unknown", reason: `Agent "${agentName}" is not known to the system` }
}

/**
 * Build a status-augmented candidate pool from the full agent registry
 * and the runtime-known agent set.
 *
 * Hidden agents ARE included as internal candidates (hideFromSuggestions=true)
 * but disabled agents are excluded entirely.
 *
 * Runtime-only agents (no index metadata) are included with null registryEntry.
 */
export function buildCandidatePool(args: {
  registry: LocalAgentRegistryEntry[]
  runtimeAgentIds: Set<string>
  disabledAgents: string[]
}): AgentCandidateEntry[] {
  const { registry, runtimeAgentIds, disabledAgents } = args
  const disabledSet = new Set(disabledAgents.map((a) => a.toLowerCase()))
  const seen = new Set<string>()

  const candidates: AgentCandidateEntry[] = []

  for (const entry of registry) {
    const lower = entry.name.toLowerCase()
    if (seen.has(lower)) continue
    seen.add(lower)

    const classification = classifyAgentStatus({
      agentName: entry.name,
      hidden: entry.hidden,
      runtimeAgentIds,
      disabledSet,
      indexHasAgent: true,
    })

    if (classification.status === "disabled") continue
    if (classification.status === "unknown") continue

    candidates.push({
      name: entry.name,
      status: classification.status,
      statusReason: classification.reason,
      registryEntry: entry,
      hideFromSuggestions: entry.hidden || classification.status === "hidden_internal",
    })
  }

  for (const rtName of runtimeAgentIds) {
    if (seen.has(rtName)) continue
    if (disabledSet.has(rtName)) continue
    seen.add(rtName)

    candidates.push({
      name: rtName,
      status: "runtime_only",
      statusReason: `Agent "${rtName}" is callable via runtime but has no index metadata`,
      registryEntry: null,
      hideFromSuggestions: false,
    })
  }

  return candidates
}

/**
 * Filter the candidate pool to public suggestions only (exclude hidden_internal,
 * index_only_stale, disabled).
 */
export function getPublicSuggestions(candidates: AgentCandidateEntry[]): AgentCandidateEntry[] {
  return candidates.filter((c) => !c.hideFromSuggestions && c.status !== "index_only_stale" && c.status !== "disabled")
}

/**
 * Filter the candidate pool to callable agents only (runtime_callable,
 * runtime_only, hidden_internal).
 */
export function getCallableCandidates(candidates: AgentCandidateEntry[]): AgentCandidateEntry[] {
  return candidates.filter((c) => CALLABLE_STATUSES.has(c.status))
}

/**
 * Status-aware variant of selectAgents that uses the candidate pool.
 *
 * Differs from the original selectAgents:
 *   - Hidden agents can be selected as internal candidates
 *   - Disabled agents produce a hard-fail entry (disabled=true)
 *   - Index-only/stale agents are skipped with reason
 *   - Runtime-only agents are valid candidates even without index metadata
 */
export function selectAgentsFromPool(
  tasks: TaskNode[],
  candidates: AgentCandidateEntry[],
): AgentSelectorResult {
  const callable = getCallableCandidates(candidates)
  const disabledCandidates = candidates.filter((c) => c.status === "disabled")

  const entries: AgentSelectionEntry[] = []
  const unassignedTasks: Array<{ taskId: string; reason: string }> = []

  for (const task of tasks) {
    const taskDomain = task.domain

    const scored = callable
      .filter((c) => c.registryEntry !== null)
      .map((c) => ({
        candidate: c,
        score: scoreAgentDomain(c.registryEntry!, taskDomain),
      }))
      .filter((s) => s.score > 0)
      .sort((a, b) => {
        const prioOrder = { high: 0, medium: 1, low: 2 }
        const aPrio = prioOrder[a.candidate.registryEntry!.priority as keyof typeof prioOrder] ?? 1
        const bPrio = prioOrder[b.candidate.registryEntry!.priority as keyof typeof prioOrder] ?? 1
        if (aPrio !== bPrio) return aPrio - bPrio
        if (b.score !== a.score) return b.score - a.score
        return a.candidate.name.localeCompare(b.candidate.name)
      })

    let selectedAgent: string
    let exactMatch = false
    let fallbackReason: string | undefined
    let disabled = false
    let unknown = false

    if (scored.length > 0) {
      const best = scored[0]
      selectedAgent = best.candidate.name
      exactMatch = true

      if (best.candidate.status === "hidden_internal") {
        fallbackReason = `Selected hidden agent "${best.candidate.name}" as internal candidate for domain "${taskDomain}"`
      } else if (best.candidate.registryEntry?.avoidWhen?.some((a) => a.toLowerCase().includes(taskDomain))) {
        fallbackReason = `Agent "${best.candidate.name}" matched but has avoid_when matching "${taskDomain}"; used as best available`
      } else {
        fallbackReason = best.candidate.registryEntry?.useWhen
          ? `Exact match via domain signals (${best.candidate.registryEntry.domainHints?.join(", ") ?? "description"})`
          : `Exact match via description/name`
      }
    } else {
      const disabledScored = disabledCandidates
        .filter((c) => c.registryEntry !== null)
        .map((c) => ({
          candidate: c,
          score: scoreAgentDomain(c.registryEntry!, taskDomain),
        }))
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score)

      if (disabledScored.length > 0) {
        const bestDisabled = disabledScored[0]
        selectedAgent = bestDisabled.candidate.name
        disabled = true
        fallbackReason = `Agent "${bestDisabled.candidate.name}" would match domain "${taskDomain}" (score: ${bestDisabled.score}) but is disabled in config — no alternative found`
      } else {
        selectedAgent = "sisyphus-junior"
        fallbackReason = `No exact agent found for domain "${taskDomain}"; used category routing via sisyphus-junior`
      }
    }

    entries.push({
      taskId: task.id,
      selectedAgent,
      exactMatch,
      fallbackReason,
      disabled,
      unknown,
    })

    if (!exactMatch && selectedAgent === "sisyphus-junior") {
      unassignedTasks.push({
        taskId: task.id,
        reason: fallbackReason ?? "No suitable agent found",
      })
    }
  }

  return {
    entries,
    unassignedTasks,
    exactMatchCount: entries.filter((e) => e.exactMatch).length,
    fallbackCount: entries.filter((e) => !e.exactMatch).length,
  }
}
