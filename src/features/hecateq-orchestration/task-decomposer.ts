import type { PromptIntakeResult, TaskNode, TaskDomain, TaskAction } from "./types"

let taskIdCounter = 0
function nextTaskId(): string {
  taskIdCounter += 1
  return `task_${taskIdCounter}`
}

function resetCounter(): void {
  taskIdCounter = 0
}

export { resetCounter }

/**
 * Domain-specific task decomposition keywords for splitting a prompt into sub-tasks.
 */
const DOMAIN_KEYWORDS: Record<string, RegExp> = {
  backend: /backend|api|endpoint|server|service|controller|route|middleware|graphql|rest|grpc|socket/i,
  frontend: /frontend|ui|ux|component|page|layout|style|css|html|react|vue|angular/i,
  database: /database|schema|migration|index|query|sql|orm|prisma|table|column/i,
  devops: /deploy|docker|kubernetes|ci|cd|pipeline|infra|terraform/i,
  security: /security|auth|jwt|oauth|password|encrypt|vulnerability/i,
  qa: /test|qa|spec|assert|mock|coverage|cypress|playwright/i,
  docs: /document|readme|docs|wiki|manual|guide|comment/i,
}

/**
 * Determine the primary domain for a prompt segment.
 */
function detectDomain(text: string): TaskDomain {
  const domains: Array<{ domain: TaskDomain; pattern: RegExp }> = [
    { domain: "backend", pattern: DOMAIN_KEYWORDS.backend },
    { domain: "frontend", pattern: DOMAIN_KEYWORDS.frontend },
    { domain: "database", pattern: DOMAIN_KEYWORDS.database },
    { domain: "devops", pattern: DOMAIN_KEYWORDS.devops },
    { domain: "security", pattern: DOMAIN_KEYWORDS.security },
    { domain: "qa", pattern: DOMAIN_KEYWORDS.qa },
    { domain: "docs", pattern: DOMAIN_KEYWORDS.docs },
  ]

  for (const { domain, pattern } of domains) {
    if (pattern.test(text)) return domain
  }

  return "unknown"
}

/**
 * Determine action type (read/write/both) from a prompt segment.
 */
function detectAction(text: string): TaskAction {
  const lowerText = text.toLowerCase()
  const hasWriteTerms = /create|implement|build|write|add|change|modify|update|delete|remove|refactor|fix/i.test(lowerText)
  const hasReadTerms = /read|analyze|review|audit|inspect|find|search|investigate/i.test(lowerText)

  if (hasWriteTerms && hasReadTerms) return "both"
  if (hasWriteTerms) return "write"
  if (hasReadTerms) return "read"
  return "write"
}

/**
 * Split a prompt into segments by sentence boundaries for multi-domain tasks.
 */
function splitPromptByDomains(prompt: string): string[] {
  const segments: string[] = []
  const sentences = prompt.split(/(?<=[.!?])\s+/).filter(Boolean)

  let currentSegment = ""
  let currentDomains = new Set<TaskDomain>()

  for (const sentence of sentences) {
    const sentenceDomain = detectDomain(sentence)
    if (sentenceDomain !== "unknown" && currentDomains.size > 0 && !currentDomains.has(sentenceDomain) && currentSegment.length > 20) {
      segments.push(currentSegment.trim())
      currentSegment = sentence
      currentDomains = new Set([sentenceDomain])
    } else {
      currentSegment += (currentSegment ? " " : "") + sentence
      if (sentenceDomain !== "unknown") currentDomains.add(sentenceDomain)
    }
  }

  if (currentSegment.trim()) {
    segments.push(currentSegment.trim())
  }

  return segments
}

/**
 * Decompose a SMALL task into a single task node.
 */
