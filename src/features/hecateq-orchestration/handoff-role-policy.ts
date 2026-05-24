/**
 * Hecateq Handoff Role Policy — Wave 3
 *
 * Role classification model for agent handoff behavior enforcement.
 * Maps every known agent to a role and validates handoff targets
 * against role-specific policy rules.
 *
 * Rules enforced:
 *   orchestrator       → can hand off to anyone
 *   implementer        → can hand off to caller, parent, or any known agent
 *   architect-builder  → should prefer parent routing; can hand off to
 *                        specialists but NOT to other architects directly
 *   reviewer-auditor   → MUST NOT hand off directly to implementers
 *   docs-research      → MUST NOT hand off to implementers;
 *                        only caller, parent, or orchestrator
 *   unknown            → no policy enforcement
 */

import type { AgentRole, RoutingDecision } from "./types"
import { getKnownAgentIds } from "./handoff-parser"

// ─── Role Registry ───────────────────────────────────────────────────────────

export interface AgentRoleEntry {
  /** Agent identifier (matching getKnownAgentIds) */
  agent: string
  /** Role classification */
  role: AgentRole
  /** Short justification for the classification */
  description: string
}

/**
 * Canonical agent-to-role mapping.
 *
 * Roles are assigned based on the agent's primary function in the
 * agent ecosystem (see AGENTS.md Delegation Akışı):
 *
 * orchestrator       — coordinate, delegate, route
 * implementer        — write code, build things
 * architect-builder  — design architecture, then build
 * reviewer-auditor   — review, test, inspect, audit
 * docs-research      — document, research, explore
 */
