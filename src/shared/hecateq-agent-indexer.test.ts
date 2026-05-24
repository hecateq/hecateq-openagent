import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import {
  HecateqAgentIndexSchema,
  buildHecateqAgentIndex,
  discoverGlobalAgentMarkdownSources,
  formatHecateqAgentIndexSummary,
  getHecateqAgentIndexOutputPath,
  isHecateqAgentIndexStale,
  joinAgentIndexMetadata,
  normalizeAgentIndexName,
  readHecateqAgentIndexFile,
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

})
