/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import {
  AgentOverrideConfigSchema,
  BrowserAutomationConfigSchema,
  BrowserAutomationProviderSchema,
  BuiltinCategoryNameSchema,
  CategoryConfigSchema,
  ExperimentalConfigSchema,
  GitMasterConfigSchema,
  HookNameSchema,
  OhMyOpenCodeConfigSchema,
} from "./schema"

describe("disabled_mcps schema", () => {
  test("should accept built-in MCP names", () => {
    // given
    const config = {
      disabled_mcps: ["context7", "grep_app"],
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.disabled_mcps).toEqual(["context7", "grep_app"])
    }
  })

  test("should accept custom MCP names", () => {
    // given
    const config = {
      disabled_mcps: ["playwright", "sqlite", "custom-mcp"],
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.disabled_mcps).toEqual(["playwright", "sqlite", "custom-mcp"])
    }
  })

  test("should accept mixed built-in and custom names", () => {
    // given
    const config = {
      disabled_mcps: ["context7", "playwright", "custom-server"],
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.disabled_mcps).toEqual(["context7", "playwright", "custom-server"])
    }
  })

  test("should accept empty array", () => {
    // given
    const config = {
      disabled_mcps: [],
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.disabled_mcps).toEqual([])
    }
  })

  test("should reject non-string values", () => {
    // given
    const config = {
      disabled_mcps: [123, true, null],
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(false)
  })

  test("should accept undefined (optional field)", () => {
    // given
    const config = {}

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.disabled_mcps).toBeUndefined()
    }
  })

  test("should reject empty strings", () => {
    // given
    const config = {
      disabled_mcps: [""],
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(false)
  })

  test("should accept MCP names with various naming patterns", () => {
    // given
    const config = {
      disabled_mcps: [
        "my-custom-mcp",
        "my_custom_mcp",
        "myCustomMcp",
        "my.custom.mcp",
        "my-custom-mcp-123",
      ],
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.disabled_mcps).toEqual([
        "my-custom-mcp",
        "my_custom_mcp",
        "myCustomMcp",
        "my.custom.mcp",
        "my-custom-mcp-123",
      ])
    }
  })
})

