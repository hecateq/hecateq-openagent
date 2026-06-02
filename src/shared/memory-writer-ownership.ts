/**
 * Memory Writer Ownership Contract
 *
 * Central, source-of-truth ownership module for the Hecateq memory system.
 * Defines which writers may write to which memory files, write mode metadata,
 * and authorization helpers. All memory write paths MUST route through
 * the authorization checks defined here.
 *
 * Phase 3A — Writer Ownership Enforcement Foundation
 * Based on MEMORY_ROLE_TRIGGER_OWNERSHIP_CONTRACT.md Sections 5-7.
 *
 * Runtime paths remain best-effort: unauthorized writes log a warning
 * and return a result error rather than throwing. Tests use strict mode
 * for deterministic failure.
 */

// ---------------------------------------------------------------------------
// Constants — Memory File Names (single source of truth)
// ---------------------------------------------------------------------------

/** All required project memory file names (human-readable markdown). */
export const MEMORY_MD_FILES = [
  "active-context.md",
  "progress.md",
  "tasks.md",
  "file-map.md",
  "decisions.md",
  "agent-routing.md",
  "quality-history.md",
  "risk-profile.md",
  "open-questions.md",
  "conventions.md",
  "environment.md",
] as const

/** All required project memory file names (machine-readable JSONL). */
export const MEMORY_JSONL_FILES = ["tasks.jsonl", "decisions.jsonl"] as const

/** Runtime/manifest state files (not project knowledge). */
export const MEMORY_MANIFEST_FILES = ["memory.json"] as const

/** Runtime resume/continuation state files (not project knowledge). */
export const MEMORY_CONTINUATION_FILES = ["continuation.json"] as const

/** Optional memory files — bootstrapped when missing, manifest/doctor treat as optional. */
export const MEMORY_OPTIONAL_FILES = ["glossary.md", "incidents.md"] as const

/** All known memory file names (required + optional + JSONL + manifest + continuation). */
export type MemoryFileName =
  | (typeof MEMORY_MD_FILES)[number]
  | (typeof MEMORY_JSONL_FILES)[number]
  | (typeof MEMORY_MANIFEST_FILES)[number]
  | (typeof MEMORY_CONTINUATION_FILES)[number]
  | (typeof MEMORY_OPTIONAL_FILES)[number]

/** All known memory file names as a readonly array. */
export const ALL_MEMORY_FILES = [
  ...MEMORY_MD_FILES,
  ...MEMORY_JSONL_FILES,
  ...MEMORY_MANIFEST_FILES,
  ...MEMORY_CONTINUATION_FILES,
  ...MEMORY_OPTIONAL_FILES,
] as const

// ---------------------------------------------------------------------------
// Constants — Writer Identities
// ---------------------------------------------------------------------------

/**
 * Writer identity strings. Every memory write path MUST self-identify
 * with exactly one of these identities. Unknown/unspecified is for
 * external callers that have not yet been integrated.
 */
export const WRITER_IDENTITIES = [
  "pre_task_seed",
  "task_completion_writer",
  "decision_writer",
  "quality_writer",
  "risk_writer",
  "file_map_writer",
  "memory_curator",
  "manifest_updater",
  "continuation_writer",
  "incident_writer",
  "routing_policy_writer",
  "unknown",
] as const

export type WriterIdentity = (typeof WRITER_IDENTITIES)[number]

// ---------------------------------------------------------------------------
// Constants — Write Modes
// ---------------------------------------------------------------------------

export type WriteMode =
  | "append_only"
  | "overwrite_snapshot"
  | "controlled_section_overwrite"
  | "append_compact"
  | "controlled_update"
  | "append_deduplicate"
  | "append_resolve"
  | "append_retention"

/** Write mode metadata for each memory file. */
export const MEMORY_FILE_WRITE_MODES: Record<string, WriteMode> = {
  "memory.json": "overwrite_snapshot",
  "continuation.json": "overwrite_snapshot",
  "active-context.md": "controlled_section_overwrite",
  "progress.md": "append_compact",
  "tasks.jsonl": "append_only",
  "tasks.md": "controlled_section_overwrite",
  "decisions.jsonl": "append_only",
  "decisions.md": "controlled_section_overwrite",
  "open-questions.md": "append_resolve",
  "conventions.md": "append_compact",
  "environment.md": "controlled_update",
  "agent-routing.md": "controlled_update",
  "file-map.md": "controlled_section_overwrite",
  "quality-history.md": "append_retention",
  "risk-profile.md": "controlled_section_overwrite",
  "glossary.md": "append_deduplicate",
  "incidents.md": "append_resolve",
}

