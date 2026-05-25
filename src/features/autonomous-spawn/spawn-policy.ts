import type { AutoSpawnConfig, SpawnPolicyResult, SpawnState } from "./types"

export function canSpawn(config: AutoSpawnConfig, state: SpawnState): SpawnPolicyResult {
  if (!config.enabled) {
    return { allowed: false, reason: "Auto-spawn is disabled in config" }
  }

  const activeCount = state.activeSessions.length
  if (activeCount >= config.maxConcurrentSpawns) {
    return {
      allowed: false,
      reason: `Max concurrent spawns reached (${activeCount}/${config.maxConcurrentSpawns})`,
    }
  }

  if (state.config.pausedUntil) {
    const pausedUntil = new Date(state.config.pausedUntil).getTime()
    if (Date.now() < pausedUntil) {
      return {
        allowed: false,
        reason: `Auto-spawn is paused until ${state.config.pausedUntil}`,
      }
    }
  }

  return { allowed: true }
}

export function getSpawnCapacity(config: AutoSpawnConfig, state: SpawnState): number {
  const activeCount = state.activeSessions.length
  const capacity = config.maxConcurrentSpawns - activeCount
  return Math.max(0, capacity)
}

export function isPaused(state: SpawnState): boolean {
  if (!state.config.pausedUntil) return false
  return Date.now() < new Date(state.config.pausedUntil).getTime()
}

export function computePauseUntil(
  config: AutoSpawnConfig,
  consecutiveFailures: number,
): string | null {
  if (consecutiveFailures < config.maxFailuresBeforePause) return null
  return new Date(Date.now() + config.pauseDurationMs).toISOString()
}
