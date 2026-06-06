/**
 * Task Completion Memory Commit
 *
 * Best-effort memory writes for normal (non-HANDOFF) task completions.
 * When agents complete work without emitting a structured HANDOFF block,
 * this module writes minimal but useful memory entries using existing
 * writers (task-state-memory, decision-log, memory-quality-writer,
 * memory-risk-writer, memory-change-impact).
 *
 * HANDOFF-based completions already write richer entries through
 * runtime-handoff-service.ts. This module fills the gap for normal
 * completions and never duplicates handoff-written entries.
 *
 * All writes are best-effort: failures are caught, logged, and reported
 * but never thrown. Task completion must never be blocked by memory
 * write failures.
 */

import { existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"

import { appendDecisionEntry, type DecisionLogEntry } from "./decision-log"
import { log } from "./logger"
import {
  appendChangeImpactEntries,
} from "./memory-change-impact"
import { PROJECT_MEMORY_DIR } from "./memory-bootstrap"
import {
  writeQualityHistory,
  type QualityGateReport,
} from "./memory-quality-writer"
import { updateRiskProfile } from "./memory-risk-writer"
import { parseMemoryUpdateSignals } from "./memory-update-signal"
import {
  routeMemoryUpdateSignals,
  type MemoryUpdateRouteResult,
} from "./memory-update-router"
import { detectSubagentMemoryWrite } from "./memory-subagent-guard"
import { scheduleMemoryCurator } from "./memory-curator-scheduler"
import {
  appendTaskEntry,
  type TaskStateEntry,
} from "./task-state-memory"
import {
  appendProgressMilestone,
} from "./memory-progress-writer"

/**
 * Writer identity for the task completion memory commit module.
 * This module orchestrates multiple writers (task_completion_writer,
 * decision_writer, quality_writer, risk_writer, file_map_writer)
 * for non-handoff task completions.
 * @see src/shared/memory-writer-ownership.ts
 */
export const TASK_COMPLETION_WRITER_IDENTITY = "task_completion_writer" as const

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TaskCompletionMemoryArgs {
  /** Last assistant text content (may be empty). */
  textContent: string
  /** Project root directory for memory file paths. */
  directory: string
  /** Child/task session ID. */
  sessionId: string
  /** Optional task description; used as entry title. */
  taskDescription?: string
  /**
   * Completion status: "completed" (default), "error", "cancelled",
   * "interrupt", or any other string. Mapped to TaskStateEntry
   * action/status.
   */
  taskStatus?: string
  /** Agent name that executed the task. */
  agentName?: string
  /** Parent session ID if available. */
  parentSessionId?: string
  /** Error message on failure. Used as blocker. */
  errorMessage?: string
}

export interface TaskCompletionMemoryResult {
  /** Whether any memory write was attempted. */
  attempted: boolean
  /** Names of files actually written (e.g. "tasks.jsonl"). */
  written: string[]
  /** Names of files skipped (deduped or no data to write). */
  skipped: string[]
  /** Error messages from failed writes (empty = all OK). */
  errors: string[]
  /** MEMORY_UPDATE signal routing result (Phase 3B.2). */
  memoryUpdateRouting?: MemoryUpdateRouteResult
  /** Subagent direct write detection result (Phase 3B.2). */
  subagentWriteDetected?: boolean
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function deterministicCompletionTaskId(sessionId: string): string {
  return `task-${sessionId}`
}

function deterministicCompletionDecisionId(sessionId: string): string {
  return `decision-${sessionId}`
}

function ensureMemoryDir(directory: string): boolean {
  const memoryDir = join(directory, PROJECT_MEMORY_DIR)
  if (!existsSync(memoryDir)) {
    try {
      mkdirSync(memoryDir, { recursive: true })
    } catch {
      return false
    }
  }
  return true
}

function mapStatus(taskStatus?: string): {
  action: TaskStateEntry["action"]
  status: TaskStateEntry["status"]
} {
  if (!taskStatus) {
    return { action: "complete", status: "completed" }
  }

  switch (taskStatus) {
    case "error":
      return { action: "block", status: "blocked" }
    case "cancelled":
      return { action: "cancel", status: "cancelled" }
    case "interrupt":
      return { action: "update", status: "in_progress" }
    default:
      return { action: "complete", status: "completed" }
  }
}

// ─── Conservative Text Extraction ───────────────────────────────────────────

/**
 * Extract file paths from text that are clearly identifiable.
 * Matches:
 * - backtick-wrapped paths ending in common extensions: `src/foo.ts`
 * - bullet/list items with common extensions: - src/foo.ts
 * - Changed files sections: "Changed files: src/a.ts, src/b.ts"
 *
 * Does NOT treat random words as paths. Requires at least one path
 * separator (/) and a known file extension.
 */
const KNOWN_EXTENSIONS =
  /\.(ts|tsx|js|jsx|json|jsonc|md|yaml|yml|css|html|sql|prisma|toml|env|sh|bash|zsh|py|rs|go|java|kt|swift|dart|c|cpp|h|hpp|rb|php|xml|svg|png|jpg|jpeg|gif|webp|ico|lock|gitignore|dockerfile|tf|yml|yaml)$/i

const FILE_PATH_RE = /`([^`\n]*\.[a-zA-Z0-9]{1,10})`/g

const BULLET_PATH_RE = /^[-*]\s+`?((?:\/?[\w./-]+\.\w{1,10}))`?/gm

const CHANGED_FILES_SECTION_RE =
  /(?:changed files?|files changed|modified files?)[:\s]*([\s\S]*?)(?:\n\n|\n(?:[A-Z]|## |$)|$)/i

const BARE_RISKY_FILES = /^(\.env(?:\.\w+)?|\.gitignore|\.npmrc|\.yarnrc|\.gitconfig|\.git-credentials|\.eslintrc|\.prettierrc|Dockerfile|docker-compose\.yml)$/i

function isLikelyFilePath(candidate: string): boolean {
  const trimmed = candidate.trim()
  if (trimmed.length < 2) return false
  if (trimmed.length > 200) return false

  if (trimmed.includes("/")) {
    const lower = trimmed.toLowerCase()
    if (KNOWN_EXTENSIONS.test(lower)) return true
    if (/\/\.(env|gitignore|npmrc|editorconfig|prettierrc|eslintrc)/.test(trimmed)) return true
    return false
  }

  if (BARE_RISKY_FILES.test(trimmed)) return true

  return false
}

function extractFilePaths(text: string): string[] {
  if (!text) return []
  const seen = new Set<string>()
  const result: string[] = []

  const addIfValid = (candidate: string): void => {
    const cleaned = candidate.replace(/^`|`$/g, "").trim()
    if (isLikelyFilePath(cleaned) && !seen.has(cleaned)) {
      seen.add(cleaned)
      result.push(cleaned)
    }
  }

  // 1. Backtick-wrapped paths
  let match: RegExpExecArray | null
  FILE_PATH_RE.lastIndex = 0
  while ((match = FILE_PATH_RE.exec(text)) !== null) {
    addIfValid(match[1])
  }

  // 2. Bullet/list items
  BULLET_PATH_RE.lastIndex = 0
  while ((match = BULLET_PATH_RE.exec(text)) !== null) {
    addIfValid(match[1])
  }

  // 3. Changed files section
  const sectionMatch = text.match(CHANGED_FILES_SECTION_RE)
  if (sectionMatch?.[1]) {
    const filesText = sectionMatch[1]
    const commaSeparated = filesText.split(/[,\n]/)
    for (const part of commaSeparated) {
      const cleaned = part.replace(/^[-*\s`]+|`+$/g, "").trim()
      if (isLikelyFilePath(cleaned) && !seen.has(cleaned)) {
        seen.add(cleaned)
        result.push(cleaned)
      }
    }
  }

  return result.slice(0, 50) // safety cap
}

/**
 * Detect test-like evidence in text content.
 * Looks for clear patterns: "tests passed", "X pass/passed",
 * "typecheck passed", "build succeeded", etc.
 */
function extractTestEvidence(text: string): {
  hasTestEvidence: boolean
  allPassed: boolean
  summary: string
  pending: string[]
} {
  if (!text) return { hasTestEvidence: false, allPassed: false, summary: "", pending: [] }

  const lower = text.toLowerCase()
  const hasPassPattern =
    /\b(\d+)\s+(?:tests?\s+)?(?:passed|pass)\b/.test(lower) ||
    /\btests?\s+(?:passed|pass)\b/.test(lower) ||
    /\btypecheck\s+(?:passed|pass)\b/.test(lower) ||
    /\b(?:build|compile)\s+(?:succeeded|passed|success)\b/.test(lower) ||
    /\blint\s+(?:passed|pass)\b/.test(lower) ||
    /\ball\s+tests?\s+(?:passed|pass)\b/.test(lower)

  const hasFailPattern =
    /\b(\d+)\s+(?:tests?\s+)?(?:failed|fail)\b/.test(lower) ||
    /\btests?\s+(?:failed|fail)\b/.test(lower) ||
    /\b(?:typecheck|build|compile|lint)\s+(?:failed|fail)\b/.test(lower) ||
    /\b(?:errors?|failures?)\s+found\b/.test(lower)

  if (!hasPassPattern && !hasFailPattern) {
    return { hasTestEvidence: false, allPassed: false, summary: "", pending: [] }
  }

  const passed = hasPassPattern && !hasFailPattern

  // Extract pass/fail counts
  const passMatch = text.match(/(\d+)\s+(?:tests?\s+)?(?:passed|pass)\b/i)
  const failMatch = text.match(/(\d+)\s+(?:tests?\s+)?(?:failed|fail)\b/i)
  const passCount = passMatch ? parseInt(passMatch[1], 10) : (passed ? 1 : 0)
  const failCount = failMatch ? parseInt(failMatch[1], 10) : (passed ? 0 : 1)

  const summary = `${passCount} passed, ${failCount} failed`

  const pending: string[] = []
  if (!passed) {
    pending.push("Fix failing tests")
  }

  return {
    hasTestEvidence: true,
    allPassed: passed,
    summary,
    pending,
  }
}

const EXPLICIT_DECISION_MARKERS = [
  "decision:",
  "decided:",
  "we decided",
  "architecture decision",
  "chosen approach",
  "rejected approach",
]

function textContainsDecisionSignal(text: string): boolean {
  if (!text) return false
  const lower = text.toLowerCase()
  return EXPLICIT_DECISION_MARKERS.some((m) => lower.includes(m))
}

// ─── Memory Writers ─────────────────────────────────────────────────────────

function tryWriteTaskEntry(
  directory: string,
  sessionId: string,
  taskDescription: string | undefined,
  taskStatus: string | undefined,
  agentName: string | undefined,
  parentSessionId: string | undefined,
  errorMessage: string | undefined,
  filePaths: string[],
  testEvidence: ReturnType<typeof extractTestEvidence>,
): boolean {
  try {
    const { action, status } = mapStatus(taskStatus)

    const entry: TaskStateEntry = {
      version: 1,
      id: deterministicCompletionTaskId(sessionId),
      timestamp: new Date().toISOString(),
      action,
      title: taskDescription || `Task ${sessionId.slice(0, 8)}`,
      status,
      owner_agent: agentName,
      source_session_id: sessionId,
      related_sessions: parentSessionId
        ? [parentSessionId, sessionId]
        : [sessionId],
      ...(status === "blocked" && errorMessage
        ? { blockers: [errorMessage] }
        : {}),
      ...(filePaths.length > 0 ? { changed_files: filePaths } : {}),
      ...(testEvidence.hasTestEvidence
        ? { verification: testEvidence.summary }
        : {}),
      metadata: {
        completion_source: "non_handoff",
        session_id: sessionId,
        ...(parentSessionId ? { parent_session_id: parentSessionId } : {}),
        task_status: taskStatus || "completed",
      },
    }

    return appendTaskEntry(directory, entry)
  } catch (error) {
    log("task-completion-memory-commit: Failed to write task entry", {
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

function tryWriteDecisionEntry(
  directory: string,
  sessionId: string,
  textContent: string,
): boolean {
  if (!textContainsDecisionSignal(textContent)) return false

  try {
    const entry: DecisionLogEntry = {
      version: 1,
      id: deterministicCompletionDecisionId(sessionId),
      timestamp: new Date().toISOString(),
      action: "record",
      title: `Decision from session ${sessionId.slice(0, 8)}`,
      status: "active",
      decision: textContent.slice(0, 500),
      rationale: "Auto-extracted from task completion text",
      impact_area: "general",
      source_session_id: sessionId,
      metadata: { extraction_source: "non_handoff" },
    }

    return appendDecisionEntry(directory, entry)
  } catch (error) {
    log("task-completion-memory-commit: Failed to write decision entry", {
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

function tryWriteQualityHistory(
  directory: string,
  testEvidence: ReturnType<typeof extractTestEvidence>,
): boolean {
  if (!testEvidence.hasTestEvidence) return false

  try {
    const report: QualityGateReport = {
      results: [
        {
          kind: "auto-detected",
          passed: testEvidence.allPassed,
          command: "tests (auto-detected from completion text)",
          exitCode: testEvidence.allPassed ? 0 : 1,
          stdout: testEvidence.summary,
          stderr: "",
          message: testEvidence.summary,
          skipped: false,
        },
      ],
      allPassed: testEvidence.allPassed,
      passedCount: testEvidence.allPassed ? 1 : 0,
      failedCount: testEvidence.allPassed ? 0 : 1,
      skippedCount: 0,
    }

    writeQualityHistory(directory, report)
    return true
  } catch (error) {
    log("task-completion-memory-commit: Failed to write quality history", {
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

const RISK_PATH_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /(^|\/)\.env($|\b)/, label: "env file" },
  { pattern: /\/secrets\//, label: "secrets dir" },
  { pattern: /\/keys\//, label: "keys dir" },
  { pattern: /migration/i, label: "migration" },
  { pattern: /\.sql$/i, label: "sql file" },
  { pattern: /package\.json$/, label: "package.json" },
  { pattern: /(^|\/)yarn\.lock$|(^|\/)package-lock\.json$/, label: "lockfile" },
  { pattern: /docker-compose|Dockerfile/i, label: "docker config" },
  { pattern: /\.tf$/i, label: "terraform" },
  { pattern: /k8s|kubernetes/i, label: "kubernetes" },
  { pattern: /database|schema/i, label: "database schema" },
  { pattern: /(^|\/)\.npmrc|(^|\/)\.yarnrc/, label: "package manager config" },
  { pattern: /(^|\/)\.gitconfig|(^|\/)\.git-credentials/, label: "git credentials" },
  { pattern: /(^|\/)tsconfig|(^|\/)\.eslintrc/, label: "project config" },
]

const EXPLICIT_RISK_MARKERS = [
  "risk:",
  "known risk",
  "security risk",
  "migration risk",
  "rollback",
]

function hasRiskSignal(filePaths: string[], textContent: string): boolean {
  if (filePaths.some((fp) => RISK_PATH_PATTERNS.some((r) => r.pattern.test(fp)))) {
    return true
  }
  if (RISK_PATH_PATTERNS.some((r) => r.pattern.test(textContent))) {
    return true
  }
  const lower = textContent.toLowerCase()
  return EXPLICIT_RISK_MARKERS.some((m) => lower.includes(m))
}

function hasOnlyTextRiskSignal(filePaths: string[], textContent: string): boolean {
  if (filePaths.some((fp) => RISK_PATH_PATTERNS.some((r) => r.pattern.test(fp)))) {
    return false
  }
  const lower = textContent.toLowerCase()
  return EXPLICIT_RISK_MARKERS.some((m) => lower.includes(m)) ||
    RISK_PATH_PATTERNS.some((r) => r.pattern.test(textContent))
}

function tryWriteRisks(
  directory: string,
  filePaths: string[],
  textContent: string,
): boolean {
  // Risk requires evidence-backed file paths. Text-only risk markers
  // without matching files are no-ops — updateRiskProfile only writes
  // entries when it can match file paths against risk detection rules.
  if (filePaths.length === 0) {
    // Do NOT call updateRiskProfile([], ...) — that is a no-op that
    // falsely reports as success. Risk requires file path evidence.
    return false
  }

  try {
    updateRiskProfile(directory, filePaths)
    return true
  } catch (error) {
    log("task-completion-memory-commit: Failed to write risk profile", {
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

function tryWriteChangeImpact(
  directory: string,
  sessionId: string,
  filePaths: string[],
): { appended: number; skipped: number } {
  if (filePaths.length === 0) return { appended: 0, skipped: 0 }

  try {
    return appendChangeImpactEntries(directory, filePaths, "modified", sessionId)
  } catch (error) {
    log("task-completion-memory-commit: Failed to write change impact", {
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

// ─── Main API ───────────────────────────────────────────────────────────────

/**
 * Write best-effort memory entries for a completed task.
 *
 * Always writes a TaskStateEntry to tasks.jsonl via appendTaskEntry.
 * Conditionally writes decision log, quality history, risk profile,
 * and change impact entries based on extractable content from
 * the task's final text.
 *
 * Never throws. All failures are caught and returned in the result's
 * `errors` array. Task completion must always proceed regardless of
 * memory write outcomes.
 */
export function commitTaskCompletionToMemory(
  args: TaskCompletionMemoryArgs,
): TaskCompletionMemoryResult {
  const {
    textContent = "",
    directory,
    sessionId,
    taskDescription,
    taskStatus,
    agentName,
    parentSessionId,
    errorMessage,
  } = args

  const result: TaskCompletionMemoryResult = {
    attempted: false,
    written: [],
    skipped: [],
    errors: [],
  }

  // Guard: must have directory and sessionId
  if (!directory || !sessionId) {
    return result
  }

  // Guard: ensure memory directory exists
  if (!ensureMemoryDir(directory)) {
    result.errors.push("Cannot create memory directory")
    return result
  }

  result.attempted = true

  // Extract information from text
  const filePaths = extractFilePaths(textContent)
  const testEvidence = extractTestEvidence(textContent)

  // ── Always write task state entry ──────────────────────────────────────
  try {
    const written = tryWriteTaskEntry(
      directory,
      sessionId,
      taskDescription,
      taskStatus,
      agentName,
      parentSessionId,
      errorMessage,
      filePaths,
      testEvidence,
    )
    if (written) {
      result.written.push("tasks.jsonl")
    } else {
      result.skipped.push("tasks.jsonl (duplicate)")
    }
  } catch (error) {
    result.errors.push(
      `tasks.jsonl: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  // ── Write progress milestone for completed tasks ──────────────────────
  // Only write when there is a clear milestone (completed status + description or file paths)
  try {
    const isCompleted = !taskStatus || taskStatus === "completed" || taskStatus === "error"
    const hasMilestoneContent = taskDescription || filePaths.length > 0 || textContent.length > 10

    if (isCompleted && hasMilestoneContent) {
      const milestone = taskDescription
        ? `Task: ${taskDescription}`
        : filePaths.length > 0
          ? `Modified ${filePaths.length} file(s) in session ${sessionId.slice(0, 8)}`
          : `Completed session ${sessionId.slice(0, 8)}`

      const progressResult = appendProgressMilestone(directory, milestone)
      if (progressResult.written) {
        result.written.push("progress.md")
      }
    } else {
      result.skipped.push("progress.md (no milestone content)")
    }
  } catch (error) {
    result.errors.push(
      `progress.md: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  // ── Conditionally write decision log ───────────────────────────────────
  try {
    if (textContent && textContainsDecisionSignal(textContent)) {
      const written = tryWriteDecisionEntry(directory, sessionId, textContent)
      if (written) {
        result.written.push("decisions.jsonl")
      } else {
        result.skipped.push("decisions.jsonl (duplicate)")
      }
    } else {
      result.skipped.push("decisions.jsonl (no decision signal)")
    }
  } catch (error) {
    result.errors.push(
      `decisions.jsonl: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  // ── Conditionally write quality history ────────────────────────────────
  try {
    if (testEvidence.hasTestEvidence) {
      tryWriteQualityHistory(directory, testEvidence)
      result.written.push("quality-history.md")
    } else {
      result.skipped.push("quality-history.md (no test evidence)")
    }
  } catch (error) {
    result.errors.push(
      `quality-history.md: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  // ── Conditionally write risk profile ───────────────────────────────────
  try {
    if (hasRiskSignal(filePaths, textContent)) {
      tryWriteRisks(directory, filePaths, textContent)
      result.written.push("risk-profile.md")
    } else {
      result.skipped.push("risk-profile.md (no risk signal)")
    }
  } catch (error) {
    result.errors.push(
      `risk-profile.md: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  // ── Conditionally write change impact map ──────────────────────────────
  try {
    if (filePaths.length > 0) {
      const ci = tryWriteChangeImpact(directory, sessionId, filePaths)
      if (ci.appended > 0) {
        result.written.push(`file-map.md (${ci.appended} entries)`)
      } else {
        result.skipped.push(`file-map.md (${ci.skipped} duplicates)`)
      }
    } else {
      result.skipped.push("file-map.md (no file paths)")
    }
  } catch (error) {
    result.errors.push(
      `file-map.md: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  // ── Phase 3B.2: MEMORY_UPDATE signal parsing and routing ────────────────
  try {
    const parseResult = parseMemoryUpdateSignals(textContent)
    if (parseResult.signals.length > 0) {
      const routeContext = {
        projectRoot: directory,
        sessionId,
        agentName,
        taskId: undefined,
      }
      const routeResult = routeMemoryUpdateSignals(
        parseResult.signals,
        routeContext,
      )
      result.memoryUpdateRouting = routeResult

      if (routeResult.routed > 0) {
        for (const f of routeResult.writtenFiles) {
          result.written.push(`MEMORY_UPDATE→${f}`)
        }
      }
    }

    // Phase 3B.2: Subagent direct write detection
    const detection = detectSubagentMemoryWrite(textContent, sessionId)
    if (detection.detected) {
      result.subagentWriteDetected = true
      log("task-completion-memory-commit: Detected potential subagent direct memory write references", {
        sessionId,
        count: detection.count,
      })
    }
  } catch (error) {
    log("task-completion-memory-commit: MEMORY_UPDATE processing failed (non-blocking)", {
      error: error instanceof Error ? error.message : String(error),
    })
    // Best-effort: never fail task completion
  }

  // ── Phase 4D: Schedule memory curator if meaningful activity occurred ────
  // Fire-and-forget: never blocks task completion, never throws.
  // Scheduled only when at least one actual memory file was written or
  // MEMORY_UPDATE signals were routed. Pure manifest-only operations
  // (memory.json) and empty/skipped completions do not trigger.
  try {
    const hasMeaningfulActivity =
      result.written.some(
        (f) =>
          f === "tasks.jsonl" ||
          f === "decisions.jsonl" ||
          f === "quality-history.md" ||
          f === "risk-profile.md" ||
          f.startsWith("file-map.md") ||
          f.startsWith("MEMORY_UPDATE→"),
      ) ||
      (result.memoryUpdateRouting !== undefined &&
        result.memoryUpdateRouting.routed > 0)

    if (hasMeaningfulActivity) {
      void scheduleMemoryCurator(directory)
    }
  } catch {
    // Best-effort: scheduling failure is silently ignored
  }

  return result
}
