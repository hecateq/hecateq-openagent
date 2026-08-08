/**
 * Hecateq Verifier Routing — deterministic verifier resolution (Part C2/C3).
 *
 * The verifier answers "was the implementation actually completed correctly?"
 * and NEVER performs implementation. The primary verifier agent is
 * `qa-test-engineer`; contract/review/architecture checks may surface
 * `agent-contract-manager` as an alternative.
 *
 * Momus is NEVER a verifier. It is filtered silently from preferred agents
 * and alternatives via the shared `momus-exclusion` guard
 * (`HECATEQ_FORBIDDEN_AGENT_SET`, `filterMomus`, `assertNoMomus`).
 *
 * Verification results are persisted as compact JSON under
 * `.opencode/state/hecateq/verifications/` and mirrored to the runtime
 * ledger as `handoff_created` events with `reason = "verification:<status>"`
 * (the Kinds enum stays stable — no new runtime event kinds).
 */

import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

import { log } from "../../shared/logger"
import { writeFileAtomically } from "../../shared/write-file-atomically"
import { appendRuntimeEvent } from "./handoff-history"
import {
  HECATEQ_FORBIDDEN_AGENT_SET,
  assertNoMomus,
  filterMomus,
} from "./momus-exclusion"

// ─── Types (Part C3) ─────────────────────────────────────────────────────────

export type HecateqVerificationStatus =
  | "verified"
  | "rejected"
  | "insufficient_evidence"

/**
 * Typed verification result contract. `resultId` and `createdAt` are
 * additive (generated on record when omitted) so results can be read back
 * by id; the required C3 fields are unchanged.
 */
export interface HecateqVerificationResult {
  /** Unique id for this verification record. Generated when omitted. */
  resultId?: string
  taskGraphId: string
  taskId: string
  attempt: number
  executionId: string
  status: HecateqVerificationStatus
  blockers: string[]
  notes?: string
  /** ISO-8601 timestamp of when the verification was recorded. */
  createdAt?: string
}

export interface HecateqVerifierDecision {
  verifierAgent: string
  reason: string
  alternatives?: string[]
}

export interface HecateqRequiredCheck {
  kind: string
  status: "passed" | "failed" | "unknown"
}

