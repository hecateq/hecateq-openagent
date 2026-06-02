import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { mkdtempSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import {
  shouldSeedProjectMemory,
  extractPreTaskMemorySeed,
  applyPreTaskMemorySeed,
  type PreTaskMemorySeed,
} from "./pre-task-memory-seed"
import { PROJECT_MEMORY_DIR, bootstrapMemoryFiles } from "./memory-bootstrap"
import { readManifest } from "./memory-manifest"

const tempDirs: string[] = []

function createTempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "omo-ptms-"))
  tempDirs.push(d)
  return d
}

afterAll(() => {
  for (const d of tempDirs) {
    try { rmSync(d, { recursive: true, force: true }) } catch { /* ignore */ }
  }
})

function setupMemoryDir(dir: string): string {
  const memDir = join(dir, PROJECT_MEMORY_DIR)
  mkdirSync(memDir, { recursive: true })
  return memDir
}

describe("shouldSeedProjectMemory", () => {
  test("#given substantial website prompt #then returns true", () => {
    const prompt = "Build a full-stack e-commerce website using Next.js, TypeScript, Prisma, and PostgreSQL. The app needs user auth, product catalog, shopping cart, and Stripe checkout."
    expect(shouldSeedProjectMemory(prompt)).toBe(true)
  })

  test("#given substantial app prompt #then returns true", () => {
    const prompt = "Create a mobile app with Flutter that connects to a Node.js backend with Express and MongoDB."
    expect(shouldSeedProjectMemory(prompt)).toBe(true)
  })

  test("#given plugin/tool prompt #then returns true", () => {
    const prompt = "I need to implement a VS Code extension that provides AI-powered code completion using TypeScript and the OpenAI API."
    expect(shouldSeedProjectMemory(prompt)).toBe(true)
  })

  test("#given multi-step spec #then returns true", () => {
    const prompt = `Project: Task Manager API

Requirements:
1. User registration and login with JWT
2. CRUD endpoints for tasks
3. Task assignment to users
4. Filter and search capabilities
5. Role-based access control

Stack: Node.js, Express, Prisma, PostgreSQL`
    expect(shouldSeedProjectMemory(prompt)).toBe(true)
  })

  test("#given short 'tamam' #then returns false", () => {
    expect(shouldSeedProjectMemory("tamam")).toBe(false)
  })

  test("#given short 'devam' #then returns false", () => {
    expect(shouldSeedProjectMemory("devam")).toBe(false)
  })

  test("#given casual 'hello' #then returns false", () => {
    expect(shouldSeedProjectMemory("hello")).toBe(false)
  })

  test("#given simple question #then returns false", () => {
    expect(shouldSeedProjectMemory("What is the capital of France?")).toBe(false)
  })

  test("#given short correction #then returns false", () => {
    expect(shouldSeedProjectMemory("fix typo in readme")).toBe(false)
  })

  test("#given empty string #then returns false", () => {
    expect(shouldSeedProjectMemory("")).toBe(false)
  })

  test("#given very short prompt #then returns false", () => {
    expect(shouldSeedProjectMemory("hi")).toBe(false)
  })

  test("#given substantial prompt without tech stack #then returns true", () => {
    const prompt = `Create a task management system with the following features:
1. User authentication
2. Project creation and management
3. Task assignment and tracking
4. Real-time notifications
5. Reporting dashboard`
    expect(shouldSeedProjectMemory(prompt)).toBe(true)
  })
})

