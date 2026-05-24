import type {
  PromptIntakeResult,
  TaskSize,
  DomainScope,
  RiskLevel,
  IntentKind,
} from "./types"

/** Terms suggesting implementation intent */
const IMPLEMENTATION_TERMS = /implement|build|create|add|develop|write|make|code|ship|deliver|produce/i
/** Terms suggesting bugfix intent */
const BUGFIX_TERMS = /bug|fix|error|issue|broken|crash|fail|wrong|incorrect|defect|regression/i
/** Terms suggesting refactoring intent */
const REFACTOR_TERMS = /refactor|clean|restructure|reorganize|modernize|simplify|extract|deduplicate|consolidate/i
/** Terms suggesting research intent */
const RESEARCH_TERMS = /research|investigate|find|search|explore|analyze|understand|learn|look up|examine/i
/** Terms suggesting planning intent */
const PLANNING_TERMS = /plan|design|strategy|architect|roadmap|spec|blueprint|proposal|approach/i
/** Terms suggesting review intent */
const REVIEW_TERMS = /review|audit|check|inspect|verify|validate|assess|evaluate/i
/** Terms suggesting devops intent */
const DEVOPS_TERMS = /deploy|ci|cd|pipeline|infrastructure|docker|kubernetes|provision|release|monitor/i
/** Terms suggesting documentation intent */
const DOCS_TERMS = /document|readme|docs|wiki|manual|guide|comment|changelog/i

/** Terms associated with backend domains */
const BACKEND_TERMS = /backend|api|endpoint|server|service|database|db|sql|query|model|controller|route|middleware|graphql|rest|grpc/i
/** Terms associated with frontend domains */
const FRONTEND_TERMS = /frontend|ui|ux|component|page|layout|style|css|html|react|vue|angular|design|visual|render/i
/** Terms associated with database domains */
const DATABASE_TERMS = /database|schema|migration|index|query|sql|orm|prisma|table|column|relation|foreign key|transaction/i
/** Terms associated with devops domains */
const DEVOPS_DOMAIN_TERMS = /docker|kubernetes|deploy|ci|cd|pipeline|infra|terraform|ansible|nginx|coolify/i
/** Terms associated with security domains */
const SECURITY_TERMS = /security|auth|jwt|oauth|password|encrypt|vulnerability|hardening|audit|threat/i
/** Terms associated with testing domains */
const QA_TERMS = /test|qa|spec|assert|mock|stub|coverage|verify|validation|regression|e2e/i
/** Terms indicating high risk */
const HIGH_RISK_TERMS = /delete|remove|drop|destroy|reset|purge|overwrite|replace|migrate\s+prod|production\s+change|schema\s+change/i
/** Terms indicating destructive risk */
const DESTRUCTIVE_TERMS = /drop\s+(?:the\s+)?(?:production\s+)?database|format|wipe|clean\s+all|rm\s+-rf|force\s+push|production\s+db/i

/** Terms that are commonly user exclusions */
const EXCLUSION_TERMS = /donot|do not|never|avoid|skip|exclude|except|without|unless/i

/**
 * Normalize the prompt by trimming whitespace and collapsing multiple spaces.
 */
function normalizePrompt(raw: string): string {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s{2,}/g, " ")
    .trim()
}

/**
 * Infer intent from the normalized prompt.
 */
function inferIntent(prompt: string): IntentKind {
  if (BUGFIX_TERMS.test(prompt)) return "bugfix"
  if (REFACTOR_TERMS.test(prompt)) return "refactor"
  if (RESEARCH_TERMS.test(prompt)) return "research"
  if (PLANNING_TERMS.test(prompt)) return "planning"
  if (REVIEW_TERMS.test(prompt)) return "review"
  if (DEVOPS_TERMS.test(prompt)) return "devops"
  if (DOCS_TERMS.test(prompt)) return "documentation"
  if (IMPLEMENTATION_TERMS.test(prompt)) return "implementation"
  return "unknown"
}

/**
 * Estimate task size from the prompt length and complexity signals.
 */
function estimateTaskSize(prompt: string, likelyDomains: string[]): TaskSize {
  const wordCount = prompt.split(/\s+/).length
  const domainCount = likelyDomains.length

  if (wordCount > 200 || domainCount >= 3) return "large"
  if (wordCount > 50 || domainCount >= 2) return "medium"
  return "small"
}

/**
 * Infer likely domains from the prompt.
 */
function inferDomains(prompt: string): string[] {
  const domains: string[] = []
  if (BACKEND_TERMS.test(prompt)) domains.push("backend")
  if (FRONTEND_TERMS.test(prompt)) domains.push("frontend")
  if (DATABASE_TERMS.test(prompt)) domains.push("database")
  if (DEVOPS_DOMAIN_TERMS.test(prompt)) domains.push("devops")
  if (SECURITY_TERMS.test(prompt)) domains.push("security")
  if (QA_TERMS.test(prompt)) domains.push("qa")
  if (domains.length === 0) domains.push("unknown")
  return domains
}

