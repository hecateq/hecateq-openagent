/**
 * Hecateq Evidence Store — runtime-truth capture, storage, freshness.
 *
 * Evidence is captured from actual runtime/tool metadata (exit codes, test
 * result counts, changed-file paths) rather than from model summaries, and is
 * stored as compact JSON under `.opencode/state/hecateq/evidence/`.
 *
 * Contract (Part B5/B6):
 *  - Atomic writes via `writeFileAtomically` (tmp + rename).
 *  - Every record is appended to the runtime ledger as a minimal
 *    `evidence_recorded` event carrying only references (evidenceId, ids).
 *  - NO full prompts, NO secrets, NO full model output, NO stdout dumps.
 */

import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

import { log } from "../../shared/logger"
import { writeFileAtomically } from "../../shared/write-file-atomically"
import type {
  EvidenceFreshness,
  EvidenceValidationError,
  HecateqCheckEvidence,
  HecateqCommandEvidence,
  HecateqTaskEvidence,
  HecateqTestEvidence,
} from "./evidence-types"
import { appendRuntimeEvent } from "./handoff-history"

// ─── Constants ───────────────────────────────────────────────────────────────

/** Relative path to the evidence directory from the project root. */
export const HECATEQ_EVIDENCE_DIR_REL = join(
  ".opencode",
  "state",
  "hecateq",
  "evidence",
)

// ─── Input types ──────────────────────────────────────────────────────────────

export interface RecordEvidenceInput {
  taskGraphId: string
  taskId: string
  attempt: number
  executionId: string
  agent: string
  filesChanged?: string[]
  commands?: HecateqCommandEvidence[]
  tests?: HecateqTestEvidence[]
  checks?: HecateqCheckEvidence[]
}

export interface EvidenceFreshnessInput {
  evidence: HecateqTaskEvidence
  taskGraphId: string
  taskId: string
  attempt: number
  executionId: string
}

// ─── Test seam ───────────────────────────────────────────────────────────────

let evidenceDirOverride: string | null = null

/**
 * Resolve the evidence directory. Tests may redirect via the override seam;
 * runtime uses `<cwd>/.opencode/state/hecateq/evidence`.
 */
function resolveEvidenceDir(): string {
  if (evidenceDirOverride) return evidenceDirOverride
  return join(process.cwd(), HECATEQ_EVIDENCE_DIR_REL)
}

/**
 * @internal Test-only seam. Pass a directory to redirect evidence storage for
 * hermetic tests; pass `null` to restore the default path.
 */
export function _setEvidenceDirForTesting(dir: string | null): void {
  evidenceDirOverride = dir
}

/** @internal Test-only seam. Restore the default evidence directory. */
export function _resetEvidenceDirForTesting(): void {
  evidenceDirOverride = null
}

// ─── Runtime-truth capture helpers (Part B2) ─────────────────────────────────

/**
 * Extract just changed-file paths from an execution/tool result. Strips every
 * non-path field, deduplicates, and sorts the result deterministically.
 */
export function captureFilesChangedFromResult(result: {
  changedFiles?: Array<{ path?: string; filePath?: string }>
}): string[] {
  const paths = (result.changedFiles ?? [])
    .map((entry) => {
      const rawPath = entry.path ?? entry.filePath
      return typeof rawPath === "string" ? rawPath.trim() : ""
    })
    .filter((entryPath) => entryPath.length > 0)
  return [...new Set(paths)].sort()
}

/**
 * Capture only command metadata (command, exitCode, durationMs) for evidence.
 * Strips any prompt/output fields the caller may have attached at runtime.
 */
export function captureCommandEvidence(cmd: {
  command: string
  exitCode?: number
  durationMs?: number
}): HecateqCommandEvidence {
  return {
    command: cmd.command,
    ...(cmd.exitCode !== undefined ? { exitCode: cmd.exitCode } : {}),
    ...(cmd.durationMs !== undefined ? { durationMs: cmd.durationMs } : {}),
  }
}

/**
 * Capture only test summary fields (name, command, passed, failed, exitCode)
 * for evidence. Strips full stdout/stderr and any other runtime fields.
 */
export function captureTestEvidence(test: {
  name?: string
  command?: string
  passed?: number
  failed?: number
  exitCode?: number
}): HecateqTestEvidence {
  return {
    ...(test.name !== undefined ? { name: test.name } : {}),
    ...(test.command !== undefined ? { command: test.command } : {}),
    ...(test.passed !== undefined ? { passed: test.passed } : {}),
    ...(test.failed !== undefined ? { failed: test.failed } : {}),
    ...(test.exitCode !== undefined ? { exitCode: test.exitCode } : {}),
  }
}