// ---------------------------------------------------------------------------
// Ownership Matrix — Writer → Allowed Files
// ---------------------------------------------------------------------------

/**
 * Allowed writer → memory file mapping.
 *
 * If a writer is not in this map, it may not write to any memory file.
 * If a file is not in a writer's allowed set, that writer must not write to it.
 *
 * The `memory_curator` entry describes which files the curator MAY touch
 * when implemented in Phase 4. It does NOT grant any current runtime
 * write permission — curator behavior is not implemented yet.
 */
export const WRITER_ALLOWED_FILES: Record<WriterIdentity, readonly string[]> = {
  pre_task_seed: [
    "active-context.md",
    "open-questions.md",
    "conventions.md",
    "environment.md",
  ],

  task_completion_writer: [
    "tasks.jsonl",
    "progress.md",
    "active-context.md",
  ],

  decision_writer: [
    "decisions.jsonl",
    "decisions.md",
  ],

  quality_writer: [
    "quality-history.md",
  ],

  risk_writer: [
    "risk-profile.md",
  ],

  file_map_writer: [
    "file-map.md",
  ],

  memory_curator: [
    // Curator may read and normalize these files.
    // No new facts may be created. Phase 4 implementation.
    "active-context.md",
    "progress.md",
    "tasks.md",
    "decisions.md",
    "open-questions.md",
    "conventions.md",
    "environment.md",
    "glossary.md",
    "agent-routing.md",
    "file-map.md",
    "risk-profile.md",
    "incidents.md",
  ],

  manifest_updater: [
    "memory.json",
  ],

  continuation_writer: [
    "continuation.json",
  ],

  incident_writer: [
    "incidents.md",
  ],

  routing_policy_writer: [
    "agent-routing.md",
  ],

  unknown: [],
}

// ---------------------------------------------------------------------------
// Forbidden Writer → File Mapping (explicit denials for tests)
// ---------------------------------------------------------------------------

/**
 * Explicit forbidden mappings. These files are specifically denied to
 * the given writers, even if their allowed list changes in the future.
 * Used by doctor checks and tests to validate ownership invariants.
 */
export const WRITER_FORBIDDEN_FILES: Record<string, readonly string[]> = {
  "pre_task_seed→decisions.md": ["pre_task_seed", "decisions.md"],
  "pre_task_seed→decisions.jsonl": ["pre_task_seed", "decisions.jsonl"],
  "pre_task_seed→tasks.jsonl": ["pre_task_seed", "tasks.jsonl"],
  "pre_task_seed→tasks.md": ["pre_task_seed", "tasks.md"],
  "pre_task_seed→quality-history.md": ["pre_task_seed", "quality-history.md"],
  "pre_task_seed→risk-profile.md": ["pre_task_seed", "risk-profile.md"],
  "pre_task_seed→file-map.md": ["pre_task_seed", "file-map.md"],
  "pre_task_seed→agent-routing.md": ["pre_task_seed", "agent-routing.md"],
  "pre_task_seed→memory.json": ["pre_task_seed", "memory.json"],
  "pre_task_seed→continuation.json": ["pre_task_seed", "continuation.json"],
  "task_completion_writer→decisions.jsonl": ["task_completion_writer", "decisions.jsonl"],
  "task_completion_writer→decisions.md": ["task_completion_writer", "decisions.md"],
  "task_completion_writer→quality-history.md": ["task_completion_writer", "quality-history.md"],
  "task_completion_writer→risk-profile.md": ["task_completion_writer", "risk-profile.md"],
  "task_completion_writer→file-map.md": ["task_completion_writer", "file-map.md"],
  "task_completion_writer→memory.json": ["task_completion_writer", "memory.json"],
  "task_completion_writer→continuation.json": ["task_completion_writer", "continuation.json"],
  "task_completion_writer→conventions.md": ["task_completion_writer", "conventions.md"],
  "task_completion_writer→environment.md": ["task_completion_writer", "environment.md"],
  "task_completion_writer→open-questions.md": ["task_completion_writer", "open-questions.md"],
}

// ---------------------------------------------------------------------------
// Authorization Helpers
// ---------------------------------------------------------------------------

export interface OwnershipCheckResult {
  /** Whether the write is authorized. */
  authorized: boolean
  /** The writer identity that was checked. */
  writer: WriterIdentity
  /** The target file name. */
  fileName: string
  /** If not authorized, a human-readable reason. */
  reason: string | null
}

/**
 * Check whether a writer is authorized to write to a specific memory file.
 *
 * Always returns a result — never throws. Callers decide whether to
 * warn, log, or abort based on the result.
 */
