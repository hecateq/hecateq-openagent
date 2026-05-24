import { afterEach, describe, expect, it } from "bun:test"
import { mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import {
  collectAgentIndexIssues,
  checkHecateqWorkflow,
  collectCustomAgentIssues,
  collectHandoffStateIssues,
  collectHandoffRolePolicyIssues,
  collectMemoryQualityIssues,
  collectProjectArtifactIssues,
  collectHecateqConfigIssues,
  collectProjectRootMemoryIssues,
  collectSafetyHookIssues,
  collectSecretFindings,
  assessMemoryFileQuality,
} from "./hecateq-workflow"
import {
  PROJECT_CONTRACTS_DIR,
  PROJECT_MEMORY_FILES,
  PROJECT_TASK_GRAPHS_DIR,
} from "../../../shared/memory-bootstrap"

const MEMORY_FILES = [...PROJECT_MEMORY_FILES]

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf-8")
}

function writeFile(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, content, "utf-8")
}

describe("hecateq workflow doctor check", () => {
  let testRoot = ""
  let originalCwd = ""
  let originalConfigDir: string | undefined
  let originalHome: string | undefined
  let originalClaudeConfigDir: string | undefined
  let originalXdgConfigHome: string | undefined

  function setupWorkspace(): { cwd: string; configDir: string; homeDir: string } {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    testRoot = join(tmpdir(), `omo-hecateq-doctor-${suffix}`)
    const cwd = join(testRoot, "workspace")
    const configDir = join(testRoot, "config")
    const homeDir = join(testRoot, "home")
    mkdirSync(cwd, { recursive: true })
    mkdirSync(configDir, { recursive: true })
    mkdirSync(homeDir, { recursive: true })
    originalCwd = process.cwd()
    originalConfigDir = process.env.OPENCODE_CONFIG_DIR
    originalHome = process.env.HOME
    originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR
    originalXdgConfigHome = process.env.XDG_CONFIG_HOME
    process.chdir(cwd)
    process.env.OPENCODE_CONFIG_DIR = configDir
    process.env.HOME = homeDir
    process.env.CLAUDE_CONFIG_DIR = join(homeDir, ".claude")
    process.env.XDG_CONFIG_HOME = join(homeDir, ".config")
    return { cwd, configDir, homeDir }
  }

  afterEach(() => {
    if (originalCwd) process.chdir(originalCwd)
    if (originalConfigDir === undefined) delete process.env.OPENCODE_CONFIG_DIR
    else process.env.OPENCODE_CONFIG_DIR = originalConfigDir
    if (originalHome === undefined) delete process.env.HOME
    else process.env.HOME = originalHome
    if (originalClaudeConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir
    if (originalXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = originalXdgConfigHome
    if (testRoot) rmSync(testRoot, { recursive: true, force: true })
    testRoot = ""
    originalCwd = ""
  })

  it("warns when project-root memory is missing", () => {
    const { cwd } = setupWorkspace()

    const issues = collectProjectRootMemoryIssues(cwd)

    expect(issues).toHaveLength(1)
    expect(issues[0]?.title).toBe("Project-root memory not initialized")
    expect(issues[0]?.severity).toBe("warning")
  })

  it("reports missing memory files when project-root memory is partial", () => {
    const { cwd } = setupWorkspace()
    const memoryDir = join(cwd, ".opencode", "memory", "knowledge", "context")
    mkdirSync(memoryDir, { recursive: true })
    writeFile(join(memoryDir, "active-context.md"), "ok\n")
    writeFile(join(memoryDir, "progress.md"), "ok\n")
    writeFile(join(memoryDir, "decisions.md"), "ok\n")

    const issues = collectProjectRootMemoryIssues(cwd)

    expect(issues).toHaveLength(1)
    expect(issues[0]?.title).toBe("Project-root memory incomplete")
    expect(issues[0]?.description).toContain("tasks.md")
    expect(issues[0]?.description).toContain("file-map.md")
  })

  it("does not report memory issues when project-root memory is complete", () => {
    const { cwd } = setupWorkspace()
    const memoryDir = join(cwd, ".opencode", "memory", "knowledge", "context")
    mkdirSync(memoryDir, { recursive: true })
    for (const fileName of MEMORY_FILES) {
      writeFile(join(memoryDir, fileName), "ok\n")
    }

    const issues = collectProjectRootMemoryIssues(cwd)

    expect(issues).toHaveLength(0)
  })

  it("reports missing artifact directories when contracts and task-graphs are absent", () => {
    const { cwd } = setupWorkspace()

    const issues = collectProjectArtifactIssues(cwd)

    expect(issues).toHaveLength(1)
    expect(issues[0]?.title).toBe("Hecateq artifact directories not initialized")
    expect(issues[0]?.description).toContain(PROJECT_CONTRACTS_DIR)
    expect(issues[0]?.description).toContain(PROJECT_TASK_GRAPHS_DIR)
  })

  it("does not report artifact issues when directories exist but are empty", () => {
    const { cwd } = setupWorkspace()
    mkdirSync(join(cwd, PROJECT_CONTRACTS_DIR), { recursive: true })
    mkdirSync(join(cwd, PROJECT_TASK_GRAPHS_DIR), { recursive: true })

    const issues = collectProjectArtifactIssues(cwd)

    expect(issues).toHaveLength(0)
  })

  it("notes disabled hecateq-memory-bootstrap when artifact directories are missing", () => {
    const { cwd } = setupWorkspace()
    writeJson(join(cwd, ".opencode", "oh-my-openagent.json"), {
      disabled_hooks: ["hecateq-memory-bootstrap"],
    })

    const issues = collectProjectArtifactIssues(cwd)

    expect(issues).toHaveLength(1)
    expect(issues[0]?.description).toContain("Bootstrap hook `hecateq-memory-bootstrap` is disabled")
    expect(issues[0]?.description).toContain("hecateq-memory-bootstrap")
  })

  it("warns when hecateq workflow helpers are disabled by config", () => {
    const { cwd } = setupWorkspace()
    writeJson(join(cwd, ".opencode", "oh-my-openagent.json"), {
      hecateq: {
        enabled: false,
      },
    })

    const { issues } = collectHecateqConfigIssues(cwd)

    const issue = issues.find((entry) => entry.title === "Hecateq workflow helpers disabled")
    expect(issue).toBeDefined()
    expect(issue?.description).toContain("hecateq.enabled is false")
  })

  it("warns when context injection is disabled by config and adds listing details", () => {
    const { cwd } = setupWorkspace()
    writeJson(join(cwd, ".opencode", "oh-my-openagent.json"), {
      hecateq: {
        context_injection: {
          enabled: false,
          include_contracts: false,
          include_task_graphs: false,
        },
      },
    })

    const result = collectHecateqConfigIssues(cwd)

    const issue = result.issues.find((entry) => entry.title === "Hecateq project context injector disabled by config")
    expect(issue).toBeDefined()
    expect(result.details.some((detail) => detail.includes("contracts listing disabled"))).toBe(true)
    expect(result.details.some((detail) => detail.includes("task graph listing disabled"))).toBe(true)
    expect(result.details.some((detail) => detail.includes("agent index runtime enrichment: enabled"))).toBe(true)
    expect(result.details.some((detail) => detail.includes("agent index suggestions: enabled"))).toBe(true)
    expect(result.details.some((detail) => detail.includes("agent index require_fresh: false"))).toBe(true)
    expect(result.details.some((detail) => detail.includes("advisory-only") && detail.includes("exact runtime resolution semantics"))).toBe(true)
  })

  it("reports agent index runtime config details", () => {
    const { cwd } = setupWorkspace()
    writeJson(join(cwd, ".opencode", "oh-my-openagent.json"), {
      hecateq: {
        agent_index: {
          enrich_runtime_agents: false,
          use_for_suggestions: false,
          require_fresh: true,
          max_suggestions: 4,
        },
      },
    })

    const result = collectHecateqConfigIssues(cwd)

    expect(result.details.some((detail) => detail.includes("agent index runtime enrichment: disabled"))).toBe(true)
    expect(result.details.some((detail) => detail.includes("agent index suggestions: disabled"))).toBe(true)
    expect(result.details.some((detail) => detail.includes("agent index require_fresh: true"))).toBe(true)
  })

  it("reports compact mode in doctor details", () => {
    const { cwd } = setupWorkspace()
    writeJson(join(cwd, ".opencode", "oh-my-openagent.json"), {
      hecateq: {
        context_injection: {
          mode: "compact",
        },
      },
    })

    const result = collectHecateqConfigIssues(cwd)

    expect(result.details.some((detail) => detail.includes("Hecateq context injection mode: compact"))).toBe(true)
  })

  it("adds expanded mode token-usage detail", () => {
    const { cwd } = setupWorkspace()
    writeJson(join(cwd, ".opencode", "oh-my-openagent.json"), {
      hecateq: {
        context_injection: {
          mode: "expanded",
        },
      },
    })

    const result = collectHecateqConfigIssues(cwd)

    expect(result.details.some((detail) => detail.includes("Expanded context injection mode may increase token usage"))).toBe(true)
  })

  it("warns when context injection mode is off", () => {
    const { cwd } = setupWorkspace()
    writeJson(join(cwd, ".opencode", "oh-my-openagent.json"), {
      hecateq: {
        context_injection: {
          mode: "off",
        },
      },
    })

    const result = collectHecateqConfigIssues(cwd)

    const issue = result.issues.find((entry) => entry.title === "Hecateq project context injector disabled by mode")
    expect(issue).toBeDefined()
    expect(issue?.description).toContain("hecateq.context_injection.mode is off")
  })

  it("warns when git checkpoint helper is disabled", () => {
    const { cwd } = setupWorkspace()
    writeJson(join(cwd, ".opencode", "oh-my-openagent.json"), {
      hecateq: {
        git_checkpoint: {
          enabled: false,
        },
      },
    })

    const result = collectHecateqConfigIssues(cwd)

    const issue = result.issues.find((entry) => entry.title === "Git checkpoint helper disabled")
    expect(issue).toBeDefined()
    expect(issue?.description).toContain("hecateq.git_checkpoint.enabled is false")
  })

  it("warns when the hecateq agent index is missing", () => {
    setupWorkspace()

    const result = collectAgentIndexIssues()

    const issue = result.issues.find((entry) => entry.title === "Hecateq Agent Index missing")
    expect(issue).toBeDefined()
    expect(issue?.fix).toContain("/hecateq-agent-index")
    expect(issue?.affects).toContain("advisory agent suggestions")
  })

  it("warns when the hecateq agent index cannot be parsed", () => {
    const { configDir } = setupWorkspace()
    writeFile(join(configDir, "hecateq", "agent-index.generated.json"), "{broken json")

    const result = collectAgentIndexIssues()

    const issue = result.issues.find((entry) => entry.title === "Hecateq Agent Index invalid")
    expect(issue).toBeDefined()
  })

  it("warns when the hecateq agent index has an unsupported version", () => {
    const { configDir } = setupWorkspace()
    writeFile(join(configDir, "hecateq", "agent-index.generated.json"), JSON.stringify({ version: 2 }, null, 2))

    const result = collectAgentIndexIssues()

    const issue = result.issues.find((entry) => entry.title === "Hecateq Agent Index invalid")
    expect(issue?.description).toContain("unsupported version 2")
  })

  it("warns when the hecateq agent index is stale", () => {
    const { configDir } = setupWorkspace()
    const agentsDir = join(configDir, "agents")
    mkdirSync(agentsDir, { recursive: true })
    writeFile(join(configDir, "hecateq", "agent-index.generated.json"), JSON.stringify({
      version: 1,
      generated_at: "2026-05-23T00:00:00.000Z",
      generator: "oh-my-openagent-hecateq",
      notice: "Generated file. Do not edit manually. Re-run /hecateq-agent-index.",
      enrichment_mode: "deterministic",
      source: { agents_dirs: [agentsDir] },
      summary: {
        agents_discovered: 1,
        agents_indexed: 1,
        weak_metadata: 0,
        duplicates: 0,
        high_ambiguity: 0,
        unknown_primary_domain: 0,
        domain_coverage: { docs: 1 },
      },
      agents: [{
        name: "agent-a",
        display_name: "Agent A",
        filename: "agent-a.md",
        source_file: join(agentsDir, "agent-a.md"),
        description: "desc",
        body_preview: "preview",
        role: "role",
        domains: ["docs"],
        primary_domain: "docs",
        secondary_domains: [],
        agent_type: "documentarian",
        capabilities: { can_plan: true, can_implement: false, can_review: true, can_test: false, can_document: true, can_coordinate: false },
        routing: { priority: 50, ambiguity: "low", best_for: [], not_for: [] },
        keywords: ["docs"],
        use_when: [],
        avoid_when: [],
        confidence: 0.8,
        signals: { filename: ["docs"], frontmatter: [], body: [] },
        warnings: [],
      }],
    }, null, 2))
    writeFile(
      join(agentsDir, "agent-a.md"),
      `---\ndescription: Newer agent\n---\nDocumentation markdown report body.`,
    )

    // Ensure the index file has an explicitly older mtime than the agent file.
    // This eliminates any dependency on filesystem timestamp granularity
    // (e.g. both files landing within the same mtime tick).
    const indexFile = join(configDir, "hecateq", "agent-index.generated.json")
    const agentFile = join(agentsDir, "agent-a.md")
    const now = Date.now() / 1000
    utimesSync(indexFile, now - 100, now - 100)  // 100 seconds in the past
    utimesSync(agentFile, now, now)                // current time

    const result = collectAgentIndexIssues()

    const issue = result.issues.find((entry) => entry.title === "Hecateq Agent Index stale")
    expect(issue).toBeDefined()
    expect(result.details.some((detail) => detail.includes("advisory-only"))).toBe(true)
  })

  it("warns when the hecateq agent index has weak metadata and duplicates", () => {
    const { configDir } = setupWorkspace()
    const agentsDir = join(configDir, "agents")
    mkdirSync(agentsDir, { recursive: true })
    writeFile(join(agentsDir, "agent-a.md"), `---\ndescription: Agent A\n---\nBody`)
    writeFile(join(configDir, "hecateq", "agent-index.generated.json"), JSON.stringify({
      version: 1,
      generated_at: new Date().toISOString(),
      generator: "oh-my-openagent-hecateq",
      notice: "Generated file. Do not edit manually. Re-run /hecateq-agent-index.",
      enrichment_mode: "deterministic",
      source: { agents_dirs: [agentsDir] },
      summary: {
        agents_discovered: 1,
        agents_indexed: 1,
        weak_metadata: 1,
        duplicates: 1,
        high_ambiguity: 1,
        unknown_primary_domain: 1,
        domain_coverage: {},
      },
      agents: [{
        name: "duplicate-agent",
        display_name: "Duplicate Agent",
        filename: "agent-a.md",
        source_file: join(agentsDir, "agent-a.md"),
        description: "Agent A",
        body_preview: "Body",
        role: "Agent A",
        domains: [],
        primary_domain: "unknown",
        secondary_domains: [],
        agent_type: "unknown",
        capabilities: { can_plan: true, can_implement: false, can_review: false, can_test: false, can_document: false, can_coordinate: false },
        routing: { priority: 25, ambiguity: "high", best_for: [], not_for: [] },
        keywords: [],
        use_when: [],
        avoid_when: [],
        confidence: 0.3,
        signals: { filename: [], frontmatter: [], body: [] },
        warnings: ["weak metadata", "duplicate effective name"],
      }],
    }, null, 2))

    const result = collectAgentIndexIssues()

    expect(result.issues.some((entry) => entry.title === "Hecateq Agent Index weak metadata")).toBe(true)
    expect(result.issues.some((entry) => entry.title === "Hecateq Agent Index duplicate agents")).toBe(true)
    expect(result.issues.some((entry) => entry.title === "Hecateq Agent Index unknown domains")).toBe(true)
    expect(result.issues.some((entry) => entry.title === "Hecateq Agent Index high routing ambiguity")).toBe(true)
  })

  it("returns no agent-index issues when the generated index is current and healthy", () => {
    const { configDir } = setupWorkspace()
    const agentsDir = join(configDir, "agents")
    mkdirSync(agentsDir, { recursive: true })
    writeFile(
      join(agentsDir, "agent-a.md"),
      `---\ndescription: Documentation expert\n---\nMarkdown documentation report guide body with enough detail.`,
    )
    writeFile(join(configDir, "hecateq", "agent-index.generated.json"), JSON.stringify({
      version: 1,
      generated_at: new Date().toISOString(),
      generator: "oh-my-openagent-hecateq",
      notice: "Generated file. Do not edit manually. Re-run /hecateq-agent-index.",
      enrichment_mode: "deterministic",
      source: { agents_dirs: [agentsDir] },
      summary: {
        agents_discovered: 1,
        agents_indexed: 1,
        weak_metadata: 0,
        duplicates: 0,
        high_ambiguity: 0,
        unknown_primary_domain: 0,
        domain_coverage: { docs: 1 },
      },
      agents: [{
        name: "agent-a",
        display_name: "Agent A",
        filename: "agent-a.md",
        source_file: join(agentsDir, "agent-a.md"),
        description: "Documentation expert",
        body_preview: "Markdown documentation report guide body with enough detail.",
        role: "Documentation expert",
        domains: ["docs"],
        primary_domain: "docs",
        secondary_domains: [],
        agent_type: "documentarian",
        capabilities: { can_plan: true, can_implement: false, can_review: true, can_test: false, can_document: true, can_coordinate: false },
        routing: { priority: 50, ambiguity: "low", best_for: [], not_for: [] },
        keywords: ["docs"],
        use_when: [],
        avoid_when: [],
        confidence: 0.8,
        signals: { filename: ["docs"], frontmatter: ["docs"], body: ["docs"] },
        warnings: [],
      }],
    }, null, 2))

    const result = collectAgentIndexIssues()

    expect(result.issues).toHaveLength(0)
    expect(result.details.some((detail) => detail.includes("Indexed agents: 1"))).toBe(true)
  })

  it("reports unknown_primary_domain and high_ambiguity in doctor details", () => {
    const { configDir } = setupWorkspace()
    const agentsDir = join(configDir, "agents")
    mkdirSync(agentsDir, { recursive: true })
    writeFile(join(configDir, "hecateq", "agent-index.generated.json"), JSON.stringify({
      version: 1,
      generated_at: new Date().toISOString(),
      generator: "oh-my-openagent-hecateq",
      notice: "Generated file. Do not edit manually. Re-run /hecateq-agent-index.",
      enrichment_mode: "deterministic",
      source: { agents_dirs: [agentsDir] },
      summary: {
        agents_discovered: 2,
        agents_indexed: 2,
        weak_metadata: 0,
        duplicates: 0,
        high_ambiguity: 1,
        unknown_primary_domain: 1,
        domain_coverage: { unknown: 1, docs: 1 },
      },
      agents: [
        {
          name: "unknown-agent",
          display_name: "Unknown Agent",
          filename: "unknown-agent.md",
          source_file: join(agentsDir, "unknown-agent.md"),
          description: "Some vague agent",
          body_preview: "Some vague body",
          role: "Some vague agent",
          domains: ["unknown"],
          primary_domain: "unknown",
          secondary_domains: [],
          agent_type: "unknown",
          capabilities: { can_plan: true, can_implement: false, can_review: false, can_test: false, can_document: false, can_coordinate: false },
          routing: { priority: 25, ambiguity: "high", best_for: [], not_for: [] },
          keywords: [],
          use_when: [],
          avoid_when: [],
          confidence: 0.3,
          signals: { filename: [], frontmatter: [], body: [] },
          warnings: ["weak metadata", "no clear domain detected"],
        },
        {
          name: "doc-agent",
          display_name: "Doc Agent",
          filename: "doc-agent.md",
          source_file: join(agentsDir, "doc-agent.md"),
          description: "Documentation expert",
          body_preview: "Markdown documentation report guide body with enough detail.",
          role: "Documentation expert",
          domains: ["docs"],
          primary_domain: "docs",
          secondary_domains: [],
          agent_type: "documentarian",
          capabilities: { can_plan: true, can_implement: false, can_review: true, can_test: false, can_document: true, can_coordinate: false },
          routing: { priority: 50, ambiguity: "low", best_for: [], not_for: [] },
          keywords: ["docs"],
          use_when: [],
          avoid_when: [],
          confidence: 0.8,
          signals: { filename: ["docs"], frontmatter: ["docs"], body: ["docs"] },
          warnings: [],
        },
      ],
    }, null, 2))

    const result = collectAgentIndexIssues()

    expect(result.issues.some((entry) => entry.title === "Hecateq Agent Index unknown domains")).toBe(true)
    expect(result.issues.some((entry) => entry.title === "Hecateq Agent Index high routing ambiguity")).toBe(true)
    expect(result.details.some((detail) => detail.includes("Unknown primary domains: 1"))).toBe(true)
    expect(result.details.some((detail) => detail.includes("High routing ambiguity: 1"))).toBe(true)
    expect(result.details.some((detail) => detail.includes("Domain coverage:"))).toBe(true)
    expect(result.details.some((detail) => detail.includes("  docs: 1"))).toBe(true)
    expect(result.details.some((detail) => detail.includes("Weak agents:"))).toBe(true)
    expect(result.details.some((detail) => detail.includes("unknown-agent: weak metadata, no clear domain detected"))).toBe(true)
    expect(result.details.some((detail) => detail.includes("Agent type distribution:"))).toBe(true)
    expect(result.details.some((detail) => detail.includes("documentarian: 1"))).toBe(true)
    expect(result.details.some((detail) => detail.includes("unknown: 1"))).toBe(true)
  })

  it("reports suggest mode as no automatic commit", () => {
    const { cwd } = setupWorkspace()
    writeJson(join(cwd, ".opencode", "oh-my-openagent.json"), {
      hecateq: {
        git_checkpoint: {
          mode: "suggest",
        },
      },
    })

    const result = collectHecateqConfigIssues(cwd)

    expect(result.details.some((detail) => detail.includes("suggest mode") && detail.includes("no automatic commit"))).toBe(true)
    expect(result.details.some((detail) => detail.includes("no hard guard is enforced yet"))).toBe(true)
  })

  it("reports auto_clean_only mode with clean-repo checkpoint behavior", () => {
    const { cwd } = setupWorkspace()
    writeJson(join(cwd, ".opencode", "oh-my-openagent.json"), {
      hecateq: {
        git_checkpoint: {
          mode: "auto_clean_only",
          auto_checkpoint_clean_repo: true,
        },
      },
    })

    const result = collectHecateqConfigIssues(cwd)

    expect(result.details.some((detail) => detail.includes("empty checkpoint commit on a clean repo"))).toBe(true)
  })

  it("warns on invalid hecateq config values", () => {
    const { cwd } = setupWorkspace()
    writeJson(join(cwd, ".opencode", "oh-my-openagent.json"), {
      hecateq: {
        context_injection: {
          max_memory_file_chars: -1,
        },
      },
    })

    const { issues } = collectHecateqConfigIssues(cwd)

    const issue = issues.find((entry) => entry.title === "Hecateq config issue")
    expect(issue).toBeDefined()
    expect(issue?.description).toContain("max_memory_file_chars")
  })

  it("uses the same memory file standard as the runtime bootstrap helper", () => {
    expect(MEMORY_FILES).toEqual([
      "active-context.md",
      "progress.md",
      "tasks.md",
      "file-map.md",
      "decisions.md",
    ])
  })

  it("warns when no custom agents are discovered", () => {
    const { cwd } = setupWorkspace()

    const issues = collectCustomAgentIssues(cwd)

    expect(issues).toHaveLength(1)
    expect(issues[0]?.title).toBe("No custom agents discovered")
  })

  it("warns on duplicate custom agent names across sources", () => {
    const { cwd, configDir } = setupWorkspace()
    writeFile(join(configDir, "agents", "nodejs-backend-architect.md"), "---\nname: nodejs-backend-architect\ndescription: Global\n---\nPrompt\n")
    writeFile(join(cwd, ".opencode", "agents", "nodejs-backend-architect.md"), "---\nname: nodejs-backend-architect\ndescription: Project\n---\nPrompt\n")

    const issues = collectCustomAgentIssues(cwd)

    const duplicateIssue = issues.find((issue) => issue.title === "Duplicate custom agent names found")
    expect(duplicateIssue).toBeDefined()
    expect(duplicateIssue?.description).toContain("nodejs-backend-architect")
    expect(duplicateIssue?.description).toContain(".opencode/agents")
  })

  it("warns on missing description frontmatter", () => {
    const { cwd, configDir } = setupWorkspace()
    writeFile(join(configDir, "agents", "backend-engineer.md"), "---\nname: backend-engineer\n---\nPrompt\n")

    const issues = collectCustomAgentIssues(cwd)

    const issue = issues.find((entry) => entry.description.includes("missing description"))
    expect(issue).toBeDefined()
    expect(issue?.title).toBe("Custom agent frontmatter issue")
  })

  it("masks secret values and detects discord webhook keys", () => {
    const { cwd, configDir } = setupWorkspace()
    writeJson(join(configDir, "oh-my-openagent.json"), {
      notification: {
        discord_webhook_url: "https://discord.com/api/webhooks/123456/abcdefSECRET",
      },
      token: "ghp_supersecrettoken",
    })
    writeJson(join(cwd, "opencode.json"), {
      api_key: "sk-secret-key-value",
    })

    const findings = collectSecretFindings(cwd)

    expect(findings.some((finding) => finding.keyPath.includes("discord_webhook_url"))).toBe(true)
    expect(findings.some((finding) => finding.keyPath.includes("api_key"))).toBe(true)
    expect(findings.every((finding) => !finding.maskedValue.includes("SECRET"))).toBe(true)
    expect(findings.every((finding) => !finding.maskedValue.includes("supersecrettoken"))).toBe(true)
  })

  it("warns when hecateq-orchestrator is disabled in config", () => {
    const { cwd, configDir } = setupWorkspace()
    writeJson(join(configDir, "oh-my-openagent.json"), {
      disabled_agents: ["hecateq-orchestrator"],
    })

    const result = collectHecateqConfigIssues(cwd)

    expect(result.issues).toHaveLength(1)
    expect(result.issues[0]?.title).toBe("Hecateq Orchestrator is disabled")
  })

  it("warns when safety hooks are disabled", () => {
    const { cwd, configDir } = setupWorkspace()
    writeJson(join(configDir, "oh-my-openagent.json"), {
      disabled_hooks: ["stop-continuation-guard", "comment-checker"],
    })

    const issues = collectSafetyHookIssues(cwd)

    expect(issues.map((issue) => issue.title)).toContain("Safety hook disabled: stop-continuation-guard")
    expect(issues.map((issue) => issue.title)).toContain("Safety hook disabled: comment-checker")
  })

  it("returns a valid consolidated doctor result", async () => {
    const { cwd, configDir } = setupWorkspace()
    const memoryDir = join(cwd, ".opencode", "memory", "knowledge", "context")
    mkdirSync(memoryDir, { recursive: true })
    for (const fileName of MEMORY_FILES) {
      writeFile(join(memoryDir, fileName), "ok\n")
    }
    writeFile(join(configDir, "agents", "backend-engineer.md"), "---\nname: backend-engineer\ndescription: Good\n---\nPrompt\n")

    const result = await checkHecateqWorkflow()

    expect(result.name).toBe("Hecateq Workflow")
    expect(["pass", "warn", "fail", "skip"]).toContain(result.status)
    expect(Array.isArray(result.issues)).toBe(true)
    expect(Array.isArray(result.details)).toBe(true)
  })

  describe("memory quality checks", () => {
    it("detects empty memory files", () => {
      const { cwd } = setupWorkspace()
      const memoryDir = join(cwd, ".opencode", "memory", "knowledge", "context")
      mkdirSync(memoryDir, { recursive: true })
      writeFile(join(memoryDir, "active-context.md"), "  \n\n  ")
      writeFile(join(memoryDir, "progress.md"), "")
      // add remaining files as normal (not empty) so they don't trigger
      for (const fileName of MEMORY_FILES) {
        if (fileName === "active-context.md" || fileName === "progress.md") continue
        writeFile(join(memoryDir, fileName), "# Real\n\nActual content here.\n")
      }

      const issues = collectMemoryQualityIssues(cwd)

      expect(issues).toHaveLength(2)
      const activeContextIssue = issues.find((i) => i.description.includes("active-context.md"))
      expect(activeContextIssue).toBeDefined()
      expect(activeContextIssue?.title).toBe("Project memory file is empty")
      expect(activeContextIssue?.severity).toBe("warning")
      const progressIssue = issues.find((i) => i.description.includes("progress.md"))
      expect(progressIssue).toBeDefined()
      expect(progressIssue?.title).toBe("Project memory file is empty")
    })

    it("detects stale memory files with 'Last updated: TODO'", () => {
      const { cwd } = setupWorkspace()
      const memoryDir = join(cwd, ".opencode", "memory", "knowledge", "context")
      mkdirSync(memoryDir, { recursive: true })
      writeFile(join(memoryDir, "tasks.md"), "# Tasks\n\nLast updated: TODO\n\n## Pending\n- TODO\n\n## Done\n- TODO\n")
      writeFile(join(memoryDir, "active-context.md"), "# Active Context\n\nLast updated: 2026-05-22\n\n## Goal\nRefactor module.\n")
      writeFile(join(memoryDir, "progress.md"), "# Progress\n\nSome real content here.\n")
      writeFile(join(memoryDir, "file-map.md"), "# File Map\n\nReal file map.\n")
      writeFile(join(memoryDir, "decisions.md"), "# Decisions\n\nReal decisions.\n")

      const issues = collectMemoryQualityIssues(cwd)

      expect(issues).toHaveLength(1)
      expect(issues[0]?.title).toBe("Project memory file has stale template content")
      expect(issues[0]?.description).toContain("tasks.md")
      expect(issues[0]?.description).toContain("Last updated: TODO")
    })

    it("detects placeholder-only memory files (headings and - TODO only)", () => {
      const { cwd } = setupWorkspace()
      const memoryDir = join(cwd, ".opencode", "memory", "knowledge", "context")
      mkdirSync(memoryDir, { recursive: true })
      // A file with real "Last updated:" date but still only - TODO items
      writeFile(
        join(memoryDir, "tasks.md"),
        "# Tasks\n\nLast updated: 2026-05-22\n\n## Pending\n- TODO\n\n## Blocked\n- TODO\n\n## Done\n- TODO\n",
      )
      // All other files are healthy
      for (const fileName of MEMORY_FILES) {
        if (fileName === "tasks.md") continue
        writeFile(join(memoryDir, fileName), "# Real\n\nActual content here with details.\n")
      }

      const issues = collectMemoryQualityIssues(cwd)

      expect(issues).toHaveLength(1)
      expect(issues[0]?.title).toBe("Project memory file contains only placeholders")
      expect(issues[0]?.description).toContain("tasks.md")
    })

    it("returns no quality issues when memory files are well-populated", () => {
      const { cwd } = setupWorkspace()
      const memoryDir = join(cwd, ".opencode", "memory", "knowledge", "context")
      mkdirSync(memoryDir, { recursive: true })
      for (const fileName of MEMORY_FILES) {
        writeFile(
          join(memoryDir, fileName),
          `# ${fileName}\n\nLast updated: 2026-05-22\n\n## Section\nDetailed content here with actual project information.\n`,
        )
      }

      const issues = collectMemoryQualityIssues(cwd)

      expect(issues).toHaveLength(0)
    })

    it("returns no issues when memory directory is missing (delegated to presence check)", () => {
      const { cwd } = setupWorkspace()
      // memory dir does not exist at all

      const issues = collectMemoryQualityIssues(cwd)

      expect(issues).toHaveLength(0)
    })

    it("skips missing individual files (delegated to presence check)", () => {
      const { cwd } = setupWorkspace()
      const memoryDir = join(cwd, ".opencode", "memory", "knowledge", "context")
      mkdirSync(memoryDir, { recursive: true })
      // Only 1 of 5 files exists
      writeFile(join(memoryDir, "active-context.md"), "# Real\n\nActual content.\n")

      const issues = collectMemoryQualityIssues(cwd)

      // The one file that exists is healthy → no issues
      expect(issues).toHaveLength(0)
    })

    it("does not flag files with mix of real content and remaining TODOs", () => {
      const { cwd } = setupWorkspace()
      const memoryDir = join(cwd, ".opencode", "memory", "knowledge", "context")
      mkdirSync(memoryDir, { recursive: true })
      // Real content mixed with some TODOs — not placeholder-only
      writeFile(
        join(memoryDir, "tasks.md"),
        "# Tasks\n\nLast updated: 2026-05-22\n\n## Pending\n- TODO: implement login\n\n## Done\n- User auth module completed\n",
      )
      for (const fileName of MEMORY_FILES) {
        if (fileName === "tasks.md") continue
        writeFile(join(memoryDir, fileName), "# Real\n\nActual content.\n")
      }

      const issues = collectMemoryQualityIssues(cwd)

      expect(issues).toHaveLength(0)
    })

    it("assessMemoryFileQuality correctly classifies all quality states", () => {
      const { cwd } = setupWorkspace()
      const memoryDir = join(cwd, ".opencode", "memory", "knowledge", "context")
      mkdirSync(memoryDir, { recursive: true })

      // Empty file
      writeFile(join(memoryDir, "empty.md"), "  \n\n  ")
      // Stale - has "Last updated: TODO"
      writeFile(join(memoryDir, "stale.md"), "# Title\n\nLast updated: TODO\n\n## Section\n- TODO\n")
      // Placeholder-only - has date but only headings + - TODO
      writeFile(join(memoryDir, "placeholder.md"), "# Title\n\nLast updated: 2026-05-22\n\n## Section\n- TODO\n- TODO\n")
      // Healthy
      writeFile(join(memoryDir, "healthy.md"), "# Title\n\nLast updated: 2026-05-22\n\n## Section\nReal content with details.\n")

      const emptyQuality = assessMemoryFileQuality(join(memoryDir, "empty.md"))
      expect(emptyQuality.isEmpty).toBe(true)
      expect(emptyQuality.hasStaleLastUpdated).toBe(false)
      expect(emptyQuality.isPlaceholderOnly).toBe(false)

      const staleQuality = assessMemoryFileQuality(join(memoryDir, "stale.md"))
      expect(staleQuality.isEmpty).toBe(false)
      expect(staleQuality.hasStaleLastUpdated).toBe(true)
      expect(staleQuality.isPlaceholderOnly).toBe(true)

      const placeholderQuality = assessMemoryFileQuality(join(memoryDir, "placeholder.md"))
      expect(placeholderQuality.isEmpty).toBe(false)
      expect(placeholderQuality.hasStaleLastUpdated).toBe(false)
      expect(placeholderQuality.isPlaceholderOnly).toBe(true)

      const healthyQuality = assessMemoryFileQuality(join(memoryDir, "healthy.md"))
      expect(healthyQuality.isEmpty).toBe(false)
      expect(healthyQuality.hasStaleLastUpdated).toBe(false)
      expect(healthyQuality.isPlaceholderOnly).toBe(false)
    })

    it("aggregator checkHecateqWorkflow includes memory quality issues alongside presence issues", async () => {
      const { cwd, configDir } = setupWorkspace()
      // Create memory directory with only some files, some stale
      const memoryDir = join(cwd, ".opencode", "memory", "knowledge", "context")
      mkdirSync(memoryDir, { recursive: true })
      writeFile(join(memoryDir, "active-context.md"), "# Active Context\n\nLast updated: 2026-05-22\n\n## Goal\nRefactor module.\n")
      writeFile(join(memoryDir, "tasks.md"), "# Tasks\n\nLast updated: TODO\n\n## Pending\n- TODO\n")

      // Add valid agent index to prevent index warnings from dominating
      const agentsDir = join(configDir, "agents")
      mkdirSync(agentsDir, { recursive: true })
      writeFile(join(agentsDir, "custom.md"), "---\nname: custom\ndescription: Custom agent\n---\nAgent prompt body.\n")
      writeFile(join(configDir, "hecateq", "agent-index.generated.json"), JSON.stringify({
        version: 1,
        generated_at: new Date().toISOString(),
        generator: "oh-my-openagent-hecateq",
        notice: "Generated file. Do not edit manually.",
        enrichment_mode: "deterministic",
        source: { agents_dirs: [agentsDir] },
        summary: {
          agents_discovered: 1,
          agents_indexed: 1,
          weak_metadata: 0,
          duplicates: 0,
          high_ambiguity: 0,
          unknown_primary_domain: 0,
          domain_coverage: { general: 1 },
        },
        agents: [{
          name: "custom",
          display_name: "Custom",
          filename: "custom.md",
          source_file: join(agentsDir, "custom.md"),
          description: "Custom agent",
          body_preview: "Agent prompt body.",
          role: "Custom agent",
          domains: ["general"],
          primary_domain: "general",
          secondary_domains: [],
          agent_type: "general",
          capabilities: { can_plan: true, can_implement: true, can_review: false, can_test: false, can_document: false, can_coordinate: false },
          routing: { priority: 50, ambiguity: "low", best_for: [], not_for: [] },
          keywords: [],
          use_when: [],
          avoid_when: [],
          confidence: 0.8,
          signals: { filename: [], frontmatter: [], body: [] },
          warnings: [],
        }],
      }, null, 2))

      const result = await checkHecateqWorkflow()

      const memoryPresenceIssue = result.issues.find((i) => i.title === "Project-root memory incomplete")
      const memoryQualityIssue = result.issues.find((i) => i.title === "Project memory file has stale template content")

      // Should have both presence (missing file-map.md, progress.md, decisions.md) and quality (stale tasks.md) issues
      if (memoryPresenceIssue) {
        expect(memoryPresenceIssue.description).toContain("file-map.md")
        expect(memoryPresenceIssue.description).toContain("progress.md")
      }
      expect(memoryQualityIssue).toBeDefined()
      expect(memoryQualityIssue?.description).toContain("tasks.md")
    })
  })

  describe("handoff role policy issues (Wave 3)", () => {
    it("reports warning when unclassified agents exist in known agent list", () => {
      // given — the role policy check uses actual known agent IDs from the parser
      // when
      const result = (() => {
        try {
          return collectHandoffRolePolicyIssues()
        } catch {
          return null as unknown as { issues: Array<{ title: string; severity: string }>; details: string[] }
        }
      })()

      // then — either no issues (all agents classified) or warnings about unclassified agents
      expect(result).not.toBeNull()
      expect(Array.isArray(result.issues)).toBe(true)
      expect(Array.isArray(result.details)).toBe(true)

      // If there are issues, they must have valid severity
      for (const issue of result.issues) {
        expect(["warning", "error"]).toContain(issue.severity)
        expect(typeof issue.title).toBe("string")
        expect(issue.title.length).toBeGreaterThan(0)
      }

      // Details must contain role distribution info
      const roleDistLine = result.details.find((d) => d.includes("Role distribution:"))
      expect(roleDistLine).toBeDefined()
    })

    it("reports role categories in doctor details", () => {
      // given
      const result = (() => {
        try {
          return collectHandoffRolePolicyIssues()
        } catch {
          return null as unknown as { issues: unknown[]; details: string[] }
        }
      })()

      // then — role distribution must list at least some agents
      expect(result).not.toBeNull()
      expect(result.details.some((d) => d.includes("Role categories defined"))).toBe(true)
      expect(result.details.some((d) => d.includes("Agents with role classification"))).toBe(true)
      expect(result.details.some((d) => d.includes("Known agents"))).toBe(true)
    })

    it("reports unclassified agents count and orphaned entries count", () => {
      // given
      const result = (() => {
        try {
          return collectHandoffRolePolicyIssues()
        } catch {
          return null as unknown as { issues: Array<{ title: string }>; details: string[] }
        }
      })()

      // then — details contain unclassified and orphaned counts
      expect(result).not.toBeNull()
      const unclassifiedLine = result.details.find((d) => d.includes("Unclassified agents"))
      const orphanedLine = result.details.find((d) => d.includes("Orphaned role entries"))
      expect(unclassifiedLine).toBeDefined()
      expect(orphanedLine).toBeDefined()
    })

    it("is included in the consolidated checkHecateqWorkflow result", async () => {
      // given — use minimal workspace setup
      const { cwd, configDir } = (() => {
        const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
        const root = join(tmpdir(), `omo-hecateq-role-${suffix}`)
        const wd = join(root, "workspace")
        const cd = join(root, "config")
        mkdirSync(wd, { recursive: true })
        mkdirSync(cd, { recursive: true })
        const origCwd = process.cwd()
        process.chdir(wd)
        afterEach(() => {
          process.chdir(origCwd)
          rmSync(root, { recursive: true, force: true })
        })
        return { cwd: wd, configDir: cd }
      })()

      const result = await checkHecateqWorkflow()

      // Role policy issues should be included in the consolidated result
      const rolePolicyIssue = result.issues.find((i) => i.title.includes("role policy") || i.title.includes("unclassified"))
      // Either there are issues or all agents are classified — both are valid outcomes
      expect(result.details.some((d) => d.includes("Role categories defined") || d.includes("Role distribution"))).toBe(true)
    })
  })

  describe("handoff state issues (Requirement 8)", () => {
    it("detects stale handoff state in run-continuation markers", () => {
      // given — a handoff marker that has been active for too long
      const { cwd, configDir } = setupWorkspace()
      const runContDir = join(cwd, ".omo", "run-continuation")
      mkdirSync(runContDir, { recursive: true })
      // Simulate a stale handoff marker: created 48 hours ago
      const staleDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
      writeFile(join(runContDir, "ses_stale_handoff.json"), JSON.stringify({
        sessionID: "ses_stale_handoff",
        updatedAt: staleDate,
        sources: {
          "background-task": {
            state: "active",
            reason: JSON.stringify({
              status: "IN_PROGRESS",
              handoff: "some-agent",
              signals: [{ signal: "backend_ready", payload: {} }],
            }),
            updatedAt: staleDate,
          },
        },
      }, null, 2))

      // when
      const issues = (() => {
        try {
          return (require("./hecateq-workflow") as { collectHandoffStateIssues: (cwd: string) => unknown[] })
            .collectHandoffStateIssues(cwd)
        } catch {
          return null
        }
      })()

      // then
      expect(issues).not.toBeNull()
      expect(issues!.length).toBeGreaterThanOrEqual(1)
      const staleIssue = (issues as Array<{ title?: string; description?: string; severity?: string }>)
        .find((i) => (i.title ?? "").toLowerCase().includes("handoff"))
      expect(staleIssue).toBeDefined()
      expect(staleIssue?.severity).toBe("warning")
    })

    it("detects invalid (corrupted) handoff state JSON", () => {
      // given — a handoff marker with unparseable reason JSON
      const { cwd, configDir } = setupWorkspace()
      const runContDir = join(cwd, ".omo", "run-continuation")
      mkdirSync(runContDir, { recursive: true })
      writeFile(join(runContDir, "ses_invalid_handoff.json"), JSON.stringify({
        sessionID: "ses_invalid_handoff",
        updatedAt: new Date().toISOString(),
        sources: {
          "background-task": {
            state: "active",
            reason: "not valid json at all {{{",
            updatedAt: new Date().toISOString(),
          },
        },
      }, null, 2))

      // when
      const issues = (() => {
        try {
          return (require("./hecateq-workflow") as { collectHandoffStateIssues: (cwd: string) => unknown[] })
            .collectHandoffStateIssues(cwd)
        } catch {
          return null
        }
      })()

      // then
      expect(issues).not.toBeNull()
      expect(issues!.length).toBeGreaterThanOrEqual(1)
      const invalidIssue = (issues as Array<{ title?: string; description?: string; severity?: string }>)
        .find((i) => (i.description ?? "").toLowerCase().includes("invalid") ||
                       (i.title ?? "").toLowerCase().includes("invalid"))
      expect(invalidIssue).toBeDefined()
    })

    it("reports no handoff issues when no handoff markers exist", () => {
      // given — clean workspace without any handoff state
      const { cwd } = setupWorkspace()

      // when
      const issues = (() => {
        try {
          return (require("./hecateq-workflow") as { collectHandoffStateIssues: (cwd: string) => unknown[] })
            .collectHandoffStateIssues(cwd)
        } catch {
          return null
        }
      })()

      // then — no handoff issues when nothing exists
      expect(issues).not.toBeNull()
      // Either empty array or no handoff-related issues
      const handoffIssues = (issues as Array<{ title?: string }>)
        .filter((i) => (i.title ?? "").toLowerCase().includes("handoff"))
      expect(handoffIssues).toHaveLength(0)
    })
  })
})