describe("hecateq config schema", () => {
  test("provides default hecateq values with compact context injection", () => {
    const result = OhMyOpenCodeConfigSchema.parse({})

    expect(result.hecateq.enabled).toBe(true)
    expect(result.hecateq.context_injection).toEqual({
      enabled: true,
      mode: "compact",
      manifest_first: true,
      max_memory_file_chars: 500,
      max_total_chars: 2500,
      max_artifact_files: 5,
      include_contracts: true,
      include_task_graphs: true,
      include_agent_index: true,
      max_agent_domains: 8,
      max_agents_per_domain: 5,
      inject_on_subagents: false,
      hecateq_only: true,
    })
    expect(result.hecateq.agent_index).toEqual({
      enabled: true,
      enrich_runtime_agents: true,
      use_for_suggestions: true,
      require_fresh: false,
      fallback_to_runtime_only: true,
      max_suggestions: 10,
    })
    expect(result.hecateq.git_checkpoint).toEqual({
      enabled: true,
      mode: "suggest",
      auto_checkpoint_clean_repo: false,
      checkpoint_message: "chore: checkpoint before hecateq task",
      include_status_in_context: true,
      include_dirty_file_list: false,
      include_dirty_file_count: true,
      max_dirty_files: 10,
      block_destructive_git: true,
    })
    expect(result.hecateq.orchestrator).toEqual({
      delegation_first: true,
      deny_write_tools: true,
    })
  })

  test("accepts compact expanded and off context injection modes", () => {
    for (const mode of ["compact", "expanded", "off"] as const) {
      const result = OhMyOpenCodeConfigSchema.safeParse({
        hecateq: {
          context_injection: { mode },
        },
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.hecateq.context_injection.mode).toBe(mode)
      }
    }
  })

  test("accepts nested hecateq config overrides", () => {
    const result = OhMyOpenCodeConfigSchema.safeParse({
      hecateq: {
        enabled: false,
        context_injection: {
          enabled: false,
          mode: "expanded",
          max_memory_file_chars: 123,
          max_total_chars: 456,
          max_artifact_files: 7,
          include_contracts: false,
          include_task_graphs: false,
          include_agent_index: false,
          max_agent_domains: 3,
          max_agents_per_domain: 2,
          inject_on_subagents: true,
          hecateq_only: false,
        },
        agent_index: {
          enabled: true,
          enrich_runtime_agents: false,
          use_for_suggestions: false,
          require_fresh: true,
          fallback_to_runtime_only: true,
          max_suggestions: 4,
        },
        git_checkpoint: {
          enabled: true,
          mode: "auto_clean_only",
          auto_checkpoint_clean_repo: true,
          checkpoint_message: "custom checkpoint",
          include_status_in_context: false,
          include_dirty_file_list: false,
          include_dirty_file_count: false,
          max_dirty_files: 7,
          block_destructive_git: false,
        },
      },
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.hecateq.enabled).toBe(false)
      expect(result.data.hecateq.context_injection.mode).toBe("expanded")
      expect(result.data.hecateq.context_injection.max_memory_file_chars).toBe(123)
      expect(result.data.hecateq.context_injection.max_total_chars).toBe(456)
      expect(result.data.hecateq.context_injection.max_artifact_files).toBe(7)
      expect(result.data.hecateq.context_injection.include_contracts).toBe(false)
      expect(result.data.hecateq.context_injection.include_task_graphs).toBe(false)
      expect(result.data.hecateq.context_injection.include_agent_index).toBe(false)
      expect(result.data.hecateq.context_injection.max_agent_domains).toBe(3)
      expect(result.data.hecateq.context_injection.max_agents_per_domain).toBe(2)
      expect(result.data.hecateq.context_injection.inject_on_subagents).toBe(true)
      expect(result.data.hecateq.context_injection.hecateq_only).toBe(false)
      expect(result.data.hecateq.agent_index).toEqual({
        enabled: true,
        enrich_runtime_agents: false,
        use_for_suggestions: false,
        require_fresh: true,
        fallback_to_runtime_only: true,
        max_suggestions: 4,
      })
      expect(result.data.hecateq.git_checkpoint.mode).toBe("auto_clean_only")
      expect(result.data.hecateq.git_checkpoint.auto_checkpoint_clean_repo).toBe(true)
      expect(result.data.hecateq.git_checkpoint.checkpoint_message).toBe("custom checkpoint")
      expect(result.data.hecateq.git_checkpoint.include_status_in_context).toBe(false)
      expect(result.data.hecateq.git_checkpoint.include_dirty_file_list).toBe(false)
      expect(result.data.hecateq.git_checkpoint.include_dirty_file_count).toBe(false)
      expect(result.data.hecateq.git_checkpoint.max_dirty_files).toBe(7)
      expect(result.data.hecateq.git_checkpoint.block_destructive_git).toBe(false)
    }
  })

  test("rejects invalid negative hecateq context injection values", () => {
    const result = OhMyOpenCodeConfigSchema.safeParse({
      hecateq: {
        context_injection: {
          max_memory_file_chars: -1,
        },
      },
    })

    expect(result.success).toBe(false)
  })

  test("rejects invalid git checkpoint mode", () => {
    const result = OhMyOpenCodeConfigSchema.safeParse({
      hecateq: {
        git_checkpoint: {
          mode: "always",
        },
      },
    })

    expect(result.success).toBe(false)
  })

  test("rejects invalid context injection mode", () => {
    const result = OhMyOpenCodeConfigSchema.safeParse({
      hecateq: {
        context_injection: {
          mode: "verbose",
        },
      },
    })

    expect(result.success).toBe(false)
  })

  test("rejects negative git checkpoint dirty file limits", () => {
    const result = OhMyOpenCodeConfigSchema.safeParse({
      hecateq: {
        git_checkpoint: {
          max_dirty_files: -1,
        },
      },
    })

    expect(result.success).toBe(false)
  })

  test("rejects invalid agent index max_suggestions", () => {
    const result = OhMyOpenCodeConfigSchema.safeParse({
      hecateq: {
        agent_index: {
          max_suggestions: 0,
        },
      },
    })

    expect(result.success).toBe(false)
  })
})