export const AGENT_ROLES: AgentRoleEntry[] = [
  // ── Orchestrators ─────────────────────────────────────────────────────────
  { agent: "sisyphus", role: "orchestrator", description: "Main orchestrator — plans, delegates, drives completion" },
  { agent: "hephaestus", role: "orchestrator", description: "Autonomous deep worker — end-to-end execution" },
  { agent: "prometheus", role: "orchestrator", description: "Strategic planner — interviews, plans, scopes" },
  { agent: "atlas", role: "orchestrator", description: "Background coordination and routing" },
  { agent: "hecateq-orchestrator", role: "orchestrator", description: "Hecateq pipeline orchestrator" },

  // ── Implementers ──────────────────────────────────────────────────────────
  { agent: "nodejs-backend-developer", role: "implementer", description: "Implements Node.js/TypeScript API endpoints" },
  { agent: "go-backend-developer", role: "implementer", description: "Implements Go services and HTTP/gRPC endpoints" },
  { agent: "flutter-dart-master", role: "implementer", description: "Implements Flutter/Dart UI and business logic" },
  { agent: "nextjs-ui-wizard", role: "implementer", description: "Implements Next.js/React UI components" },
  { agent: "python-ml-engineer", role: "implementer", description: "Implements Python AI/ML pipelines" },
  { agent: "cli-developer", role: "implementer", description: "Builds CLI tools and automation scripts" },
  { agent: "database-specialist", role: "implementer", description: "Implements database schemas and queries" },
  { agent: "realtime-systems-expert", role: "implementer", description: "Implements WebSocket/WebRTC real-time systems" },
  { agent: "mobile-platform-specialist", role: "implementer", description: "Implements native iOS/Android bridges" },
  { agent: "notification-service-specialist", role: "implementer", description: "Implements push notification services" },
  { agent: "i18n-localization-specialist", role: "implementer", description: "Implements multi-language support" },
  { agent: "media-processing-worker", role: "implementer", description: "Implements image/video processing pipelines" },
  { agent: "synthetic-data-generator", role: "implementer", description: "Generates mock test/demo data" },
  { agent: "devops-engineer", role: "implementer", description: "Implements Docker/K8s/CI-CD infrastructure" },
  { agent: "coolify-devops-specialist", role: "implementer", description: "Implements Coolify deployment infrastructure" },

  // ── Architect-Builders ────────────────────────────────────────────────────
  { agent: "nodejs-backend-architect", role: "architect-builder", description: "Designs backend architecture, delegates implementation" },
  { agent: "microservices-architect", role: "architect-builder", description: "Designs distributed system architecture" },
  { agent: "graphql-architect", role: "architect-builder", description: "Designs GraphQL schema and federation" },
  { agent: "security-architect", role: "architect-builder", description: "Designs security hardening and threat models" },
  { agent: "devsecops-pipeline-architect", role: "architect-builder", description: "Designs CI/CD security scanning pipelines" },
  { agent: "self-healing-architect", role: "architect-builder", description: "Designs auto-fix and recovery systems" },
  { agent: "flutter-app-builder", role: "architect-builder", description: "Architects Flutter app structure, delegates to specialists" },
  { agent: "nextjs-website-builder", role: "architect-builder", description: "Architects Next.js full-stack websites" },
  { agent: "api-ecosystem-navigator", role: "architect-builder", description: "Designs third-party API integration architecture" },
  { agent: "api-contract-manager", role: "architect-builder", description: "Designs API contracts and DTO definitions" },

  // ── Reviewer-Auditors ─────────────────────────────────────────────────────
  { agent: "qa-test-engineer", role: "reviewer-auditor", description: "Writes and runs unit/integration/E2E tests" },
  { agent: "accessibility-tester", role: "reviewer-auditor", description: "Audits WCAG 2.1 compliance" },
  { agent: "license-audit-sentinel", role: "reviewer-auditor", description: "Scans dependencies for license violations" },
  { agent: "app-store-review-analyzer", role: "reviewer-auditor", description: "Audits App Store/Play Store submission readiness" },
  { agent: "backend-frontend-scanner", role: "reviewer-auditor", description: "Scans API endpoint integration mismatches" },
  { agent: "performance-specialist", role: "reviewer-auditor", description: "Profiles and verifies performance benchmarks" },
  { agent: "compliance-specialist", role: "reviewer-auditor", description: "Audits GDPR/KVKK/CCPA data compliance" },
  { agent: "seo-technical-specialist", role: "reviewer-auditor", description: "Audits technical SEO meta/structured data" },
  { agent: "refactoring-specialist", role: "reviewer-auditor", description: "Reviews and simplifies code complexity" },
  { agent: "error-recovery-agent", role: "reviewer-auditor", description: "Analyzes runtime failures and crashes" },

  // ── Docs / Research / Context ─────────────────────────────────────────────
  { agent: "librarian", role: "docs-research", description: "Reads docs and finds GitHub examples" },
  { agent: "librarian-tr", role: "docs-research", description: "Turkish-language documentation researcher" },
  { agent: "explore", role: "docs-research", description: "Fast codebase exploration and grep" },
  { agent: "oracle", role: "docs-research", description: "Conventional problem consulting and architecture advice" },
  { agent: "technical-writer-documentarian", role: "docs-research", description: "Writes API docs, READMEs, and user guides" },
  { agent: "ux-motion-designer", role: "docs-research", description: "Designs wireframes and user interaction flows" },
  { agent: "design-translator", role: "docs-research", description: "Translates Figma designs to code specs" },
  { agent: "design-system-guardian", role: "docs-research", description: "Maintains design tokens and UI consistency" },
  { agent: "product-owner", role: "docs-research", description: "Defines user stories and acceptance criteria" },
  { agent: "strategy-analyst", role: "docs-research", description: "Analyzes ROI, priority, and impact matrices" },
  { agent: "assumption-breaker", role: "docs-research", description: "Exposes hidden assumptions and risks" },
  { agent: "system-philosopher", role: "docs-research", description: "Analyzes long-term simplification and architecture" },
  { agent: "release-manager", role: "docs-research", description: "Manages versioning, changelogs, and deploy gates" },
  { agent: "agent-contract-manager", role: "docs-research", description: "Governs agent communication protocols" },
  { agent: "context-manager", role: "docs-research", description: "Manages memory bank and handoff integrity" },
]

// ─── Role Lookup ─────────────────────────────────────────────────────────────

/** Build a Map from agent name → role entry for fast lookup */
const roleMap = new Map<string, AgentRoleEntry>()
for (const entry of AGENT_ROLES) {
  roleMap.set(entry.agent, entry)
}

/**
 * Get the role classification for a given agent.
 * Returns "unknown" if the agent is not in the registry.
 */
export function getAgentRole(agent: string): AgentRole {
  return roleMap.get(agent)?.role ?? "unknown"
}

/**
 * Get the full role entry for a given agent.
 * Returns undefined if the agent is not in the registry.
 */
export function getAgentRoleEntry(agent: string): AgentRoleEntry | undefined {
  return roleMap.get(agent)
}

/**
 * Check whether an agent has a known role (is in the registry).
 */
export function hasKnownRole(agent: string): boolean {
  return roleMap.has(agent)
}

/**
 * Get all agents with a specific role.
 */
export function getAgentsByRole(role: AgentRole): string[] {
  return AGENT_ROLES
    .filter((entry) => entry.role === role)
    .map((entry) => entry.agent)
}

