import { describe, expect, it } from "bun:test"
import { HECATEQ_ORCHESTRATOR_POLICY } from "./default"
import { buildHecateqPromptPack } from "./prompt-pack"
import { getHecateqPromptAdapter, hasHecateqPromptAdapter } from "./prompt-adapters"

const baseInput = {
  customAgentRegistrySection: "<custom-agent-registry />",
  taskToolNote: "Use task() for delegation",
  profileDetection: {
    prompt_profile: "auto" as const,
    model: "openai/gpt-5.4",
  },
}

describe("Hecateq prompt pack assembly", () => {
  describe("#given default config with auto/generic", () => {
    it("#then final prompt contains Hecateq God identity", () => {
      const prompt = buildHecateqPromptPack(baseInput)
      expect(prompt).toContain("HECATEQ ORCHESTRATOR POLICY")
      expect(prompt).toContain("You are Hecateq God")
    })

    it("#then final prompt contains runtime truth rules", () => {
      const prompt = buildHecateqPromptPack({
        ...baseInput,
        orchestratorConfig: { model_adapters: { strict_runtime_truth: true } },
      })
      expect(prompt).toContain("RUNTIME TRUTH REINFORCEMENT")
      expect(prompt).toContain("advisory-only, not runtime truth")
    })

    it("#then final prompt contains dependency-gated delegation rules", () => {
      const prompt = buildHecateqPromptPack(baseInput)
      expect(prompt).toContain("Dependency-aware ordering is required")
    })

    it("#then core prompt always present even when adapters disabled", () => {
      const prompt = buildHecateqPromptPack({
        ...baseInput,
        orchestratorConfig: { model_adapters: { enabled: false } },
      })
      expect(prompt).toContain("HECATEQ ORCHESTRATOR POLICY")
      expect(prompt).not.toContain("MODEL-AWARE GUIDANCE")
    })
  })

  describe("#given OpenAI model", () => {
    it("#then appends GPT adapter", () => {
      const prompt = buildHecateqPromptPack({
        ...baseInput,
        profileDetection: {
          prompt_profile: "auto",
          model: "openai/gpt-5.4",
        },
      })
      expect(prompt).toContain("MODEL-AWARE GUIDANCE — GPT")
    })

    it("#then adapter does not duplicate core policy blocks", () => {
      const prompt = buildHecateqPromptPack({
        ...baseInput,
        profileDetection: {
          prompt_profile: "auto",
          model: "openai/gpt-5.4",
        },
      })
      const hecateqCount = (prompt.match(/HECATEQ ORCHESTRATOR POLICY/g) ?? []).length
      expect(hecateqCount).toBe(1)
    })
  })

  describe("#given Claude model", () => {
    it("#then appends Claude adapter", () => {
      const prompt = buildHecateqPromptPack({
        ...baseInput,
        profileDetection: {
          prompt_profile: "auto",
          model: "anthropic/claude-sonnet-4-6",
        },
      })
      expect(prompt).toContain("MODEL-AWARE GUIDANCE — Anthropic Claude")
    })
  })

  describe("#given Gemini model", () => {
    it("#then appends Gemini adapter", () => {
      const prompt = buildHecateqPromptPack({
        ...baseInput,
        profileDetection: {
          prompt_profile: "auto",
          model: "google/gemini-2.0-flash",
        },
      })
      expect(prompt).toContain("MODEL-AWARE GUIDANCE — Google Gemini")
    })
  })

  describe("#given Qwen model", () => {
    it("#then appends Qwen adapter", () => {
      const prompt = buildHecateqPromptPack({
        ...baseInput,
        profileDetection: {
          prompt_profile: "auto",
          model: "dashscope/qwen-plus",
        },
      })
      expect(prompt).toContain("MODEL-AWARE GUIDANCE — Alibaba Qwen")
    })
  })

  describe("#given DeepSeek model", () => {
    it("#then appends DeepSeek adapter", () => {
      const prompt = buildHecateqPromptPack({
        ...baseInput,
        profileDetection: {
          prompt_profile: "auto",
          model: "deepseek/deepseek-r1",
        },
      })
      expect(prompt).toContain("MODEL-AWARE GUIDANCE — DeepSeek")
    })
  })

  describe("#given unknown model", () => {
    it("#then appends Generic adapter", () => {
      const prompt = buildHecateqPromptPack({
        ...baseInput,
        profileDetection: {
          prompt_profile: "auto",
          model: "unknown/random-model",
        },
      })
      expect(prompt).toContain("MODEL-AWARE GUIDANCE — Generic")
    })
  })

  describe("#given explicit small-model profile", () => {
    it("#then appends Small Model adapter", () => {
      const prompt = buildHecateqPromptPack({
        ...baseInput,
        profileDetection: {
          prompt_profile: "small-model",
          model: "anthropic/claude-sonnet",
        },
      })
      expect(prompt).toContain("MODEL-AWARE GUIDANCE — Small")
    })
  })

  describe("#given adapters disabled via config", () => {
    it("#then no adapter block appears", () => {
      const prompt = buildHecateqPromptPack({
        ...baseInput,
        orchestratorConfig: { model_adapters: { enabled: false } },
        profileDetection: {
          prompt_profile: "auto",
          model: "openai/gpt-5.4",
        },
      })
      expect(prompt).not.toContain("MODEL-AWARE GUIDANCE")
    })
  })

  describe("#invariants preserved", () => {
    it("#then final prompt contains agent index advisory-only invariant", () => {
      const prompt = buildHecateqPromptPack(baseInput)
      expect(prompt).toContain("advisory for ranking and selection, not runtime truth")
    })

    it("#then final prompt contains unknown/disabled agent no-call invariant", () => {
      const prompt = buildHecateqPromptPack(baseInput)
      expect(prompt).toContain("Never call unknown or disabled agents")
      expect(prompt).toContain("STATUS: BLOCKED")
    })

    it("#then final prompt contains write/edit denial for orchestrator", () => {
      const prompt = buildHecateqPromptPack(baseInput)
      expect(prompt).toContain("tools are denied at runtime for orchestrator agents")
    })

    it("#then final prompt contains TINY SAFE BRIDGING FIX GATE", () => {
      const prompt = buildHecateqPromptPack(baseInput)
      expect(prompt).toContain("TINY SAFE BRIDGING FIX GATE")
    })

    it("#then final prompt contains DELEGATION-FIRST header", () => {
      const prompt = buildHecateqPromptPack(baseInput)
      expect(prompt).toContain("DELEGATION-FIRST ORCHESTRATION POLICY")
    })
  })

  describe("#given delegationFirst=false", () => {
    it("#then uses SOFTENED DELEGATION POLICY text", () => {
      const prompt = buildHecateqPromptPack({
        ...baseInput,
        delegationFirst: false,
      })
      expect(prompt).toContain("SOFTENED DELEGATION POLICY")
      expect(prompt).not.toContain("DELEGATION-FIRST ORCHESTRATION POLICY")
    })
  })

  describe("#given strict_runtime_truth=false", () => {
    it("#then runtime truth block is absent", () => {
      const prompt = buildHecateqPromptPack({
        ...baseInput,
        orchestratorConfig: {
          model_adapters: { strict_runtime_truth: false },
        },
      })
      expect(prompt).not.toContain("RUNTIME TRUTH REINFORCEMENT")
    })
  })

  describe("#given delegation_bias=conservative", () => {
    it("#then conservative bias block appears", () => {
      const prompt = buildHecateqPromptPack({
        ...baseInput,
        orchestratorConfig: {
          model_adapters: { delegation_bias: "conservative" },
        },
      })
      expect(prompt).toContain("DELEGATION BIAS — CONSERVATIVE")
    })
  })

  describe("#given delegation_bias=expanded", () => {
    it("#then expanded bias block appears", () => {
      const prompt = buildHecateqPromptPack({
        ...baseInput,
        orchestratorConfig: {
          model_adapters: { delegation_bias: "expanded" },
        },
      })
      expect(prompt).toContain("DELEGATION BIAS — EXPANDED")
    })
  })

  describe("#given delegation_bias=balanced (default)", () => {
    it("#then no delegation bias block appears", () => {
      const prompt = buildHecateqPromptPack({
        ...baseInput,
        orchestratorConfig: {
          model_adapters: { delegation_bias: "balanced" },
        },
      })
      expect(prompt).not.toContain("DELEGATION BIAS")
    })

    it("#then core policy is still present", () => {
      const prompt = buildHecateqPromptPack({
        ...baseInput,
      })
      expect(prompt).toContain("HECATEQ ORCHESTRATOR POLICY")
    })
  })

  describe("#given memoryPolicySection provided", () => {
    it("#then includes memory policy in output", () => {
      const prompt = buildHecateqPromptPack({
        ...baseInput,
        memoryPolicySection: "PROJECT-ROOT MEMORY POLICY\n\nTest memory section",
      })
      expect(prompt).toContain("PROJECT-ROOT MEMORY POLICY")
      expect(prompt).toContain("Test memory section")
    })
  })
})

