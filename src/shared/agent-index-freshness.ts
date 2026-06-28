/**
 * Hecateq Agent Index Freshness — PR-5 live-registry durability layer.
 *
 * Provides pure functions (no I/O) for verifying that a custom agent
 * is registered in the live runtime and that the agent index is fresh.
 *
 * Design invariants:
 *   - Built-in agents always pass the freshness check (they bypass it entirely).
 *   - Custom agents must be in the live registry AND the index must be fresh.
 *   - When requireFresh is false, the index is always considered fresh.
 *   - Default maxAge threshold is 7 days (604,800,000 ms).
 */

const MS_PER_HOUR = 3_600_000
const MS_PER_DAY = 86_400_000
export const DEFAULT_MAX_AGE_MS = 7 * MS_PER_DAY

/**
 * Check whether a named agent is in the live runtime registry.
 * Case-insensitive comparison.
 */
export function isAgentInLiveRegistry(
  agentName: string,
  liveAgentIds: Set<string>,
): boolean {
  return liveAgentIds.has(agentName.toLowerCase())
}

/**
 * Check whether the agent index is fresh based on its generated_at timestamp.
 *
 * @param indexGeneratedAt — ISO-8601 timestamp from the index file
 * @param requireFresh — when false, always returns { fresh: true, ageMs: 0 }
 * @param maxAgeMs — maximum allowed age in milliseconds (default: 7 days)
 */
export function isIndexFresh(
  indexGeneratedAt: string,
  requireFresh: boolean,
  maxAgeMs: number = DEFAULT_MAX_AGE_MS,
): { fresh: boolean; ageMs: number } {
  if (!requireFresh) {
    return { fresh: true, ageMs: 0 }
  }

  const generatedMs = Date.parse(indexGeneratedAt)
  if (Number.isNaN(generatedMs)) {
    return { fresh: false, ageMs: NaN }
  }

  const ageMs = Date.now() - generatedMs
  return { fresh: ageMs <= maxAgeMs, ageMs }
}