describe("OhMyOpenCodeConfigSchema - model_capabilities", () => {
  test("accepts valid model capabilities config", () => {
    const input = {
      model_capabilities: {
        enabled: true,
        auto_refresh_on_start: true,
        refresh_timeout_ms: 5000,
        source_url: "https://models.dev/api.json",
      },
    }

    const result = OhMyOpenCodeConfigSchema.safeParse(input)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.model_capabilities).toEqual(input.model_capabilities)
    }
  })

  test("rejects invalid model capabilities config", () => {
    const result = OhMyOpenCodeConfigSchema.safeParse({
      model_capabilities: {
        refresh_timeout_ms: -1,
        source_url: "not-a-url",
      },
    })

    expect(result.success).toBe(false)
  })
})

describe("AgentOverrideConfigSchema", () => {
  describe("category field", () => {
    test("accepts category as optional string", () => {
      // given
      const config = { category: "visual-engineering" }

      // when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // then
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.category).toBe("visual-engineering")
      }
    })

    test("accepts config without category", () => {
      // given
      const config = { temperature: 0.5 }

      // when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // then
      expect(result.success).toBe(true)
    })

    test("rejects non-string category", () => {
      // given
      const config = { category: 123 }

      // when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // then
      expect(result.success).toBe(false)
    })
  })

  describe("variant field", () => {
    test("accepts variant as optional string", () => {
      // given
      const config = { variant: "high" }

      // when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // then
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.variant).toBe("high")
      }
    })

    test("rejects non-string variant", () => {
      // given
      const config = { variant: 123 }

      // when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // then
      expect(result.success).toBe(false)
    })
  })

  describe("skills field", () => {
    test("accepts skills as optional string array", () => {
      // given
      const config = { skills: ["frontend-ui-ux", "code-reviewer"] }

      // when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // then
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.skills).toEqual(["frontend-ui-ux", "code-reviewer"])
      }
    })

    test("accepts empty skills array", () => {
      // given
      const config = { skills: [] }

      // when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // then
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.skills).toEqual([])
      }
    })

    test("accepts config without skills", () => {
      // given
      const config = { temperature: 0.5 }

      // when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // then
      expect(result.success).toBe(true)
    })

    test("rejects non-array skills", () => {
      // given
      const config = { skills: "frontend-ui-ux" }

      // when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // then
      expect(result.success).toBe(false)
    })
  })

  describe("backward compatibility", () => {
    test("still accepts model field (deprecated)", () => {
      // given
      const config = { model: "openai/gpt-5.4" }

      // when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // then
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.model).toBe("openai/gpt-5.4")
      }
    })

    test("accepts both model and category (deprecated usage)", () => {
      // given - category should take precedence at runtime, but both should validate
      const config = { 
        model: "openai/gpt-5.4",
        category: "ultrabrain"
      }

      // when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // then
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.model).toBe("openai/gpt-5.4")
        expect(result.data.category).toBe("ultrabrain")
      }
    })
  })

  describe("combined fields", () => {
    test("accepts category with skills", () => {
      // given
      const config = { 
        category: "visual-engineering",
        skills: ["frontend-ui-ux"]
      }

      // when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // then
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.category).toBe("visual-engineering")
        expect(result.data.skills).toEqual(["frontend-ui-ux"])
      }
    })

    test("accepts category with skills and other fields", () => {
      // given
      const config = { 
        category: "ultrabrain",
        skills: ["code-reviewer"],
        temperature: 0.3,
        prompt_append: "Extra instructions"
      }

      // when
      const result = AgentOverrideConfigSchema.safeParse(config)

      // then
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.category).toBe("ultrabrain")
        expect(result.data.skills).toEqual(["code-reviewer"])
        expect(result.data.temperature).toBe(0.3)
        expect(result.data.prompt_append).toBe("Extra instructions")
      }
    })
  })
})