export interface ResolveVerifierAgentInput {
  preferredAgents?: string[]
  requiredChecks?: HecateqRequiredCheck[]
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Relative path to the verifications directory from the project root. */
export const HECATEQ_VERIFICATION_DIR_REL = join(
  ".opencode",
  "state",
  "hecateq",
  "verifications",
)

/** Primary verifier agent (Part C2). */
const DEFAULT_VERIFIER_AGENT = "qa-test-engineer"

/**
 * Check kinds that surface `agent-contract-manager` as an alternative:
 * contract validation, plan/code review, and architecture checks.
 */
const CONTRACT_LIKE_CHECK_KINDS: ReadonlySet<string> = new Set([
  "contract",
  "review",
  "architecture",
])

// ─── Test seam ───────────────────────────────────────────────────────────────

let verificationDirOverride: string | null = null

/**
 * Resolve the verifications directory. Tests may redirect via the override
 * seam; runtime uses `<cwd>/.opencode/state/hecateq/verifications`.
 */
function resolveVerificationDir(): string {
  if (verificationDirOverride) return verificationDirOverride
  return join(process.cwd(), HECATEQ_VERIFICATION_DIR_REL)
}

/**
 * @internal Test-only seam. Pass a directory to redirect verification
 * storage for hermetic tests; pass `null` to restore the default path.
 */
export function _setVerificationDirForTesting(dir: string | null): void {
  verificationDirOverride = dir
}

/** @internal Test-only seam. Restore the default verifications directory. */
export function _resetVerificationDirForTesting(): void {
  verificationDirOverride = null
}

// ─── Verifier resolution (Part C2) ───────────────────────────────────────────

function isForbiddenVerifierAgent(agent: string): boolean {
  return HECATEQ_FORBIDDEN_AGENT_SET.has(agent.toLowerCase().trim())
}

function isContractLikeCheckKind(kind: string): boolean {
  const normalized = kind.toLowerCase().trim()
  return [...CONTRACT_LIKE_CHECK_KINDS].some(
    (contractKind) =>
      normalized === contractKind || normalized.includes(contractKind),
  )
}

/**
 * Resolve the verifier agent deterministically.
 *
 *  - Default: `qa-test-engineer`.
 *  - `preferredAgents` are honored in order, but forbidden agents (momus)
 *    are silently excluded.
 *  - If `requiredChecks` include contract/review/architecture kinds,
 *    `agent-contract-manager` is added as an alternative.
 *  - NEVER returns momus; a defensive fallback to the default guards
 *    against any future regression.
 */
export function resolveVerifierAgent(
  input: ResolveVerifierAgentInput = {},
): HecateqVerifierDecision {
  const preferred = filterMomus(input.preferredAgents ?? [])
  const verifierAgent = preferred[0] ?? DEFAULT_VERIFIER_AGENT

  const hasContractLikeCheck = (input.requiredChecks ?? []).some((check) =>
    isContractLikeCheckKind(check.kind),
  )
  const alternatives = hasContractLikeCheck
    ? ["agent-contract-manager"].filter(
        (agent) => !isForbiddenVerifierAgent(agent),
      )
    : undefined

  // Defensive: the filters above already exclude momus, but fail closed
  // rather than ever surfacing a forbidden verifier.
  const safeVerifier = isForbiddenVerifierAgent(verifierAgent)
    ? DEFAULT_VERIFIER_AGENT
    : verifierAgent

  // Hard exclusion (Part L): the resolved verifier must never be momus.
  assertNoMomus([safeVerifier], "verifier-routing")

  const reason =
    safeVerifier === DEFAULT_VERIFIER_AGENT
      ? "default verifier agent (qa-test-engineer)"
      : `preferred verifier agent: ${safeVerifier}`

  return {
    verifierAgent: safeVerifier,
    reason,
    ...(alternatives && alternatives.length > 0 ? { alternatives } : {}),
  }
}

// ─── Storage (Part C3) ───────────────────────────────────────────────────────

/**
 * Persist one verification result. Generates `resultId` / `createdAt` when
 * omitted, writes the record as JSON (atomic), and appends a
 * `handoff_created` runtime event with `reason = "verification:<status>"`.
 *
 * Throws if the file cannot be written (the ledger event is only appended
 * after a successful write so the ledger never references a record that
 * does not exist on disk).
 */
export function recordVerificationResult(
  result: HecateqVerificationResult,
): void {
  const resultId = result.resultId ?? randomUUID()
  const createdAt = result.createdAt ?? new Date().toISOString()
  const record: HecateqVerificationResult = { ...result, resultId, createdAt }

  const dir = resolveVerificationDir()
  mkdirSync(dir, { recursive: true })
  const filePath = join(dir, `${resultId}.json`)
  writeFileAtomically(filePath, `${JSON.stringify(record, null, 2)}\n`)

  appendRuntimeEvent({
    event: "handoff_created",
    timestamp: createdAt,
    task_graph_id: record.taskGraphId,
    task_id: record.taskId,
    attempt: record.attempt,
    execution_id: record.executionId,
    reason: `verification:${record.status}`,
  })
}

/** Read one verification result by id. Returns `null` when missing/malformed. */
export function readVerificationResult(
  resultId: string,
): HecateqVerificationResult | null {
  const filePath = join(resolveVerificationDir(), `${resultId}.json`)
  if (!existsSync(filePath)) return null

  let raw: string
  try {
    raw = readFileSync(filePath, "utf-8")
  } catch {
    return null
  }

  const parsed = tryParseVerificationFile(raw)
  if (!parsed) {
    log("hecateq:verification:skipped-invalid-file", { filePath })
    return null
  }
  return parsed
}

/**
 * List verification results for one execution, sorted by createdAt
 * (ascending; resultId breaks ties deterministically).
 */
export function listVerificationResultsForExecution(
  executionId: string,
): HecateqVerificationResult[] {
  const dir = resolveVerificationDir()
  if (!existsSync(dir)) return []

  const entries: HecateqVerificationResult[] = []
  for (const fileName of readdirSync(dir)) {
    if (!fileName.endsWith(".json")) continue
    const resultId = fileName.slice(0, -".json".length)
    const result = readVerificationResult(resultId)
    if (result && result.executionId === executionId) {
      entries.push(result)
    }
  }

  return entries.sort(
    (a, b) =>
      (a.createdAt ?? "").localeCompare(b.createdAt ?? "") ||
      (a.resultId ?? "").localeCompare(b.resultId ?? ""),
  )
}

// ─── Parsing helpers ─────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

function isVerificationStatus(
  value: unknown,
): value is HecateqVerificationStatus {
  return (
    value === "verified" ||
    value === "rejected" ||
    value === "insufficient_evidence"
  )
}

/** Parse + validate a raw verification file. Returns `null` on any mismatch. */
function tryParseVerificationFile(
  raw: string,
): HecateqVerificationResult | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null

  const taskGraphId = parsed.taskGraphId
  const taskId = parsed.taskId
  const executionId = parsed.executionId
  const status = parsed.status
  const attempt = parsed.attempt
  if (
    typeof taskGraphId !== "string" ||
    typeof taskId !== "string" ||
    typeof executionId !== "string" ||
    !isVerificationStatus(status) ||
    typeof attempt !== "number"
  ) {
    return null
  }
  if (!isStringArray(parsed.blockers)) return null

  const result: HecateqVerificationResult = {
    taskGraphId,
    taskId,
    attempt,
    executionId,
    status,
    blockers: parsed.blockers,
  }
  if (typeof parsed.resultId === "string") result.resultId = parsed.resultId
  if (typeof parsed.notes === "string") result.notes = parsed.notes
  if (typeof parsed.createdAt === "string") result.createdAt = parsed.createdAt
  return result
}
