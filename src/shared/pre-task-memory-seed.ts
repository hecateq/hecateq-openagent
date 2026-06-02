/**
 * Pre-Task Memory Seed
 *
 * Deterministic, non-LLM extraction of project intent from user prompts.
 * Seeds project memory files (.opencode/state/memory/) before delegation
 * so downstream agents have structured context from the start.
 *
 * Phase 3A alignment: pre-task seed writes ONLY:
 *   - active-context.md (current goal/state/constraints)
 *   - open-questions.md (pre-existing questions)
 *   - conventions.md (known patterns)
 *   - environment.md (explicit setup info)
 *
 * It does NOT write decisions, tasks, progress, file-map, risk-profile,
 * or quality-history. Explicit decisions from the prompt are extracted as
 * `decisionCandidates` for later processing by the Decision Writer.
 *
 * All writes are best-effort: failures are caught, logged, and never
 * thrown. Memory write failure must not block runtime flow.
 */

import { existsSync, readFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"

import { writeFileAtomically } from "./write-file-atomically"
import { log } from "./logger"
import { PROJECT_MEMORY_DIR } from "./memory-bootstrap"
import { readManifest, refreshFileEntry, writeManifest } from "./memory-manifest"
import {
  canWriteMemoryFile,
  type WriterIdentity,
} from "./memory-writer-ownership"

/**
 * Writer identity for the pre-task memory seed module.
 * This module writes to 4 files (active-context, open-questions, conventions,
 * environment) and is owned by pre_task_seed.
 * @see src/shared/memory-writer-ownership.ts
 */
export const PRE_TASK_SEED_WRITER_IDENTITY: WriterIdentity = "pre_task_seed"

// ---------------------------------------------------------------------------

export interface DecisionCandidate {
  /** Candidate title (short). */
  title: string
  /** The decision text. */
  decision: string
  /** Rationale from the prompt. */
  rationale: string
  /** Impact area (e.g., architecture, stack, deployment). */
  impactArea: string
  /** Source prompt excerpt. */
  sourceExcerpt: string
}

export interface PreTaskMemorySeed {
  /** The user's stated project goal / primary intent. */
  projectGoal: string
  /** Detected project type (website, app, plugin, api, system, tool, etc.). */
  projectType: string
  /** Explicit technology decisions extracted from the prompt. */
  explicitStackDecisions: string[]
  /** Explicit constraints (must/should/required/must-not). */
  explicitConstraints: string[]
  /** Initial tasks / steps from the prompt. */
  initialTasks: string[]
  /** Planned file/directory structure (when explicit or safely implied). */
  plannedStructure: string[]
  /** Explicit risks mentioned in the prompt. */
  explicitRisks: string[]
  /** Explicit research requirements. */
  explicitResearchRequirements: string[]
  /**
   * Decision candidates extracted from the prompt for later processing
   * by the Decision Writer. Pre-task seed does NOT write these to
   * decisions.jsonl or decisions.md directly.
   */
  decisionCandidates: DecisionCandidate[]
}

export interface SeedResult {
  /** Files that were updated. */
  written: string[]
  /** Files that were skipped (no data to write). */
  skipped: string[]
  /** Error messages from failed writes. */
  errors: string[]
  /** Whether manifest was refreshed. */
  manifestRefreshed: boolean
  /**
   * Decision candidates that were extracted but NOT written.
   * Callers should route these to the Decision Writer.
   */
  decisionCandidates: DecisionCandidate[]
}

// ---------------------------------------------------------------------------

/** Keywords that strongly indicate a project prompt. */
const PROJECT_ACTION_WORDS = new Set([
  "create", "build", "implement", "write", "develop", "generate",
  "setup", "scaffold", "design", "architect", "deploy", "configure",
  "migrate", "refactor", "port", "rewrite", "construct",
])

/** Keywords that indicate a project target. */
const PROJECT_TARGET_WORDS = new Set([
  "project", "website", "app", "application", "plugin", "extension",
  "system", "tool", "cli", "api", "backend", "frontend", "full-stack",
  "fullstack", "service", "microservice", "server", "dashboard",
  "admin panel", "library", "package", "module", "component",
  "database", "schema", "pipeline", "workflow", "bot", "agent",
  "scraper", "crawler", "e-commerce", "saas",
])

/** Words that indicate casual chat. Do NOT seed. */
const CASUAL_CHAT_WORDS = new Set([
  "hi", "hello", "hey", "thanks", "thank you", "ok", "okay",
  "good", "great", "nice", "cool", "awesome",
])

/** Turkish casual words. Do NOT seed. */
const TR_CASUAL_WORDS = new Set([
  "tamam", "devam", "hadi", "eyvallah", "sağol", "selam",
  "merhaba", "görüşürüz", "kolay gelsin",
])

/** Known technology stack keywords for extraction. */
const TECH_STACK_KEYWORDS = [
  "React", "Next.js", "NextJS", "Vue", "Angular", "Svelte", "Solid",
  "Node.js", "NodeJS", "Express", "Fastify", "NestJS", "Koa", "Hono",
  "TypeScript", "JavaScript", "Python", "Go", "Rust", "Java", "Kotlin",
  "Swift", "Dart", "Flutter", "React Native", "Expo",
  "Prisma", "Drizzle", "TypeORM", "Sequelize", "Knex",
  "PostgreSQL", "Postgres", "MySQL", "SQLite", "MongoDB", "Redis",
  "Docker", "Kubernetes", "AWS", "GCP", "Azure", "Vercel", "Netlify",
  "GraphQL", "REST", "tRPC", "gRPC", "WebSocket", "Socket.IO",
  "Tailwind", "shadcn/ui", "MUI", "Chakra", "Bootstrap",
  "Jest", "Vitest", "Playwright", "Cypress",
  "Bun", "Deno", "pnpm", "yarn", "npm",
  "Zod", "Joi", "Yup",
  "JWT", "OAuth", "Passport", "NextAuth", "Auth.js",
  "Stripe", "Twilio", "SendGrid", "Resend",
  "OpenAI", "Anthropic", "Claude", "GPT",
]

const TECH_STACK_PATTERN = new RegExp(
  TECH_STACK_KEYWORDS.map((kw) => kw.replace(/[.*+?^${}()|[\]\\/.]/g, "\\$&")).join("|"),
  "gi",
)

const CONSTRAINT_PATTERNS = [
  /\b(must|must not|should|should not|required|mandatory|shall)\b[^.!?\n]{10,}/gi,
  /\b(do not|don't|never|avoid|prevent)\b[^.!?\n]{10,}/gi,
  /\b(only\s+(allow|use|support)|limited to)\b[^.!?\n]{10,}/gi,
]

const RISK_PATTERNS = [
  /\brisk[^.!?\n]{5,}/gi,
  /\b(careful|dangerous|destructive|critical|sensitive)\b[^.!?\n]{5,}/gi,
  /\b(security|vulnerability|exploit|breach)\b[^.!?\n]{5,}/gi,
]

const RESEARCH_PATTERNS = [
  /\b(research|find out|investigate|look up|check|explore|discover)\b[^.!?\n]{5,}/gi,
  /\b(how (does|to|can|do|is)|what (is|are|does)|why (is|does))\b[^.!?\n]{5,}/gi,
]

/** Minimum meaningful characters for a prompt to be considered substantial. */
const MIN_PROMPT_LENGTH = 30

/**
 * Determine whether a user prompt should trigger pre-task memory seeding.
 *
 * Seeds only substantial project prompts. Does NOT seed:
 * - Casual chat (hi, hello, thanks)
 * - Short corrections (fix typo, change color)
 * - Turkish casual (tamam, devam, hadi)
 * - Simple explanation requests
 * - Non-project conversation
 */
export function shouldSeedProjectMemory(prompt: string): boolean {
  const normalized = prompt.trim().toLowerCase()

  // Too short to be meaningful
  if (prompt.trim().length < MIN_PROMPT_LENGTH) return false

  // Casual chat detection
  const firstWord = normalized.split(/\s+/)[0] ?? ""
  if (CASUAL_CHAT_WORDS.has(firstWord)) return false
  if (TR_CASUAL_WORDS.has(firstWord)) return false

  // Single-line single-sentence without project signals
  const lines = normalized.split(/\n/).filter((l) => l.trim().length > 0)
    if (lines.length <= 1 && !/[.?!]/.test(normalized)) {
    const hasAction = PROJECT_ACTION_WORDS.has(lines[0]?.split(/\s+/)[0] ?? "")
    const hasTarget = PROJECT_TARGET_WORDS.has(
      [...PROJECT_TARGET_WORDS].find((t) => normalized.includes(t)) ?? "",
    )
    if (!hasAction && !hasTarget) return false
  }

  // Strong signals: action word + project target
  let signalScore = 0
  for (const action of PROJECT_ACTION_WORDS) {
    if (normalized.includes(action)) signalScore += 2
  }
  for (const target of PROJECT_TARGET_WORDS) {
    if (normalized.includes(target)) signalScore += 2
  }
  // Technology mentions are also strong signals
  const techMatches = normalized.match(TECH_STACK_PATTERN)
  if (techMatches) signalScore += techMatches.length * 2

  // Multi-line or multi-sentence prompts with content
  if (normalized.length > 150) signalScore += 1

  // Must meet minimum signal threshold
  return signalScore >= 4
}

// ---------------------------------------------------------------------------

function extractFirstGoal(prompt: string): string {
  const trimmed = prompt.trim()
  // Try to find the first meaningful sentence (not a greeting)
  const sentences = trimmed.split(/[.!?\n]/).map((s) => s.trim()).filter((s) => s.length > 5)
  for (const sentence of sentences) {
    const lower = sentence.toLowerCase()
    if (CASUAL_CHAT_WORDS.has(lower.split(/\s+/)[0] ?? "")) continue
    if (TR_CASUAL_WORDS.has(lower.split(/\s+/)[0] ?? "")) continue
    return sentence.length > 200 ? sentence.slice(0, 197) + "..." : sentence
  }
  return trimmed.length > 200 ? trimmed.slice(0, 197) + "..." : trimmed
}

function extractProjectType(prompt: string): string {
  const normalized = prompt.toLowerCase()
  let bestMatch = "unknown"
  let bestLength = 0
  for (const target of PROJECT_TARGET_WORDS) {
    if (normalized.includes(target) && target.length > bestLength) {
      bestMatch = target
      bestLength = target.length
    }
  }
  return bestMatch
}

function extractTechStack(prompt: string): string[] {
  const seen = new Set<string>()
  const matches = prompt.match(TECH_STACK_PATTERN)
  if (!matches) return []
  const result: string[] = []
  for (const m of matches) {
    const lower = m.toLowerCase()
    if (seen.has(lower)) continue
    seen.add(lower)
    // Preserve original casing for display
    result.push(m)
  }
  return result
}

function extractConstraints(prompt: string): string[] {
  const constraints: string[] = []
  for (const pattern of CONSTRAINT_PATTERNS) {
    const matches = prompt.match(pattern)
    if (matches) {
      for (const m of matches) {
        const cleaned = m.trim().replace(/^[-*\s]+/, "")
        if (cleaned.length > 10 && cleaned.length < 200) {
          constraints.push(cleaned)
        }
      }
    }
  }
  return [...new Set(constraints)].slice(0, 10)
}

function extractInitialTasks(prompt: string): string[] {
  const tasks: string[] = []

  // Look for numbered lists: 1. or 1) or 1-
  const numberedMatches = prompt.match(/(?:^|\n)\s*\d+[.)-]\s*([^\n]+)/gm)
  if (numberedMatches) {
    for (const m of numberedMatches) {
      const cleaned = m.replace(/^\s*\d+[.)-]\s*/, "").trim()
      if (cleaned.length > 3 && cleaned.length < 200) {
        tasks.push(cleaned)
      }
    }
  }

  // Look for bullet lists: - or *
  if (tasks.length === 0) {
    const bulletMatches = prompt.match(/(?:^|\n)\s*[-*]\s+([^\n]+)/gm)
    if (bulletMatches) {
      for (const m of bulletMatches) {
        const cleaned = m.replace(/^\s*[-*]\s+/, "").trim()
        if (cleaned.length > 3 && cleaned.length < 200) {
          tasks.push(cleaned)
        }
      }
    }
  }

  return tasks.slice(0, 15)
}