// ─── Storage (Part B5) ────────────────────────────────────────────────────────

/**
 * Record one piece of task-bound evidence. Generates a fresh evidenceId,
 * persists it as JSON (atomic), and appends a minimal `evidence_recorded`
 * ledger event carrying only references. Returns the recorded evidence.
 *
 * Throws if the evidence file cannot be written (the ledger event is only
 * appended after a successful write so the ledger never references a record
 * that does not exist on disk).
 */
export function recordEvidence(input: RecordEvidenceInput): HecateqTaskEvidence {
  const evidence: HecateqTaskEvidence = {
    evidenceId: randomUUID(),
    taskGraphId: input.taskGraphId,
    taskId: input.taskId,
    attempt: input.attempt,
    executionId: input.executionId,
    agent: input.agent,
    createdAt: new Date().toISOString(),
    ...(input.filesChanged && input.filesChanged.length > 0
      ? { filesChanged: [...input.filesChanged].sort() }
      : {}),
    ...(input.commands && input.commands.length > 0
      ? { commands: input.commands }
      : {}),
    ...(input.tests && input.tests.length > 0 ? { tests: input.tests } : {}),
    ...(input.checks && input.checks.length > 0 ? { checks: input.checks } : {}),
  }

  const dir = resolveEvidenceDir()
  mkdirSync(dir, { recursive: true })
  const filePath = join(dir, `${evidence.evidenceId}.json`)
  writeFileAtomically(filePath, `${JSON.stringify(evidence, null, 2)}\n`)

  appendRuntimeEvent({
    event: "evidence_recorded",
    timestamp: evidence.createdAt,
    task_graph_id: evidence.taskGraphId,
    task_id: evidence.taskId,
    attempt: evidence.attempt,
    execution_id: evidence.executionId,
    agent: evidence.agent,
    reason: evidence.evidenceId,
  })

  return evidence
}

/** Read one evidence record by id. Returns `null` when missing or malformed. */
export function readEvidence(evidenceId: string): HecateqTaskEvidence | null {
  const filePath = join(resolveEvidenceDir(), `${evidenceId}.json`)
  if (!existsSync(filePath)) return null

  let raw: string
  try {
    raw = readFileSync(filePath, "utf-8")
  } catch {
    return null
  }

  const parsed = tryParseEvidenceFile(raw)
  if (!parsed) {
    log("hecateq:evidence:skipped-invalid-file", { filePath })
    return null
  }
  return parsed
}

/**
 * List evidence for one task (taskGraphId + taskId), sorted by createdAt
 * (ascending; evidenceId breaks ties deterministically).
 */
export function listEvidence(
  taskGraphId: string,
  taskId: string,
): HecateqTaskEvidence[] {
  const dir = resolveEvidenceDir()
  if (!existsSync(dir)) return []

  const entries: HecateqTaskEvidence[] = []
  for (const fileName of readdirSync(dir)) {
    if (!fileName.endsWith(".json")) continue
    const evidenceId = fileName.slice(0, -".json".length)
    const evidence = readEvidence(evidenceId)
    if (
      evidence &&
      evidence.taskGraphId === taskGraphId &&
      evidence.taskId === taskId
    ) {
      entries.push(evidence)
    }
  }

  return entries.sort(
    (a, b) =>
      a.createdAt.localeCompare(b.createdAt) ||
      a.evidenceId.localeCompare(b.evidenceId),
  )
}

// ─── Freshness validation (Part B4) ──────────────────────────────────────────

/**
 * Validate evidence freshness against the current task attempt:
 *  - taskGraphId / taskId mismatch -> "invalid"
 *  - attempt / executionId mismatch -> "stale"
 *  - exact identity match -> "fresh"
 */
export function validateEvidenceFreshness(
  input: EvidenceFreshnessInput,
): EvidenceFreshness {
  const validation = collectEvidenceValidationErrors(input)
  return validation ? validation.kind : "fresh"
}

/**
 * Throw an `EvidenceValidationFailedError` (structured reasons) when the
 * evidence is not "fresh" for the current task attempt. No-op on "fresh".
 */
export function assertEvidenceMatchesCurrent(
  input: EvidenceFreshnessInput,
): void {
  const validation = collectEvidenceValidationErrors(input)
  if (!validation) return
  throw new EvidenceValidationFailedError(validation)
}

/** Thrown when evidence does not match the current task attempt. */
export class EvidenceValidationFailedError extends Error {
  readonly kind: "stale" | "invalid"
  readonly reasons: string[]