/**
 * Get all known agent role entries.
 */
export function getAllAgentRoles(): AgentRoleEntry[] {
  return [...AGENT_ROLES]
}

/**
 * Validate whether the source agent's role permits a handoff
 * to the given target agent.
 *
 * @param sourceAgent - The agent issuing the handoff
 * @param targetAgent - The target agent (must be a non-routing-directive agent ID)
 * @returns A human-readable violation message, or null if the handoff is permitted
 */
export function validateHandoffTargetByRole(
  sourceAgent: string,
  targetAgent: string,
): string | null {
  const sourceRole = getAgentRole(sourceAgent)
  const targetRole = getAgentRole(targetAgent)

  // unknown role → no policy enforcement
  if (sourceRole === "unknown") return null
  // target unknown → no policy enforcement
  if (targetRole === "unknown") return null

  // ── Orchestrator rule: can hand off to anyone ───────────────────────────
  if (sourceRole === "orchestrator") return null

  // ── Implementer rule: can hand off to any known agent ───────────────────
  if (sourceRole === "implementer") {
    // Implementers can hand off to anyone - no restriction
    return null
  }

  // ── Architect-builder rule: must NOT hand off directly to other architects ──
  if (sourceRole === "architect-builder") {
    if (targetRole === "architect-builder") {
      return `Role policy violation: architect-builder "${sourceAgent}" attempted direct handoff to architect-builder "${targetAgent}". Architect-builders should prefer return_to_parent_for_routing or delegate to implementers/reviewers.`
    }
    // Allowed: architect → implementer, reviewer, orchestrator, docs-research
    return null
  }

  // ── Reviewer-auditor rule: must NOT hand off to implementers ────────────
  if (sourceRole === "reviewer-auditor") {
    if (targetRole === "implementer") {
      return `Role policy violation: reviewer-auditor "${sourceAgent}" attempted direct handoff to implementer "${targetAgent}". Reviewers must use return_to_parent_for_routing instead of directly assigning implementers.`
    }
    // Allowed: reviewer → other reviewers, orchestrator, docs, architects
    return null
  }

  // ── Docs-research rule: must NOT hand off to implementers, only to caller/parent/orchestrator ──
  if (sourceRole === "docs-research") {
    if (targetRole === "implementer") {
      return `Role policy violation: docs-research agent "${sourceAgent}" attempted direct handoff to implementer "${targetAgent}". Docs/research agents must use return_to_parent_for_routing or return_to_caller.`
    }
    // Allowed: docs → orchestrator, reviewer, architect, docs
    return null
  }

  return null
}

/**
 * Build a human-readable summary of the role policy for a given agent.
 */
export function describeRolePolicy(agent: string): string {
  const entry = getAgentRoleEntry(agent)
  if (!entry) return `Agent "${agent}" has no role classification — no handoff policy enforced.`

  switch (entry.role) {
    case "orchestrator":
      return `Agent "${agent}" (orchestrator) — may hand off to any agent without restriction.`
    case "implementer":
      return `Agent "${agent}" (implementer) — may hand off to caller, parent, or any valid next agent.`
    case "architect-builder":
      return `Agent "${agent}" (architect-builder) — should prefer return_to_parent_for_routing. Direct handoff to other architect-builders is forbidden.`
    case "reviewer-auditor":
      return `Agent "${agent}" (reviewer-auditor) — direct handoff to implementers is FORBIDDEN. Must use return_to_parent_for_routing.`
    case "docs-research":
      return `Agent "${agent}" (docs-research) — direct handoff to implementers is FORBIDDEN. Only return_to_caller, return_to_parent_for_routing, or handoff to orchestrator is allowed.`
    default:
      return `Agent "${agent}" has unknown role classification.`
  }
}

/**
 * Identify agents from getKnownAgentIds() that are NOT in the role registry.
 * These are agents with unknown roles and no policy enforcement.
 */
export function findUnclassifiedAgents(): string[] {
  const knownIds = getKnownAgentIds()
  return knownIds.filter((id) => !roleMap.has(id) && id !== "return_to_caller" && id !== "return_to_parent_for_routing")
}

/**
 * Identify role entries that reference agents NOT in getKnownAgentIds().
 * These may be stale entries or planned agents.
 */
export function findOrphanedRoleEntries(): AgentRoleEntry[] {
  const knownIds = new Set(getKnownAgentIds())
  return AGENT_ROLES.filter((entry) => !knownIds.has(entry.agent))
}