function extractPlannedStructure(prompt: string): string[] {
  const structure: string[] = []

  // Look for file paths or directory mentions
  const pathMatches = prompt.match(/[\w./-]+\/[\w./-]+/g)
  if (pathMatches) {
    for (const m of pathMatches) {
      if (m.includes("/") && m.length > 3 && m.length < 120) {
        structure.push(m)
      }
    }
  }

  // Look for explicit directory structure patterns
  const dirMatches = prompt.match(/(?:create|make|add|need|require|have)\s+(?:a\s+)?(?:new\s+)?([\w/-]+(?:\s+(?:directory|folder|dir|file)))/gi)
  if (dirMatches) {
    for (const m of dirMatches) {
      const cleaned = m.trim()
      if (cleaned.length < 120) structure.push(cleaned)
    }
  }

  return [...new Set(structure)].slice(0, 20)
}

function extractRisks(prompt: string): string[] {
  const risks: string[] = []
  for (const pattern of RISK_PATTERNS) {
    const matches = prompt.match(pattern)
    if (matches) {
      for (const m of matches) {
        const cleaned = m.trim().replace(/^[-*\s]+/, "")
        if (cleaned.length > 5 && cleaned.length < 200) {
          risks.push(cleaned)
        }
      }
    }
  }
  return [...new Set(risks)].slice(0, 10)
}