export function canWriteMemoryFile(
  writer: WriterIdentity,
  fileName: string,
): OwnershipCheckResult {
  const allowed = WRITER_ALLOWED_FILES[writer]

  if (!allowed) {
    return {
      authorized: false,
      writer,
      fileName,
      reason: `Writer "${writer}" has no allowed files defined`,
    }
  }

  if (allowed.length === 0) {
    return {
      authorized: false,
      writer,
      fileName,
      reason: `Writer "${writer}" is not authorized to write any memory files`,
    }
  }

  if (allowed.includes(fileName)) {
    return { authorized: true, writer, fileName, reason: null }
  }

  return {
    authorized: false,
    writer,
    fileName,
    reason: `Writer "${writer}" is not authorized to write "${fileName}". Allowed: ${allowed.join(", ")}`,
  }
}

/**
 * Strict assertion: throws if the writer is not authorized.
 * Use in tests and strict enforcement paths only.
 * Runtime paths should use `canWriteMemoryFile` and handle the result.
 */
export function assertCanWriteMemoryFile(
  writer: WriterIdentity,
  fileName: string,
): void {
  const result = canWriteMemoryFile(writer, fileName)
  if (!result.authorized) {
    throw new Error(
      `OWNERSHIP VIOLATION: ${result.reason}`,
    )
  }
}

/**
 * Get all memory files that a writer is authorized to write.
 * Returns empty array for unknown/unregistered writers.
 */
export function getAllowedMemoryFilesForWriter(
  writer: WriterIdentity,
): readonly string[] {
  return WRITER_ALLOWED_FILES[writer] ?? []
}

/**
 * Get the declared write mode for a memory file.
 * Returns undefined for unknown file names.
 */
export function getMemoryFileWriteMode(fileName: string): WriteMode | undefined {
  return MEMORY_FILE_WRITE_MODES[fileName]
}

/**
 * Check whether a file name is a known memory file.
 */
export function isKnownMemoryFile(fileName: string): boolean {
  return fileName in MEMORY_FILE_WRITE_MODES
}

// ---------------------------------------------------------------------------
// Ownership Map Validation (for doctor/static checks)
// ---------------------------------------------------------------------------

export interface OwnershipMapValidationIssue {
  severity: "error" | "warn"
  message: string
}

/**
 * Validate the ownership map itself for internal consistency.
 * Returns issues found:
 * - Unknown memory file in the write mode map
 * - Required memory file missing from write mode map
 * - Writer has an allowed file that is not a known memory file
 */
export function validateOwnershipMap(): OwnershipMapValidationIssue[] {
  const issues: OwnershipMapValidationIssue[] = []

  // Check: every file in write mode map is a known file
  const knownFiles = new Set<string>(ALL_MEMORY_FILES)
  for (const fileName of Object.keys(MEMORY_FILE_WRITE_MODES)) {
    if (!knownFiles.has(fileName)) {
      issues.push({
        severity: "warn",
        message: `Unknown memory file "${fileName}" in write mode map`,
      })
    }
  }

  // Check: every required file has a write mode
  for (const fileName of ALL_MEMORY_FILES) {
    if (!(fileName in MEMORY_FILE_WRITE_MODES)) {
      issues.push({
        severity: "error",
        message: `Required memory file "${fileName}" missing from write mode map`,
      })
    }
  }

  // Check: every writer's allowed files are known memory files
  for (const [writer, allowed] of Object.entries(WRITER_ALLOWED_FILES)) {
    for (const fileName of allowed) {
      if (!knownFiles.has(fileName) && !(fileName in MEMORY_FILE_WRITE_MODES)) {
        issues.push({
          severity: "warn",
          message: `Writer "${writer}" lists unknown memory file "${fileName}"`,
        })
      }
    }
  }

  return issues
}

/**
 * Validate that all explicit forbidden mappings are reflected in the
 * ownership matrix (i.e., the writer's allowed list does NOT contain
 * the forbidden file).
 */
export function validateForbiddenMappings(): OwnershipMapValidationIssue[] {
  const issues: OwnershipMapValidationIssue[] = []

  for (const [key, [writer, fileName]] of Object.entries(WRITER_FORBIDDEN_FILES)) {
    if (!writer || !fileName) continue
    const allowed = WRITER_ALLOWED_FILES[writer as WriterIdentity] ?? []
    if (allowed.includes(fileName)) {
      issues.push({
        severity: "error",
        message: `Forbidden mapping violation: "${key}" — "${fileName}" is in "${writer}" allowed list but marked forbidden`,
      })
    }
  }

  return issues
}
