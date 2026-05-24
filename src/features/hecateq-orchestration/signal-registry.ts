/**
 * Hecateq Signal Registry — Known DAG Signal Definitions
 *
 * Wave 1 foundation: defines the known signals from the agent DAG
 * (Delegation Akışı in AGENTS.md). Each signal carries metadata about
 * which agents emit it and which consume it, enabling future
 * auto-routing decisions.
 *
 * Wave 2+ will add signal subscription, dynamic registration,
 * and policy-based signal → agent routing.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface HecateqSignalDefinition {
  /** Canonical signal name (e.g. "schema_ready") */
  signal: string
  /** Human-readable description */
  description: string
  /** Agents that emit this signal */
  emittedBy: string[]
  /** Agents that consume/react to this signal */
  consumedBy: string[]
  /** Category for grouping / routing hints */
  category: "infrastructure" | "development" | "quality" | "deployment" | "compliance"
}

// ─── Known Signals ───────────────────────────────────────────────────────────

/**
 * All known DAG signals from the agent handoff protocol (AGENTS.md).
 *
 * Signal → Emitter mapping:
 * | Signal                  | Emitter                      |
 * |-------------------------|------------------------------|
 * | schema_ready            | database-specialist          |
 * | backend_ready           | nodejs-backend-developer     |
 * | ui_specs_ready          | design-translator            |
 * | auth_audit_passed       | security-architect           |
 * | infra_provisioned       | coolify-devops-specialist    |
 * | pipeline_secured        | devsecops-pipeline-architect |
 * | tests_passed            | qa-test-engineer             |
 * | performance_verified    | performance-specialist       |
 * | compliance_signed       | compliance-specialist        |
 */
export const KNOWN_SIGNALS: HecateqSignalDefinition[] = [
  {
    signal: "schema_ready",
    description: "Database schema design and migration files are ready",
    emittedBy: ["database-specialist"],
    consumedBy: ["nodejs-backend-developer", "go-backend-developer", "python-ml-engineer"],
    category: "infrastructure",
  },
  {
    signal: "backend_ready",
    description: "Backend API implementation is complete and endpoints respond",
    emittedBy: ["nodejs-backend-developer", "go-backend-developer"],
    consumedBy: ["qa-test-engineer", "security-architect", "performance-specialist"],
    category: "development",
  },
  {
    signal: "ui_specs_ready",
    description: "UI design specs or wireframes are ready for implementation",
    emittedBy: ["design-translator", "ux-motion-designer"],
    consumedBy: ["nextjs-ui-wizard", "flutter-dart-master", "qa-test-engineer"],
    category: "development",
  },
  {
    signal: "auth_audit_passed",
    description: "Authentication/authorization audit completed without critical findings",
    emittedBy: ["security-architect"],
    consumedBy: ["nodejs-backend-developer", "release-manager"],
    category: "quality",
  },
  {
    signal: "infra_provisioned",
    description: "Infrastructure (servers, databases, storage) is provisioned and reachable",
    emittedBy: ["coolify-devops-specialist", "devops-engineer"],
    consumedBy: ["nodejs-backend-developer", "release-manager"],
    category: "infrastructure",
  },
  {
    signal: "pipeline_secured",
    description: "CI/CD pipeline security scanning (SAST/DAST/secret) is configured",
    emittedBy: ["devsecops-pipeline-architect"],
    consumedBy: ["release-manager", "coolify-devops-specialist"],
    category: "deployment",
  },
  {
    signal: "tests_passed",
    description: "All tests pass — unit, integration, and/or E2E",
    emittedBy: ["qa-test-engineer"],
    consumedBy: ["release-manager", "nodejs-backend-developer", "flutter-dart-master"],
    category: "quality",
  },
  {
    signal: "performance_verified",
    description: "Performance benchmarks are within acceptable thresholds",
    emittedBy: ["performance-specialist"],
    consumedBy: ["release-manager", "qa-test-engineer"],
    category: "quality",
  },
  {
    signal: "compliance_signed",
    description: "Compliance requirements (GDPR/KVKK/CCPA) are met and documented",
    emittedBy: ["compliance-specialist"],
    consumedBy: ["release-manager", "security-architect"],
    category: "compliance",
  },
]

// ─── Lookup Helpers ──────────────────────────────────────────────────────────

/**
 * Get the signal definition for a given signal name.
 * Returns undefined if the signal is unknown.
 */
export function getSignalDefinition(signal: string): HecateqSignalDefinition | undefined {
  return KNOWN_SIGNALS.find((s) => s.signal === signal)
}

/**
 * Get all signals emitted by a given agent.
 */
export function getSignalsEmittedBy(agent: string): HecateqSignalDefinition[] {
  return KNOWN_SIGNALS.filter((s) => s.emittedBy.includes(agent))
}

/**
 * Get all signals consumed by a given agent.
 */
export function getSignalsConsumedBy(agent: string): HecateqSignalDefinition[] {
  return KNOWN_SIGNALS.filter((s) => s.consumedBy.includes(agent))
}

/**
 * Get all known signal names as a flat array.
 */
export function getAllSignalNames(): string[] {
  return KNOWN_SIGNALS.map((s) => s.signal)
}

/**
 * Validate that a signal name is known (in the registry).
 */
export function isKnownSignal(signal: string): boolean {
  return KNOWN_SIGNALS.some((s) => s.signal === signal)
}