/**
 * Build DecisionCandidate entries from explicitly detected technology decisions.
 * These are NOT written to decisions files — they are returned for the
 * Decision Writer to process later.
 */
function buildDecisionCandidates(
  techDecisions: string[],
  prompt: string,
): DecisionCandidate[] {
  if (techDecisions.length === 0) return []

  return techDecisions.map((tech) => {
    // Find the context around this tech mention for a source excerpt
    const idx = prompt.toLowerCase().indexOf(tech.toLowerCase())
    const excerpt = idx >= 0
      ? prompt.slice(Math.max(0, idx - 20), Math.min(prompt.length, idx + tech.length + 60)).trim()
      : prompt.slice(0, 120).trim()

    return {
      title: `Using ${tech}`,
      decision: `Adopt ${tech} as part of the project technology stack`,
      rationale: `Explicitly mentioned in the project prompt`,
      impactArea: mapTechToImpactArea(tech),
      sourceExcerpt: excerpt.length > 200 ? excerpt.slice(0, 197) + "..." : excerpt,
    }
  })
}

// ---------------------------------------------------------------------------
// Non-tech decision extraction — Phase 3B.1a
//
// Scans prompts for explicit durable non-technology decisions that should
// be surfaced as decisionCandidates. These are policy, constraint, routing,
// scope, ownership, and convention decisions extracted via pattern matching.
//
// Conservative: if a match is ambiguous or the sentence also looks like a
// task instruction, it is skipped. Only explicit declarative/prohibitive
// statements are extracted.
// ---------------------------------------------------------------------------

interface NonTechDecisionPattern {
  /** Pattern to match against the prompt. */
  pattern: RegExp
  /** Title for the decision candidate. */
  title: string
  /** Decision text. */
  decision: string
  /** Impact area. */
  impactArea: string
  /** Rationale for the decision. */
  rationale: string
}

