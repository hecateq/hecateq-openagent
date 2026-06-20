import { describe, expect, it } from "bun:test"
import { buildCustomAgentRegistrySection, createHecateqOrchestratorAgent } from "./index"
import type { HecateqCustomAgentSummary } from "./agent"

describe("buildCustomAgentRegistrySection", () => {
  // given: empty registry
  describe("#given empty or missing registry", () => {
    it("#then returns empty string for undefined", () => {
      const result = buildCustomAgentRegistrySection(undefined)
      expect(result).toBe("")
    })

    it("#then returns empty string for empty array", () => {
      const result = buildCustomAgentRegistrySection([])
      expect(result).toBe("")
    })
  })

  // given: single agent with all rich fields
  describe("#given single agent with all rich signal fields", () => {
    const summaries: HecateqCustomAgentSummary[] = [
      {
        name: "backend-developer",
        description: "Implements REST APIs with Express and Prisma",
        domain: "backend",
        useWhen: 'routing_signal == "api_implementation"',
        avoidWhen: 'routing_signal == "frontend_work"',
        priority: "high",
        skills: "nodejs-backend-developer",
      },
    ]

    it("#then emits structured XML with all fields", () => {
      const result = buildCustomAgentRegistrySection(summaries)
      expect(result).toContain('<custom-agent-registry>')
      expect(result).toContain('</custom-agent-registry>')
      expect(result).toContain('<custom_agent name="backend-developer">')
      expect(result).toContain("<description>Implements REST APIs with Express and Prisma</description>")
      expect(result).toContain("<domain>backend</domain>")
      expect(result).toContain('<use-when>routing_signal == "api_implementation"</use-when>')
      expect(result).toContain('<avoid-when>routing_signal == "frontend_work"</avoid-when>')
      expect(result).toContain("<priority>high</priority>")
      expect(result).toContain("<skills>nodejs-backend-developer</skills>")
    })
  })

  // given: agent with only name (no optional fields)
  describe("#given agent with only required name field", () => {
    const summaries: HecateqCustomAgentSummary[] = [
      { name: "minimal-agent" },
    ]

    it("#then emits XML with only description tag", () => {
      const result = buildCustomAgentRegistrySection(summaries)
      expect(result).toContain('<custom_agent name="minimal-agent">')
      expect(result).toContain("<description>")
      expect(result).not.toContain("<domain>")
      expect(result).not.toContain("<use-when>")
      expect(result).not.toContain("<avoid-when>")
      expect(result).not.toContain("<priority>")
      expect(result).not.toContain("<skills>")
    })
  })

  // given: agent with some optional fields but not all
  describe("#given agent with partial optional fields", () => {
    const summaries: HecateqCustomAgentSummary[] = [
      {
        name: "partial-agent",
        description: "Specialized worker",
        domain: "devops",
        priority: "medium",
      },
    ]

    it("#then includes populated fields and omits missing fields", () => {
      const result = buildCustomAgentRegistrySection(summaries)
      expect(result).toContain("<domain>devops</domain>")
      expect(result).toContain("<priority>medium</priority>")
      expect(result).not.toContain("<use-when>")
      expect(result).not.toContain("<avoid-when>")
      expect(result).not.toContain("<skills>")
    })
  })

  // given: hidden agent
  describe("#given hidden agent", () => {
    it("#then hidden agent is excluded from output", () => {
      const summaries: HecateqCustomAgentSummary[] = [
        { name: "visible-agent", description: "Available" },
        { name: "hidden-agent", description: "Should not appear", hidden: true },
      ]
      const result = buildCustomAgentRegistrySection(summaries)
      expect(result).toContain("visible-agent")
      expect(result).not.toContain("hidden-agent")
    })
  })

  // given: disabled agent
  describe("#given disabled agent", () => {
    it("#then disabled agent is excluded from output", () => {
      const summaries: HecateqCustomAgentSummary[] = [
        { name: "active-agent", description: "Active" },
        { name: "disabled-agent", description: "Should not appear", disabled: true },
      ]
      const result = buildCustomAgentRegistrySection(summaries)
      expect(result).toContain("active-agent")
      expect(result).not.toContain("disabled-agent")
    })
  })

  // given: description longer than 120 characters
  describe("#given description exceeding 120 characters", () => {
    const longDescription = "This is a very long description that goes on and on and on and on and on and on and on and on and on and on and on and on and on and on and on and on"
    const summaries: HecateqCustomAgentSummary[] = [
      { name: "long-desc-agent", description: longDescription },
    ]

    it("#then description is truncated to 120 characters with ellipsis", () => {
      const result = buildCustomAgentRegistrySection(summaries)
      expect(result).not.toContain(longDescription)
      // truncated length should be 117 + "..." = 120
      const descMatch = result.match(/<description>(.+)<\/description>/)
      expect(descMatch).not.toBeNull()
      if (descMatch) {
        expect(descMatch[1].length).toBe(120)
        expect(descMatch[1]).toEndWith("...")
      }
    })
  })

  // given: description with special characters (pipe normalization)
  describe("#given description containing pipe characters", () => {
    const summaries: HecateqCustomAgentSummary[] = [
      { name: "pipe-agent", description: "Does X | Y | Z operations" },
    ]

    it("#then pipes are normalized to forward slashes", () => {
      const result = buildCustomAgentRegistrySection(summaries)
      expect(result).toContain("Does X / Y / Z operations")
      expect(result).not.toContain("|")
    })
  })

  // given: empty description
  describe("#given empty description", () => {
    const summaries: HecateqCustomAgentSummary[] = [
      { name: "no-desc-agent" },
    ]

    it("#then uses fallback description text", () => {
      const result = buildCustomAgentRegistrySection(summaries)
      expect(result).toContain("<description>No description provided</description>")
    })
  })

  // given: multiple agents under the 12 cap
  describe("#given multiple agents under the cap", () => {
    const summaries: HecateqCustomAgentSummary[] = [
      { name: "agent-alpha", description: "First agent", domain: "backend" },
      { name: "agent-beta", description: "Second agent", domain: "frontend" },
      { name: "agent-gamma", description: "Third agent", domain: "devops" },
    ]

    it("#then all agents are rendered in XML", () => {
      const result = buildCustomAgentRegistrySection(summaries)
      expect(result).toContain('name="agent-alpha"')
      expect(result).toContain('name="agent-beta"')
      expect(result).toContain('name="agent-gamma"')
      // no overflow comment
      expect(result).not.toContain("more exact custom agents")
    })
  })

  // given: more than 12 agents
  describe("#given more than 12 custom agents", () => {
    const summaries: HecateqCustomAgentSummary[] = Array.from(
      { length: 15 },
      (_, i) => ({ name: `agent-${i + 1}`, description: `Agent number ${i + 1}` }),
    )

    it("#then only first 12 are rendered with overflow comment", () => {
      const result = buildCustomAgentRegistrySection(summaries)
      expect(result).toContain('name="agent-1"')
      expect(result).toContain('name="agent-12"')
      expect(result).not.toContain('name="agent-13"')
      expect(result).not.toContain('name="agent-15"')
      expect(result).toContain("and 3 more exact custom agents")
    })
  })

  // given: builtin agent name
  describe("#given agent with builtin name", () => {
    it("#then sisyphus is filtered out", () => {
      const summaries: HecateqCustomAgentSummary[] = [
        { name: "sisyphus", description: "Should be filtered" },
        { name: "custom-agent", description: "Should appear" },
      ]
      const result = buildCustomAgentRegistrySection(summaries)
      expect(result).not.toContain("sisyphus")
      expect(result).toContain("custom-agent")
    })

    it("#then hecateq-orchestrator is filtered out", () => {
      const summaries: HecateqCustomAgentSummary[] = [
        { name: "hecateq-orchestrator", description: "Should be filtered" },
        { name: "custom-agent", description: "Should appear" },
      ]
      const result = buildCustomAgentRegistrySection(summaries)
      expect(result).not.toContain("hecateq-orchestrator")
      expect(result).toContain("custom-agent")
    })
  })

  // given: duplicate agent names
  describe("#given duplicate agent names", () => {
    const summaries: HecateqCustomAgentSummary[] = [
      { name: "dup-agent", description: "First occurrence" },
      { name: "dup-agent", description: "Second occurrence should be deduplicated" },
      { name: "unique-agent", description: "Unique" },
    ]

    it("#then duplicates are deduplicated keeping first occurrence", () => {
      const result = buildCustomAgentRegistrySection(summaries)
      // first occurrence's description should be kept
      expect(result).toContain("First occurrence")
      expect(result).not.toContain("Second occurrence")
      // unique still present
      expect(result).toContain("unique-agent")
      // only two custom_agent blocks
      const agentCount = (result.match(/<custom_agent /g) ?? []).length
      expect(agentCount).toBe(2)
    })
  })

  // given: duplicate names with different casing
  describe("#given duplicate names with different casing", () => {
    const summaries: HecateqCustomAgentSummary[] = [
      { name: "CaseAgent", description: "First" },
      { name: "caseagent", description: "Second" },
    ]

    it("#then duplicates are detected case-insensitively", () => {
      const result = buildCustomAgentRegistrySection(summaries)
      expect(result).toContain("First")
      expect(result).not.toContain("Second")
    })
  })

  // given: empty name after trimming
  describe("#given empty name after trimming", () => {
    const summaries: HecateqCustomAgentSummary[] = [
      { name: "   ", description: "Whitespace name" },
      { name: "valid-agent", description: "Valid" },
    ]

    it("#then whitespace-only name is skipped", () => {
      const result = buildCustomAgentRegistrySection(summaries)
      expect(result).not.toContain("Whitespace name")
      expect(result).toContain("valid-agent")
    })
  })

  // given: registry produces output consumed by prompt pack
  describe("#given output consumed by prompt-pack", () => {
    it("#then output starts with custom-agent-registry opening tag", () => {
      const summaries: HecateqCustomAgentSummary[] = [
        { name: "test", description: "Test agent" },
      ]
      const result = buildCustomAgentRegistrySection(summaries)
      expect(result).toStartWith("<custom-agent-registry>")
    })

    it("#then output ends with custom-agent-registry closing tag", () => {
      const summaries: HecateqCustomAgentSummary[] = [
        { name: "test", description: "Test agent" },
      ]
      const result = buildCustomAgentRegistrySection(summaries)
      expect(result).toEndWith("</custom-agent-registry>")
    })
  })

  // given: empty registry does not break prompt assembly
  describe("#given empty registry integrates with prompt pack", () => {
    it("#then empty string does not cause insertion issues", () => {
      const result = buildCustomAgentRegistrySection([])
      expect(result).toBe("")
    })
  })

  // given: null passed as summaries
  describe("#given null passed as customAgentSummaries", () => {
    it("#then returns empty string", () => {
      // TS type says undefined, but JS runtime may pass null
      const result = buildCustomAgentRegistrySection(null as unknown as HecateqCustomAgentSummary[] | undefined)
      expect(result).toBe("")
    })
  })

  // given: description with special XML characters
  describe("#given description with special XML characters", () => {
    const summaries: HecateqCustomAgentSummary[] = [
      { name: "xml-agent", description: "Handles <input> and <output> types with 100% & coverage" },
    ]

    it("#then special XML chars are preserved as-is (no escaping)", () => {
      const result = buildCustomAgentRegistrySection(summaries)
      // The description content contains these chars verbatim — no escaping applied
      const descMatch = result.match(/<description>(.+)<\/description>/)
      expect(descMatch).not.toBeNull()
      if (descMatch) {
        expect(descMatch[1]).toContain("<input>")
        expect(descMatch[1]).toContain("<output>")
        expect(descMatch[1]).toContain("& coverage")
      }
    })
  })

  // given: description with newlines
  describe("#given description containing newlines", () => {
    const summaries: HecateqCustomAgentSummary[] = [
      { name: "newline-agent", description: "Handles\nmulti-line\ndescriptions" },
    ]

    it("#then newlines are collapsed to spaces by summarizeDescription", () => {
      const result = buildCustomAgentRegistrySection(summaries)
      // The description content itself should have no newlines (collapsed to spaces)
      const descMatch = result.match(/<description>(.+)<\/description>/)
      expect(descMatch).not.toBeNull()
      if (descMatch) {
        expect(descMatch[1]).toBe("Handles multi-line descriptions")
        expect(descMatch[1]).not.toContain("\n")
      }
    })
  })

  // given: description exactly 120 characters
  describe("#given description exactly 120 characters", () => {
    const exact120 = "A".repeat(120)
    const summaries: HecateqCustomAgentSummary[] = [
      { name: "exact-120-agent", description: exact120 },
    ]

    it("#then description is not truncated", () => {
      const result = buildCustomAgentRegistrySection(summaries)
      expect(result).toContain(exact120)
      expect(result).not.toContain("...")
    })
  })

  // given: description exactly 121 characters
  describe("#given description exactly 121 characters", () => {
    const long121 = "A".repeat(121)
    const summaries: HecateqCustomAgentSummary[] = [
      { name: "exact-121-agent", description: long121 },
    ]

    it("#then description is truncated to 120 characters with ellipsis", () => {
      const result = buildCustomAgentRegistrySection(summaries)
      expect(result).not.toContain(long121)
      const descMatch = result.match(/<description>(.+)<\/description>/)
      expect(descMatch).not.toBeNull()
      if (descMatch) {
        expect(descMatch[1].length).toBe(120)
        expect(descMatch[1]).toEndWith("...")
        // only first 117 chars of the original plus "..."
        expect(descMatch[1]).toBe(`${"A".repeat(117)}...`)
      }
    })
  })

  // given: description with empty string
  describe("#given description with empty string", () => {
    const summaries: HecateqCustomAgentSummary[] = [
      { name: "empty-desc-agent", description: "" },
    ]

    it("#then falls back to 'No description provided'", () => {
      const result = buildCustomAgentRegistrySection(summaries)
      expect(result).toContain("No description provided")
    })
  })

  // given: description with only whitespace
  describe("#given description with only whitespace characters", () => {
    const summaries: HecateqCustomAgentSummary[] = [
      { name: "whitespace-desc-agent", description: "   \t\n  " },
    ]

    it("#then does not crash and falls back to 'No description provided'", () => {
      const result = buildCustomAgentRegistrySection(summaries)
      expect(result).toContain("No description provided")
    })
  })

  // given: builtin agent name with case variations
  describe("#given agent with builtin name in different case", () => {
    it("#then Sisyphus (capitalized) is filtered out", () => {
      const summaries: HecateqCustomAgentSummary[] = [
        { name: "Sisyphus", description: "Capitalized builtin" },
        { name: "my-agent", description: "Real custom agent" },
      ]
      const result = buildCustomAgentRegistrySection(summaries)
      expect(result).not.toContain("Sisyphus")
      expect(result).toContain("my-agent")
    })

    it("#then HECATEQ-ORCHESTRATOR (uppercase) is filtered out", () => {
      const summaries: HecateqCustomAgentSummary[] = [
        { name: "HECATEQ-ORCHESTRATOR", description: "Uppercase builtin" },
        { name: "my-agent", description: "Real custom agent" },
      ]
      const result = buildCustomAgentRegistrySection(summaries)
      expect(result).not.toContain("HECATEQ-ORCHESTRATOR")
      expect(result).toContain("my-agent")
    })

    it("#then OpenCode-Builder (exact case from schema) is filtered out", () => {
      const summaries: HecateqCustomAgentSummary[] = [
        { name: "OpenCode-Builder", description: "Exact case builtin" },
      ]
      const result = buildCustomAgentRegistrySection(summaries)
      expect(result).not.toContain("OpenCode-Builder")
      expect(result).toBe("")
    })
  })

  // given: agent name with leading/trailing whitespace
  describe("#given agent name with leading and trailing whitespace", () => {
    const summaries: HecateqCustomAgentSummary[] = [
      { name: "  padded-agent  ", description: "Has leading/trailing spaces" },
    ]

    it("#then whitespace is trimmed for normalization and agent is included", () => {
      const result = buildCustomAgentRegistrySection(summaries)
      // The name in XML output uses the original un-trimmed value
      expect(result).toContain('name="  padded-agent  "')
      expect(result).toContain("Has leading/trailing spaces")
    })
  })
})

