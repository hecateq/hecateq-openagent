/**
 * Memory Update Signal Router — Phase 3B.2
 *
 * Routes parsed MEMORY_UPDATE signals to existing designated memory writer
 * modules. Each signal entry is mapped to the correct writer based on its
 * target field.
 *
 * Routing rules:
 * - changed_files → appendChangeImpactEntry / appendChangeImpactEntries
 * - decisions → appendDecisionEntry (never decisions.md rendering)
 * - quality → writeQualityHistory (only actual command/result)
 * - risks → existing risk writer if safe, skip vague items
 * - open_questions → only safe writer if exists, otherwise skip/defer
 * - next_actions → no direct tasks.md; route only if safe task-state writer exists
 *
 * Best-effort: failures are logged/skipped, never thrown.
 * Generated/absolute paths are filtered.
 * Absence of entries preserves existing behavior.
 */

import { join } from "node:path"
import { log } from "./logger"
import type { MemoryUpdateSignal, MemoryUpdateEntry } from "./memory-update-signal"
import { PROJECT_MEMORY_DIR } from "./memory-bootstrap"
import { appendDecisionEntry, type DecisionLogEntry } from "./decision-log"
import { DECISION_WRITER_IDENTITY } from "./decision-log"
import type { DecisionLogEntry as DLE } from "./decision-log"

// Re-import explicitly for type safety
import {
  appendChangeImpactEntries,
  FILE_MAP_WRITER_IDENTITY,
} from "./memory-change-impact"
import {
  writeQualityHistory,
  QUALITY_WRITER_IDENTITY,
  type QualityGateReport,
} from "./memory-quality-writer"
import {
  RISK_WRITER_IDENTITY,
  updateRiskProfile,
} from "./memory-risk-writer"
import {
  OPEN_QUESTIONS_WRITER_IDENTITY,
  writeOpenQuestionFromSignal,
} from "./memory-open-questions-writer"
import {
  appendTaskEntry,
  TASK_STATE_WRITER_IDENTITY,
  type TaskStateEntry,
} from "./task-state-memory"
import {
  canWriteMemoryFile,
  type WriterIdentity,
} from "./memory-writer-ownership"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemoryUpdateRouteContext {
  projectRoot: string
  sessionId: string
  agentName?: string
  taskId?: string
}

export interface ManifestUpdateInfo {
  fileName: string
  updated: boolean
  reason: string | null
}