const NON_TECH_DECISION_PATTERNS: NonTechDecisionPattern[] = [
  // ── Routing policy decisions ──────────────────────────────────────────
  {
    pattern: /\bcategory[_\s]?(?:based[_\s]?)?routing\s+(?:is|must be|should be|will be|shall be)\s+(disabled|deprecated|not[_\s]?used|turned off|off)\b/i,
    title: "Category routing is disabled",
    decision: "Category-based routing is disabled. Delegation must use exact runtime-valid agents rather than category fallback.",
    impactArea: "routing",
    rationale: "Explicit routing policy stated in prompt",
  },
  {
    pattern: /\b(?:use|must use|should use|require|only use|restrict to)\s+(?:exact|runtime[_\s]?valid|declared|registered|known)(?:\s+\S+){0,4}\s+(?:agent|agents)\b/i,
    title: "Use exact runtime-valid agents only",
    decision: "Delegation must use exact runtime-valid agents rather than generic category routing.",
    impactArea: "routing",
    rationale: "Explicit delegation policy stated in prompt",
  },
  {
    pattern: /\b(?:do not|must not|should not|never|don't|cannot|may not)\s+(?:fallback|fall back|default|resort)\s+to\s+(?:category|categories)\b/i,
    title: "No category fallback for unknown agents",
    decision: "Unknown or unavailable agents must not silently fallback to category routing.",
    impactArea: "routing",
    rationale: "Explicit fallback prohibition stated in prompt",
  },
  {
    pattern: /\bunknown\s+(?:agent|agents)\s+(?:must not|should not|do not|shall not|cannot|may not)\s+(?:fallback|fall back|be resolved)\b/i,
    title: "Unknown agents must not fallback to category",
    decision: "When an agent is unknown or unavailable, the system must not silently resolve to a category fallback.",
    impactArea: "routing",
    rationale: "Explicit fallback policy stated in prompt",
  },

  // ── Subagent direct write prohibition ─────────────────────────────────
  {
    pattern: /\bsubagent(?:s)?\s+(?:must not|should not|do not|may not|shall not|cannot|are forbidden to|are prohibited from|never)\s+(?:directly\s+)?(?:write|edit|modify|touch|update)\s+(?:memory|memory files|\.opencode\/state\/memory)/i,
    title: "Subagents must not directly edit memory files",
    decision: "Subagents must not directly write to or edit memory files. All memory writes must go through designated writer modules.",
    impactArea: "memory",
    rationale: "Explicit write restriction stated in prompt",
  },

  // ── Memory scoping decisions ──────────────────────────────────────────
  {
    pattern: /\bmemory\s+(?:must be|should be|is|will be|shall be)\s+(?:project[-_\s]?root[-_\s]?(?:-| )?scoped|scoped to (?:the )?project root|per[-_\s]?project)\b/i,
    title: "Memory is project-root scoped",
    decision: "Project memory is scoped to the project root directory, not global or per-session.",
    impactArea: "memory",
    rationale: "Explicit scoping policy stated in prompt",
  },

  // ── Generated files exclusion ─────────────────────────────────────────
  {
    pattern: /\b(?:generated|build|dist|output|compiled|transpiled)[_\s]?(?:files?|directories?|artifacts?|outputs?)\s+(?:must not|should not|do not|shall not|cannot|are not to|must never)\s+(?:be\s+(?:included\s+)?)?(?:enter|appear|be included|go|be written|be tracked)\s+(?:in|into|to)\s+(?:file[_\s]?map|the file map|file-map)/i,
    title: "Generated files excluded from file-map",
    decision: "Generated files and build artifacts must not be included in file-map.md.",
    impactArea: "convention",
    rationale: "Explicit file-map exclusion policy stated in prompt",
  },
  {
    pattern: /\b(?:\.next|dist|build|node_modules|coverage|\.turbo|\.cache|out)\/?\s+(?:must not|should not|do not|shall not|cannot|must never)\s+(?:be\s+(?:included\s+)?)?(?:enter|appear|be included|go|be written|be tracked)\s+(?:in|into|to)\s+(?:file[_\s]?map|the file map|file-map)/i,
    title: "Build artifacts excluded from file-map",
    decision: "Specific build artifact directories must not be included in file-map.md.",
    impactArea: "convention",
    rationale: "Explicit directory exclusion policy stated in prompt",
  },

  // ── Writer ownership decisions ────────────────────────────────────────
  {
    pattern: /\b(?:only|solely|exclusively)\s+(?:the\s+)?([a-z_]+\s+(?:writer|updater))\s+(?:may|can|must|should|is allowed to|is permitted to)\s+(?:write|edit|modify|update|append to)\s+(?:decisions|tasks|quality|risks|manifest|memory|agent-routing|file-map)/i,
    title: "Writer ownership policy",
    decision: "Writer ownership is enforced: only designated writers may modify their respective memory files.",
    impactArea: "memory",
    rationale: "Explicit writer ownership policy stated in prompt",
  },
  {
    pattern: /\b(?:pre[_\s]?task[_\s]?seed)\s+(?:must not|should not|do not|may not|shall not|cannot)\s+(?:directly\s+)?(?:write|edit|modify)\s+(?:decisions?\.(?:jsonl|md)|decision files)\b/i,
    title: "Pre-task seed must not write decision files",
    decision: "Pre-task seed must not write decisions.jsonl or decisions.md directly. Decision candidates are emitted for Decision Writer processing.",
    impactArea: "memory",
    rationale: "Explicit writer ownership constraint stated in prompt",
  },

  // ── Framework version/configuration approach ──────────────────────────
  {
    pattern: /\buse\s+(?:tailwind|bootstrap|material|chakra|mui|ant)\b.{0,40}\b(v|version\s+)?\d+(?:\.\d+)*\b.{0,40}\b(css[_\s]?first|utility[_\s]?first|component[_\s]?based)\b/i,
    title: "Framework configuration approach specified",
    decision: "Adopt specific framework version and configuration approach as explicitly stated in the prompt.",
    impactArea: "frontend",
    rationale: "Explicit framework configuration approach stated in prompt",
  },
  {
    pattern: /\b(?:do not|must not|should not|never|don't|cannot)\s+(?:use|adopt|employ|rely on|utilize)\s+(?:legacy|old|deprecated)\s+(?:tailwind\.config(?:\.\w+)?|\.eslintrc(?:\.\w+)?|\.prettierrc(?:\.\w+)?|\.babelrc(?:\.\w+)?|\.postcssrc(?:\.\w+)?|jest\.config(?:\.\w+)?|mocha\.opts)\b/i,
    title: "Do not use legacy config files",
    decision: "Explicitly exclude legacy config file formats in favor of modern alternatives.",
    impactArea: "convention",
    rationale: "Explicit config format exclusion stated in prompt",
  },
]

/**
 * Determine whether a prompt sentence looks like a task instruction rather
 * than a policy decision. Task instructions start with action verbs and
 * describe work to be done, not rules/constraints.
 */
function isTaskInstructionLike(sentence: string): boolean {
  const trimmed = sentence.trim().toLowerCase()
  if (trimmed.length < 10) return false

  const taskLeadWords = [
    "create", "build", "add", "remove", "delete", "run", "execute",
    "install", "setup", "configure", "deploy", "test", "implement",
    "write", "edit", "change", "update", "fix", "refactor", "move",
    "copy", "rename", "replace", "generate", "scaffold", "migrate",
    "open", "close", "start", "stop", "restart", "push", "pull",
    "commit", "merge", "rebase", "deploy to", "publish",
  ]

  // Only flag as task instruction if the sentence starts with a task word
  // and does NOT contain negation/prohibition words
  for (const lead of taskLeadWords) {
    if (trimmed.startsWith(lead + " ") || trimmed.startsWith(lead + " the ")) {
      // Check for negation/prohibition that would make it a decision
      if (/\b(?:must not|should not|do not|never|shall not|cannot|may not|is disabled|is deprecated)\b/i.test(trimmed)) {
        return false // Negation overrides — this is a constraint, not a task
      }
      // Check for scope qualifiers that indicate a policy
      if (/\b(?:only|exclusively|solely|always|policy|rule|convention|standard)\b/i.test(trimmed)) {
        return false
      }
      return true
    }
  }

  return false
}

/**
 * Build DecisionCandidate entries from explicit non-technology decisions
 * detected in the prompt via pattern matching.
 *
 * Conservative rules:
 * - Only declarative/prohibitive statements are extracted.
 * - Task instructions (create X, run Y, build Z) are skipped.
 * - Vague/maybe/research phrasing is skipped by consumer filter.
 * - Sentences starting with task verbs are skipped unless they contain
 *   negation/prohibition language.
 */
function buildNonTechDecisionCandidates(prompt: string): DecisionCandidate[] {
  if (!prompt || prompt.trim().length < 30) return []

  const candidates: DecisionCandidate[] = []

  for (const entry of NON_TECH_DECISION_PATTERNS) {
    // Use String.match to avoid infinite-loop risks with global regex + exec
    const match = prompt.match(entry.pattern)
    if (!match || !match[0]) continue

    const matchedText = match[0].trim()

    // Skip if the matched text looks like a task instruction
    if (isTaskInstructionLike(matchedText)) continue

    // Build source excerpt from the match context
    const idx = match.index ?? prompt.toLowerCase().indexOf(matchedText.toLowerCase())
    const excerpt = idx >= 0
      ? prompt.slice(Math.max(0, idx - 20), Math.min(prompt.length, idx + matchedText.length + 60)).trim()
      : matchedText

    candidates.push({
      title: entry.title,
      decision: entry.decision,
      rationale: entry.rationale,
      impactArea: entry.impactArea,
      sourceExcerpt: excerpt.length > 200 ? excerpt.slice(0, 197) + "..." : excerpt,
    })
  }

  return candidates
}

/**
 * Deduplicate decision candidates by normalized title.
 * Later candidates with the same normalized title are dropped.
 */
function dedupeCandidates(candidates: DecisionCandidate[]): DecisionCandidate[] {
  const seen = new Set<string>()
  const result: DecisionCandidate[] = []

  for (const c of candidates) {
    const key = c.title.toLowerCase().trim()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(c)
  }

  return result
}

function mapTechToImpactArea(tech: string): string {
  const lower = tech.toLowerCase()
  if (["react", "next.js", "nextjs", "vue", "angular", "svelte", "solid", "tailwind", "shadcn"].some((t) => lower.includes(t))) return "frontend"
  if (["express", "fastify", "nestjs", "koa", "hono", "node.js", "nodejs", "bun", "deno"].some((t) => lower.includes(t))) return "backend"
  if (["postgresql", "postgres", "mysql", "sqlite", "mongodb", "redis", "prisma", "drizzle"].some((t) => lower.includes(t))) return "database"
  if (["docker", "kubernetes", "aws", "gcp", "azure", "vercel", "netlify", "coolify"].some((t) => lower.includes(t))) return "deployment"
  if (["jwt", "oauth", "passport", "nextauth", "auth.js"].some((t) => lower.includes(t))) return "auth"
  if (["jest", "vitest", "playwright", "cypress"].some((t) => lower.includes(t))) return "testing"
  return "stack"
}

function extractResearchRequirements(prompt: string): string[] {
  const research: string[] = []
  for (const pattern of RESEARCH_PATTERNS) {
    const matches = prompt.match(pattern)
    if (matches) {
      for (const m of matches) {
        const cleaned = m.trim().replace(/^[-*\s]+/, "")
        if (cleaned.length > 10 && cleaned.length < 200) {
          research.push(cleaned)
        }
      }
    }
  }
  return [...new Set(research)].slice(0, 10)
}

/**
 * Deterministically extract a PreTaskMemorySeed from a user prompt.
 * No LLM calls. No invented data. Only what is explicit in the text.
 *
 * Returns null if the prompt does not contain enough to extract.
 */
export function extractPreTaskMemorySeed(
  prompt: string,
  _projectRoot?: string,
): PreTaskMemorySeed | null {
  if (!prompt || prompt.trim().length < MIN_PROMPT_LENGTH) return null
  if (!shouldSeedProjectMemory(prompt)) return null

  const projectGoal = extractFirstGoal(prompt)
  if (!projectGoal || projectGoal.length < 5) return null

  const techDecisions = extractTechStack(prompt)
  const techCandidates = buildDecisionCandidates(techDecisions, prompt)
  const nonTechCandidates = buildNonTechDecisionCandidates(prompt)
  const decisionCandidates = dedupeCandidates([...techCandidates, ...nonTechCandidates])

  return {
    projectGoal,
    projectType: extractProjectType(prompt),
    explicitStackDecisions: techDecisions,
    explicitConstraints: extractConstraints(prompt),
    initialTasks: extractInitialTasks(prompt),
    plannedStructure: extractPlannedStructure(prompt),
    explicitRisks: extractRisks(prompt),
    explicitResearchRequirements: extractResearchRequirements(prompt),
    decisionCandidates,
  }
}

// ---------------------------------------------------------------------------

interface FileUpdateState {
  lines: string[]
  hadScaffold: boolean
}

function readOrInitFile(filePath: string, wantCreate: boolean): FileUpdateState | null {
  if (existsSync(filePath)) {
    const raw = readFileSync(filePath, "utf-8")
    const lines = raw.split("\n")
    const hadScaffold = lines.every((line) => {
      const trimmed = line.trim()
      return (
        trimmed.length === 0 ||
        trimmed.startsWith("#") ||
        trimmed === "- TODO" ||
        trimmed.startsWith("- TODO ") ||
        /Last\s+updated:\s*(TODO|\d{4})/i.test(trimmed) ||
        trimmed.startsWith("- None") ||
        trimmed === "- (none recorded)" ||
        trimmed === "- Memory bootstrap completed" ||
        trimmed === "- Initial setup" ||
        trimmed === "- Populating project context" ||
        trimmed === "- Populate project-specific context" ||
        trimmed === "- Fill in domain-specific details" ||
        trimmed === "- None recorded yet" ||
        trimmed === "- None configured yet" ||
        trimmed === "- No gates executed yet" ||
        trimmed === "- No issues recorded" ||
        trimmed === "- No regression history"
      )
    })
    return { lines, hadScaffold }
  }

  if (!wantCreate) return null

  // Ensure parent directory exists
  const parentDir = filePath.substring(0, filePath.lastIndexOf("/"))
  try { mkdirSync(parentDir, { recursive: true }) } catch { /* best-effort */ }

  return { lines: [], hadScaffold: true }
}

/** Deduplicate bullets: skip lines that have the same content (case-insensitive). */
function dedupeBullets(lines: string[], newBullets: string[]): string[] {
  const existing = new Set(lines.map((l) => l.trim().toLowerCase()).filter(Boolean))
  const result = [...lines]
  for (const bullet of newBullets) {
    const trimmed = bullet.trim()
    if (!trimmed) continue
    if (!existing.has(trimmed.toLowerCase())) {
      result.push(trimmed.startsWith("- ") ? trimmed : `- ${trimmed}`)
      existing.add(trimmed.toLowerCase())
    }
  }
  return result
}

function isScaffoldLine(line: string): boolean {
  const trimmed = line.trim()
  if (trimmed.length === 0) return true
  if (trimmed.startsWith("#")) return false

  const scaffoldPhrases = [
    "- TODO",
    "- None",
    "- None yet",
    "- (none recorded)",
    "- None recorded yet",
    "- None configured yet",
    "- No gates executed yet",
    "- No issues recorded",
    "- No regression history",
    "- Memory bootstrap completed",
    "- Memory system initialized",
    "- None identified yet",
    "- Initial setup of",
    "Populate project-specific context",
    "Populate with domain-specific",
    "Technology stack pending",
    "Fill in domain-specific details",
    "Populating project context",
    "Populate as architectural decisions are made",
    "Using Hecateq memory system for project state tracking",
    ".opencode/state/memory \u2014 project memory files",
    "package.json (or project manifest)",
    "node_modules, .git, dist",
    ".env, secrets/, keys/",
    "- None identified yet",
    "- None configured yet",
  ]

  for (const phrase of scaffoldPhrases) {
    if (trimmed === phrase || trimmed.startsWith(phrase)) return true
    if (trimmed.includes(phrase) && trimmed.length < 80) return true
  }

  return /^Last\s+updated:\s*(TODO|\d{4})/i.test(trimmed)
}

function sectionIsAllScaffold(lines: string[], startIdx: number): boolean {
  for (let i = startIdx; i < lines.length; i++) {
    const trimmed = lines[i]?.trim() ?? ""
    if (trimmed.startsWith("## ") || trimmed.startsWith("# ")) break
    if (!isScaffoldLine(trimmed)) return false
  }
  return true
}

function replaceScaffoldSection(
  lines: string[],
  sectionHeader: string,
  newContent: string[],
): string[] {
  // Find the section start index
  let headerIdx = -1
  for (let i = 0; i < lines.length; i++) {
    if ((lines[i] ?? "").trim() === sectionHeader) {
      headerIdx = i
      break
    }
  }

  if (headerIdx < 0) {
    // Header not found: append section at end
    const result = [...lines]
    if (newContent.length > 0) {
      if (result.length > 0 && (result[result.length - 1] ?? "").trim() !== "") {
        result.push("")
      }
      result.push(sectionHeader)
      result.push("")
      for (const c of newContent) result.push(c)
    }
    return result
  }

  // Find section end (next ## or # heading, or EOF)
  let sectionEnd = lines.length
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const trimmed = (lines[i] ?? "").trim()
    if (trimmed.startsWith("## ") || trimmed.startsWith("# ")) {
      sectionEnd = i
      break
    }
  }

  // Check if section is all scaffold
  if (!sectionIsAllScaffold(lines, headerIdx + 1)) {
    return lines // Preserve user content
  }

  // Replace scaffold section with new content
  const before = lines.slice(0, headerIdx + 1)
  const after = lines.slice(sectionEnd)
  const middle = newContent.length > 0
    ? ["", ...newContent, ""]
    : [""]

  if (after.length > 0 && (after[0] ?? "").trim() === "") {
    return [...before, ...middle, ...after.slice(1)]
  }
  return [...before, ...middle, ...after]
}

function updateLastUpdated(lines: string[]): string[] {
  const now = new Date().toISOString().split("T")[0] ?? ""
  return lines.map((line) => {
    if (/^Last\s+updated:\s*(TODO|\d{4}-\d{2}-\d{2})/i.test(line.trim())) {
      return `Last updated: ${now}`
    }
    return line
  })
}

/**
 * Phase 3A: Guard a pre-task seed write against the ownership contract.
 * Logs and returns false if the writer is not authorized for the given file.
 */
function guardSeedWrite(fileName: string, writerOverride?: WriterIdentity): boolean {
  const effectiveWriter = writerOverride ?? PRE_TASK_SEED_WRITER_IDENTITY
  const check = canWriteMemoryFile(effectiveWriter, fileName)
  if (!check.authorized) {
    log("pre-task-memory-seed: Ownership violation — write skipped", {
      writer: effectiveWriter,
      fileName,
      reason: check.reason,
    })
    return false
  }
  return true
}

function applyActiveContextSeed(projectRoot: string, seed: PreTaskMemorySeed): boolean {
  if (!guardSeedWrite("active-context.md")) return false

  const filePath = join(projectRoot, PROJECT_MEMORY_DIR, "active-context.md")
  const state = readOrInitFile(filePath, true)
  if (!state) return false

  let lines = state.lines.length > 0 ? [...state.lines] : [
    "# Active Context",
    "",
    "Last updated: TODO",
    "",
    "## Current Goal",
    "- TODO",
    "",
    "## Current State",
    "- TODO",
    "",
    "## Constraints",
    "- TODO",
    "",
    "## Known Risks",
    "- TODO",
  ]

  if (seed.projectGoal) {
    const goalContent = [`- ${seed.projectGoal}`]
    if (seed.projectType !== "unknown") {
      goalContent.push(`- Project type: ${seed.projectType}`)
    }
    lines = replaceScaffoldSection(lines, "## Current Goal", goalContent)
  }

  if (seed.explicitConstraints.length > 0) {
    const constraints = seed.explicitConstraints.map((c) => `- ${c}`)
    lines = replaceScaffoldSection(lines, "## Constraints", constraints)
  }

  if (seed.explicitRisks.length > 0) {
    const risks = seed.explicitRisks.map((r) => `- ${r}`)
    lines = replaceScaffoldSection(lines, "## Known Risks", risks)
  }

  lines = updateLastUpdated(lines)

  const content = lines.join("\n") + "\n"
  writeFileAtomically(filePath, content)
  return true
}

// ── Phase 3A: Pre-task seed is restricted to 4 files ────────────────────────
//
// It may only write: active-context.md, open-questions.md, conventions.md,
// environment.md. All other memory files are owned by dedicated writers.
//
// The removed seed functions (applyDecisionsSeed, applyTasksSeed,
// applyProgressSeed, applyFileMapSeed, applyRiskProfileSeed) used to write
// into files owned by: decision_writer, task_completion_writer,
// file_map_writer, and risk_writer respectively.
//
// Explicit decisions from the prompt are now extracted as decisionCandidates
// instead of written directly to decisions.md.

function applyOpenQuestionsSeed(projectRoot: string, seed: PreTaskMemorySeed): boolean {
  if (!guardSeedWrite("open-questions.md")) return false
  if (seed.explicitResearchRequirements.length === 0) return false

  const filePath = join(projectRoot, PROJECT_MEMORY_DIR, "open-questions.md")
  const state = readOrInitFile(filePath, true)
  if (!state) return false

  let lines = state.lines.length > 0 ? [...state.lines] : [
    "# Open Questions",
    "",
    "Last updated: TODO",
    "",
    "## Active Questions",
    "- TODO",
    "",
    "## Waiting For",
    "- TODO",
    "",
    "## Unresolved Tradeoffs",
    "- TODO",
    "",
    "## Resolved Questions",
    "- <!-- When a question is resolved, move it here with a pointer to the decision or task. -->",
  ]

  const questions = seed.explicitResearchRequirements.map((q) => {
    if (q.length < 5) return null
    return `- ${q.charAt(0).toUpperCase() + q.slice(1)}`
  }).filter((q): q is string => q !== null)

  if (questions.length === 0) return false

  lines = replaceScaffoldSection(lines, "## Active Questions", questions)
  lines = updateLastUpdated(lines)

  const content = lines.join("\n") + "\n"
  writeFileAtomically(filePath, content)
  return true
}

function applyConventionsSeed(projectRoot: string, seed: PreTaskMemorySeed): boolean {
  if (!guardSeedWrite("conventions.md")) return false
  // Write conventions when we have technology stack information that implies patterns
  if (seed.explicitStackDecisions.length === 0) return false

  const filePath = join(projectRoot, PROJECT_MEMORY_DIR, "conventions.md")
  const state = readOrInitFile(filePath, true)
  if (!state) return false

  let lines = state.lines.length > 0 ? [...state.lines] : [
    "# Conventions",
    "",
    "Last updated: TODO",
    "",
    "## Coding Style",
    "- TODO",
    "",
    "## Naming Conventions",
    "- TODO",
    "",
    "## Folder Structure",
    "- TODO",
    "",
    "## Framework Patterns",
    "- TODO",
    "",
    "## Generated Files",
    "- TODO",
    "",
    "## Test Conventions",
    "- TODO",
  ]

  const frameworkConventions = buildFrameworkConventions(seed.explicitStackDecisions)
  if (frameworkConventions.length > 0) {
    lines = replaceScaffoldSection(lines, "## Framework Patterns", frameworkConventions)
  }

  lines = updateLastUpdated(lines)

  const content = lines.join("\n") + "\n"
  writeFileAtomically(filePath, content)
  return true
}

function buildFrameworkConventions(stack: string[]): string[] {
  const conventions: string[] = []
  const lower = stack.map((s) => s.toLowerCase())

  if (lower.some((s) => s.includes("typescript"))) {
    conventions.push("- Use strict TypeScript mode")
  }
  if (lower.some((s) => s.includes("react") || s.includes("next"))) {
    conventions.push("- React functional components with hooks")
  }
  if (lower.some((s) => s.includes("express") || s.includes("fastify") || s.includes("nestjs"))) {
    conventions.push("- REST API with controller/service/repository layers")
  }
  if (lower.some((s) => s.includes("prisma"))) {
    conventions.push("- Prisma as ORM with migration-based schema management")
  }

  return conventions.slice(0, 5)
}

function applyEnvironmentSeed(projectRoot: string, _seed: PreTaskMemorySeed): boolean {
  if (!guardSeedWrite("environment.md")) return false

  const filePath = join(projectRoot, PROJECT_MEMORY_DIR, "environment.md")
  const state = readOrInitFile(filePath, true)
  if (!state) return false

  let lines = state.lines.length > 0 ? [...state.lines] : [
    "# Environment",
    "",
    "Last updated: TODO",
    "",
    "## Runtime",
    "- Package manager: TODO",
    "- Runtime version: TODO",
    "",
    "## Commands",
    "- Dev: TODO",
    "- Build: TODO",
    "- Test: TODO",
    "- Lint: TODO",
    "- Typecheck: TODO",
    "",
    "## Ports",
    "- TODO",
    "",
    "## Environment Variables (names only — no values)",
    "- TODO",
    "",
    "## Services",
    "- TODO",
    "",
    "## Deployment",
    "- TODO",
    "",
    "## Secrets Policy",
    "- Secret values are NEVER written to this file.",
    "- Use env var names only.",
  ]

  // If the file is brand new or all scaffold, leave as is (scaffold is fine).
  // Only update if there's actual environment info to seed.
  // For now, environment seed only updates the Last updated date.
  lines = updateLastUpdated(lines)

  const content = lines.join("\n") + "\n"
  writeFileAtomically(filePath, content)
  return true
}

/**
 * Apply extracted PreTaskMemorySeed to project memory files.
 *
 * Phase 3A restriction: writes ONLY to:
 *   - active-context.md (current goal/state/constraints)
 *   - open-questions.md (research requirements as questions)
 *   - conventions.md (framework patterns from stack decisions)
 *   - environment.md (scaffold/environment metadata)
 *
 * Does NOT write decisions, tasks, progress, file-map, or risk-profile.
 * Decision candidates are returned for later processing by the Decision Writer.
 *
 * Writes only to memory files under `.opencode/state/memory/` within the
 * given project root. Never overwrites user-authored content.
 * Scaffold sections are replaced; user content is preserved.
 * Bullets are deduplicated. Updates the memory manifest after writes.
 *
 * All failures are caught, logged, and reported. Never thrown.
 */
export function applyPreTaskMemorySeed(
  projectRoot: string,
  seed: PreTaskMemorySeed,
): SeedResult {
  const result: SeedResult = {
    written: [],
    skipped: [],
    errors: [],
    manifestRefreshed: false,
    decisionCandidates: seed?.decisionCandidates ?? [],
  }

  if (!projectRoot || !seed) {
    result.errors.push("Missing projectRoot or seed")
    return result
  }

  const memoryDir = join(projectRoot, PROJECT_MEMORY_DIR)
  try { mkdirSync(memoryDir, { recursive: true }) } catch { /* best-effort */ }

  // Phase 3A: Only write to the 4 allowed files (per writer ownership contract)
  const writers: Array<[string, () => boolean]> = [
    ["active-context.md", () => applyActiveContextSeed(projectRoot, seed)],
    ["open-questions.md", () => applyOpenQuestionsSeed(projectRoot, seed)],
    ["conventions.md", () => applyConventionsSeed(projectRoot, seed)],
    ["environment.md", () => applyEnvironmentSeed(projectRoot, seed)],
  ]

  for (const [fileName, writer] of writers) {
    try {
      const updated = writer()
      if (updated) {
        result.written.push(fileName)
      } else {
        result.skipped.push(fileName)
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      result.errors.push(`${fileName}: ${msg}`)
      log("pre-task-memory-seed: Write failed", { fileName, projectRoot, error: msg })
    }
  }

  // Refresh manifest
  if (result.written.length > 0) {
    try {
      let manifest = readManifest(projectRoot)
      if (manifest) {
        for (const fileName of result.written) {
          manifest = refreshFileEntry(projectRoot, manifest, fileName)
        }
        manifest.manifest_updated_at = new Date().toISOString()
        manifest.manifest_revision = (manifest.manifest_revision ?? 0) + 1
        writeManifest(projectRoot, manifest)
        result.manifestRefreshed = true
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      result.errors.push(`manifest: ${msg}`)
      log("pre-task-memory-seed: Manifest refresh failed", { projectRoot, error: msg })
    }
  }

  return result
}