// ─── End-to-end via createHecateqOrchestratorAgent() ──────────────────────

function getPrompt(
  model: string,
  customAgentSummaries?: HecateqCustomAgentSummary[],
): string {
  const agent = createHecateqOrchestratorAgent(
    model,
    undefined, undefined, undefined, undefined,
    customAgentSummaries,
  )
  // Factory always sets prompt; non-null assertion is safe here.
  return agent.prompt!
}

describe("createHecateqOrchestratorAgent end-to-end registry integration", () => {
  const model = "openai/gpt-5.4"

  // given: all fields populated in customAgentSummaries
  describe("#given all registry fields populated", () => {
    const summaries: HecateqCustomAgentSummary[] = [
      {
        name: "backend-dev",
        description: "Builds REST APIs",
        domain: "backend",
        useWhen: "api work",
        avoidWhen: "frontend work",
        priority: "high",
        skills: "nodejs-backend-developer",
      },
    ]

    it("#then agent prompt includes the rich XML registry block", () => {
      const prompt = getPrompt(model, summaries)
      expect(prompt).toContain("<custom-agent-registry>")
      expect(prompt).toContain('</custom-agent-registry>')
      expect(prompt).toContain('<custom_agent name="backend-dev">')
      expect(prompt).toContain("<domain>backend</domain>")
      expect(prompt).toContain("<priority>high</priority>")
      expect(prompt).toContain("<skills>nodejs-backend-developer</skills>")
    })
  })

  // given: no custom agent summaries
  // Note: the policy text mentions "<custom-agent-registry>" inline as a reference
  // (e.g. "Prefer exact custom agents from <custom-agent-registry> before any generic fallback").
  // So we check for the closing tag </custom-agent-registry> which only appears from actual output.
  describe("#given no custom agent summaries", () => {
    it("#then prompt does NOT include </custom-agent-registry> block for undefined", () => {
      const prompt = getPrompt(model)
      expect(prompt).not.toContain("</custom-agent-registry>")
    })

    it("#then prompt does NOT include </custom-agent-registry> block for empty array", () => {
      const prompt = getPrompt(model, [])
      expect(prompt).not.toContain("</custom-agent-registry>")
    })
  })

  // given: hidden agents in summaries
  describe("#given hidden agents in summaries", () => {
    const summaries: HecateqCustomAgentSummary[] = [
      { name: "visible-agent", description: "Should appear" },
      { name: "hidden-agent", description: "Should not appear", hidden: true },
    ]

    it("#then hidden agents are excluded from prompt", () => {
      const prompt = getPrompt(model, summaries)
      expect(prompt).toContain("visible-agent")
      expect(prompt).not.toContain("hidden-agent")
    })
  })

  // given: builtin agent names in summaries
  // Note: the policy text references these names inline (e.g. "hecateq-orchestrator" appears
  // in "Do not delegate to yourself (hecateq-orchestrator) via task()"). So we check that
  // they don't appear as XML registry entries, not that they never appear in the prompt at all.
  describe("#given builtin agent names in summaries", () => {
    const summaries: HecateqCustomAgentSummary[] = [
      { name: "sisyphus", description: "Builtin" },
      { name: "hephaestus", description: "Builtin" },
      { name: "hecateq-orchestrator", description: "Self" },
      { name: "custom-agent", description: "Real custom agent" },
    ]

    it("#then builtin agents are excluded from registry XML in prompt", () => {
      const prompt = getPrompt(model, summaries)
      // Builtin names should not appear as <custom_agent> entries
      expect(prompt).not.toContain('<custom_agent name="sisyphus">')
      expect(prompt).not.toContain('<custom_agent name="hephaestus">')
      expect(prompt).not.toContain('<custom_agent name="hecateq-orchestrator">')
      // Custom (non-builtin) agent should appear
      expect(prompt).toContain('<custom_agent name="custom-agent">')
    })
  })

  // given: more than 12 custom agents
  describe("#given more than 12 custom agents", () => {
    const summaries: HecateqCustomAgentSummary[] = Array.from(
      { length: 15 },
      (_, i) => ({ name: `agent-${i + 1}`, description: `Agent number ${i + 1}` }),
    )

    it("#then prompt caps at 12 with overflow note", () => {
      const prompt = getPrompt(model, summaries)
      expect(prompt).toContain('name="agent-1"')
      expect(prompt).toContain('name="agent-12"')
      expect(prompt).not.toContain('name="agent-13"')
      expect(prompt).not.toContain('name="agent-15"')
      expect(prompt).toContain("and 3 more exact custom agents")
    })
  })
})