describe("CategoryConfigSchema", () => {
  test("accepts variant as optional string", () => {
    // given
    const config = { model: "openai/gpt-5.4", variant: "xhigh" }

    // when
    const result = CategoryConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.variant).toBe("xhigh")
    }
  })

  test("accepts reasoningEffort as optional string with xhigh", () => {
    // given
    const config = { reasoningEffort: "xhigh" }

    // when
    const result = CategoryConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.reasoningEffort).toBe("xhigh")
    }
  })

  test("accepts reasoningEffort values none and minimal", () => {
    // given
    const noneConfig = { reasoningEffort: "none" }
    const minimalConfig = { reasoningEffort: "minimal" }

    // when
    const noneResult = CategoryConfigSchema.safeParse(noneConfig)
    const minimalResult = CategoryConfigSchema.safeParse(minimalConfig)

    // then
    expect(noneResult.success).toBe(true)
    expect(minimalResult.success).toBe(true)
    if (noneResult.success) {
      expect(noneResult.data.reasoningEffort).toBe("none")
    }
    if (minimalResult.success) {
      expect(minimalResult.data.reasoningEffort).toBe("minimal")
    }
  })

  test("rejects non-string variant", () => {
    // given
    const config = { model: "openai/gpt-5.4", variant: 123 }

    // when
    const result = CategoryConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(false)
  })
})

describe("BuiltinCategoryNameSchema", () => {
  test("accepts all builtin category names", () => {
    // given
    const categories = ["visual-engineering", "ultrabrain", "artistry", "quick", "unspecified-low", "unspecified-high", "writing"]

    // when / #then
    for (const cat of categories) {
      const result = BuiltinCategoryNameSchema.safeParse(cat)
      expect(result.success).toBe(true)
    }
  })
})

describe("HookNameSchema", () => {
  test("accepts hecateq-memory-bootstrap hook name", () => {
    //#given
    const input = "hecateq-memory-bootstrap"

    //#when
    const result = HookNameSchema.safeParse(input)

    //#then
    expect(result.success).toBe(true)
  })

  test("accepts hecateq-project-context-injector hook name", () => {
    //#given
    const input = "hecateq-project-context-injector"

    //#when
    const result = HookNameSchema.safeParse(input)

    //#then
    expect(result.success).toBe(true)
  })

  test("rejects removed beast-mode-system hook name", () => {
    //#given
    const input = "beast-mode-system"

    //#when
    const result = HookNameSchema.safeParse(input)

    //#then
    expect(result.success).toBe(false)
  })

  test("rejects removed delegate-task-english-directive hook name", () => {
    //#given
    const input = "delegate-task-english-directive"

    //#when
    const result = HookNameSchema.safeParse(input)

    //#then
    expect(result.success).toBe(false)
  })
})

describe("Sisyphus-Junior agent override", () => {
  test("schema accepts agents['Sisyphus-Junior'] and retains the key after parsing", () => {
    // given
    const config = {
      agents: {
        "sisyphus-junior": {
          model: "openai/gpt-5.4",
          temperature: 0.2,
        },
      },
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.agents?.["sisyphus-junior"]).toBeDefined()
      expect(result.data.agents?.["sisyphus-junior"]?.model).toBe("openai/gpt-5.4")
      expect(result.data.agents?.["sisyphus-junior"]?.temperature).toBe(0.2)
    }
  })

  test("schema accepts sisyphus-junior with prompt_append", () => {
    // given
    const config = {
      agents: {
        "sisyphus-junior": {
          prompt_append: "Additional instructions for sisyphus-junior",
        },
      },
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.agents?.["sisyphus-junior"]?.prompt_append).toBe(
        "Additional instructions for sisyphus-junior"
      )
    }
  })

  test("schema accepts sisyphus-junior with tools override", () => {
    // given
    const config = {
      agents: {
        "sisyphus-junior": {
          tools: {
            read: true,
            write: false,
          },
        },
      },
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.agents?.["sisyphus-junior"]?.tools).toEqual({
        read: true,
        write: false,
      })
    }
  })

  test("schema accepts lowercase agent names (sisyphus, atlas, prometheus)", () => {
    // given
    const config = {
      agents: {
        sisyphus: {
          temperature: 0.1,
        },
        atlas: {
          temperature: 0.2,
        },
        prometheus: {
          temperature: 0.3,
        },
      },
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.agents?.sisyphus?.temperature).toBe(0.1)
      expect(result.data.agents?.atlas?.temperature).toBe(0.2)
      expect(result.data.agents?.prometheus?.temperature).toBe(0.3)
    }
  })

  test("schema accepts lowercase metis and momus agent names", () => {
    // given
    const config = {
      agents: {
        metis: {
          category: "ultrabrain",
        },
        momus: {
          category: "quick",
        },
      },
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.agents?.metis?.category).toBe("ultrabrain")
      expect(result.data.agents?.momus?.category).toBe("quick")
    }
  })
})