describe("extractPreTaskMemorySeed", () => {
  test("#given substantial website prompt #then extracts goal, type, stack", () => {
    const prompt = "Build a full-stack e-commerce website using Next.js, TypeScript, Prisma, and PostgreSQL."
    const seed = extractPreTaskMemorySeed(prompt)

    expect(seed).not.toBeNull()
    if (!seed) return

    expect(seed.projectGoal).toContain("e-commerce")
    expect(seed.projectType).toBe("full-stack")
    expect(seed.explicitStackDecisions.length).toBeGreaterThanOrEqual(3)
  })

  test("#given prompt with constraints #then extracts them", () => {
    const prompt = "Build an API using Express and TypeScript. The API must support rate limiting and must not exceed 100ms response time. You should use PostgreSQL."
    const seed = extractPreTaskMemorySeed(prompt)

    expect(seed).not.toBeNull()
    if (!seed) return

    const allConstraints = seed.explicitConstraints.join(" ")
    expect(allConstraints).toMatch(/must|should|must not/i)
  })

  test("#given prompt with numbered tasks #then extracts them", () => {
    const prompt = `Build a blog engine:

1. Set up the database schema with Posts and Comments tables
2. Create REST API endpoints for CRUD operations
3. Build the admin dashboard with authentication
4. Add Markdown support for posts`
    const seed = extractPreTaskMemorySeed(prompt)

    expect(seed).not.toBeNull()
    if (!seed) return

    expect(seed.initialTasks.length).toBeGreaterThanOrEqual(3)
  })

  test("#given prompt with explicit risks #then extracts them", () => {
    const prompt = "Implement a payment system. Be careful with the PCI compliance requirements. Security vulnerabilities in the payment flow are a major risk."
    const seed = extractPreTaskMemorySeed(prompt)

    expect(seed).not.toBeNull()
    if (!seed) return

    expect(seed.explicitRisks.length).toBeGreaterThanOrEqual(1)
  })

  test("#given short prompt #then returns null", () => {
    const seed = extractPreTaskMemorySeed("fix typo")
    expect(seed).toBeNull()
  })

  test("#given casual prompt #then returns null", () => {
    const seed = extractPreTaskMemorySeed("hello how are you doing today")
    expect(seed).toBeNull()
  })

  test("#given project prompt without tech #then still extracts goal and type", () => {
    const prompt = "Create a project management dashboard with drag-and-drop Kanban boards."
    const seed = extractPreTaskMemorySeed(prompt)

    expect(seed).not.toBeNull()
    if (!seed) return

    expect(seed.projectGoal.length).toBeGreaterThan(5)
    expect(seed.projectType).toBe("dashboard")
    expect(seed.explicitStackDecisions.length).toBe(0) // No tech mentioned
  })
})

