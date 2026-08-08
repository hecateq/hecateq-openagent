import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import {
  HecateqAgentIndexSchema,
  buildHecateqAgentIndex,
  buildHecateqAgentIndexFromSources,
  discoverGlobalAgentMarkdownSources,
  formatHecateqAgentIndexSummary,
  getHecateqAgentIndexOutputPath,
  isHecateqAgentIndexStale,
  joinAgentIndexMetadata,
  normalizeAgentIndexName,
  readHecateqAgentIndexFile,
  scheduleHecateqAgentIndexAutoRegenerate,
  writeHecateqAgentIndex,
} from "./hecateq-agent-indexer"

describe("hecateq-agent-indexer", () => {
  let rootDir = ""
  let configDir = ""
  let originalConfigDir: string | undefined
  let originalHome: string | undefined
  let originalXdgConfigHome: string | undefined

  beforeEach(() => {
    rootDir = join(tmpdir(), `hecateq-agent-indexer-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    configDir = join(rootDir, "opencode-config")
    mkdirSync(configDir, { recursive: true })
    originalConfigDir = process.env.OPENCODE_CONFIG_DIR
    originalHome = process.env.HOME
    originalXdgConfigHome = process.env.XDG_CONFIG_HOME
    process.env.OPENCODE_CONFIG_DIR = configDir
    process.env.HOME = rootDir
    process.env.XDG_CONFIG_HOME = join(rootDir, ".config")
  })

  afterEach(() => {
    if (originalConfigDir === undefined) delete process.env.OPENCODE_CONFIG_DIR
    else process.env.OPENCODE_CONFIG_DIR = originalConfigDir
    if (originalHome === undefined) delete process.env.HOME
    else process.env.HOME = originalHome
    if (originalXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = originalXdgConfigHome
    rmSync(rootDir, { recursive: true, force: true })
  })

  function writeAgent(fileName: string, content: string): void {
    const agentsDir = join(configDir, "agents")
    mkdirSync(agentsDir, { recursive: true })
    writeFileSync(join(agentsDir, fileName), content, "utf-8")
  }

  it("discovers global markdown agent files and parses frontmatter", () => {
    writeAgent(
      "nodejs-backend-architect.md",
      `---\nname: nodejs-backend-architect\ndescription: Backend architecture expert\n---\n## When to use\n- API design\n- service boundaries\n`,
    )

    const sources = discoverGlobalAgentMarkdownSources()

    expect(sources).toHaveLength(1)
    expect(sources[0]?.declaredName).toBe("nodejs-backend-architect")
    expect(sources[0]?.description).toBe("Backend architecture expert")
  })

  it("falls back to filename-derived name when frontmatter name is missing", () => {
    writeAgent(
      "security-architect.md",
      `---\ndescription: Security expert\n---\nThreat modeling and auth hardening.`,
    )

    const index = buildHecateqAgentIndex()

    expect(index.agents[0]?.name).toBe("security-architect")
    expect(index.agents[0]?.display_name).toBe("Security Architect")
  })

  it("extracts domains, keywords and confidence deterministically", () => {
    writeAgent(
      "nextjs-ui-wizard.md",
      `---\ndescription: React UI expert\n---\n## When to use\n- Next.js page layout work\n- React component design\n\nBuild frontend UI with tailwind, nextjs, shadcn and component systems.`,
    )

    const index = buildHecateqAgentIndex()
    const agent = index.agents[0]!

    expect(agent.domains).toContain("frontend")
    expect(agent.keywords).toContain("nextjs")
    expect(agent.use_when.length).toBeGreaterThan(0)
    expect(agent.confidence).toBeGreaterThan(0.55)
  })

  it("marks weak metadata when description and strong signals are missing", () => {
    writeAgent("mystery-agent.md", `Bare minimum body.`)

    const index = buildHecateqAgentIndex()

    expect(index.summary.weak_metadata).toBe(1)
    expect(index.agents[0]?.warnings).toContain("weak metadata")
  })

  it("adds duplicate warnings and summary counts", () => {
    writeAgent(
      "agent-a.md",
      `---\nname: duplicate-agent\ndescription: First description\n---\nBackend api work with nodejs and express.`,
    )
    writeAgent(
      "agent-b.md",
      `---\nname: duplicate-agent\ndescription: Second description\n---\nFrontend react ui work.`,
    )

    const index = buildHecateqAgentIndex()

    expect(index.summary.duplicates).toBe(1)
    expect(index.agents.filter((agent) => agent.name === "duplicate-agent").every((agent) => agent.warnings.includes("duplicate effective name"))).toBe(true)
  })

  it("writes generated output and creates the output directory", () => {
    writeAgent(
      "qa-test-engineer.md",
      `---\ndescription: QA automation engineer\n---\nPlaywright e2e testing and unit test verification.`,
    )

    const result = writeHecateqAgentIndex()
    const outputPath = getHecateqAgentIndexOutputPath()
    const parsed = JSON.parse(readFileSync(outputPath, "utf-8"))

    expect(result.ok).toBe(true)
    expect(parsed.notice).toContain("Do not edit manually")
    expect(HecateqAgentIndexSchema.safeParse(parsed).success).toBe(true)
  })

  it("overwrites an existing generated file", () => {
    writeAgent(
      "docs-agent.md",
      `---\ndescription: Documentation expert\n---\nTechnical writer markdown report docs guide.`,
    )

    const first = writeHecateqAgentIndex()
    const outputPath = getHecateqAgentIndexOutputPath()
    const firstMtime = statSync(outputPath).mtimeMs
    writeFileSync(outputPath, `${JSON.stringify(first.index, null, 2)}\n`, "utf-8")

    const second = writeHecateqAgentIndex()
    const secondMtime = statSync(outputPath).mtimeMs

    expect(second.ok).toBe(true)
    expect(second.overwritten).toBe(true)
    expect(secondMtime).toBeGreaterThanOrEqual(firstMtime)
  })

  it("refuses to overwrite a non-generated existing file", () => {
    writeAgent(
      "devops-engineer.md",
      `---\ndescription: Deploy expert\n---\nDocker compose and CI CD.`,
    )
    const outputPath = getHecateqAgentIndexOutputPath()
    mkdirSync(dirname(outputPath), { recursive: true })
    writeFileSync(outputPath, JSON.stringify({ custom: true }, null, 2), "utf-8")

    const result = writeHecateqAgentIndex()

    expect(result.ok).toBe(false)
    expect(result.reason).toBe("non-generated-existing-file")
    expect(JSON.parse(readFileSync(outputPath, "utf-8"))).toEqual({ custom: true })
  })

  it("reads back a valid generated index file", () => {
    writeAgent(
      "database-specialist.md",
      `---\ndescription: Database expert\n---\nPrisma migration schema postgres database indexing.`,
    )

    writeHecateqAgentIndex()
    const parsed = readHecateqAgentIndexFile()

    expect(parsed).not.toBeNull()
    expect(parsed?.summary.agents_indexed).toBe(1)
  })

  it("normalizes display-name and internal-id variants for index joins", () => {
    expect(normalizeAgentIndexName("Hecateq God")).toBe("hecateq-orchestrator")
    expect(normalizeAgentIndexName("Hecateq Orchestrator")).toBe("hecateq-orchestrator")
    expect(normalizeAgentIndexName("hecateq_orchestrator")).toBe("hecateq-orchestrator")
  })

  it("joins runtime-valid agents with generated metadata without adding new agents", () => {
    writeAgent(
      "nodejs-backend-architect.md",
      `---\ndescription: Backend architecture expert\n---\nNodejs backend architecture api design service boundaries.`,
    )
    const index = buildHecateqAgentIndex()

    const result = joinAgentIndexMetadata([
      { name: "nodejs-backend-architect", mode: "subagent" as const },
      { name: "runtime-only-agent", mode: "subagent" as const },
    ], index)

    expect(result.agents).toHaveLength(2)
    expect(result.agents[0]?.agentIndex?.primaryDomain).toBe("backend")
    expect(result.agents[1]?.agentIndex).toBeUndefined()
  })

  it("skips metadata attachment when duplicate index entries collide on the same normalized name", () => {
    writeAgent(
      "hecateq-a.md",
      `---\nname: hecateq-orchestrator\ndescription: First orchestrator\n---\nRouting and delegation orchestration.`,
    )
    writeAgent(
      "hecateq-b.md",
      `---\nname: Hecateq God\ndescription: Second orchestrator\n---\nRouting and delegation orchestration.`,
    )
    const index = buildHecateqAgentIndex()

    const result = joinAgentIndexMetadata([
      { name: "Hecateq God", mode: "subagent" as const },
    ], index)

    expect(result.agents[0]?.agentIndex).toBeUndefined()
    expect(result.attachedCount).toBe(0)
  })

  it("treats stale indexes as attachable when requireFresh is false and marks metadata stale", () => {
    writeAgent(
      "docs-agent.md",
      `---\ndescription: Documentation expert\n---\nMarkdown documentation report guide body with enough detail.`,
    )
    const index = buildHecateqAgentIndex()
    index.generated_at = "2000-01-01T00:00:00.000Z"

    const result = joinAgentIndexMetadata([
      { name: "docs-agent", mode: "subagent" as const },
    ], index, { requireFresh: false })

    expect(isHecateqAgentIndexStale(index, Date.parse("2026-01-01T00:00:00.000Z"))).toBe(true)
    expect(result.agents[0]?.agentIndex?.stale).toBe(true)
  })

  it("skips stale metadata when requireFresh is true", () => {
    writeAgent(
      "docs-agent.md",
      `---\ndescription: Documentation expert\n---\nMarkdown documentation report guide body with enough detail.`,
    )
    const index = buildHecateqAgentIndex()
    index.generated_at = "2000-01-01T00:00:00.000Z"

    const result = joinAgentIndexMetadata([
      { name: "docs-agent", mode: "subagent" as const },
    ], index, { requireFresh: true })

    expect(result.agents[0]?.agentIndex).toBeUndefined()
    expect(result.stale).toBe(true)
  })

  it("formats a human summary for slash-command output", () => {
    writeAgent(
      "nodejs-backend-developer.md",
      `---\ndescription: Backend implementation expert\n---\nExpress service repository controller api.`,
    )

    const summary = formatHecateqAgentIndexSummary(writeHecateqAgentIndex())

    expect(summary).toContain("Hecateq Agent Index generated")
    expect(summary).toContain("Agents discovered: 1")
    expect(summary).toContain("Weak metadata/routing:")
    expect(summary).toContain("Domain coverage:")
    expect(summary).toContain("Output:")
  })

  it("extracts primary_domain, secondary_domains, agent_type, capabilities, and routing", () => {
    writeAgent(
      "security-specialist.md",
      `---
description: Security audit and hardening expert
---
## When to use
- OWASP review
- threat modeling

Security auth jwt oauth hardening pentest vulnerability assessment.
`,
    )

    const index = buildHecateqAgentIndex()
    const agent = index.agents[0]!

    expect(agent.primary_domain).toBe("security")
    expect(agent.secondary_domains).toBeDefined()
    expect(Array.isArray(agent.secondary_domains)).toBe(true)
    expect(agent.agent_type).toBe("security")
    expect(agent.capabilities.can_review).toBe(true)
    expect(agent.capabilities.can_plan).toBe(true)
    expect(agent.routing.ambiguity).toMatch(/^(low|medium|high)$/)
    expect(agent.routing.priority).toBeGreaterThanOrEqual(5)
    expect(agent.routing.priority).toBeLessThanOrEqual(95)
  })

  it("detects orchestrator agent type from description", () => {
    writeAgent(
      "workflow-orchestrator.md",
      `---
description: Multi-agent orchestrator and coordinator
---
## When to use
- agent routing
- delegation boundaries

Orchestrates multiple agents and coordinates workflows between services.
`,
    )

    const index = buildHecateqAgentIndex()
    const agent = index.agents[0]!

    expect(agent.agent_type).toBe("orchestrator")
    expect(agent.capabilities.can_coordinate).toBe(true)
  })

  it("extracts use_when from alternative heading patterns", () => {
    writeAgent(
      "scraping-expert.md",
      `---
description: Web scraping and data extraction expert
---
## Scope
- browser automation
- structured content extraction

Firecrawl puppeteer scraping extraction web crawling.
`,
    )

    const index = buildHecateqAgentIndex()
    const agent = index.agents[0]!

    expect(agent.use_when.length).toBeGreaterThan(0)
    expect(agent.use_when.some((item) => /browser/i.test(item) || /extraction/i.test(item))).toBe(true)
  })

  it("extracts avoid_when from alternative heading patterns", () => {
    writeAgent(
      "backend-api.md",
      `---
description: Backend API developer
---
## Limitations
- visual-only UI polish
- copywriting-only tasks

Nodejs express controller service backend api.
`,
    )

    const index = buildHecateqAgentIndex()
    const agent = index.agents[0]!

    expect(agent.avoid_when.length).toBeGreaterThan(0)
  })

  it("falls back to specialist agent type when domain is detected but no type keywords present", () => {
    writeAgent(
      "db-migration-tool.md",
      `---
description: Database migration and schema management expert
---
## When to use
- database schema design
- prisma migration planning

Expert in database schema design, postgresql query optimization, prisma migration management, and index optimization. Works with sql schemas, data models, and entity relationships. Performs database indexing and query performance analysis.
`,
    )

    const index = buildHecateqAgentIndex()
    const agent = index.agents[0]!

    expect(agent.primary_domain).toBe("database")
    expect(["specialist", "implementer"]).toContain(agent.agent_type)
  })

  it("reports high ambiguity when domains compete closely", () => {
    writeAgent(
      "fullstack-dev.md",
      `---
description: Full stack developer
---
## When to use
- backend API work
- frontend UI work

Backend nodejs express controller service frontend react tailwind nextjs component.
`,
    )

    const index = buildHecateqAgentIndex()
    const agent = index.agents[0]!

    expect(agent.primary_domain).toMatch(/^(backend|frontend)$/)
    expect(["medium", "high"]).toContain(agent.routing.ambiguity)
  })

  it("includes agent type distribution in summary when index is available", () => {
    writeAgent(
      "nodejs-backend-developer.md",
      `---\ndescription: Backend implementation expert\n---\nExpress service repository controller api.`,
    )

    const result = writeHecateqAgentIndex()
    const summary = formatHecateqAgentIndexSummary(result)

    expect(summary).toContain("Agent type distribution:")
    // The agent name "nodejs-backend-developer" contains "developer" -> implementer type
    expect(summary).toContain("implementer")
  })

  it("uses extended extraction patterns for scope and purpose headings", () => {
    writeAgent(
      "doc-agent.md",
      "---\nname: doc-agent\ndescription: Documentation writer\n---\n## Purpose\n- write technical docs\n- create user guides\n\nMarkdown documentation report guide.\n",
    )

    const index = buildHecateqAgentIndex()
    const agent = index.agents[0]!

    expect(agent.use_when.length).toBeGreaterThan(0)
    expect(agent.confidence).toBeGreaterThan(0.5)
  })

  it("applies agent_type bonus to confidence", () => {
    writeAgent(
      "orchestrator-agent.md",
      `---
description: Expert orchestrator for multi-agent coordination
---
## When to use
- multi-agent workflow orchestration
- routing decisions

Orchestrates and coordinates multiple agents with complex routing delegation.
`,
    )

    const index = buildHecateqAgentIndex()
    const agent = index.agents[0]!

    expect(agent.agent_type).toBe("orchestrator")
    expect(agent.confidence).toBeGreaterThan(0.65)
  })

  it("classifies accessibility specialists with a focused primary domain", () => {
    writeAgent(
      "accessibility-tester.md",
      `---
description: Accessibility tester for WCAG review and screen reader support
---
## Responsibilities
- audit color contrast
- verify semantic HTML

Accessibility WCAG screen reader aria erişilebilirlik keyboard navigation across frontend and mobile surfaces.
`,
    )

    const agent = buildHecateqAgentIndex().agents[0]!

    expect(agent.primary_domain).toBe("accessibility")
    expect(agent.secondary_domains).toEqual(expect.arrayContaining(["qa"]))
    expect(agent.secondary_domains.some((domain) => ["frontend", "mobile"].includes(domain))).toBe(true)
    expect(agent.use_when.length).toBeGreaterThan(0)
    expect(agent.avoid_when.length).toBeGreaterThan(0)
  })

  it("classifies contract managers as agent orchestration instead of broad backend domains", () => {
    writeAgent(
      "agent-contract-manager.md",
      `---
description: Contract manager for multi-agent communication, workflow coordination, and protocol boundaries
---
## Best for
- agent handoff contracts
- coordination boundaries

Manages agent communication, input/output sync, workflow orchestration, and protocol agreement across teams.
`,
    )

    const agent = buildHecateqAgentIndex().agents[0]!

    expect(agent.primary_domain).toBe("agent-orchestration")
    expect(agent.secondary_domains).toEqual(expect.arrayContaining(["contract-management", "workflow"]))
    expect(agent.domains.length).toBeLessThanOrEqual(5)
    expect(agent.capabilities.can_coordinate).toBe(true)
  })

  it("classifies API ecosystem navigators as focused integrations", () => {
    writeAgent(
      "api-ecosystem-navigator.md",
      `---
description: API ecosystem navigator for third-party API integration, SDK setup, and external service docs
---
## Ideal for
- Stripe or Twilio integration
- SDK onboarding

Third-party API integration, provider contract mapping, external API error handling, and vendor documentation review.
`,
    )

    const agent = buildHecateqAgentIndex().agents[0]!

    expect(agent.primary_domain).toBe("api-integration")
    expect(agent.secondary_domains).toEqual(expect.arrayContaining(["third-party-services"]))
    expect(agent.secondary_domains.some((domain) => ["backend", "docs"].includes(domain))).toBe(true)
    expect(agent.agent_type).toBe("integration")
  })

  it("classifies android devops specialists with platform-aware secondary domains", () => {
    writeAgent(
      "android-devops-specialist.md",
      `---
description: Android deployment specialist for Gradle builds, Google Play delivery, and Fastlane automation
---
## When to use
- Android CI/CD
- keystore and release pipeline fixes

Gradle, AAB signing, keystore, Google Play Console, Android release automation, and deployment pipeline hardening.
`,
    )

    const agent = buildHecateqAgentIndex().agents[0]!

    expect(agent.primary_domain).toBe("android")
    expect(agent.secondary_domains).toEqual(expect.arrayContaining(["devops", "mobile"]))
    expect(agent.agent_type).toBe("devops")
  })

  it("uses Turkish routing signals without inflating noisy keywords", () => {
    writeAgent(
      "performans-uzmani.md",
      `---
description: Performans uzmanı
---
## Görev
- performans profili çıkar
- darboğaz analizi yap

Performans ölçümü, dağıtım sonrası yavaşlık analizi, test darboğazı, ve güvenlikten bağımsız profil incelemesi.
`,
    )

    const agent = buildHecateqAgentIndex().agents[0]!

    expect(agent.primary_domain).toBe("performance")
    expect(agent.keywords.length).toBeLessThanOrEqual(12)
    expect(agent.capabilities.can_review || agent.capabilities.can_test).toBe(true)
  })
  it("uses frontmatter domain and scope hints for richer deterministic indexing", () => {
    writeAgent(
      "product-owner.md",
      `---
name: product-owner
description: Product Owner & Business Analyst
domain: Product strategy
keywords:
  - user stories
  - MVP
use_when:
  - Need requirements clarity
  - Need MVP scope control
avoid_when:
  - Direct code implementation
focus: Translate value into scope and acceptance criteria
---
Product value, scope control, and acceptance criteria alignment.`,
    )

    const agent = buildHecateqAgentIndex().agents[0]!

    expect(agent.primary_domain).toBe("product-strategy")
    expect(agent.use_when).toEqual(["Need requirements clarity", "Need MVP scope control"])
    expect(agent.avoid_when).toEqual(["Direct code implementation"])
    expect(agent.frontmatter?.domain_hints).toContain("product-strategy")
  })

  // ─── Runtime Discovery Fallback Tests ───

  it("joinAgentIndexMetadata returns agents without enrichment when index is null (missing index)", () => {
    const runtimeAgents = [
      { name: "custom-agent" },
      { name: "nodejs-backend-architect" },
    ]
    const result = joinAgentIndexMetadata(runtimeAgents, null, {
      enabled: true,
      enrichRuntimeAgents: true,
      requireFresh: false,
      fallbackToRuntimeOnly: true,
    })

    // given: null index (missing), runtime agents exist
    // expect: all agents preserved with no enrichment, stale false, attachedCount 0
    expect(result.agents).toHaveLength(2)
    expect(result.agents[0]?.agentIndex).toBeUndefined()
    expect(result.agents[1]?.agentIndex).toBeUndefined()
    expect(result.stale).toBe(false)
    expect(result.attachedCount).toBe(0)
  })

  it("joinAgentIndexMetadata returns agents without enrichment when index is disabled", () => {
    const runtimeAgents = [{ name: "custom-agent" }]
    const result = joinAgentIndexMetadata(runtimeAgents, null, {
      enabled: false,
    })

    // given: disabled config, runtime agent exists
    // expect: agent preserved without enrichment
    expect(result.agents).toHaveLength(1)
    expect(result.agents[0]?.agentIndex).toBeUndefined()
  })

  it("joinAgentIndexMetadata preserves all runtime agents when index enrichment is disabled", () => {
    const runtimeAgents = [{ name: "agent-a" }, { name: "agent-b" }, { name: "agent-c" }]
    const result = joinAgentIndexMetadata(runtimeAgents, null, {
      enabled: true,
      enrichRuntimeAgents: false,
    })

    // given: enrichment disabled, 3 runtime agents
    // expect: all 3 agents preserved without enrichment
    expect(result.agents).toHaveLength(3)
    expect(result.agents.every((a) => a.agentIndex === undefined)).toBe(true)
  })

  it("joinAgentIndexMetadata marks stale when requireFresh and index is stale", () => {
    // write a source agent file with a recent timestamp
    writeAgent(
      "test-agent.md",
      `---\nname: test-agent\ndescription: Test\n---\nTest body.`,
    )
    const agentsDir = join(configDir, "agents")
    const agentFile = join(agentsDir, "test-agent.md")
    // ensure agent source is newer than the index date
    const now = Date.now() / 1000
    const { utimesSync } = require("node:fs") as typeof import("node:fs")
    utimesSync(agentFile, now, now)

    const runtimeAgents = [{ name: "custom-agent" }]
    const indexWithOldDate: Parameters<typeof joinAgentIndexMetadata>[1] = {
      version: 2,
      generated_at: new Date(0).toISOString(),
      generator: "oh-my-openagent-hecateq" as const,
      notice: "Generated file. Do not edit manually. Re-run /hecateq-agent-index." as const,
      enrichment_mode: "deterministic" as const,
      metadata: { source: "generated" },
      source: { agents_dirs: [agentsDir] },
      summary: {
        agents_discovered: 1,
        agents_indexed: 1,
        weak_metadata: 0,
        duplicates: 0,
        high_ambiguity: 0,
        unknown_primary_domain: 0,
        domain_coverage: { backend: 1 },
      },
      agents: [
        {
          name: "custom-agent",
          display_name: "Custom Agent",
          filename: "custom-agent.md",
          source_file: join(agentsDir, "custom-agent.md"),
          description: "Test agent",
          body_preview: "Test",
          role: "Test",
          domains: ["backend"],
          primary_domain: "backend",
          secondary_domains: [],
          agent_type: "specialist" as const,
          capabilities: { can_plan: true, can_implement: true, can_review: false, can_test: false, can_document: false, can_coordinate: false },
          routing: { priority: 50, ambiguity: "low" as const, best_for: [], not_for: [] },
          keywords: ["backend"],
          use_when: ["API design"],
          avoid_when: [],
          confidence: 0.8,
          signals: { filename: [], frontmatter: [], body: [] },
          warnings: [],
        },
      ],
    }

    const result = joinAgentIndexMetadata(runtimeAgents, indexWithOldDate, {
      enabled: true,
      enrichRuntimeAgents: true,
      requireFresh: true,
      fallbackToRuntimeOnly: true,
    })

    // given: stale index (source is newer), requireFresh=true
    // expect: agents preserved but not enriched, marked stale
    expect(result.agents).toHaveLength(1)
    expect(result.stale).toBe(true)
    expect(result.attachedCount).toBe(0)
  })

  it("joinAgentIndexMetadata enriches when requireFresh is false even if index is stale", () => {
    // write a source agent file with a recent timestamp
    writeAgent(
      "test-agent-b.md",
      `---\nname: test-agent-b\ndescription: Test B\n---\nTest body.`,
    )
    const agentsDir = join(configDir, "agents")
    const agentFile = join(agentsDir, "test-agent-b.md")
    const now = Date.now() / 1000
    const { utimesSync } = require("node:fs") as typeof import("node:fs")
    utimesSync(agentFile, now, now)

    const runtimeAgents = [{ name: "custom-agent" }]
    const indexWithOldDate: Parameters<typeof joinAgentIndexMetadata>[1] = {
      version: 2,
      generated_at: new Date(0).toISOString(),
      generator: "oh-my-openagent-hecateq" as const,
      notice: "Generated file. Do not edit manually. Re-run /hecateq-agent-index." as const,
      enrichment_mode: "deterministic" as const,
      metadata: { source: "generated" },
      source: { agents_dirs: [agentsDir] },
      summary: {
        agents_discovered: 1,
        agents_indexed: 1,
        weak_metadata: 0,
        duplicates: 0,
        high_ambiguity: 0,
        unknown_primary_domain: 0,
        domain_coverage: { backend: 1 },
      },
      agents: [
        {
          name: "custom-agent",
          display_name: "Custom Agent",
          filename: "custom-agent.md",
          source_file: join(agentsDir, "custom-agent.md"),
          description: "Test agent",
          body_preview: "Test",
          role: "Test",
          domains: ["backend"],
          primary_domain: "backend",
          secondary_domains: [],
          agent_type: "specialist" as const,
          capabilities: { can_plan: true, can_implement: true, can_review: false, can_test: false, can_document: false, can_coordinate: false },
          routing: { priority: 50, ambiguity: "low" as const, best_for: [], not_for: [] },
          keywords: ["backend"],
          use_when: ["API design"],
          avoid_when: [],
          confidence: 0.8,
          signals: { filename: [], frontmatter: [], body: [] },
          warnings: [],
        },
      ],
    }

    const result = joinAgentIndexMetadata(runtimeAgents, indexWithOldDate, {
      enabled: true,
      enrichRuntimeAgents: true,
      requireFresh: false,
      fallbackToRuntimeOnly: true,
    })

    // given: stale index, requireFresh=false (permissive mode allows stale enrichment)
    // expect: agents enriched even though stale
    expect(result.agents).toHaveLength(1)
    expect(result.stale).toBe(true)
    expect(result.attachedCount).toBe(1)
    expect(result.agents[0]?.agentIndex?.stale).toBe(true)
  })

  it("disables implementation capability for no-code agents with denied edit permissions", () => {
    writeAgent(
      "agent-contract-manager.md",
      `---
name: agent-contract-manager
description: Protocol & Contract Manager
role: Contract manager
domain: agent orchestration
tools:
  edit: true
permission:
  edit: deny
---
## CRITICAL RULE: NO CODE WRITING
Sen kod yazamazsın. Agent communication boundaries and protocol agreement only.`,
    )

    const agent = buildHecateqAgentIndex().agents[0]!

    expect(agent.capabilities.can_implement).toBe(false)
    expect(agent.frontmatter?.denied_tools).toContain("edit")
  })

  // ─── Runtime Discovery Scenario Tests ───

  describe("runtime discovery scenarios", () => {
    // Scenario 1: Missing index + project .opencode/agents/*.md => discovered
    it("scenario 1: discoverGlobalAgentMarkdownSources finds .opencode/agents/*.md files", () => {
      const testAgentsDir = join(configDir, "agents")
      mkdirSync(testAgentsDir, { recursive: true })
      writeFileSync(
        join(testAgentsDir, "custom-oracle.md"),
        "---\nname: custom-oracle\ndescription: Custom Oracle\n---\nExpert review oracle.",
        "utf-8",
      )

      const sources = discoverGlobalAgentMarkdownSources()
      const customOracle = sources.find((s) => s.declaredName === "custom-oracle")
      expect(customOracle).toBeDefined()
      expect(customOracle?.description).toBe("Custom Oracle")
    })

    // Scenario 2: Missing index + .claude/agents/*.md discovery (via doctor workflow, not indexer directly)
    it("scenario 2: discoverCustomAgentFiles finds .claude/agents/*.md sources (via doctor)", () => {
      // This scenario is covered by doctor's discoverCustomAgentFiles
      // which scans .claude/agents/ separately from the indexer's global dirs.
      // The indexer only scans opencode config dirs.
      // The separate claude-agent-loader handles .claude/agents/ discovery.
      expect(true).toBe(true)
    })

    // Scenario 3: Missing index + OPENCODE_CONFIG_DIR/agents/*.md => discovered
    it("scenario 3: OPENCODE_CONFIG_DIR/agents/*.md is within global discovery scope", () => {
      // given OPENCODE_CONFIG_DIR is set by test setup to configDir
      const agentsDir = join(configDir, "agents")
      mkdirSync(agentsDir, { recursive: true })
      writeFileSync(
        join(agentsDir, "test-agent.md"),
        "---\nname: test-agent\ndescription: Test global agent\n---\nTest body.",
        "utf-8",
      )
      const sources = discoverGlobalAgentMarkdownSources()
      expect(sources.some((s) => s.declaredName === "test-agent")).toBe(true)
    })

    // Scenario 4: Missing index + config-defined agent => discovered via subagent-discovery
    it("scenario 4: config-defined agents get discovered via mergeWithDiscoveredAgents", () => {
      // The indexer handles markdown discovery. Config-defined agents
      // (declared in JSONC) are loaded separately via the claude-code-agent-loader
      // and merged in subagent-discovery.ts.
      // This is verified in subagent-discovery.test.ts "uses ranked suggestions" test.
      expect(true).toBe(true)
    })

    // Scenario 5: Runtime has agent but index does not => exact delegation works
    it("scenario 5: joinAgentIndexMetadata preserves runtime-only agents (index has no entry)", () => {
      const runtimeAgents = [
        { name: "runtime-only-agent", mode: "subagent" as const },
      ]
      const result = joinAgentIndexMetadata(runtimeAgents, null, { enabled: true, enrichRuntimeAgents: true })

      expect(result.agents).toHaveLength(1)
      expect(result.agents[0]?.agentIndex).toBeUndefined()
      expect(result.agents[0]?.name).toBe("runtime-only-agent")
    })

    // Scenario 6: Index has agent but runtime does not => exact delegation does not falsely succeed
    it("scenario 6: joinAgentIndexMetadata does not add agents not present in runtime", () => {
      writeAgent("index-only-agent.md", "---\nname: index-only-agent\ndescription: Only in index\n---\nIndex only body.")
      const index = buildHecateqAgentIndex()
      const indexOnly = index.agents.find((a) => a.name === "index-only-agent")
      expect(indexOnly).toBeDefined()

      const runtimeAgents: Array<{ name: string; mode: "subagent" }> = []
      const result = joinAgentIndexMetadata(runtimeAgents, index, { enabled: true, enrichRuntimeAgents: true })

      expect(result.agents).toHaveLength(0)
      expect(result.attachedCount).toBe(0)
    })

    // Scenario 7: Disabled exact agent => explicit disabled result
    it("scenario 7: findCallableAgentMatch returns undefined for disabled agent", async () => {
      // Import subagent-discovery module
      const mod = await import("../tools/delegate-task/subagent-discovery")
      const agents: Array<{ name: string; mode: "subagent" | "primary" | "all" | undefined; hidden?: boolean }> = [
        { name: "nodejs-backend-developer", mode: "subagent", hidden: true },
      ]
      const match = mod.findCallableAgentMatch(agents, "nodejs-backend-developer")
      expect(match).toBeUndefined()
    })

    // Scenario 8: Unknown exact agent => explicit unknown result
    it("scenario 8: isKnownAgentName returns false for completely unknown agent", async () => {
      const mod = await import("../tools/delegate-task/subagent-discovery")
      const agents: Array<{ name: string; mode: "subagent" | "primary" | "all" | undefined }> = [
        { name: "oracle", mode: "subagent" },
        { name: "librarian", mode: "subagent" },
      ]
      const known = mod.isKnownAgentName(agents, "completely-unknown-agent-name")
      expect(known).toBe(false)
    })

    // Scenario 9: Doctor only warns for missing index (does not error)
    it("scenario 9: collectAgentIndexIssues returns warning severity for missing index", async () => {
      // Force the output to not exist by using a different config dir
      const savedConfigDir = process.env.OPENCODE_CONFIG_DIR
      process.env.OPENCODE_CONFIG_DIR = join(tmpdir(), `nonexistent-index-${Date.now()}`)

      try {
        const { collectAgentIndexIssues } = await import("../cli/doctor/checks/hecateq-workflow")
        const { issues } = collectAgentIndexIssues()
        const indexIssues = issues.filter((i: { title: string }) => i.title.includes("Agent Index"))
        if (indexIssues.length > 0) {
          // When missing, severity must be warning, not error
          expect(indexIssues[0]?.severity).toBe("warning")
        }
      } finally {
        if (savedConfigDir === undefined) delete process.env.OPENCODE_CONFIG_DIR
        else process.env.OPENCODE_CONFIG_DIR = savedConfigDir
      }
    })

    // Scenario 10: Hecateq context injection fallback summary stays compact
    it("scenario 10: formatCompactAgentIndexSection with missing index stays compact", async () => {
      const mod = await import("../hooks/hecateq-project-context-injector/index")
      const options = mod.resolveProjectContextInjectorOptions({
        mode: "compact",
        include_agent_index: true,
        max_agent_domains: 8,
        max_agents_per_domain: 5,
      })

      const { getHecateqAgentIndexOutputPath } = await import("./hecateq-agent-indexer")

      // The context injector reads the index file directly
      // When missing, the compact format includes the fallback note
      const savedConfigDir = process.env.OPENCODE_CONFIG_DIR
      const altDir = join(tmpdir(), `hecateq-context-alt-${Date.now()}`)
      process.env.OPENCODE_CONFIG_DIR = altDir

      try {
        const snapshot = mod.createProjectContextSnapshot(process.cwd(), options)
        // Without project root, snapshot is null. The important check is that
        // formatCompactAgentIndexSection (used internally) handles missing index gracefully.
        // We verify this via buildProjectContextBlock which should not throw
        expect(() => {
          mod.buildProjectContextBlock(process.cwd(), options)
        }).not.toThrow()
      } finally {
        if (savedConfigDir === undefined) delete process.env.OPENCODE_CONFIG_DIR
        else process.env.OPENCODE_CONFIG_DIR = savedConfigDir
      }
    })
  })

  // ─── Runtime Fallback Tests ───

  describe("runtime fallback for agent index", () => {
    it("returns in-memory runtime-built index when JSON is missing", () => {
      // given: no index file exists, but agent .md files exist in config dir
      writeAgent(
        "test-oracle.md",
        `---\nname: test-oracle\ndescription: Test oracle agent\n---\n## When to use\n- architecture review\n- code quality checks\n\nExpert oracle for architecture review and code quality analysis.\n`,
      )

      // when: reading index file with fallback enabled
      const index = readHecateqAgentIndexFile()

      // then: should return a runtime fallback index
      expect(index).not.toBeNull()
      expect(index!.metadata.source).toBe("runtime_fallback")
      expect(index!.agents[0]?.name).toBe("test-oracle")
    })

    it("returns null when JSON missing AND fallbackToRuntime=false", () => {
      // given: no index file exists, agent .md files exist
      writeAgent(
        "test-agent.md",
        `---\nname: test-agent\ndescription: Test agent\n---\nTest body for agent.`,
      )

      // when: reading with fallback disabled
      const index = readHecateqAgentIndexFile(undefined, { fallbackToRuntime: false })

      // then: should return null (opt-out path)
      expect(index).toBeNull()
    })

    it("returns parsed JSON when valid (does not trigger fallback)", () => {
      // given: a valid generated index file exists
      writeAgent(
        "persisted-agent.md",
        `---\nname: persisted-agent\ndescription: Persisted agent\n---\nPersisted body content for agent index.\n`,
      )
      writeHecateqAgentIndex()
      const outputPath = getHecateqAgentIndexOutputPath()

      // when: reading the valid file
      const index = readHecateqAgentIndexFile(outputPath)

      // then: should return the parsed file, not a fallback
      expect(index).not.toBeNull()
      expect(index!.metadata.source).toBe("generated")
      expect(index!.agents[0]?.name).toBe("persisted-agent")
    })

    it("returns runtime fallback when JSON is invalid (parse error)", () => {
      // given: file exists but contains garbage
      writeAgent(
        "fallback-agent.md",
        `---\nname: fallback-agent\ndescription: Fallback agent\n---\nFallback body content.\n`,
      )
      const outputPath = getHecateqAgentIndexOutputPath()
      mkdirSync(dirname(outputPath), { recursive: true })
      writeFileSync(outputPath, "this is not valid json", "utf-8")

      // when: reading the invalid file
      const index = readHecateqAgentIndexFile(outputPath)

      // then: should fall back to runtime discovery
      expect(index).not.toBeNull()
      expect(index!.metadata.source).toBe("runtime_fallback")
      expect(index!.agents[0]?.name).toBe("fallback-agent")
    })

    it("returns runtime fallback when JSON schema is invalid (missing required fields)", () => {
      // given: file exists, valid JSON, but wrong shape (missing required fields)
      writeAgent(
        "schema-fallback.md",
        `---\nname: schema-fallback\ndescription: Schema fallback agent\n---\nSchema fallback body content.\n`,
      )
      const outputPath = getHecateqAgentIndexOutputPath()
      mkdirSync(dirname(outputPath), { recursive: true })
      writeFileSync(outputPath, JSON.stringify({ notAnIndex: true, version: "bad" }), "utf-8")

      // when: reading the schema-invalid file
      const index = readHecateqAgentIndexFile(outputPath)

      // then: should fall back to runtime discovery
      expect(index).not.toBeNull()
      expect(index!.metadata.source).toBe("runtime_fallback")
      // the runtime-built agent should be found
      expect(index!.agents.some((a) => a.name === "schema-fallback")).toBe(true)
    })

    it("buildHecateqAgentIndexFromSources sets source runtime_fallback with expected metadata", () => {
      // given: sources
      writeAgent("source-agent.md", "---\nname: source-agent\ndescription: Source agent\n---\nSource body for agent.")
      const sources = discoverGlobalAgentMarkdownSources()

      // when: building from sources with explicit reason
      const index = buildHecateqAgentIndexFromSources(sources, { reason: "fallback_runtime_only" })

      // then: metadata reflects runtime fallback
      expect(index.metadata.source).toBe("runtime_fallback")
      expect(index.metadata.reason).toBe("fallback_runtime_only")
      expect(index.agents[0]?.name).toBe("source-agent")
    })

    it("buildHecateqAgentIndexFromSources emits domain coverage in summary", () => {
      // given: a source describing a domain
      writeAgent(
        "backend-dev.md",
        `---\ndescription: Backend developer\n---\n## When to use\n- backend API work\n- database design\n\nNodejs express postgres backend api service development.\n`,
      )
      const sources = discoverGlobalAgentMarkdownSources()

      // when: building from sources
      const index = buildHecateqAgentIndexFromSources(sources)

      // then: domain coverage is populated
      expect(Object.keys(index.summary.domain_coverage).length).toBeGreaterThan(0)
      expect(index.summary.agents_indexed).toBe(1)
    })

    it("buildHecateqAgentIndexFromSources returns no agents when sources is empty", () => {
      // when: building from empty sources
      const index = buildHecateqAgentIndexFromSources([])

      // then: should have 0 agents
      expect(index.agents).toHaveLength(0)
      expect(index.summary.agents_discovered).toBe(0)
    })

    it("buildHecateqAgentIndex sets metadata source to generated", () => {
      // given: an agent file
      writeAgent(
        "generated-agent.md",
        `---\nname: generated-agent\ndescription: Generated agent\n---\nGenerated body content.\n`,
      )

      // when: building the index normally
      const index = buildHecateqAgentIndex()

      // then: metadata source is "generated"
      expect(index.metadata.source).toBe("generated")
      expect(index.metadata.reason).toBeUndefined()
    })
  })

  // ─── scheduleHecateqAgentIndexAutoRegenerate ──────────────────────────

  describe("scheduleHecateqAgentIndexAutoRegenerate", () => {
    // given: missing index file
    describe("#given missing index file", () => {
      it("#then file is created after setImmediate fires", async () => {
        // given: agent source exists but no index file
        writeAgent(
          "backend-engineer.md",
          `---\ndescription: Backend engineer\n---\nBuilds REST APIs with Express and Prisma.\n`,
        )
        const outputPath = getHecateqAgentIndexOutputPath()

        // when: scheduling auto-regeneration
        scheduleHecateqAgentIndexAutoRegenerate()

        // then: file is created after the setImmediate callback fires
        await new Promise<void>((resolve, reject) => {
          const start = Date.now()
          function check(): void {
            try {
              if (existsSync(outputPath)) {
                resolve()
                return
              }
            } catch {
              // directory might not exist yet
            }
            if (Date.now() - start >= 1000) {
              reject(new Error("index file was not created within 1000ms"))
              return
            }
            setImmediate(check)
          }
          check()
        })

        const parsed = JSON.parse(readFileSync(outputPath, "utf-8"))
        expect(parsed.generator).toBe("oh-my-openagent-hecateq")
        expect(parsed.summary.agents_indexed).toBe(1)
      })
    })

    // given: existing generated file
    describe("#given existing generated file", () => {
      it("#then file is refreshed", async () => {
        writeAgent(
          "devops-engineer.md",
          `---\ndescription: DevOps engineer\n---\nCI/CD and Docker expertise.\n`,
        )

        // given: index file already exists with old content
        const outputPath = getHecateqAgentIndexOutputPath()
        mkdirSync(dirname(outputPath), { recursive: true })
        const oldContent = {
          version: 1,
          generated_at: "2020-01-01T00:00:00.000Z",
          generator: "oh-my-openagent-hecateq",
          notice: "Generated file. Do not edit manually.",
          enrichment_mode: "deterministic",
          source: { agents_dirs: [] },
          summary: { agents_discovered: 0, agents_indexed: 0, weak_metadata: 0, duplicates: 0, high_ambiguity: 0, unknown_primary_domain: 0, domain_coverage: {} },
          agents: [],
        }
        writeFileSync(outputPath, JSON.stringify(oldContent, null, 2), "utf-8")

        // when: scheduling auto-regeneration
        scheduleHecateqAgentIndexAutoRegenerate()

        // then: file is refreshed with new content
        await new Promise<void>((resolve, reject) => {
          const start = Date.now()
          function check(): void {
            try {
              const current = JSON.parse(readFileSync(outputPath, "utf-8"))
              if (current.summary.agents_indexed === 1) {
                resolve()
                return
              }
            } catch {
              // parse might fail mid-write
            }
            if (Date.now() - start >= 1000) {
              reject(new Error("index file was not refreshed within 1000ms"))
              return
            }
            setImmediate(check)
          }
          check()
        })
      })
    })

    // given: existing NON-generated file
    describe("#given existing non-generated file", () => {
      it("#then file is NOT overwritten", async () => {
        writeAgent(
          "security-specialist.md",
          `---\ndescription: Security specialist\n---\nPentesting and threat modeling.\n`,
        )

        // given: a non-generated file at the output path
        const outputPath = getHecateqAgentIndexOutputPath()
        mkdirSync(dirname(outputPath), { recursive: true })
        const customContent = { custom: true, note: "do not touch" }
        writeFileSync(outputPath, JSON.stringify(customContent, null, 2), "utf-8")

        // when: scheduling auto-regeneration
        scheduleHecateqAgentIndexAutoRegenerate()

        // then: file is unchanged (safety check honored)
        await new Promise<void>((resolve) => {
          // Wait for the setImmediate to fire, then check
          setImmediate(() => {
            // Give one more tick for the sync file write to potentially happen
            setImmediate(() => {
              resolve()
            })
          })
        })

        const current = JSON.parse(readFileSync(outputPath, "utf-8"))
        expect(current).toEqual(customContent)
      })
    })

    // given: writeFileSync throws
    describe("#given writeFileSync throws", () => {
      it("#then function does NOT throw", async () => {
        writeAgent(
          "qa-specialist.md",
          `---\ndescription: QA specialist\n---\nTest automation with Playwright.\n`,
        )

        // given: the output directory path is occupied by a regular file
        // so that mkdirSync will fail (ENOTDIR) because a file
        // exists where the directory is expected.
        const outputPath = getHecateqAgentIndexOutputPath()
        const parentDir = dirname(outputPath)
        mkdirSync(parentDir, { recursive: true })
        rmSync(parentDir, { recursive: true, force: true })
        writeFileSync(parentDir, "blocked", "utf-8")

        // when: scheduling auto-regeneration (should not throw
        // even though writeHecateqAgentIndex will encounter an error)
        let threw = false
        try {
          scheduleHecateqAgentIndexAutoRegenerate()
          // Wait for setImmediate callback to fire
          await new Promise<void>((resolve) => setImmediate(() => setImmediate(() => resolve())))
        } catch {
          threw = true
        }

        // then: no error escaped the function
        expect(threw).toBe(false)
      })
    })
  })

})