describe("BrowserAutomationProviderSchema", () => {
  test("accepts 'playwright' as valid provider", () => {
    // given
    const input = "playwright"

    // when
    const result = BrowserAutomationProviderSchema.safeParse(input)

    // then
    expect(result.success).toBe(true)
    expect(result.data).toBe("playwright")
  })

  test("accepts 'agent-browser' as valid provider", () => {
    // given
    const input = "agent-browser"

    // when
    const result = BrowserAutomationProviderSchema.safeParse(input)

    // then
    expect(result.success).toBe(true)
    expect(result.data).toBe("agent-browser")
  })

  test("rejects invalid provider", () => {
    // given
    const input = "invalid-provider"

    // when
    const result = BrowserAutomationProviderSchema.safeParse(input)

    // then
    expect(result.success).toBe(false)
  })

  test("accepts 'playwright-cli' as valid provider", () => {
    // given
    const input = "playwright-cli"

    // when
    const result = BrowserAutomationProviderSchema.safeParse(input)

    // then
    expect(result.success).toBe(true)
    expect(result.data).toBe("playwright-cli")
  })
})

describe("BrowserAutomationConfigSchema", () => {
  test("defaults provider to 'playwright' when not specified", () => {
    // given
    const input = {}

    // when
    const result = BrowserAutomationConfigSchema.parse(input)

    // then
    expect(result.provider).toBe("playwright")
  })

  test("accepts agent-browser provider", () => {
    // given
    const input = { provider: "agent-browser" }

    // when
    const result = BrowserAutomationConfigSchema.parse(input)

    // then
    expect(result.provider).toBe("agent-browser")
  })

  test("accepts playwright-cli provider in config", () => {
    // given
    const input = { provider: "playwright-cli" }

    // when
    const result = BrowserAutomationConfigSchema.parse(input)

    // then
    expect(result.provider).toBe("playwright-cli")
  })
})

describe("OhMyOpenCodeConfigSchema - browser_automation_engine", () => {
  test("accepts browser_automation_engine config", () => {
    // given
    const input = {
      browser_automation_engine: {
        provider: "agent-browser",
      },
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(input)

    // then
    expect(result.success).toBe(true)
    expect(result.data?.browser_automation_engine?.provider).toBe("agent-browser")
  })

  test("accepts config without browser_automation_engine", () => {
    // given
    const input = {}

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(input)

    // then
    expect(result.success).toBe(true)
    expect(result.data?.browser_automation_engine).toBeUndefined()
  })

  test("accepts browser_automation_engine with playwright-cli", () => {
    // given
    const input = { browser_automation_engine: { provider: "playwright-cli" } }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(input)

    // then
    expect(result.success).toBe(true)
    expect(result.data?.browser_automation_engine?.provider).toBe("playwright-cli")
  })
})

describe("OhMyOpenCodeConfigSchema - hashline_edit", () => {
  test("accepts hashline_edit as true", () => {
    //#given
    const input = { hashline_edit: true }

    //#when
    const result = OhMyOpenCodeConfigSchema.safeParse(input)

    //#then
    expect(result.success).toBe(true)
    expect(result.data?.hashline_edit).toBe(true)
  })

  test("accepts hashline_edit as false", () => {
    //#given
    const input = { hashline_edit: false }

    //#when
    const result = OhMyOpenCodeConfigSchema.safeParse(input)

    //#then
    expect(result.success).toBe(true)
    expect(result.data?.hashline_edit).toBe(false)
  })

  test("hashline_edit is optional", () => {
    //#given
    const input = { auto_update: true }

    //#when
    const result = OhMyOpenCodeConfigSchema.safeParse(input)

    //#then
    expect(result.success).toBe(true)
    expect(result.data?.hashline_edit).toBeUndefined()
  })

  test("rejects non-boolean hashline_edit", () => {
    //#given
    const input = { hashline_edit: "true" }

    //#when
    const result = OhMyOpenCodeConfigSchema.safeParse(input)

    //#then
    expect(result.success).toBe(false)
  })
})

describe("ExperimentalConfigSchema feature flags", () => {
  test("accepts plugin_load_timeout_ms as number", () => {
    //#given
    const config = { plugin_load_timeout_ms: 5000 }

    //#when
    const result = ExperimentalConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.plugin_load_timeout_ms).toBe(5000)
    }
  })

  test("rejects plugin_load_timeout_ms below 1000", () => {
    //#given
    const config = { plugin_load_timeout_ms: 500 }

    //#when
    const result = ExperimentalConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(false)
  })

  test("accepts safe_hook_creation as boolean", () => {
    //#given
    const config = { safe_hook_creation: false }

    //#when
    const result = ExperimentalConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.safe_hook_creation).toBe(false)
    }
  })

  test("both fields are optional", () => {
    //#given
    const config = {}

    //#when
    const result = ExperimentalConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.plugin_load_timeout_ms).toBeUndefined()
      expect(result.data.safe_hook_creation).toBeUndefined()
    }
  })

  test("accepts disable_omo_env as true", () => {
    //#given
    const config = { disable_omo_env: true }

    //#when
    const result = ExperimentalConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.disable_omo_env).toBe(true)
    }
  })

  test("accepts disable_omo_env as false", () => {
    //#given
    const config = { disable_omo_env: false }

    //#when
    const result = ExperimentalConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.disable_omo_env).toBe(false)
    }
  })

  test("disable_omo_env is optional", () => {
    //#given
    const config = { safe_hook_creation: true }

    //#when
    const result = ExperimentalConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.disable_omo_env).toBeUndefined()
    }
  })

  test("rejects non-boolean disable_omo_env", () => {
    //#given
    const config = { disable_omo_env: "true" }

    //#when
    const result = ExperimentalConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(false)
  })

})