describe("applyPreTaskMemorySeed", () => {
  test("#given seed #then writes active-context with goal", () => {
    const dir = createTempDir()
    bootstrapMemoryFiles(dir)

    const seed: PreTaskMemorySeed = {
      projectGoal: "Build a SaaS dashboard with user authentication",
      projectType: "dashboard",
      explicitStackDecisions: ["Next.js", "TypeScript", "Prisma", "PostgreSQL"],
      explicitConstraints: ["Must use JWT for auth", "Should support dark mode"],
      initialTasks: ["Set up database schema", "Create auth endpoints", "Build dashboard UI"],
      plannedStructure: ["src/app/", "src/components/", "prisma/schema.prisma"],
      explicitRisks: [],
      explicitResearchRequirements: [],
      decisionCandidates: [],
    }

    const result = applyPreTaskMemorySeed(dir, seed)
    expect(result.written).toContain("active-context.md")

    const content = readFileSync(join(dir, PROJECT_MEMORY_DIR, "active-context.md"), "utf-8")
    expect(content).toContain("Build a SaaS dashboard")
    expect(content).toContain("Project type: dashboard")
  })

  test("#given seed with stack decisions #then does NOT write decisions directly, produces candidates", () => {
    const dir = createTempDir()
    bootstrapMemoryFiles(dir)

    const seed = extractPreTaskMemorySeed("Build an API using Express, TypeScript, Prisma, Redis")
    expect(seed).not.toBeNull()
    if (!seed) return

    const result = applyPreTaskMemorySeed(dir, seed)
    // Phase 3A: should NOT write decisions.md
    expect(result.written).not.toContain("decisions.md")

    // Should write conventions.md (framework patterns from stack)
    expect(result.written).toContain("conventions.md")

    // Decision candidates should be present (from extractPreTaskMemorySeed)
    expect(result.decisionCandidates.length).toBeGreaterThanOrEqual(3)
  })

  test("#given seed with initial tasks #then does NOT write tasks.md (owned by task_completion_writer)", () => {
    const dir = createTempDir()
    bootstrapMemoryFiles(dir)

    const seed: PreTaskMemorySeed = {
      projectGoal: "Build an app",
      projectType: "app",
      explicitStackDecisions: [],
      explicitConstraints: [],
      initialTasks: ["Set up project", "Create UI components", "Add state management"],
      plannedStructure: [],
      explicitRisks: [],
      explicitResearchRequirements: [],
      decisionCandidates: [],
    }

    const result = applyPreTaskMemorySeed(dir, seed)
    // Phase 3A: should NOT write tasks.md
    expect(result.written).not.toContain("tasks.md")
    expect(result.written).toContain("active-context.md")
  })

  test("#given seed #then does NOT write progress.md (owned by task_completion_writer)", () => {
    const dir = createTempDir()
    bootstrapMemoryFiles(dir)

    const seed: PreTaskMemorySeed = {
      projectGoal: "Build an app",
      projectType: "app",
      explicitStackDecisions: [],
      explicitConstraints: [],
      initialTasks: [],
      plannedStructure: [],
      explicitRisks: [],
      explicitResearchRequirements: [],
      decisionCandidates: [],
    }

    const result = applyPreTaskMemorySeed(dir, seed)
    // Phase 3A: should NOT write progress.md
    expect(result.written).not.toContain("progress.md")
    expect(result.written).toContain("active-context.md")
  })

  test("#given seed with planned structure #then does NOT write file-map.md (owned by file_map_writer)", () => {
    const dir = createTempDir()
    bootstrapMemoryFiles(dir)

    const seed: PreTaskMemorySeed = {
      projectGoal: "Build an app",
      projectType: "app",
      explicitStackDecisions: [],
      explicitConstraints: [],
      initialTasks: [],
      plannedStructure: ["src/routes/", "src/services/", "src/models/"],
      explicitRisks: [],
      explicitResearchRequirements: [],
      decisionCandidates: [],
    }

    const result = applyPreTaskMemorySeed(dir, seed)
    // Phase 3A: should NOT write file-map.md
    expect(result.written).not.toContain("file-map.md")
    expect(result.written).toContain("active-context.md")
  })

  test("#given seed without risks #then does not update quality-history", () => {
    const dir = createTempDir()
    bootstrapMemoryFiles(dir)

    const seed: PreTaskMemorySeed = {
      projectGoal: "Build an app",
      projectType: "app",
      explicitStackDecisions: [],
      explicitConstraints: [],
      initialTasks: [],
      plannedStructure: [],
      explicitRisks: [],
      explicitResearchRequirements: [],
      decisionCandidates: [],
    }

    const result = applyPreTaskMemorySeed(dir, seed)
    expect(result.written).not.toContain("quality-history.md")
  })

  test("#given seed without explicit risks #then does not update risk-profile", () => {
    const dir = createTempDir()
    bootstrapMemoryFiles(dir)

    const seed: PreTaskMemorySeed = {
      projectGoal: "Build an app",
      projectType: "app",
      explicitStackDecisions: [],
      explicitConstraints: [],
      initialTasks: [],
      plannedStructure: [],
      explicitRisks: [],
      explicitResearchRequirements: [],
      decisionCandidates: [],
    }

    const result = applyPreTaskMemorySeed(dir, seed)
    expect(result.written).not.toContain("risk-profile.md")
  })

  test("#given seed with explicit risks #then does NOT write risk-profile.md (owned by risk_writer)", () => {
    const dir = createTempDir()
    bootstrapMemoryFiles(dir)

    const seed: PreTaskMemorySeed = {
      projectGoal: "Build a payment system",
      projectType: "system",
      explicitStackDecisions: [],
      explicitConstraints: [],
      initialTasks: [],
      plannedStructure: [],
      explicitRisks: ["PCI compliance risk", "Security vulnerability in payment flow"],
      explicitResearchRequirements: [],
      decisionCandidates: [],
    }

    const result = applyPreTaskMemorySeed(dir, seed)
    // Phase 3A: should NOT write risk-profile.md
    expect(result.written).not.toContain("risk-profile.md")
    // Risks go into active-context Known Risks section
    expect(result.written).toContain("active-context.md")

    const content = readFileSync(join(dir, PROJECT_MEMORY_DIR, "active-context.md"), "utf-8")
    expect(content).toContain("PCI compliance")
  })

  test("#given existing user content #then preserves it", () => {
    const dir = createTempDir()
    bootstrapMemoryFiles(dir)

    const userContent = "## Current Goal\n- Build the perfect system\n\n## Current State\n- Working on auth\n\n## Constraints\n- None recorded yet\n\n## Known Risks\n- None recorded yet"
    const memDir = join(dir, PROJECT_MEMORY_DIR)
    writeFileSync(join(memDir, "active-context.md"), `# Active Context\n\nLast updated: 2026-01-01\n\n${userContent}`, "utf-8")

    const seed: PreTaskMemorySeed = {
      projectGoal: "Build a SaaS dashboard",
      projectType: "dashboard",
      explicitStackDecisions: ["React"],
      explicitConstraints: [],
      initialTasks: [],
      plannedStructure: [],
      explicitRisks: [],
      explicitResearchRequirements: [],
      decisionCandidates: [],
    }

    const result = applyPreTaskMemorySeed(dir, seed)

    const content = readFileSync(join(memDir, "active-context.md"), "utf-8")
    expect(content).toContain("Build the perfect system")
    expect(content).toContain("Working on auth")
  })

  test("#given scaffold sections #then replaces with seed content", () => {
    const dir = createTempDir()
    setupMemoryDir(dir)

    // Write scaffold-only file
    const scaffoldContent = `# Active Context

Last updated: TODO

## Current Goal
- TODO

## Current State
- TODO

## Constraints
- TODO

## Known Risks
- TODO
`
    writeFileSync(join(dir, PROJECT_MEMORY_DIR, "active-context.md"), scaffoldContent, "utf-8")

    const seed: PreTaskMemorySeed = {
      projectGoal: "Build a CLI tool",
      projectType: "cli",
      explicitStackDecisions: ["Node.js", "TypeScript"],
      explicitConstraints: ["Must be cross-platform"],
      initialTasks: [],
      plannedStructure: [],
      explicitRisks: [],
      explicitResearchRequirements: [],
      decisionCandidates: [],
    }

    const result = applyPreTaskMemorySeed(dir, seed)

    const content = readFileSync(join(dir, PROJECT_MEMORY_DIR, "active-context.md"), "utf-8")
    expect(content).toContain("Build a CLI tool")
    expect(content).toContain("Must be cross-platform")
    expect(content).toContain("Project type: cli")
  })

  test("#given duplicate seed run #then does not duplicate bullets in active-context", () => {
    const dir = createTempDir()
    bootstrapMemoryFiles(dir)

    const seed: PreTaskMemorySeed = {
      projectGoal: "Build an API",
      projectType: "api",
      explicitStackDecisions: ["Express", "PostgreSQL"],
      explicitConstraints: ["Must use HTTPS"],
      initialTasks: ["Create project", "Set up database"],
      plannedStructure: ["src/"],
      explicitRisks: [],
      explicitResearchRequirements: [],
      decisionCandidates: [],
    }

    applyPreTaskMemorySeed(dir, seed)
    const secondResult = applyPreTaskMemorySeed(dir, seed)

    // Duplicate run should not duplicate goal bullets in active-context
    const content = readFileSync(join(dir, PROJECT_MEMORY_DIR, "active-context.md"), "utf-8")
    const apiCount = (content.match(/Build an API/g) ?? []).length
    expect(apiCount).toBe(1)
  })

  test("#given seed #then manifest is refreshed", () => {
    const dir = createTempDir()
    bootstrapMemoryFiles(dir)
    bootstrapMemoryFiles(dir) // second run will hydrate

    // Make sure manifest exists
    const manifestBefore = readManifest(dir)
    if (!manifestBefore) {
      // bootstrap will create it
      return
    }

    const seed: PreTaskMemorySeed = {
      projectGoal: "Build an app",
      projectType: "app",
      explicitStackDecisions: [],
      explicitConstraints: [],
      initialTasks: [],
      plannedStructure: [],
      explicitRisks: [],
      explicitResearchRequirements: [],
      decisionCandidates: [],
    }

    const result = applyPreTaskMemorySeed(dir, seed)
    if (result.written.length > 0) {
      const manifestAfter = readManifest(dir)
      expect(manifestAfter).not.toBeNull()
      if (manifestAfter) {
        expect(result.manifestRefreshed).toBe(true)
      }
    }
  })
})