describe("prompt adapters", () => {
  describe("#all adapters exist", () => {
    const profiles = ["generic", "gpt", "claude", "gemini", "qwen", "deepseek", "small-model"] as const

    for (const profile of profiles) {
      it(`#then ${profile} adapter exists and is non-empty`, () => {
        expect(hasHecateqPromptAdapter(profile)).toBe(true)
        const adapter = getHecateqPromptAdapter(profile)
        expect(adapter.length).toBeGreaterThan(10)
      })
    }
  })

  describe("#gpt adapter", () => {
    it("#then contains decision tree language", () => {
      const adapter = getHecateqPromptAdapter("gpt")
      expect(adapter).toContain("decision tree")
    })
  })

  describe("#claude adapter", () => {
    it("#then limits over-planning", () => {
      const adapter = getHecateqPromptAdapter("claude")
      expect(adapter).toContain("over-planning")
    })
  })

  describe("#gemini adapter", () => {
    it("#then contains UNKNOWN/NEEDS_VERIFICATION language", () => {
      const adapter = getHecateqPromptAdapter("gemini")
      expect(adapter).toContain("UNKNOWN")
      expect(adapter).toContain("NEEDS_VERIFICATION")
    })
  })

  describe("#small-model adapter", () => {
    it("#then is shorter than core policy", () => {
      const adapter = getHecateqPromptAdapter("small-model")
      expect(adapter.length).toBeLessThan(HECATEQ_ORCHESTRATOR_POLICY.length)
    })
  })

  describe("#generic adapter", () => {
    it("#then references core policy as authoritative", () => {
      const adapter = getHecateqPromptAdapter("generic")
      expect(adapter).toContain("authoritative guide")
    })
  })
})