describe("GitMasterConfigSchema", () => {
  test("accepts boolean true for commit_footer", () => {
    //#given
    const config = { commit_footer: true }

    //#when
    const result = GitMasterConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.commit_footer).toBe(true)
    }
  })

  test("accepts boolean false for commit_footer", () => {
    //#given
    const config = { commit_footer: false }

    //#when
    const result = GitMasterConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.commit_footer).toBe(false)
    }
  })

  test("accepts string value for commit_footer", () => {
    //#given
    const config = { commit_footer: "Custom footer text" }

    //#when
    const result = GitMasterConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.commit_footer).toBe("Custom footer text")
    }
  })

  test("defaults commit_footer to true when not provided", () => {
    //#given
    const config = {}

    //#when
    const result = GitMasterConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.commit_footer).toBe(true)
    }
  })

  test("rejects number for commit_footer", () => {
    //#given
    const config = { commit_footer: 123 }

    //#when
    const result = GitMasterConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(false)
  })

  test("accepts shell-safe git_env_prefix", () => {
    const config = { git_env_prefix: "MY_HOOK=active" }

    const result = GitMasterConfigSchema.safeParse(config)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.git_env_prefix).toBe("MY_HOOK=active")
    }
  })

  test("rejects git_env_prefix with shell metacharacters", () => {
    const config = { git_env_prefix: "A=1; rm -rf /" }

    const result = GitMasterConfigSchema.safeParse(config)

    expect(result.success).toBe(false)
  })
})

describe("OhMyOpenCodeConfigSchema - git_master defaults (#2040)", () => {
  test("git_master defaults are applied when section is missing from config", () => {
    //#given
    const config = {}

    //#when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.git_master).toBeDefined()
      expect(result.data.git_master.commit_footer).toBe(true)
      expect(result.data.git_master.include_co_authored_by).toBe(true)
      expect(result.data.git_master.git_env_prefix).toBe("GIT_MASTER=1")
    }
  })

  test("git_master respects explicit false values", () => {
    //#given
    const config = {
      git_master: {
        commit_footer: false,
        include_co_authored_by: false,
      },
    }

    //#when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.git_master.commit_footer).toBe(false)
      expect(result.data.git_master.include_co_authored_by).toBe(false)
    }
  })
})

describe("skills schema", () => {
  test("accepts skills.sources configuration", () => {
    //#given
    const config = {
      skills: {
        sources: [{ path: "skill/", recursive: true }],
      },
    }

    //#when
    const result = OhMyOpenCodeConfigSchema.safeParse(config)

    //#then
    expect(result.success).toBe(true)
  })
})