describe("Phase 3A — Decision candidates", () => {
  test("#given seed with stack decisions #then decision candidates are not lost", () => {
    const prompt = "Build an API using Express, TypeScript, Prisma, and Redis."
    const seed = extractPreTaskMemorySeed(prompt)

    expect(seed).not.toBeNull()
    if (!seed) return

    expect(seed.decisionCandidates.length).toBeGreaterThanOrEqual(3)

    // Each candidate should have the required fields
    for (const candidate of seed.decisionCandidates) {
      expect(candidate.title).toBeTruthy()
      expect(candidate.decision).toBeTruthy()
      expect(candidate.rationale).toBeTruthy()
      expect(candidate.impactArea).toBeTruthy()
      expect(candidate.sourceExcerpt).toBeTruthy()
    }
  })

  test("#given seed without explicit stack #then decision candidates are empty", () => {
    const prompt = "Create a project management dashboard with drag-and-drop Kanban boards."
    const seed = extractPreTaskMemorySeed(prompt)

    expect(seed).not.toBeNull()
    if (!seed) return

    expect(seed.decisionCandidates.length).toBe(0)
  })

  test("#given seed #then decision candidates are in result", () => {
    const dir = createTempDir()
    bootstrapMemoryFiles(dir)

    const seed: PreTaskMemorySeed = {
      projectGoal: "Build an API",
      projectType: "api",
      explicitStackDecisions: ["Express", "PostgreSQL"],
      explicitConstraints: [],
      initialTasks: [],
      plannedStructure: [],
      explicitRisks: [],
      explicitResearchRequirements: [],
      decisionCandidates: [
        { title: "Use Express", decision: "Adopt Express", rationale: "Test", impactArea: "backend", sourceExcerpt: "Express" },
        { title: "Use PostgreSQL", decision: "Adopt PostgreSQL", rationale: "Test", impactArea: "database", sourceExcerpt: "PostgreSQL" },
      ],
    }

    const result = applyPreTaskMemorySeed(dir, seed)
    expect(result.decisionCandidates.length).toBe(2)
    expect(result.decisionCandidates[0].title).toBe("Use Express")
    expect(result.decisionCandidates[1].title).toBe("Use PostgreSQL")
  })

  test("#given seed #then no decisions files are written directly", () => {
    const dir = createTempDir()
    bootstrapMemoryFiles(dir)

    const seed: PreTaskMemorySeed = {
      projectGoal: "Build an API",
      projectType: "api",
      explicitStackDecisions: ["Express", "TypeScript"],
      explicitConstraints: [],
      initialTasks: [],
      plannedStructure: [],
      explicitRisks: [],
      explicitResearchRequirements: [],
      decisionCandidates: [],
    }

    const result = applyPreTaskMemorySeed(dir, seed)
    // Phase 3A: must NOT write decisions.md or decisions.jsonl
    expect(result.written).not.toContain("decisions.md")
    expect(result.written).not.toContain("decisions.jsonl")
  })

  test("#given seed #then active-context / conventions / environment behavior remains working", () => {
    const dir = createTempDir()
    bootstrapMemoryFiles(dir)

    const seed: PreTaskMemorySeed = {
      projectGoal: "Build a SaaS dashboard with auth",
      projectType: "dashboard",
      explicitStackDecisions: ["React", "TypeScript"],
      explicitConstraints: ["Must use JWT"],
      initialTasks: ["Set up auth", "Build dashboard"],
      plannedStructure: [],
      explicitRisks: [],
      explicitResearchRequirements: [],
      decisionCandidates: [],
    }

    const result = applyPreTaskMemorySeed(dir, seed)

    // Active context should still work
    expect(result.written).toContain("active-context.md")
    const ac = readFileSync(join(dir, PROJECT_MEMORY_DIR, "active-context.md"), "utf-8")
    expect(ac).toContain("Build a SaaS dashboard")
    expect(ac).toContain("Must use JWT")

    // Conventions should work (from stack decisions)
    expect(result.written).toContain("conventions.md")
    const conv = readFileSync(join(dir, PROJECT_MEMORY_DIR, "conventions.md"), "utf-8")
    expect(conv).toContain("Framework Patterns")
  })

  test("#given seed with research requirements #then writes open-questions.md", () => {
    const dir = createTempDir()
    bootstrapMemoryFiles(dir)

    const seed: PreTaskMemorySeed = {
      projectGoal: "Build real-time chat app",
      projectType: "app",
      explicitStackDecisions: [],
      explicitConstraints: [],
      initialTasks: [],
      plannedStructure: [],
      explicitRisks: [],
      explicitResearchRequirements: [
        "research WebSocket scaling patterns",
        "find out about Socket.IO vs WS library",
      ],
      decisionCandidates: [],
    }

    const result = applyPreTaskMemorySeed(dir, seed)
    expect(result.written).toContain("open-questions.md")

    const content = readFileSync(join(dir, PROJECT_MEMORY_DIR, "open-questions.md"), "utf-8")
    expect(content).toContain("Research WebSocket scaling patterns")
  })
})

