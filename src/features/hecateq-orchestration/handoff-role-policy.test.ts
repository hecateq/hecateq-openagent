import { describe, expect, test } from "bun:test"

import {
  AGENT_ROLES,
  getAgentRole,
  getAgentRoleEntry,
  hasKnownRole,
  getAgentsByRole,
  getAllAgentRoles,
  validateHandoffTargetByRole,
  describeRolePolicy,
  findUnclassifiedAgents,
  findOrphanedRoleEntries,
} from "./handoff-role-policy"
import type { AgentRole } from "./types"

// ─── Registry Structure ──────────────────────────────────────────────────────

describe("AGENT_ROLES registry", () => {
  test("#given registry #then has all 5 role categories represented", () => {
    const roles = new Set(AGENT_ROLES.map((e) => e.role))
    expect(roles.has("orchestrator")).toBe(true)
    expect(roles.has("implementer")).toBe(true)
    expect(roles.has("architect-builder")).toBe(true)
    expect(roles.has("reviewer-auditor")).toBe(true)
    expect(roles.has("docs-research")).toBe(true)
    expect(roles.size).toBe(5)
  })

  test("#given each entry #then has agent, role, and description", () => {
    for (const entry of AGENT_ROLES) {
      expect(typeof entry.agent).toBe("string")
      expect(entry.agent.length).toBeGreaterThan(0)
      expect(["orchestrator", "implementer", "architect-builder", "reviewer-auditor", "docs-research", "unknown"]).toContain(entry.role)
      expect(typeof entry.description).toBe("string")
      expect(entry.description.length).toBeGreaterThan(0)
    }
  })

  test("#given all entries #then agent names are unique", () => {
    const names = AGENT_ROLES.map((e) => e.agent)
    expect(new Set(names).size).toBe(names.length)
  })

  test("#given registry #then contains at least 40 entries", () => {
    expect(AGENT_ROLES.length).toBeGreaterThanOrEqual(40)
  })
})

// ─── getAgentRole ────────────────────────────────────────────────────────────

describe("getAgentRole", () => {
  test("#given registered orchestrator #then returns orchestrator", () => {
    expect(getAgentRole("sisyphus")).toBe("orchestrator")
    expect(getAgentRole("hephaestus")).toBe("orchestrator")
    expect(getAgentRole("prometheus")).toBe("orchestrator")
  })

  test("#given registered implementer #then returns implementer", () => {
    expect(getAgentRole("nodejs-backend-developer")).toBe("implementer")
    expect(getAgentRole("flutter-dart-master")).toBe("implementer")
    expect(getAgentRole("database-specialist")).toBe("implementer")
  })

  test("#given registered architect-builder #then returns architect-builder", () => {
    expect(getAgentRole("nodejs-backend-architect")).toBe("architect-builder")
    expect(getAgentRole("security-architect")).toBe("architect-builder")
  })

  test("#given registered reviewer-auditor #then returns reviewer-auditor", () => {
    expect(getAgentRole("qa-test-engineer")).toBe("reviewer-auditor")
    expect(getAgentRole("accessibility-tester")).toBe("reviewer-auditor")
  })

  test("#given registered docs-research #then returns docs-research", () => {
    expect(getAgentRole("librarian")).toBe("docs-research")
    expect(getAgentRole("technical-writer-documentarian")).toBe("docs-research")
  })

  test("#given unknown agent #then returns unknown", () => {
    expect(getAgentRole("completely-fake-agent")).toBe("unknown")
    expect(getAgentRole("")).toBe("unknown")
    expect(getAgentRole("nonexistent")).toBe("unknown")
  })
})

// ─── getAgentRoleEntry ───────────────────────────────────────────────────────

describe("getAgentRoleEntry", () => {
  test("#given registered agent #then returns full entry", () => {
    const entry = getAgentRoleEntry("sisyphus")
    expect(entry).toBeDefined()
    expect(entry!.agent).toBe("sisyphus")
    expect(entry!.role).toBe("orchestrator")
    expect(typeof entry!.description).toBe("string")
  })

  test("#given unknown agent #then returns undefined", () => {
    expect(getAgentRoleEntry("nonexistent")).toBeUndefined()
  })
})

// ─── hasKnownRole ────────────────────────────────────────────────────────────

describe("hasKnownRole", () => {
  test("#given registered agent #then returns true", () => {
    expect(hasKnownRole("sisyphus")).toBe(true)
    expect(hasKnownRole("qa-test-engineer")).toBe(true)
  })

  test("#given unknown agent #then returns false", () => {
    expect(hasKnownRole("no-such-agent")).toBe(false)
  })
})

// ─── getAgentsByRole ─────────────────────────────────────────────────────────

