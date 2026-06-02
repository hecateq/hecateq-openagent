import { log } from "./logger"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for curator scheduling. */
export interface CuratorScheduleOptions {
  /** Session ID for manifest refresh stamp. */
  sessionId?: string
  /** Agent name for manifest refresh stamp. */
  agent?: string
  /** Retention limit for quality-history (default 20). */
  qualityRetentionLimit?: number
}

/** Observable state of the curator scheduler. */
export interface CuratorScheduleState {
  /** Project roots with an active curator run in progress. */
  active: string[]
  /** Project roots with a pending follow-up run queued. */
  pending: string[]
  /** Total active count. */
  activeCount: number
  /** Total pending count. */
  pendingCount: number
}

// ---------------------------------------------------------------------------
// Per-projectRoot active/pending tracking
// ---------------------------------------------------------------------------

/**
 * Guards against concurrent curator runs for the same project root.
 * Implements queued follow-up: when scheduleMemoryCurator() is called while
 * a curator run is active, a single follow-up is queued. When the active
 * run finishes and pending is set, the follow-up executes — draining until
 * no pending remains.
 *
 * Loop safety:
 * - The curator never calls scheduleMemoryCurator() directly.
 * - The curator write path (through existing writers) does not touch
 *   appendTaskEntry / appendDecisionEntry (the curator only reads JSONL).
 * - If a curator write triggers auto-render, the auto-render drain loop
 *   is separate and does not schedule the curator.
 * - Manifest refresh from curator writes does not schedule the curator.
 * - A depth limit (128) acts as a circuit breaker against runaway.
 *
 * No session.idle used. No broad runtime hooks.
 */
const _activeCuratorRun = new Set<string>()
const _pendingCuratorRerun = new Set<string>()

// ---------------------------------------------------------------------------
// Drain loop
// ---------------------------------------------------------------------------

/**
 * Maximum recursive drain depth before circuit breaker triggers.
 * Matches Phase 4B.1 render drain limit.
 */
const MAX_CURATOR_DRAIN_DEPTH = 128

/**
 * Runs one curator pass for a project root, then drains any follow-up
 * runs queued while this pass was active. Recurses until no pending
 * remains. Bounded by maxDepth as a circuit breaker.
 *
 * Uses dynamic import to avoid circular dependencies and to keep the
 * curator module lazy-loaded.
 *
 * Never throws to the caller — all errors are caught and logged.
 */
function _curatorDrain(projectRoot: string, depth = 0): void {
  if (depth >= MAX_CURATOR_DRAIN_DEPTH) {
    log("memory-curator-scheduler: Curator drain depth limit reached", {
      projectRoot,
      depth,
    })
    _activeCuratorRun.delete(projectRoot)
    _pendingCuratorRerun.delete(projectRoot)
    return
  }

  import("./memory-curator")
    .then(({ runMemoryCurator }) => {
      const options: import("./memory-curator").CuratorOptions | undefined =
        undefined // options are project-level, not carried across runs
      return runMemoryCurator(projectRoot, options)
    })
    .catch((err) => {
      log("memory-curator-scheduler: Curator run failed", {
        projectRoot,
        depth,
        error: err instanceof Error ? err.message : String(err),
      })
    })
    .finally(() => {
      if (_pendingCuratorRerun.has(projectRoot)) {
        // Follow-up needed — drain pending and recurse
        _pendingCuratorRerun.delete(projectRoot)
        _curatorDrain(projectRoot, depth + 1)
      } else {
        // No pending — drain complete
        _activeCuratorRun.delete(projectRoot)
      }
    })
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Schedule a best-effort memory curator run for the given project root.
 *
 * This is fire-and-forget: the call returns immediately and the curator
 * runs asynchronously via dynamic import. Normal scheduling must NOT be
 * awaited in production paths.
 *
 * Behavior:
 * - If no curator run is active for this projectRoot: starts immediately.
 * - If a curator run IS active: queues exactly one follow-up run.
 *   Multiple overlapping schedule calls while active still result in at
 *   most one follow-up (the pending flag is a Set).
 * - All errors are caught and logged; never thrown to the caller.
 * - The curator module is dynamically imported; first call loads the
 *   module (~50ms), subsequent calls use the cached module.
 *
 * The caller must NOT await this function in production paths. Use
 * `void scheduleMemoryCurator(...)` or call without `await`.
 */
export function scheduleMemoryCurator(
  projectRoot: string,
  _options?: CuratorScheduleOptions,
): void {
  if (!projectRoot) return

  if (!_activeCuratorRun.has(projectRoot)) {
    _activeCuratorRun.add(projectRoot)
    _curatorDrain(projectRoot)
  } else {
    _pendingCuratorRerun.add(projectRoot)
  }
}

/**
 * Flush pending curator runs by polling the microtask queue until the
 * active curator run set is empty. Caps at `maxLayers` microtask layers
 * to prevent infinite waits in edge cases.
 *
 * FOR TEST/INTERNAL USE ONLY — production paths are fire-and-forget.
 *
 * If `projectRoot` is provided, only waits for that project's runs.
 * Otherwise waits for ALL pending runs to complete.
 */
export async function flushPendingMemoryCuratorRuns(
  projectRoot?: string,
  maxLayers = 20,
): Promise<void> {
  for (let i = 0; i < maxLayers; i++) {
    // Yield to the microtask queue to let dynamic import + curator chain settle
    await new Promise<void>((r) => queueMicrotask(r))

    if (projectRoot !== undefined) {
      if (
        !_activeCuratorRun.has(projectRoot) &&
        !_pendingCuratorRerun.has(projectRoot)
      ) {
        return
      }
    } else {
      if (_activeCuratorRun.size === 0 && _pendingCuratorRerun.size === 0) {
        return
      }
    }
  }
}

/**
 * Returns the current curator scheduler state for observability.
 * FOR TEST/INTERNAL USE ONLY.
 *
 * If `projectRoot` is provided, returns state scoped to that project.
 * Otherwise returns global state.
 */
export function getMemoryCuratorScheduleState(
  projectRoot?: string,
): CuratorScheduleState {
  if (projectRoot !== undefined) {
    return {
      active: _activeCuratorRun.has(projectRoot) ? [projectRoot] : [],
      pending: _pendingCuratorRerun.has(projectRoot) ? [projectRoot] : [],
      activeCount: _activeCuratorRun.has(projectRoot) ? 1 : 0,
      pendingCount: _pendingCuratorRerun.has(projectRoot) ? 1 : 0,
    }
  }

  return {
    active: [..._activeCuratorRun],
    pending: [..._pendingCuratorRerun],
    activeCount: _activeCuratorRun.size,
    pendingCount: _pendingCuratorRerun.size,
  }
}