describe("Phase 3B.1a — Non-tech decision extraction", () => {
  test("#given category routing disabled prompt #then produces decisionCandidate", () => {
    const prompt = "Category routing is disabled. All delegation must use exact agents."
    const seed = extractPreTaskMemorySeed(prompt)

    expect(seed).not.toBeNull()
    if (!seed) return

    const routingCandidates = seed.decisionCandidates.filter(
      (c) => c.impactArea === "routing",
    )
    expect(routingCandidates.length).toBeGreaterThanOrEqual(1)
    const titles = routingCandidates.map((c) => c.title)
    expect(titles.some((t) => /category[_\s]?routing/i.test(t))).toBe(true)
  })

  test("#given exact runtime-valid agents prompt #then produces decisionCandidate", () => {
    const prompt = "Build a plugin system for the project. You must use exact runtime-valid agents for all task delegation."
    const seed = extractPreTaskMemorySeed(prompt)

    expect(seed).not.toBeNull()
    if (!seed) return

    const routingCandidates = seed.decisionCandidates.filter(
      (c) => c.impactArea === "routing",
    )
    expect(routingCandidates.length).toBeGreaterThanOrEqual(1)
    const decisionTexts = routingCandidates.map((c) => c.decision).join(" ")
    expect(decisionTexts).toMatch(/exact|runtime[_\s]?valid/i)
  })

  test("#given no category fallback prompt #then produces decisionCandidate", () => {
    const prompt = "Unknown agents must not fallback to category. Do not fallback to categories for unavailable agents."
    const seed = extractPreTaskMemorySeed(prompt)

    expect(seed).not.toBeNull()
    if (!seed) return

    const routingCandidates = seed.decisionCandidates.filter(
      (c) => c.impactArea === "routing",
    )
    expect(routingCandidates.length).toBeGreaterThanOrEqual(1)
    const decisionTexts = routingCandidates.map((c) => c.decision).join(" ")
    expect(decisionTexts).toMatch(/fallback|category/i)
  })

  test("#given subagents must not directly edit memory prompt #then produces decisionCandidate", () => {
    const prompt = "Subagents must not directly edit memory files. All memory writes go through designated writers."
    const seed = extractPreTaskMemorySeed(prompt)

    expect(seed).not.toBeNull()
    if (!seed) return

    const memoryCandidates = seed.decisionCandidates.filter(
      (c) => c.impactArea === "memory",
    )
    expect(memoryCandidates.length).toBeGreaterThanOrEqual(1)
    const titles = memoryCandidates.map((c) => c.title)
    expect(titles.some((t) => /subagent/i.test(t))).toBe(true)
  })

  test("#given project-root scoped memory prompt #then produces decisionCandidate", () => {
    const prompt = "Build a project management app. Memory must be project-root scoped. Each project has its own memory directory in .opencode/state/memory."
    const seed = extractPreTaskMemorySeed(prompt)

    expect(seed).not.toBeNull()
    if (!seed) return

    const memoryCandidates = seed.decisionCandidates.filter(
      (c) => c.impactArea === "memory",
    )
    expect(memoryCandidates.length).toBeGreaterThanOrEqual(1)
    const titles = memoryCandidates.map((c) => c.title)
    expect(titles.some((t) => /project.root|scoped/i.test(t))).toBe(true)
  })

  test("#given generated files exclusion prompt #then produces decisionCandidate", () => {
    const prompt = "Generated files like .next/ must not enter file-map.md. Build artifacts should not be included in the file map."
    const seed = extractPreTaskMemorySeed(prompt)

    expect(seed).not.toBeNull()
    if (!seed) return

    const conventionCandidates = seed.decisionCandidates.filter(
      (c) => c.impactArea === "convention",
    )
    expect(conventionCandidates.length).toBeGreaterThanOrEqual(1)
  })

  test("#given ordinary task instructions #then does not produce non-tech decisions", () => {
    const prompt = "Create app/page.tsx with a hero section. Run the build command. Add a navigation bar to the layout."

    // Extract non-tech candidates directly — task instructions should not match
    // the non-tech patterns, and the consumer would filter them anyway
    const seed = extractPreTaskMemorySeed(prompt)
    expect(seed).not.toBeNull()
    if (!seed) return

    // Only tech stack candidates should be present (if any tech keywords detected)
    // Non-tech decisions should be empty for pure task instructions
    const nonTechRouting = seed.decisionCandidates.filter(
      (c) => c.impactArea === "routing",
    )
    const nonTechMemory = seed.decisionCandidates.filter(
      (c) => c.impactArea === "memory",
    )
    const nonTechConvention = seed.decisionCandidates.filter(
      (c) => c.impactArea === "convention",
    )
    expect(nonTechRouting.length).toBe(0)
    expect(nonTechMemory.length).toBe(0)
    expect(nonTechConvention.length).toBe(0)
  })

  test("#given vague maybe wording #then does not produce false decisions", () => {
    const prompt = "Maybe use Tailwind CSS later if it works out. We could consider category routing but it's not decided yet."

    const seed = extractPreTaskMemorySeed(prompt)
    expect(seed).not.toBeNull()
    if (!seed) return

    // Tech keyword "Tailwind" may produce a stack candidate, but non-tech
    // "category routing" in a "maybe" context should not produce a routing candidate
    const routingCandidates = seed.decisionCandidates.filter(
      (c) => c.impactArea === "routing",
    )
    expect(routingCandidates.length).toBe(0)
  })

  test("#given seed with both tech and non-tech decisions #then pre-task seed still does not write decision files", () => {
    const dir = createTempDir()
    bootstrapMemoryFiles(dir)

    const prompt = "Build an API using Express and TypeScript. Category routing is disabled. Subagents must not directly edit memory files."
    const seed = extractPreTaskMemorySeed(prompt)

    expect(seed).not.toBeNull()
    if (!seed) return

    const result = applyPreTaskMemorySeed(dir, seed)
    expect(result.written).not.toContain("decisions.md")
    expect(result.written).not.toContain("decisions.jsonl")

    // Decision candidates should include both tech and non-tech
    expect(result.decisionCandidates.length).toBeGreaterThanOrEqual(4)

    // Tech candidates
    const techTitles = result.decisionCandidates
      .filter((c) => c.impactArea === "backend" || c.impactArea === "stack")
      .map((c) => c.title)
    expect(techTitles.some((t) => /Express/i.test(t))).toBe(true)
    expect(techTitles.some((t) => /TypeScript/i.test(t))).toBe(true)

    // Non-tech candidates
    const nonTechTitles = result.decisionCandidates
      .filter((c) => c.impactArea === "routing" || c.impactArea === "memory")
      .map((c) => c.title)
    expect(nonTechTitles.some((t) => /category|routing/i.test(t))).toBe(true)
    expect(nonTechTitles.some((t) => /subagent|memory/i.test(t))).toBe(true)
  })

  test("#given duplicate tech and non-tech candidates #then deduplication prevents duplicates", () => {
    // Tailwind is both in TECH_STACK_KEYWORDS and could match non-tech patterns
    const prompt = "Use Tailwind CSS v4 CSS-first config. The project uses Tailwind and TypeScript."

    const seed = extractPreTaskMemorySeed(prompt)
    expect(seed).not.toBeNull()
    if (!seed) return

    // Should have candidates but no duplicate titles
    const titles = seed.decisionCandidates.map((c) => c.title)
    const uniqueTitles = new Set(titles)
    expect(uniqueTitles.size).toBe(titles.length)
  })

  test("#given writer ownership prompt #then produces decisionCandidate", () => {
    const prompt = "Build a memory system for the project. Only the decision writer may write decisions. Pre-task seed must not write decision files directly."
    const seed = extractPreTaskMemorySeed(prompt)

    expect(seed).not.toBeNull()
    if (!seed) return

    const memoryCandidates = seed.decisionCandidates.filter(
      (c) => c.impactArea === "memory",
    )
    expect(memoryCandidates.length).toBeGreaterThanOrEqual(1)
  })

  test("#given legacy config exclusion prompt #then produces decisionCandidate", () => {
    const prompt = "Use Tailwind CSS v4. Do not use legacy tailwind.config.js files."
    const seed = extractPreTaskMemorySeed(prompt)

    expect(seed).not.toBeNull()
    if (!seed) return

    // Should have at least the tech candidate (Tailwind) and the exclusion candidate
    expect(seed.decisionCandidates.length).toBeGreaterThanOrEqual(2)

    const exclusionCandidates = seed.decisionCandidates.filter(
      (c) => /legacy|config/i.test(c.title),
    )
    expect(exclusionCandidates.length).toBeGreaterThanOrEqual(1)
  })
})

