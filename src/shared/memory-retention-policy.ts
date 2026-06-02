// ---------------------------------------------------------------------------
// Phase 6: Central memory retention policy constants
// ---------------------------------------------------------------------------
//
// All limits are hardcoded defaults. Config-driven retention is a future phase.
// Do not add schema fields for these — the config schema contract explicitly
// forbids adding new fields in this phase.
//
// Design invariants:
// - Pruning is always best-effort; append success is never blocked.
// - JSONL sources-of-truth are preserved with newest-first semantics.
// - Malformed lines are tolerated; only valid JSONL lines are counted.
// - Manifest refresh follows successful pruning when the file changes.
// - Active/current data is never pruned (active risks, latest failure, etc.).

/** Maximum lines in tasks.jsonl before pruning. */
export const TASKS_JSONL_MAX_LINES = 1000

/** Maximum bytes for tasks.jsonl before pruning. */
export const TASKS_JSONL_MAX_BYTES = 1_000_000

/** Maximum lines in decisions.jsonl before pruning. */
export const DECISIONS_JSONL_MAX_LINES = 500

/** Maximum bytes for decisions.jsonl before pruning. */
export const DECISIONS_JSONL_MAX_BYTES = 750_000

/** Maximum quality history entries to retain. */
export const QUALITY_HISTORY_MAX_ENTRIES = 20

/** Always preserve the latest failure entry in quality history. */
export const QUALITY_HISTORY_PRESERVE_LATEST_FAILURE = true

/** Maximum resolved/mitigated risk entries to retain. Active risks are never pruned. */
export const RISK_PROFILE_MAX_RESOLVED_RISKS = 50

/** Maximum Change Impact Map entries to retain. */
export const CHANGE_IMPACT_MAX_ENTRIES = 100

/** Run-continuation marker max age in days before cleanup. */
export const RUN_CONTINUATION_MARKER_MAX_AGE_DAYS = 30

/** Maximum run-continuation markers to retain. */
export const RUN_CONTINUATION_MAX_MARKERS = 200