/**
 * Infer domain scope from number of domains.
 */
function inferDomainScope(domains: string[]): DomainScope {
  if (domains.length === 0 || (domains.length === 1 && domains[0] === "unknown")) return "unknown-domain"
  if (domains.length === 1) return "single-domain"
  return "multi-domain"
}

/**
 * Infer risk level from the prompt.
 */
function inferRiskLevel(prompt: string): RiskLevel {
  if (DESTRUCTIVE_TERMS.test(prompt)) return "destructive"
  if (HIGH_RISK_TERMS.test(prompt)) return "high"
  if (prompt.length > 500) return "medium"
  return "low"
}

/**
 * Extract user constraints from the prompt.
 */
function extractConstraints(prompt: string): string[] {
  const constraints: string[] = []
  const constraintPatterns = [
    /using\s+(.+?)(?:[,;.]|$)/gi,
    /with\s+(.+?)(?:[,;.]|$)/gi,
    /must\s+(.+?)(?:[,;.]|$)/gi,
    /should\s+(.+?)(?:[,;.]|$)/gi,
    /need\s+(.+?)(?:[,;.]|$)/gi,
  ]

  for (const pattern of constraintPatterns) {
    const matches = prompt.matchAll(pattern)
    for (const match of matches) {
      if (match[1] && match[1].trim().length > 3) {
        constraints.push(match[1].trim())
      }
    }
  }

  return constraints.slice(0, 10)
}

/**
 * Extract user exclusions from the prompt.
 */
function extractExclusions(prompt: string): string[] {
  const exclusions: string[] = []
  const exclusionPatterns = /(?:donot|do not|never|avoid|skip|exclude|except|without|unless)\s+(.+?)(?:[,;.]|$)/gi
  const matches = prompt.matchAll(exclusionPatterns)
  for (const match of matches) {
    if (match[1] && match[1].trim().length > 3) {
      exclusions.push(match[1].trim())
    }
  }
  return exclusions.slice(0, 10)
}

/**
 * Detect explicitly requested agent names in the prompt.
 */
function extractRequestedAgents(prompt: string): string[] {
  const agentPatterns = [
    /use\s+(?:the\s+)?(\w+(?:[-\s]\w+)*)\s+agent/gi,
    /delegate\s+to\s+(\w+(?:[-\s]\w+)*)/gi,
    /assign\s+(\w+(?:[-\s]\w+)*)/gi,
    /with\s+(\w+(?:[-\s]\w+)*)\s+agent/gi,
  ]

  const agents: string[] = []
  for (const pattern of agentPatterns) {
    const matches = prompt.matchAll(pattern)
    for (const match of matches) {
      if (match[1]) {
        agents.push(match[1].trim().toLowerCase().replace(/\s+/g, "-"))
      }
    }
  }
  return agents
}

/**
 * Full prompt intake: normalize, classify and produce a structured intake result.
 *
 * This is the first stage of the orchestration pipeline.
 * It does not perform any I/O — pure classification logic.
 */
export function analyzePrompt(rawPrompt: string): PromptIntakeResult {
  const normalizedPrompt = normalizePrompt(rawPrompt)
  const intent = inferIntent(normalizedPrompt)
  const likelyDomains = inferDomains(normalizedPrompt)
  const domainScope = inferDomainScope(likelyDomains)
  const taskSize = estimateTaskSize(normalizedPrompt, likelyDomains)
  const riskLevel = inferRiskLevel(normalizedPrompt)

  const implementationIntents: readonly IntentKind[] = ["implementation", "bugfix", "refactor"] as const
  const requiresPlan = taskSize === "large" || riskLevel === "high" || riskLevel === "destructive"
  const requiresImplementation = (implementationIntents as readonly IntentKind[]).includes(intent)
  const testingIntents: readonly IntentKind[] = ["implementation", "bugfix", "refactor"] as const
  const requiresTesting = (testingIntents as readonly IntentKind[]).includes(intent)

  const constraints = extractConstraints(normalizedPrompt)
  const userExclusions = extractExclusions(normalizedPrompt)
  const requestedAgents = extractRequestedAgents(normalizedPrompt)

  const ambiguous = intent === "unknown"
    && taskSize === "medium"
    && likelyDomains.length === 0

  return {
    rawPrompt,
    normalizedPrompt,
    taskSize,
    domainScope,
    likelyDomains,
    intent,
    riskLevel,
    requiresPlan,
    requiresImplementation,
    requiresTesting,
    constraints,
    userExclusions,
    requestedAgents,
    ambiguous,
  }
}