// ─── Prompt integration section ordering ──────────────────────────────────

describe("prompt integration section ordering via createHecateqOrchestratorAgent()", () => {
  const model = "openai/gpt-5.4"
  const summaries: HecateqCustomAgentSummary[] = [
    { name: "test-agent", description: "Test agent for ordering checks" },
  ]

  it("#then prompt includes the registry section when summaries provided", () => {
    const prompt = getPrompt(model, summaries)
    expect(prompt).toContain("<custom-agent-registry>")
    expect(prompt).toContain('name="test-agent"')
  })

  it("#then registry section comes after the agent identity section", () => {
    const prompt = getPrompt(model, summaries)
    const identityIndex = prompt.indexOf("<agent-identity>")
    const registryIndex = prompt.indexOf("<custom-agent-registry>")
    expect(identityIndex).toBeGreaterThanOrEqual(0)
    expect(registryIndex).toBeGreaterThan(identityIndex)
  })

  it("#then registry section comes before the handoff protocol section", () => {
    const prompt = getPrompt(model, summaries)
    const registryIndex = prompt.indexOf("<custom-agent-registry>")
    const handoffIndex = prompt.indexOf("HANDOFF PROTOCOL")
    expect(registryIndex).toBeGreaterThanOrEqual(0)
    expect(handoffIndex).toBeGreaterThan(registryIndex)
  })
})