describe("getAgentsByRole", () => {
  test("#given orchestrator role #then returns all orchestrators", () => {
    const agents = getAgentsByRole("orchestrator")
    expect(agents).toContain("sisyphus")
    expect(agents).toContain("hephaestus")
    expect(agents.length).toBeGreaterThanOrEqual(4)
  })

  test("#given implementer role #then returns all implementers", () => {
    const agents = getAgentsByRole("implementer")
    expect(agents).toContain("nodejs-backend-developer")
    expect(agents).toContain("go-backend-developer")
    expect(agents.length).toBeGreaterThanOrEqual(12)
  })

  test("#given reviewer-auditor role #then returns all reviewers", () => {
    const agents = getAgentsByRole("reviewer-auditor")
    expect(agents).toContain("qa-test-engineer")
    expect(agents).toContain("performance-specialist")
    expect(agents.length).toBeGreaterThanOrEqual(8)
  })

  test("#given docs-research role #then returns all docs agents", () => {
    const agents = getAgentsByRole("docs-research")
    expect(agents).toContain("librarian")
    expect(agents).toContain("technical-writer-documentarian")
    expect(agents.length).toBeGreaterThanOrEqual(10)
  })
})

// ─── validateHandoffTargetByRole ─────────────────────────────────────────────

describe("validateHandoffTargetByRole — orchestrator rules", () => {
  test("#given orchestrator handoff to any target #then no violation", () => {
    expect(validateHandoffTargetByRole("sisyphus", "nodejs-backend-developer")).toBeNull()
    expect(validateHandoffTargetByRole("prometheus", "sisyphus")).toBeNull()
    expect(validateHandoffTargetByRole("hephaestus", "qa-test-engineer")).toBeNull()
    expect(validateHandoffTargetByRole("atlas", "librarian")).toBeNull()
  })

  test("#given orchestrator to implementer #then allowed", () => {
    expect(validateHandoffTargetByRole("sisyphus", "flutter-dart-master")).toBeNull()
  })

  test("#given orchestrator to architect #then allowed", () => {
    expect(validateHandoffTargetByRole("sisyphus", "nodejs-backend-architect")).toBeNull()
  })
})

describe("validateHandoffTargetByRole — implementer rules", () => {
  test("#given implementer handoff to any target #then no violation", () => {
    expect(validateHandoffTargetByRole("nodejs-backend-developer", "qa-test-engineer")).toBeNull()
    expect(validateHandoffTargetByRole("flutter-dart-master", "security-architect")).toBeNull()
    expect(validateHandoffTargetByRole("database-specialist", "sisyphus")).toBeNull()
    expect(validateHandoffTargetByRole("cli-developer", "librarian")).toBeNull()
  })

  test("#given implementer to another implementer #then allowed", () => {
    expect(validateHandoffTargetByRole("nodejs-backend-developer", "flutter-dart-master")).toBeNull()
  })
})

describe("validateHandoffTargetByRole — architect-builder rules", () => {
  test("#given architect-builder to implementer #then allowed", () => {
    expect(validateHandoffTargetByRole("nodejs-backend-architect", "nodejs-backend-developer")).toBeNull()
    expect(validateHandoffTargetByRole("security-architect", "database-specialist")).toBeNull()
  })

  test("#given architect-builder to reviewer #then allowed", () => {
    expect(validateHandoffTargetByRole("nodejs-backend-architect", "qa-test-engineer")).toBeNull()
  })

  test("#given architect-builder to another architect-builder #then violation", () => {
    const violation = validateHandoffTargetByRole("nodejs-backend-architect", "security-architect")
    expect(violation).not.toBeNull()
    expect(violation).toContain("architect-builder")
    expect(violation).toContain("return_to_parent_for_routing")
  })

  test("#given architect-builder to orchestrator #then allowed", () => {
    expect(validateHandoffTargetByRole("microservices-architect", "sisyphus")).toBeNull()
  })

  test("#given architect-builder to docs-research #then allowed", () => {
    expect(validateHandoffTargetByRole("graphql-architect", "librarian")).toBeNull()
  })
})

describe("validateHandoffTargetByRole — reviewer-auditor rules", () => {
  test("#given reviewer to implementer #then violation", () => {
    const violation = validateHandoffTargetByRole("qa-test-engineer", "nodejs-backend-developer")
    expect(violation).not.toBeNull()
    expect(violation).toContain("reviewer-auditor")
    expect(violation).toContain("return_to_parent_for_routing")
  })

  test("#given reviewer to another reviewer #then allowed", () => {
    expect(validateHandoffTargetByRole("qa-test-engineer", "accessibility-tester")).toBeNull()
    expect(validateHandoffTargetByRole("performance-specialist", "compliance-specialist")).toBeNull()
  })

  test("#given reviewer to orchestrator #then allowed", () => {
    expect(validateHandoffTargetByRole("qa-test-engineer", "sisyphus")).toBeNull()
  })

  test("#given reviewer to architect #then allowed", () => {
    expect(validateHandoffTargetByRole("compliance-specialist", "security-architect")).toBeNull()
  })

  test("#given reviewer to docs-research #then allowed", () => {
    expect(validateHandoffTargetByRole("accessibility-tester", "technical-writer-documentarian")).toBeNull()
  })
})

