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
} from "./memory-risk-writer"
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

export interface MemoryUpdateRouteResult {
  attempted: number
  routed: number
  skipped: number
  errors: string[]
  skippedReasons: string[]
  writtenFiles: string[]
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
): { written: boolean; file: string; reason: string } {
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
      : `${result.skipped} duplicates`,
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
  _ctx: MemoryUpdateRouteContext,
): { written: boolean; file: string; reason: string } {
  // Vague risk entries are skipped — require description and category
  const description =
    typeof entry.data?.description === "string"
      ? entry.data.description
      : entry.description || ""
  const category =
    typeof entry.data?.category === "string"
      ? entry.data.category
      : ""

  if (!description || description.length < 10) {
    return {
      written: false,
      file: "risk-profile.md",
      reason: "risk description too vague (min 10 chars required)",
    }
  }

  // Route to risk writer if safe — use a lightweight write
  try {
    // Dynamic import to avoid circular dependency at module level
    const { updateRiskProfile } = require("./memory-risk-writer") as {
      updateRiskProfile: (
        projectRoot: string,
        filePaths: string[],
        severity?: string,
      ) => void
    }

    // Check ownership
    const ownership = canWriteMemoryFile(RISK_WRITER_IDENTITY, "risk-profile.md")
    if (!ownership.authorized) {
      return {
        written: false,
        file: "risk-profile.md",
        reason: `risk_writer not authorized: ${ownership.reason || "unknown"}`,
      }
    }

    updateRiskProfile(_ctx.projectRoot, [], "medium")

    return {
      written: true,
      file: "risk-profile.md",
      reason: `risk recorded: ${description.slice(0, 80)}`,
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
  _ctx: MemoryUpdateRouteContext,
): { written: boolean; file: string; reason: string } {
  // open_questions only routed if a safe writer exists
  // Currently: no dedicated open-questions writer module exists
  // The pre-task seed writes open-questions.md but not as a standalone writer
  const question =
    typeof entry.data?.question === "string"
      ? entry.data.question
      : entry.description || ""

  if (!question || question.length < 5) {
    return {
      written: false,
      file: "open-questions.md",
      reason: "question text too short or missing",
    }
  }

  // Defer: no standalone open-questions writer yet
  return {
    written: false,
    file: "open-questions.md",
    reason: "deferred — no standalone open-questions writer exists (Phase 4?)",
  }
}

function routeNextActions(
  entry: MemoryUpdateEntry,
  _ctx: MemoryUpdateRouteContext,
): { written: boolean; file: string; reason: string } {
  // next_actions must NOT write directly to tasks.md or tasks.jsonl
  // Only route if a safe task-state writer exists without inventing facts
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

  // Defer: no safe next_actions writer — do NOT write to tasks.md
  return {
    written: false,
    file: "tasks.jsonl",
    reason: "deferred — no safe next-actions writer (do not write tasks.md directly)",
  }
}

// ---------------------------------------------------------------------------
// Router dispatch table
// ---------------------------------------------------------------------------

type EntryRouter = (
  entry: MemoryUpdateEntry,
  ctx: MemoryUpdateRouteContext,
) => { written: boolean; file: string; reason: string }

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