  constructor(validation: EvidenceValidationError) {
    super(`Evidence is ${validation.kind}: ${validation.reasons.join("; ")}`)
    this.name = "EvidenceValidationFailedError"
    this.kind = validation.kind
    this.reasons = [...validation.reasons]
  }
}

// ─── Validation helpers ───────────────────────────────────────────────────────

/**
 * Collect all identity mismatches. "invalid" (task binding) takes precedence
 * over "stale" (attempt/execution) because the evidence does not belong to the
 * task at all in that case. Returns `null` when the identity fully matches.
 */
function collectEvidenceValidationErrors(
  input: EvidenceFreshnessInput,
): EvidenceValidationError | null {
  const reasons: string[] = []
  let invalid = false
  let stale = false

  if (input.evidence.taskGraphId !== input.taskGraphId) {
    invalid = true
    reasons.push(
      `taskGraphId mismatch: expected "${input.taskGraphId}", got "${input.evidence.taskGraphId}"`,
    )
  }
  if (input.evidence.taskId !== input.taskId) {
    invalid = true
    reasons.push(
      `taskId mismatch: expected "${input.taskId}", got "${input.evidence.taskId}"`,
    )
  }
  if (input.evidence.attempt !== input.attempt) {
    stale = true
    reasons.push(
      `attempt mismatch: expected ${input.attempt}, got ${input.evidence.attempt}`,
    )
  }
  if (input.evidence.executionId !== input.executionId) {
    stale = true
    reasons.push(
      `executionId mismatch: expected "${input.executionId}", got "${input.evidence.executionId}"`,
    )
  }

  if (!invalid && !stale) return null
  return { kind: invalid ? "invalid" : "stale", reasons }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

function isCommandEvidence(value: unknown): value is HecateqCommandEvidence {
  if (!isRecord(value)) return false
  if (typeof value.command !== "string") return false
  if (value.exitCode !== undefined && typeof value.exitCode !== "number") return false
  if (value.durationMs !== undefined && typeof value.durationMs !== "number") return false
  return true
}

function isTestEvidence(value: unknown): value is HecateqTestEvidence {
  if (!isRecord(value)) return false
  for (const key of ["name", "command"] as const) {
    if (value[key] !== undefined && typeof value[key] !== "string") return false
  }
  for (const key of ["passed", "failed", "exitCode"] as const) {
    if (value[key] !== undefined && typeof value[key] !== "number") return false
  }
  return true
}

function isCheckEvidence(value: unknown): value is HecateqCheckEvidence {
  if (!isRecord(value)) return false
  if (typeof value.kind !== "string") return false
  if (value.status !== "passed" && value.status !== "failed" && value.status !== "unknown") {
    return false
  }
  if (value.detail !== undefined && typeof value.detail !== "string") return false
  return true
}

/** Parse + validate a raw evidence file. Returns `null` on any mismatch. */
function tryParseEvidenceFile(raw: string): HecateqTaskEvidence | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null

  const evidenceId = parsed.evidenceId
  const taskGraphId = parsed.taskGraphId
  const taskId = parsed.taskId
  const executionId = parsed.executionId
  const agent = parsed.agent
  const createdAt = parsed.createdAt
  const attempt = parsed.attempt
  if (
    typeof evidenceId !== "string" ||
    typeof taskGraphId !== "string" ||
    typeof taskId !== "string" ||
    typeof executionId !== "string" ||
    typeof agent !== "string" ||
    typeof createdAt !== "string" ||
    typeof attempt !== "number"
  ) {
    return null
  }

  const evidence: HecateqTaskEvidence = {
    evidenceId,
    taskGraphId,
    taskId,
    attempt,
    executionId,
    agent,
    createdAt,
  }

  if (parsed.filesChanged !== undefined) {
    if (!isStringArray(parsed.filesChanged)) return null
    evidence.filesChanged = parsed.filesChanged
  }
  if (parsed.commands !== undefined) {
    if (!Array.isArray(parsed.commands) || !parsed.commands.every(isCommandEvidence)) return null
    evidence.commands = parsed.commands
  }
  if (parsed.tests !== undefined) {
    if (!Array.isArray(parsed.tests) || !parsed.tests.every(isTestEvidence)) return null
    evidence.tests = parsed.tests
  }
  if (parsed.checks !== undefined) {
    if (!Array.isArray(parsed.checks) || !parsed.checks.every(isCheckEvidence)) return null
    evidence.checks = parsed.checks
  }

  return evidence
}