describe("validateHandoffTargetByRole — docs-research rules", () => {
  test("#given docs-research to implementer #then violation", () => {
    const violation = validateHandoffTargetByRole("librarian", "nodejs-backend-developer")
    expect(violation).not.toBeNull()
    expect(violation).toContain("docs-research")
    expect(violation).toContain("return_to_parent_for_routing")
  })

  test("#given docs-research to orchestrator #then allowed", () => {
    expect(validateHandoffTargetByRole("librarian", "sisyphus")).toBeNull()
    expect(validateHandoffTargetByRole("technical-writer-documentarian", "prometheus")).toBeNull()
  })

  test("#given docs-research to reviewer #then allowed", () => {
    expect(validateHandoffTargetByRole("explore", "qa-test-engineer")).toBeNull()
  })

  test("#given docs-research to architect #then allowed", () => {
    expect(validateHandoffTargetByRole("oracle", "security-architect")).toBeNull()
  })

  test("#given docs-research to another docs-research #then allowed", () => {
    expect(validateHandoffTargetByRole("librarian", "technical-writer-documentarian")).toBeNull()
  })
})

describe("validateHandoffTargetByRole — unknown agent edge cases", () => {
  test("#given unknown source agent #then no enforcement", () => {
    expect(validateHandoffTargetByRole("unknown-agent", "nodejs-backend-developer")).toBeNull()
  })

  test("#given handoff to unknown target #then no enforcement", () => {
    expect(validateHandoffTargetByRole("librarian", "no-such-agent")).toBeNull()
  })

  test("#given both unknown #then no enforcement", () => {
    expect(validateHandoffTargetByRole("foo", "bar")).toBeNull()
  })

  test("#given empty source agent string #then returns unknown role", () => {
    expect(validateHandoffTargetByRole("", "nodejs-backend-developer")).toBeNull()
  })
})

// ─── describeRolePolicy ──────────────────────────────────────────────────────

describe("describeRolePolicy", () => {
  test("#given orchestrator #then describes unrestricted handoff", () => {
    const desc = describeRolePolicy("sisyphus")
    expect(desc).toContain("orchestrator")
    expect(desc).toContain("may hand off to any agent")
  })

  test("#given implementer #then describes allowed handoff", () => {
    const desc = describeRolePolicy("nodejs-backend-developer")
    expect(desc).toContain("implementer")
    expect(desc).toContain("may hand off")
  })

  test("#given architect-builder #then describes architect restriction", () => {
    const desc = describeRolePolicy("nodejs-backend-architect")
    expect(desc).toContain("architect-builder")
    expect(desc).toContain("forbidden")
  })

  test("#given reviewer-auditor #then describes reviewer restriction", () => {
    const desc = describeRolePolicy("qa-test-engineer")
    expect(desc).toContain("reviewer-auditor")
    expect(desc).toContain("FORBIDDEN")
  })

  test("#given docs-research #then describes docs restriction", () => {
    const desc = describeRolePolicy("librarian")
    expect(desc).toContain("docs-research")
    expect(desc).toContain("FORBIDDEN")
  })

  test("#given unknown agent #then describes no policy", () => {
    const desc = describeRolePolicy("nonexistent")
    expect(desc).toContain("no role classification")
  })
})

// ─── findUnclassifiedAgents ──────────────────────────────────────────────────

describe("findUnclassifiedAgents", () => {
  test("#given known agent IDs and role registry #then finds unclassified agents", () => {
    const unclassified = findUnclassifiedAgents()
    expect(Array.isArray(unclassified)).toBe(true)
    // All non-routing-directive agents in getKnownAgentIds should ideally be classified,
    // but any that aren't are returned. This is an informative, not a contract test.
    for (const agent of unclassified) {
      expect(agent).not.toBe("return_to_caller")
      expect(agent).not.toBe("return_to_parent_for_routing")
    }
  })
})

// ─── findOrphanedRoleEntries ─────────────────────────────────────────────────

describe("findOrphanedRoleEntries", () => {
  test("#given role entries #then returns entries not in known agent IDs", () => {
    const orphaned = findOrphanedRoleEntries()
    expect(Array.isArray(orphaned)).toBe(true)
    // Entries referencing agents not yet in getKnownAgentIds() are "orphaned".
    // They may represent planned/upcoming agents.
    for (const entry of orphaned) {
      expect(typeof entry.agent).toBe("string")
      expect(typeof entry.role).toBe("string")
    }
  })
})
