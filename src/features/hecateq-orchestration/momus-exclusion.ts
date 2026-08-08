/**
 * Momus Hard Exclusion (Part L)
 *
 * The critic agent (momus) is banned from every Hecateq orchestration
 * surface: reviewer routing, verifier routing, planner gate assistance,
 * fallback candidates, prompt recommendations, candidate ranking, tests,
 * and runtime chains. If a candidate set contains momus, it must be
 * removed before the set can influence any routing decision.
 *
 * This module is the single source of truth for the ban. The
 * `momus-exclusion` meta-audit (momus-exclusion.test.ts) scans consumer
 * files for the token and treats this module itself as the canonical
 * guard, so it is exempt from the per-line scan.
 */

/** The forbidden critic agent. Never routed anywhere in the Hecateq pipeline. */
export const HECATEQ_FORBIDDEN_AGENTS: string[] = ["momus"]

/** Readonly set form of {@link HECATEQ_FORBIDDEN_AGENTS} for O(1) checks. */
export const HECATEQ_FORBIDDEN_AGENT_SET: ReadonlySet<string> = new Set(
  HECATEQ_FORBIDDEN_AGENTS,
)

/** Human-readable description of the guard, surfaced in routing context. */
export const HECATEQ_MOMUS_GUARD_DESCRIPTION =
  "Momus is hard-excluded from every Hecateq routing decision (HECATEQ Evidence/Verification/Planner Gate V1 Part L)"

/** Case-insensitive check: is the given agent the forbidden critic? */
export function isMomus(agent: string): boolean {
  return agent.toLowerCase() === "momus"
}

/** Case-insensitive filter: remove the forbidden critic from a candidate list. */
export function filterMomus(agents: string[]): string[] {
  return agents.filter((agent) => !isMomus(agent))
}

/**
 * Fail-closed assertion: throws when the candidate list contains the
 * forbidden critic. Intended as a defensive net at routing boundaries
 * (verifier routing, reviewer routing, planner gate).
 */
export function assertNoMomus(agents: string[], context: string): void {
  const offender = agents.find((agent) => isMomus(agent))
  if (offender !== undefined) {
    throw new Error(`${context}: forbidden agent: ${offender}`)
  }
}
