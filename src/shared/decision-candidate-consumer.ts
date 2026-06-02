/**
 * Decision Candidate Consumer — Phase 3B.1
 *
 * Accepts DecisionCandidate entries extracted by the pre-task memory seed,
 * validates them for explicit durable decision content, converts valid
 * candidates to DecisionLogEntry input, and appends them via the centralized
 * Decision Writer (src/shared/decision-log.ts) using the Decision Writer
 * ownership identity.
 *
 * The pre-task seed emits decisionCandidates but must NOT write
 * decisions.jsonl or decisions.md directly. This consumer is the sole
 * bridge between pre-task seed detection and the Decision Writer path.
 *
 * All writes are best-effort: failures are caught, logged, and never
 * thrown. Memory write failure must not block runtime flow.
 */

import { join } from "node:path"
import { log } from "./logger"
import {
  appendDecisionEntry,
  DECISION_WRITER_IDENTITY,
  DECISION_LOG_FILENAME,
  type DecisionLogEntry,
} from "./decision-log"
import { PROJECT_MEMORY_DIR } from "./memory-bootstrap"
import {
  refreshManifestAfterWrite,
  type ManifestRefreshResult,
} from "./memory-manifest-updater"
import type { DecisionCandidate } from "./pre-task-memory-seed"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of a decision candidate consumption pass. Best-effort only. */
export interface DecisionCandidateConsumerResult {
  /** Number of candidates received. */
  attempted: number
  /** Number of candidates successfully written to decisions.jsonl. */
  written: number
  /** Number of candidates skipped (vague/not-durable). */
  skipped: number
  /** Error messages from failed writes. */
  errors: string[]
  /** Reasons why specific candidates were skipped. */
  skippedReasons: string[]
  /** Whether the memory manifest was refreshed after writes. */
  manifestRefreshed: boolean
}

// ---------------------------------------------------------------------------
// Durability filter — determines whether a DecisionCandidate is an explicit
// durable decision worth persisting, or a vague/auto-generated candidate.
// ---------------------------------------------------------------------------

/**
 * Words and phrases that indicate a candidate is NOT an explicit durable
 * decision. These are research requirements, open questions, task instructions,
 * or auto-generated low-signal entries.
 */
const VAGUE_TITLE_PATTERNS = [
  /\b(research|explore|investigate|find out|look up|check|discover|how to|how does|what is|what are|why is|why does|learn about)\b/i,
  /\b(test|verify|validate|run)\b.*\b(results?|output|coverage)\b/i,
  /\b(risk|warning|caution)\b/i,
  /\b(todo|task|step)\b.*\b(create|build|implement|fix|add|remove|set up|configure)\b/i,
]

/** Impact areas that are auto-derived from tech keywords but not durable decisions. */
const NON_DURABLE_IMPACT_AREAS = new Set([
  "research",
  "unknown",
  "testing",
])

/** Minimum decision text length to be considered an explicit durable decision. */
const MIN_DECISION_LENGTH = 20

/**
 * Determine whether a DecisionCandidate represents an explicit durable
 * project decision that should be written to decisions.jsonl.
 */
function isExplicitDurableCandidate(candidate: DecisionCandidate): boolean {
  // Skip candidates with vague/research-oriented titles
  for (const pattern of VAGUE_TITLE_PATTERNS) {
    if (pattern.test(candidate.title)) return false
  }

  // Skip candidates with non-durable impact areas (research, unknown, testing)
  if (NON_DURABLE_IMPACT_AREAS.has(candidate.impactArea.toLowerCase())) {
    return false
  }

  // Skip candidates whose decision text is too short (auto-generated placeholder)
  if (candidate.decision.trim().length < MIN_DECISION_LENGTH) {
    return false
  }

  // Skip candidates whose title is essentially the same as the decision
  // (indicates auto-generated without meaningful rationale)
  const titleCore = candidate.title.toLowerCase().replace(/^using\s+/, "").trim()
  const decisionCore = candidate.decision.toLowerCase().replace(/^adopt\s+/, "").replace(/\s+as part of the project technology stack\s*$/, "").trim()
  if (titleCore === decisionCore && candidate.rationale.length < 30) {
    return false
  }

  return true
}

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

/**
 * Generate a deterministic, content-stable decision ID from candidate data.
 * This allows the existing decision-log deduplication to detect repeats.
 */
function generateCandidateId(candidate: DecisionCandidate, index: number): string {
  const base = `${candidate.title}|${candidate.impactArea}`
    .toLowerCase()
    .replace(/[^a-z0-9|]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 40)

  // Simple hash from the title for uniqueness
  let hash = 0
  for (let i = 0; i < candidate.title.length; i++) {
    hash = (hash << 5) - hash + candidate.title.charCodeAt(i)
    hash |= 0
  }
  const hashStr = Math.abs(hash).toString(36).slice(0, 6)

  return `dec-candidate-${base}-${hashStr}`
}