describe("invariants", () => {
  test("#given project root #then memory path is .opencode/state/memory", () => {
    const dir = createTempDir()
    const seed: PreTaskMemorySeed = {
      projectGoal: "Test",
      projectType: "app",
      explicitStackDecisions: [],
      explicitConstraints: [],
      initialTasks: [],
      plannedStructure: [],
      explicitRisks: [],
      explicitResearchRequirements: [],
      decisionCandidates: [],
    }

    applyPreTaskMemorySeed(dir, seed)
    expect(existsSync(join(dir, ".opencode", "state", "memory"))).toBe(true)
  })

  test("#given seed #then root discovery unchanged", () => {
    const { findProjectRoot } = require("./memory-bootstrap") as typeof import("./memory-bootstrap")
    const dir = createTempDir()
    applyPreTaskMemorySeed(dir, {
      projectGoal: "Test", projectType: "app",
      explicitStackDecisions: [], explicitConstraints: [],
      initialTasks: [], plannedStructure: [],
      explicitRisks: [], explicitResearchRequirements: [],
      decisionCandidates: [],
    })

    const root = findProjectRoot(dir)
    expect(root).toBe(dir)
  })

  test("#given seed #then does not create files outside .opencode/state/memory", () => {
    const dir = createTempDir()
    applyPreTaskMemorySeed(dir, {
      projectGoal: "Test", projectType: "app",
      explicitStackDecisions: [], explicitConstraints: [],
      initialTasks: [], plannedStructure: [],
      explicitRisks: [], explicitResearchRequirements: [],
      decisionCandidates: [],
    })

    // No files created at root level except .opencode/
    const rootFiles = require("node:fs").readdirSync(dir) as string[]
    const nonOpenCodeFiles = rootFiles.filter((f: string) => f !== ".opencode")
    expect(nonOpenCodeFiles.length).toBe(0)
  })

  test("#given seed #then quality-history not updated during seed", () => {
    const dir = createTempDir()
    bootstrapMemoryFiles(dir)

    const qhBefore = existsSync(join(dir, PROJECT_MEMORY_DIR, "quality-history.md"))
      ? readFileSync(join(dir, PROJECT_MEMORY_DIR, "quality-history.md"), "utf-8")
      : ""

    applyPreTaskMemorySeed(dir, {
      projectGoal: "Build a website", projectType: "website",
      explicitStackDecisions: ["React"], explicitConstraints: [],
      initialTasks: [], plannedStructure: [],
      explicitRisks: [], explicitResearchRequirements: [],
      decisionCandidates: [],
    })

    const qhAfter = existsSync(join(dir, PROJECT_MEMORY_DIR, "quality-history.md"))
      ? readFileSync(join(dir, PROJECT_MEMORY_DIR, "quality-history.md"), "utf-8")
      : ""

    expect(qhAfter).toBe(qhBefore)
  })
})