function decomposeSmall(intake: PromptIntakeResult): TaskNode[] {
  const domain = intake.likelyDomains.length > 0 && intake.likelyDomains[0]
    ? (intake.likelyDomains[0] as TaskDomain)
    : "unknown"

  return [
    {
      id: nextTaskId(),
      label: intake.normalizedPrompt.slice(0, 80) + (intake.normalizedPrompt.length > 80 ? "..." : ""),
      prompt: intake.normalizedPrompt,
      domain,
      action: detectAction(intake.normalizedPrompt),
      dependsOn: [],
      status: "pending",
      canParallelize: false,
    },
  ]
}

/**
 * Decompose a MEDIUM task: split by sentence/domain boundaries when multi-domain,
 * otherwise keep as a single task.
 */
function decomposeMedium(intake: PromptIntakeResult): TaskNode[] {
  if (intake.likelyDomains.length <= 1) {
    return decomposeSmall(intake)
  }

  const segments = splitPromptByDomains(intake.normalizedPrompt)

  if (segments.length <= 1) {
    return decomposeSmall(intake)
  }

  const tasks: TaskNode[] = []
  for (let i = 0; i < segments.length; i++) {
    const domain = detectDomain(segments[i])
    tasks.push({
      id: nextTaskId(),
      label: segments[i].slice(0, 80) + (segments[i].length > 80 ? "..." : ""),
      prompt: segments[i],
      domain,
      action: detectAction(segments[i]),
      dependsOn: i > 0 ? [tasks[i - 1].id] : [],
      status: "pending",
      canParallelize: i === 0,
    })
  }

  return tasks
}

/**
 * Decompose a LARGE task: split by domain boundaries, then create explicit
 * dependency ordering (database → backend → frontend).
 *
 * Large tasks always produce a dependency chain with domain ordering.
 */
function decomposeLarge(intake: PromptIntakeResult): TaskNode[] {
  const domainOrder: TaskDomain[] = [
    "database",
    "backend",
    "security",
    "devops",
    "frontend",
    "qa",
    "docs",
    "unknown",
  ]

  const domainSegments = new Map<TaskDomain, string[]>()
  const sentences = intake.normalizedPrompt.split(/(?<=[.!?])\s+/).filter(Boolean)

  let currentDomain: TaskDomain = "unknown"
  for (const sentence of sentences) {
    const domain = detectDomain(sentence)
    if (domain !== "unknown") {
      currentDomain = domain
    }
    if (!domainSegments.has(currentDomain)) {
      domainSegments.set(currentDomain, [])
    }
    domainSegments.get(currentDomain)?.push(sentence)
  }

  const tasks: TaskNode[] = []
  const lastIdByDomain = new Map<TaskDomain, string>()

  for (const domain of domainOrder) {
    const segments = domainSegments.get(domain)
    if (!segments || segments.length === 0) continue

    const domainText = segments.join(" ")

    // Determine dependencies: depends on the previous domain in the ordered chain
    const dependsOn: string[] = []
    for (const [prevDomain, lastId] of lastIdByDomain) {
      if (prevDomain !== domain) {
        dependsOn.push(lastId)
      }
    }

    const task: TaskNode = {
      id: nextTaskId(),
      label: `${domain}: ${domainText.slice(0, 70)}${domainText.length > 70 ? "..." : ""}`,
      prompt: domainText,
      domain,
      action: detectAction(domainText),
      dependsOn,
      status: "pending",
      canParallelize: dependsOn.length === 0,
      metadata: { largeDomain: true },
    }

    tasks.push(task)
    lastIdByDomain.set(domain, task.id)
  }

  return tasks.length > 0 ? tasks : decomposeSmall(intake)
}

/**
 * Decompose a user prompt into task nodes suitable for dependency planning.
 *
 * Rules:
 * - SMALL: single task node
 * - MEDIUM: split by domain boundaries if multi-domain, with sequential dependency
 * - LARGE: domain-aware decomposition with proper dependency ordering
 */
export function decomposePrompt(intake: PromptIntakeResult): TaskNode[] {
  switch (intake.taskSize) {
    case "small":
      return decomposeSmall(intake)
    case "medium":
      return decomposeMedium(intake)
    case "large":
      return decomposeLarge(intake)
    default:
      return decomposeSmall(intake)
  }
}