export interface MemoryUpdateRouteResult {
  attempted: number
  routed: number
  skipped: number
  errors: string[]
  skippedReasons: string[]
  writtenFiles: string[]
  /** Per-file manifest update status. Only set when the writer provides it. */
  manifestUpdates?: ManifestUpdateInfo[]
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

const GENERATED_PATH_PATTERNS = [
  /(^|\/)dist\//,
  /(^|\/)build\//,
  /(^|\/)\.next\//,
  /(^|\/)node_modules\//,
  /(^|\/)coverage\//,
  /(^|\/)\.turbo\//,
  /(^|\/)\.cache\//,
  /(^|\/)out\//,
  /(^|\/)\.git\//,
]

function isGeneratedPath(p: string): boolean {
  for (const pattern of GENERATED_PATH_PATTERNS) {
    if (pattern.test(p)) return true
  }
  return false
}

function isAbsolutePath(p: string): boolean {
  return p.startsWith("/") || /^[A-Za-z]:[/\\]/.test(p)
}

function filterPaths(paths: string[]): string[] {
  return paths.filter((p) => !isGeneratedPath(p) && !isAbsolutePath(p))
}

// ---------------------------------------------------------------------------
// Entry routers
// ---------------------------------------------------------------------------

function routeChangedFiles(
  entry: MemoryUpdateEntry,
  ctx: MemoryUpdateRouteContext,
): EntryRouterResult {
  const files: string[] = []
  if (entry.data?.files && Array.isArray(entry.data.files)) {
    for (const f of entry.data.files) {
      if (typeof f === "string") files.push(f)
    }
  } else if (entry.data?.path && typeof entry.data.path === "string") {
    files.push(entry.data.path)
  }

  const validFiles = filterPaths(files)
  if (validFiles.length === 0) {
    return {
      written: false,
      file: "file-map.md",
      reason: "no valid (non-generated, relative) file paths",
    }
  }

  const result = appendChangeImpactEntries(
    ctx.projectRoot,
    validFiles,
    "modified",
    ctx.sessionId,
  )

  return {
    written: result.appended > 0,
    file: "file-map.md",
    reason: result.appended > 0
      ? `appended ${result.appended} entries`
      : result.lockBlocked
        ? `lock blocked: ${result.reason || "unknown"}`
        : `${result.skipped} duplicates`,
    manifestUpdated: result.manifestUpdated,
    manifestReason: result.manifestReason,
  }
}

function routeDecisions(
  entry: MemoryUpdateEntry,
  ctx: MemoryUpdateRouteContext,
): { written: boolean; file: string; reason: string } {
  const title =
    typeof entry.data?.title === "string"
      ? entry.data.title
      : entry.description || "Decision from MEMORY_UPDATE"
  const decision =
    typeof entry.data?.decision === "string"
      ? entry.data.decision
      : entry.description || ""
  const rationale =
    typeof entry.data?.rationale === "string"
      ? entry.data.rationale
      : "Submitted via MEMORY_UPDATE signal"
  const impactArea =
    typeof entry.data?.impact_area === "string"
      ? entry.data.impact_area
      : "general"

  // Generate a deterministic ID
  const idBase = `${title}|${impactArea}`.toLowerCase().replace(/[^a-z0-9|]/g, "-").slice(0, 40)
  let hash = 0
  for (let i = 0; i < title.length; i++) {
    hash = (hash << 5) - hash + title.charCodeAt(i)
    hash |= 0
  }
  const id = `dec-mu-${idBase}-${Math.abs(hash).toString(36).slice(0, 6)}`

  const dle: DLE = {
    version: 1,
    id,
    timestamp: new Date().toISOString(),
    action: "record",
    title,
    status: "active",
    decision: decision.slice(0, 1000),
    rationale,
    impact_area: impactArea,
    source_session_id: ctx.sessionId,
  }

  const appended = appendDecisionEntry(
    ctx.projectRoot,
    dle,
    DECISION_WRITER_IDENTITY,
  )

  return {
    written: appended,
    file: "decisions.jsonl",
    reason: appended ? "appended" : "duplicate content",
  }
}

function routeQuality(
  entry: MemoryUpdateEntry,
  ctx: MemoryUpdateRouteContext,
): { written: boolean; file: string; reason: string } {
  // Only route if there's actual command/result data
  const command =
    typeof entry.data?.command === "string" ? entry.data.command : undefined
  const passed =
    typeof entry.data?.passed === "boolean" ? entry.data.passed : undefined
  const summary =
    typeof entry.data?.summary === "string" ? entry.data.summary : undefined

  if (!command && passed === undefined && !summary) {
    return {
      written: false,
      file: "quality-history.md",
      reason: "no actual command/result data (requires command, passed, or summary)",
    }
  }

  const gateName = command || "auto-detected"
  const gatePassed = passed ?? false

  const report: QualityGateReport = {
    results: [
      {
        kind: gateName,
        passed: gatePassed,
        command: gateName,
        exitCode: gatePassed ? 0 : 1,
        stdout: summary || gateName,
        stderr: "",
        message: summary || gateName,
        skipped: false,
      },
    ],
    allPassed: gatePassed,
    passedCount: gatePassed ? 1 : 0,
    failedCount: gatePassed ? 0 : 1,
    skippedCount: 0,
  }

  writeQualityHistory(ctx.projectRoot, report, {
    writer: QUALITY_WRITER_IDENTITY,
  })

  return {
    written: true,
    file: "quality-history.md",
    reason: `wrote ${gatePassed ? "PASS" : "FAIL"} for ${gateName}`,
  }
}

function routeRisks(
  entry: MemoryUpdateEntry,
  ctx: MemoryUpdateRouteContext,
): EntryRouterResult {
  // Vague risk entries are skipped — require description with sufficient length
  const description =
    typeof entry.data?.description === "string"
      ? entry.data.description
      : entry.description || ""

  // Extract file paths from entry.data.filePaths or entry.data.files
  const rawPaths: string[] = []
  if (entry.data?.filePaths && Array.isArray(entry.data.filePaths)) {
    for (const fp of entry.data.filePaths) {
      if (typeof fp === "string") rawPaths.push(fp)
    }
  } else if (entry.data?.files && Array.isArray(entry.data.files)) {
    for (const fp of entry.data.files) {
      if (typeof fp === "string") rawPaths.push(fp)
    }
  }

  // Extract severity from entry.data.severity or entry.data.priority
  let severity = "medium"
  const rawSeverity =
    typeof entry.data?.severity === "string"
      ? entry.data.severity
      : typeof entry.data?.priority === "string"
        ? entry.data.priority
        : undefined
  if (rawSeverity && ["low", "medium", "high", "critical"].includes(rawSeverity)) {
    severity = rawSeverity
  }

  // Invalid/empty risk entry — skip safely
  if (!description || description.length < 10) {
    return {
      written: false,
      file: "risk-profile.md",
      reason: "risk description too vague (min 10 chars required)",
    }
  }

  // Normalize paths: filter out absolute and generated paths
  const normalizedPaths = rawPaths.filter(
    (p) => !p.startsWith("/") && !p.startsWith("dist/") && !p.startsWith("node_modules/"),
  )

  // Require at least one evidence-backed file path.
  // Text-only risks without file paths are no-ops: updateRiskProfile
  // only writes entries when it can match paths against risk detection rules.
  // Reporting 'written: true' for a no-op violates the acceptance contract.
  if (normalizedPaths.length === 0) {
    return {
      written: false,
      file: "risk-profile.md",
      reason: "risk entry has no evidence-backed file paths: text-only risks are ignored because risk requires file path evidence",
    }
  }

  // Route to risk writer with real file paths and extracted severity
  try {
    // Check ownership
    const ownership = canWriteMemoryFile(RISK_WRITER_IDENTITY, "risk-profile.md")
    if (!ownership.authorized) {
      return {
        written: false,
        file: "risk-profile.md",
        reason: `risk_writer not authorized: ${ownership.reason || "unknown"}`,
      }
    }

    updateRiskProfile(ctx.projectRoot, normalizedPaths, severity)

    return {
      written: true,
      file: "risk-profile.md",
      reason: `risk recorded: ${description.slice(0, 80)} (paths: ${normalizedPaths.length}, severity: ${severity})`,
    }
  } catch (err) {
    return {
      written: false,
      file: "risk-profile.md",
      reason: `write failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

function routeOpenQuestions(
  entry: MemoryUpdateEntry,
  ctx: MemoryUpdateRouteContext,
): EntryRouterResult {
  const result = writeOpenQuestionFromSignal(
    ctx.projectRoot,
    entry.data,
    OPEN_QUESTIONS_WRITER_IDENTITY,
  )

  return {
    written: result.written,
    file: result.file,
    reason: result.reason,
    manifestUpdated: result.manifestUpdated,
    manifestReason: result.manifestReason,
  }
}

function routeNextActions(
  entry: MemoryUpdateEntry,
  ctx: MemoryUpdateRouteContext,
): { written: boolean; file: string; reason: string } {
  const action =
    typeof entry.data?.action === "string"
      ? entry.data.action
      : entry.description || ""

  if (!action || action.length < 5) {
    return {
      written: false,
      file: "tasks.jsonl",
      reason: "action text too short or missing",
    }
  }

  // Build a minimal task state entry from the action data
  const id = `na-${ctx.sessionId}-${action.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30)}`
  const newEntry: TaskStateEntry = {
    version: 1,
    id,
    timestamp: new Date().toISOString(),
    action: "create",
    title: action,
    status: "planned",
    priority: (typeof entry.data?.priority === "string" &&
      ["critical", "high", "medium", "low"].includes(entry.data.priority))
      ? entry.data.priority as "critical" | "high" | "medium" | "low"
      : "medium",
    notes: typeof entry.data?.context === "string"
      ? entry.data.context
      : undefined,
    source_session_id: ctx.sessionId,
  }

  try {
    const appended = appendTaskEntry(ctx.projectRoot, newEntry, TASK_STATE_WRITER_IDENTITY)
    return {
      written: appended,
      file: "tasks.jsonl",
      reason: appended ? "appended to tasks.jsonl" : "duplicate or skipped",
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      written: false,
      file: "tasks.jsonl",
      reason: `write failed: ${msg}`,
    }
  }
}

// ---------------------------------------------------------------------------
// Router dispatch table
// ---------------------------------------------------------------------------

interface EntryRouterResult {
  written: boolean
  file: string
  reason: string
  manifestUpdated?: boolean
  manifestReason?: string | null
}

type EntryRouter = (
  entry: MemoryUpdateEntry,
  ctx: MemoryUpdateRouteContext,
) => EntryRouterResult

const ROUTERS: Record<string, EntryRouter> = {
  changed_files: routeChangedFiles,
  decisions: routeDecisions,
  quality: routeQuality,
  risks: routeRisks,
  open_questions: routeOpenQuestions,
  next_actions: routeNextActions,
}

// ---------------------------------------------------------------------------
// Main router
// ---------------------------------------------------------------------------

export function routeMemoryUpdateSignals(
  signals: MemoryUpdateSignal[],
  ctx: MemoryUpdateRouteContext,
): MemoryUpdateRouteResult {
  const result: MemoryUpdateRouteResult = {
    attempted: 0,
    routed: 0,
    skipped: 0,
    errors: [],
    skippedReasons: [],
    writtenFiles: [],
    manifestUpdates: [],
  }

  if (!signals || signals.length === 0) return result
  if (!ctx.projectRoot) {
    result.errors.push("Missing projectRoot in route context")
    return result
  }

  for (const signal of signals) {
    for (const entry of signal.entries) {
      result.attempted++

      const router = ROUTERS[entry.target]
      if (!router) {
        result.skipped++
        result.skippedReasons.push(
          `No router for target "${entry.target}"`,
        )
        continue
      }

      try {
        const outcome = router(entry, ctx)
        if (outcome.written) {
          result.routed++
          if (!result.writtenFiles.includes(outcome.file)) {
            result.writtenFiles.push(outcome.file)
          }
        } else {
          result.skipped++
          result.skippedReasons.push(
            `${entry.target}: ${outcome.reason}`,
          )
        }

        // Collect manifest update info if provided
        if (outcome.manifestUpdated !== undefined) {
          if (!result.manifestUpdates) result.manifestUpdates = []
          result.manifestUpdates.push({
            fileName: outcome.file,
            updated: outcome.manifestUpdated,
            reason: outcome.manifestReason ?? null,
          })
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        result.errors.push(`${entry.target}: ${msg}`)
        log("memory-update-router: Route failed for entry", {
          target: entry.target,
          error: msg,
          sessionId: ctx.sessionId,
        })
      }
    }
  }

  return result
}