// ---------------------------------------------------------------------------
// Conversion: DecisionCandidate → DecisionLogEntry
// ---------------------------------------------------------------------------

function convertCandidateToEntry(
  candidate: DecisionCandidate,
  id: string,
  sessionId?: string,
): DecisionLogEntry {
  return {
    version: 1,
    id,
    timestamp: new Date().toISOString(),
    action: "record",
    title: candidate.title,
    status: "active",
    decision: candidate.decision,
    rationale: candidate.rationale,
    impact_area: candidate.impactArea,
    source_session_id: sessionId,
  }
}

// ---------------------------------------------------------------------------
// Core consumer function
// ---------------------------------------------------------------------------

/**
 * Consume DecisionCandidate entries from pre-task seed extraction,
 * validate them for explicit durable decision content, and persist
 * the valid ones through the Decision Writer (appendDecisionEntry).
 *
 * Uses the Decision Writer ownership identity so the ownership guard
 * in decision-log.ts authorizes the write.
 *
 * After writing, refreshes the memory manifest to reflect the new
 * decisions.jsonl state.
 *
 * All failures are caught and logged. Never throws.
 *
 * @param candidates - DecisionCandidate entries from pre-task seed
 * @param projectRoot - Absolute path to the project root
 * @param options - Optional session ID for attribution
 * @returns DecisionCandidateConsumerResult
 */
export function consumeDecisionCandidates(
  candidates: DecisionCandidate[],
  projectRoot: string,
  options?: {
    sessionId?: string
  },
): DecisionCandidateConsumerResult {
  const candidateCount = (candidates && Array.isArray(candidates)) ? candidates.length : 0
  const result: DecisionCandidateConsumerResult = {
    attempted: candidateCount,
    written: 0,
    skipped: 0,
    errors: [],
    skippedReasons: [],
    manifestRefreshed: false,
  }

  if (!candidates) return result
  if (!Array.isArray(candidates) || candidates.length === 0) return result
  if (!projectRoot) {
    result.errors.push("Missing projectRoot")
    return result
  }

  // Track already-seen decision IDs within this batch for deduplication
  const seenIds = new Set<string>()

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]
    if (!candidate) continue

    // Step 1: Validate durability
    if (!isExplicitDurableCandidate(candidate)) {
      result.skipped++
      result.skippedReasons.push(
        `"${candidate.title}": not an explicit durable decision`,
      )
      continue
    }

    // Step 2: Generate decision ID
    const id = generateCandidateId(candidate, i)
    if (seenIds.has(id)) {
      result.skipped++
      result.skippedReasons.push(
        `"${candidate.title}": duplicate candidate within batch`,
      )
      continue
    }
    seenIds.add(id)

    // Step 3: Convert to DecisionLogEntry
    const entry = convertCandidateToEntry(candidate, id, options?.sessionId)

    // Step 4: Append via Decision Writer
    try {
      const appended = appendDecisionEntry(
        projectRoot,
        entry,
        DECISION_WRITER_IDENTITY,
      )

      if (appended) {
        result.written++
        log("decision-candidate-consumer: Candidate written to decisions.jsonl", {
          decisionId: id,
          title: candidate.title,
          impactArea: candidate.impactArea,
        })
      } else {
        // appendDecisionEntry returned false — likely duplicate content
        result.skipped++
        result.skippedReasons.push(
          `"${candidate.title}": duplicate content in decisions.jsonl`,
        )
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      result.errors.push(`${candidate.title}: ${msg}`)
      log("decision-candidate-consumer: Write failed", {
        decisionId: id,
        title: candidate.title,
        error: msg,
      })
    }
  }

  // Step 5: Refresh manifest if any writes succeeded
  if (result.written > 0) {
    try {
      const decisionsJsonlPath = join(
        projectRoot,
        PROJECT_MEMORY_DIR,
        DECISION_LOG_FILENAME,
      )
      const refreshResult: ManifestRefreshResult = refreshManifestAfterWrite(
        projectRoot,
        decisionsJsonlPath,
        undefined, // harnessKind
        undefined, // agent
        options?.sessionId,
      )

      result.manifestRefreshed = refreshResult.updated
      if (!refreshResult.updated && refreshResult.reason) {
        log("decision-candidate-consumer: Manifest refresh skipped", {
          reason: refreshResult.reason,
        })
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      result.errors.push(`manifest refresh: ${msg}`)
      log("decision-candidate-consumer: Manifest refresh failed", {
        projectRoot,
        error: msg,
      })
    }
  }

  return result
}
