/**
 * Hecateq Resumption Channel — pure liveness resolvers.
 *
 * Reads liveness from runtime primitives via injected probes. NO heuristics,
 * NO time-based fallback: when a probe is absent the channel is "unknown"
 * and treated as NOT alive (fail closed). A live channel means the execution
 * is NOT marked blocked.
 */

import type {
  HecateqExecutionRecord,
  HecateqProgressState,
  ResumptionChannel,
} from "./runtime-continuity-types"

export interface LivenessProbes {
  isBackgroundTaskAlive?: (id: string) => boolean
  isDelegatedSessionAlive?: (id: string) => boolean
  isContinuationAlive?: (id: string) => boolean
}

/**
 * Probe a background task's liveness. The registry has no direct reference
 * to BackgroundManager, so the caller supplies a probe function (e.g.
 * `(id) => BackgroundManager.getTask(id)?.status` in "pending" | "running").
 * Fails closed (false) when no probe is provided.
 */
export function probeBackgroundTaskLiveness(
  backgroundTaskId: string,
  managerProbe?: (id: string) => boolean,
): boolean {
  if (!managerProbe) return false
  return managerProbe(backgroundTaskId)
}

/**
 * Probe a delegated session's liveness. The authoritative check is
 * `isOpenCodeSessionActive` from session-idle-settle, which requires an
 * OpenCode client and is async; callers wrap it in a synchronous probe
 * (e.g. `(id) => isOpenCodeSessionActive(client, id)`). Fails closed
 * (false) when no probe is provided.
 */
export function probeDelegatedSessionLiveness(
  sessionId: string,
  sessionProbe?: (id: string) => boolean,
): boolean {
  if (!sessionProbe) return false
  return sessionProbe(sessionId)
}

/**
 * Resolve whether a resumption channel is live. The stored `alive` flag on
 * the channel is a snapshot; liveness must be re-proven from runtime state.
 * Without a matching probe the channel is unknown -> not alive.
 */
export function isLiveResumptionChannel(
  channel: ResumptionChannel | undefined,
  probes?: LivenessProbes,
): boolean {
  if (!channel) return false
  switch (channel.kind) {
    case "background_task":
      return probes?.isBackgroundTaskAlive
        ? probes.isBackgroundTaskAlive(channel.id)
        : false
    case "delegated_session":
      return probes?.isDelegatedSessionAlive
        ? probes.isDelegatedSessionAlive(channel.id)
        : false
    case "continuation":
      return probes?.isContinuationAlive
        ? probes.isContinuationAlive(channel.id)
        : false
    case "parent_wake":
      // A parent wake is a continuation-style channel into the parent
      // session; its liveness is proven via the continuation probe.
      return probes?.isContinuationAlive
        ? probes.isContinuationAlive(channel.id)
        : false
  }
}

/**
 * Resolve the runtime progress state for a record:
 *  - terminal states (completed/failed) -> unchanged
 *  - active state -> unchanged
 *  - waiting state with channel + alive probe -> "waiting" (still waiting)
 *  - waiting state with channel + dead probe OR no channel -> "blocked"
 * Idempotent: calling twice with the same input returns the same state.
 */
export function resolveProgressState(input: {
  record: HecateqExecutionRecord
  livenessProbes?: LivenessProbes
}): HecateqProgressState {
  const { record, livenessProbes } = input
  const state = record.progressState

  if (state === "completed" || state === "failed") {
    return state
  }
  if (state === "active") {
    return state
  }
  if (state === "waiting") {
    if (record.channel && isLiveResumptionChannel(record.channel, livenessProbes)) {
      return "waiting"
    }
    return "blocked"
  }
  return state // "blocked" stays blocked
}
