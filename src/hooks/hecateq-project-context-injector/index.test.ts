import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  buildProjectContextBlock,
  createHecateqProjectContextInjectorHook,
  createProjectContextSnapshot,
  MAX_TOTAL_CONTEXT_CHARS,
  resolveProjectContextInjectorOptions,
} from "./index"
import {
  PROJECT_CONTRACTS_DIR,
  PROJECT_MEMORY_DIR,
  PROJECT_TASK_GRAPHS_DIR,
} from "../../shared/memory-bootstrap"

const MEMORY_FILE_NAMES = [
  "active-context.md",
  "progress.md",
  "tasks.md",
  "file-map.md",
  "decisions.md",
] as const

describe("hecateq-project-context-injector", () => {
  let testDir = ""
  let opencodeConfigDir = ""
  let originalConfigDir: string | undefined
  let originalHome: string | undefined
  let originalXdgConfigHome: string | undefined

  beforeEach(() => {
    if (testDir) rmSync(testDir, { recursive: true, force: true })
    testDir = join(tmpdir(), `hecateq-project-context-${randomUUID()}`)
    mkdirSync(testDir, { recursive: true })
    opencodeConfigDir = join(testDir, "opencode-config")
    mkdirSync(opencodeConfigDir, { recursive: true })
    originalConfigDir = process.env.OPENCODE_CONFIG_DIR
    originalHome = process.env.HOME
    originalXdgConfigHome = process.env.XDG_CONFIG_HOME
    process.env.OPENCODE_CONFIG_DIR = opencodeConfigDir
    process.env.HOME = testDir
    process.env.XDG_CONFIG_HOME = join(testDir, ".config")
  })

  afterEach(() => {
    if (originalConfigDir === undefined) delete process.env.OPENCODE_CONFIG_DIR
    else process.env.OPENCODE_CONFIG_DIR = originalConfigDir
    if (originalHome === undefined) delete process.env.HOME
    else process.env.HOME = originalHome
    if (originalXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = originalXdgConfigHome
  })

  function setupProjectRoot(): void {
    mkdirSync(join(testDir, ".opencode"), { recursive: true })
    mkdirSync(join(testDir, PROJECT_MEMORY_DIR), { recursive: true })
    mkdirSync(join(testDir, PROJECT_CONTRACTS_DIR), { recursive: true })
    mkdirSync(join(testDir, PROJECT_TASK_GRAPHS_DIR), { recursive: true })
  }

  function writeMemoryFile(name: string, content: string): void {
    writeFileSync(join(testDir, PROJECT_MEMORY_DIR, name), content, "utf-8")
  }

  function writeAgentIndexFile(content: string): void {
    const hecateqDir = join(opencodeConfigDir, "hecateq")
    mkdirSync(hecateqDir, { recursive: true })
    writeFileSync(join(hecateqDir, "agent-index.generated.json"), content, "utf-8")
  }

  function runGit(args: string[], cwd = testDir): string {
    const result = Bun.spawnSync(["git", ...args], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
      },
    })

    const stdout = Buffer.from(result.stdout ?? []).toString("utf-8").trim()
    const stderr = Buffer.from(result.stderr ?? []).toString("utf-8").trim()
    if (result.exitCode !== 0) {
      throw new Error(stderr || stdout || `git ${args.join(" ")} failed`)
    }

    return stdout
  }

  function initializeGitRepository(): void {
    runGit(["init"])
    runGit(["config", "user.email", "test@example.com"])
    runGit(["config", "user.name", "Test User"])
    writeFileSync(join(testDir, "README.md"), "initial\n", "utf-8")
    runGit(["add", "README.md"])
    runGit(["commit", "-m", "init"])
  }

  test("builds a context block from project-root memory and artifact listings", () => {
    setupProjectRoot()
    writeMemoryFile("active-context.md", "# Active Context\n\nCurrent focus")
    writeMemoryFile("progress.md", "# Progress\n\nMilestone A")
    writeMemoryFile("tasks.md", "# Tasks\n\nPending item")
    writeMemoryFile("file-map.md", "# File Map\n\nsrc/app.ts")
    writeMemoryFile("decisions.md", "# Decisions\n\nUse Hecateq")
    writeFileSync(join(testDir, PROJECT_CONTRACTS_DIR, "current-contract.md"), "secret-payload-shape", "utf-8")
    writeFileSync(join(testDir, PROJECT_TASK_GRAPHS_DIR, "current-task-graph.md"), "graph-body", "utf-8")

    const block = buildProjectContextBlock(testDir)

    expect(block).not.toBeNull()
    expect(block).toContain("<hecateq-project-context>")
    expect(block).toContain("Project root: ")
    expect(block).toContain("active-context.md: present")
    expect(block).toContain("Memory:\n- initialized: yes")
    expect(block).toContain("- contracts: ready, 1 files")
    expect(block).toContain("- task-graphs: ready, 1 files")
    expect(block).toContain("Read detailed artifact files only when needed.")
    expect(block).not.toContain(`Contracts directory: ${PROJECT_CONTRACTS_DIR}/`)
    expect(block).not.toContain(`${PROJECT_CONTRACTS_DIR}/current-contract.md`)
    expect(block).not.toContain(`${PROJECT_TASK_GRAPHS_DIR}/current-task-graph.md`)
    expect(block).not.toContain("secret-payload-shape")
    expect(block).not.toContain("graph-body")
  })

  test("expanded mode preserves detailed memory summary and artifact listings", () => {
    setupProjectRoot()
    writeMemoryFile("active-context.md", "# Active Context\n\nCurrent focus")
    writeMemoryFile("progress.md", "# Progress\n\nMilestone A")
    writeFileSync(join(testDir, PROJECT_CONTRACTS_DIR, "current-contract.md"), "secret-payload-shape", "utf-8")
    writeFileSync(join(testDir, PROJECT_TASK_GRAPHS_DIR, "current-task-graph.md"), "graph-body", "utf-8")

    const block = buildProjectContextBlock(
      testDir,
      resolveProjectContextInjectorOptions({ mode: "expanded" }),
    )

    expect(block).toContain("Memory summary:")
    expect(block).toContain("Current focus")
    expect(block).toContain(`Contracts directory: ${PROJECT_CONTRACTS_DIR}/`)
    expect(block).toContain(`${PROJECT_CONTRACTS_DIR}/current-contract.md`)
    expect(block).toContain(`${PROJECT_TASK_GRAPHS_DIR}/current-task-graph.md`)
    expect(block).not.toContain("secret-payload-shape")
    expect(block).not.toContain("graph-body")
  })

  test("compact mode shows missing agent index state without breaking existing sections", () => {
    setupProjectRoot()
    writeMemoryFile("active-context.md", "# Active Context\n\nCurrent focus")

    const block = buildProjectContextBlock(testDir)

    expect(block).toContain("Artifacts:")
    expect(block).toContain("Agent capabilities:")
    expect(block).toContain("- index: missing")
    expect(block).toContain("- run /hecateq-agent-index to generate capability index")
    expect(block).toContain("Context rules:")
  })

  test("compact mode renders grouped agent index summary without full JSON fields", () => {
    setupProjectRoot()
    writeMemoryFile("active-context.md", "# Active Context\n\nCurrent focus")
    writeAgentIndexFile(JSON.stringify({
      version: 1,
      generated_at: "2026-05-23T10:00:00.000Z",
      generator: "oh-my-openagent-hecateq",
      notice: "Generated file. Do not edit manually. Re-run /hecateq-agent-index.",
      enrichment_mode: "deterministic",
      source: { agents_dirs: [join(opencodeConfigDir, "agents")] },
      summary: {
        agents_discovered: 6,
        agents_indexed: 6,
        weak_metadata: 1,
        duplicates: 0,
        high_ambiguity: 1,
        unknown_primary_domain: 1,
        domain_coverage: {
          backend: 3,
          security: 1,
          unknown: 1,
          flutter: 1,
        },
      },
      agents: [
        {
          name: "nodejs-backend-architect",
          display_name: "Nodejs Backend Architect",
          filename: "nodejs-backend-architect.md",
          source_file: "/tmp/nodejs-backend-architect.md",
          description: "Backend architecture expert",
          body_preview: "preview",
          role: "architect",
          domains: ["backend"],
          primary_domain: "backend",
          secondary_domains: ["architecture"],
          agent_type: "specialist",
          capabilities: { can_plan: true, can_implement: true, can_review: true, can_test: false, can_document: false, can_coordinate: false },
          routing: { priority: 90, ambiguity: "low", best_for: ["API design"], not_for: ["UI polish"] },
          keywords: ["backend"],
          use_when: ["API design"],
          avoid_when: ["UI polish"],
          confidence: 0.95,
          signals: { filename: ["backend"], frontmatter: [], body: [] },
          frontmatter: { domain_hints: [], keywords: [], use_when: [], avoid_when: [], hidden: false, enabled_tools: [], denied_tools: [] },
          warnings: [],
        },
        {
          name: "database-specialist",
          display_name: "Database Specialist",
          filename: "database-specialist.md",
          source_file: "/tmp/database-specialist.md",
          description: "Database expert",
          body_preview: "preview",
          role: "specialist",
          domains: ["backend", "database"],
          primary_domain: "backend",
          secondary_domains: ["database"],
          agent_type: "specialist",
          capabilities: { can_plan: true, can_implement: true, can_review: true, can_test: false, can_document: false, can_coordinate: false },
          routing: { priority: 75, ambiguity: "medium", best_for: ["Schema design"], not_for: ["UI polish"] },
          keywords: ["database"],
          use_when: ["Schema design"],
          avoid_when: ["UI polish"],
          confidence: 0.7,
          signals: { filename: ["database"], frontmatter: [], body: [] },
          frontmatter: { domain_hints: [], keywords: [], use_when: [], avoid_when: [], hidden: false, enabled_tools: [], denied_tools: [] },
          warnings: ["weak metadata"],
        },
        {
          name: "nodejs-backend-developer",
          display_name: "Nodejs Backend Developer",
          filename: "nodejs-backend-developer.md",
          source_file: "/tmp/nodejs-backend-developer.md",
          description: "Backend developer",
          body_preview: "preview",
          role: "implementer",
          domains: ["backend"],
          primary_domain: "backend",
          secondary_domains: [],
          agent_type: "implementer",
          capabilities: { can_plan: true, can_implement: true, can_review: false, can_test: false, can_document: false, can_coordinate: false },
          routing: { priority: 82, ambiguity: "low", best_for: ["Service implementation"], not_for: ["UI polish"] },
          keywords: ["backend"],
          use_when: ["Service implementation"],
          avoid_when: ["UI polish"],
          confidence: 0.82,
          signals: { filename: ["backend"], frontmatter: [], body: [] },
          frontmatter: { domain_hints: [], keywords: [], use_when: [], avoid_when: [], hidden: false, enabled_tools: [], denied_tools: [] },
          warnings: [],
        },
        {
          name: "security-architect",
          display_name: "Security Architect",
          filename: "security-architect.md",
          source_file: "/tmp/security-architect.md",
          description: "Security expert",
          body_preview: "preview",
          role: "security",
          domains: ["security"],
          primary_domain: "security",
          secondary_domains: [],
          agent_type: "security",
          capabilities: { can_plan: true, can_implement: false, can_review: true, can_test: true, can_document: false, can_coordinate: false },
          routing: { priority: 88, ambiguity: "low", best_for: ["Threat modeling"], not_for: ["UI polish"] },
          keywords: ["security"],
          use_when: ["Threat modeling"],
          avoid_when: ["UI polish"],
          confidence: 0.9,
          signals: { filename: ["security"], frontmatter: [], body: [] },
          frontmatter: { domain_hints: [], keywords: [], use_when: [], avoid_when: [], hidden: false, enabled_tools: [], denied_tools: [] },
          warnings: [],
        },
        {
          name: "flutter-dart-master",
          display_name: "Flutter Dart Master",
          filename: "flutter-dart-master.md",
          source_file: "/tmp/flutter-dart-master.md",
          description: "Flutter expert",
          body_preview: "preview",
          role: "specialist",
          domains: ["flutter"],
          primary_domain: "flutter",
          secondary_domains: [],
          agent_type: "specialist",
          capabilities: { can_plan: true, can_implement: true, can_review: true, can_test: false, can_document: false, can_coordinate: false },
          routing: { priority: 80, ambiguity: "low", best_for: ["Widget architecture"], not_for: ["Backend internals"] },
          keywords: ["flutter"],
          use_when: ["Widget architecture"],
          avoid_when: ["Backend internals"],
          confidence: 0.84,
          signals: { filename: ["flutter"], frontmatter: [], body: [] },
          frontmatter: { domain_hints: [], keywords: [], use_when: [], avoid_when: [], hidden: false, enabled_tools: [], denied_tools: [] },
          warnings: [],
        },
        {
          name: "mystery-agent",
          display_name: "Mystery Agent",
          filename: "mystery-agent.md",
          source_file: "/tmp/mystery-agent.md",
          description: "Unknown",
          body_preview: "preview",
          role: "unknown",
          domains: ["unknown"],
          primary_domain: "unknown",
          secondary_domains: [],
          agent_type: "unknown",
          capabilities: { can_plan: true, can_implement: false, can_review: false, can_test: false, can_document: false, can_coordinate: false },
          routing: { priority: 20, ambiguity: "high", best_for: ["Unknown"], not_for: ["Specific work"] },
          keywords: ["unknown"],
          use_when: ["Unknown"],
          avoid_when: ["Specific work"],
          confidence: 0.2,
          signals: { filename: [], frontmatter: [], body: [] },
          frontmatter: { domain_hints: [], keywords: [], use_when: [], avoid_when: [], hidden: false, enabled_tools: [], denied_tools: [] },
          warnings: ["weak metadata"],
        },
      ],
    }, null, 2))

    const block = buildProjectContextBlock(testDir)

    expect(block).toContain("Agent capabilities:")
    expect(block).toContain("- index: present")
    expect(block).toContain("- agents_indexed: 6")
    expect(block).toContain("- weak_metadata: 1")
    expect(block).toContain("- high_ambiguity: 1")
    expect(block).toContain("- unknown_primary_domain: 1")
    expect(block).toContain("Top domains:")
    expect(block).toContain("- backend: nodejs-backend-architect, nodejs-backend-developer, database-specialist")
    expect(block).toContain("- security: security-architect")
    expect(block).toContain("- flutter: flutter-dart-master")
    expect(block).not.toContain("- unknown:")
    expect(block).toContain("Use this index as ranking aid only.")
    expect(block).toContain("task(subagent_type=\"...\")")
    expect(block).not.toContain("body_preview")
    expect(block).not.toContain("use_when")
    expect(block).not.toContain("avoid_when")
  })

  test("compact mode applies agent domain and per-domain limits", () => {
    setupProjectRoot()
    writeMemoryFile("active-context.md", "# Active Context\n\nCurrent focus")
    writeAgentIndexFile(JSON.stringify({
      version: 1,
      generated_at: "2026-05-23T10:00:00.000Z",
      generator: "oh-my-openagent-hecateq",
      notice: "Generated file. Do not edit manually. Re-run /hecateq-agent-index.",
      enrichment_mode: "deterministic",
      source: { agents_dirs: [join(opencodeConfigDir, "agents")] },
      summary: {
        agents_discovered: 5,
        agents_indexed: 5,
        weak_metadata: 0,
        duplicates: 0,
        high_ambiguity: 0,
        unknown_primary_domain: 0,
        domain_coverage: { backend: 3, flutter: 1, security: 1 },
      },
      agents: [
        { name: "a-backend", display_name: "A Backend", filename: "a.md", source_file: "/tmp/a.md", description: "", body_preview: "preview", role: "backend specialist", domains: ["backend"], primary_domain: "backend", secondary_domains: [], agent_type: "specialist", capabilities: { can_plan: true, can_implement: true, can_review: true, can_test: false, can_document: false, can_coordinate: false }, routing: { priority: 90, ambiguity: "low", best_for: [], not_for: [] }, keywords: [], use_when: [], avoid_when: [], confidence: 0.9, signals: { filename: [], frontmatter: [], body: [] }, frontmatter: { domain_hints: [], keywords: [], use_when: [], avoid_when: [], hidden: false, enabled_tools: [], denied_tools: [] }, warnings: [] },
        { name: "b-backend", display_name: "B Backend", filename: "b.md", source_file: "/tmp/b.md", description: "", body_preview: "preview", role: "backend specialist", domains: ["backend"], primary_domain: "backend", secondary_domains: [], agent_type: "specialist", capabilities: { can_plan: true, can_implement: true, can_review: true, can_test: false, can_document: false, can_coordinate: false }, routing: { priority: 89, ambiguity: "low", best_for: [], not_for: [] }, keywords: [], use_when: [], avoid_when: [], confidence: 0.89, signals: { filename: [], frontmatter: [], body: [] }, frontmatter: { domain_hints: [], keywords: [], use_when: [], avoid_when: [], hidden: false, enabled_tools: [], denied_tools: [] }, warnings: [] },
        { name: "c-backend", display_name: "C Backend", filename: "c.md", source_file: "/tmp/c.md", description: "", body_preview: "preview", role: "backend specialist", domains: ["backend"], primary_domain: "backend", secondary_domains: [], agent_type: "specialist", capabilities: { can_plan: true, can_implement: true, can_review: true, can_test: false, can_document: false, can_coordinate: false }, routing: { priority: 88, ambiguity: "low", best_for: [], not_for: [] }, keywords: [], use_when: [], avoid_when: [], confidence: 0.88, signals: { filename: [], frontmatter: [], body: [] }, frontmatter: { domain_hints: [], keywords: [], use_when: [], avoid_when: [], hidden: false, enabled_tools: [], denied_tools: [] }, warnings: [] },
        { name: "flutter-one", display_name: "Flutter One", filename: "f.md", source_file: "/tmp/f.md", description: "", body_preview: "preview", role: "flutter specialist", domains: ["flutter"], primary_domain: "flutter", secondary_domains: [], agent_type: "specialist", capabilities: { can_plan: true, can_implement: true, can_review: true, can_test: false, can_document: false, can_coordinate: false }, routing: { priority: 70, ambiguity: "low", best_for: [], not_for: [] }, keywords: [], use_when: [], avoid_when: [], confidence: 0.7, signals: { filename: [], frontmatter: [], body: [] }, frontmatter: { domain_hints: [], keywords: [], use_when: [], avoid_when: [], hidden: false, enabled_tools: [], denied_tools: [] }, warnings: [] },
        { name: "security-one", display_name: "Security One", filename: "s.md", source_file: "/tmp/s.md", description: "", body_preview: "preview", role: "security reviewer", domains: ["security"], primary_domain: "security", secondary_domains: [], agent_type: "security", capabilities: { can_plan: true, can_implement: false, can_review: true, can_test: true, can_document: false, can_coordinate: false }, routing: { priority: 75, ambiguity: "low", best_for: [], not_for: [] }, keywords: [], use_when: [], avoid_when: [], confidence: 0.75, signals: { filename: [], frontmatter: [], body: [] }, frontmatter: { domain_hints: [], keywords: [], use_when: [], avoid_when: [], hidden: false, enabled_tools: [], denied_tools: [] }, warnings: [] },
      ],
    }, null, 2))

    const block = buildProjectContextBlock(
      testDir,
      resolveProjectContextInjectorOptions({ max_agent_domains: 2, max_agents_per_domain: 2 }),
    )

    expect(block).toContain("- backend: a-backend, b-backend")
    expect(block).not.toContain("c-backend")
    expect(block).toContain("- flutter: flutter-one")
    expect(block).not.toContain("- security: security-one")
  })

  test("expanded mode includes generated timestamp but still does not dump full JSON", () => {
    setupProjectRoot()
    writeMemoryFile("active-context.md", "# Active Context\n\nCurrent focus")
    writeAgentIndexFile(JSON.stringify({
      version: 1,
      generated_at: "2026-05-23T10:00:00.000Z",
      generator: "oh-my-openagent-hecateq",
      notice: "Generated file. Do not edit manually. Re-run /hecateq-agent-index.",
      enrichment_mode: "deterministic",
      source: { agents_dirs: [join(opencodeConfigDir, "agents")] },
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
        { name: "nodejs-backend-architect", display_name: "Nodejs Backend Architect", filename: "a.md", source_file: "/tmp/a.md", description: "", body_preview: "preview", role: "backend architect", domains: ["backend"], primary_domain: "backend", secondary_domains: [], agent_type: "specialist", capabilities: { can_plan: true, can_implement: true, can_review: true, can_test: false, can_document: false, can_coordinate: false }, routing: { priority: 90, ambiguity: "low", best_for: [], not_for: [] }, keywords: [], use_when: [], avoid_when: [], confidence: 0.9, signals: { filename: [], frontmatter: [], body: [] }, frontmatter: { domain_hints: [], keywords: [], use_when: [], avoid_when: [], hidden: false, enabled_tools: [], denied_tools: [] }, warnings: [] },
      ],
    }, null, 2))

    const block = buildProjectContextBlock(
      testDir,
      resolveProjectContextInjectorOptions({ mode: "expanded" }),
    )

    expect(block).toContain("- generated: 2026-05-23T10:00:00.000Z")
    expect(block).toContain("- backend: nodejs-backend-architect")
    expect(block).not.toContain("\"agents\":")
    expect(block).not.toContain("body_preview")
    expect(block).not.toContain("use_when")
    expect(block).not.toContain("avoid_when")
  })

  test("invalid agent index does not break context injection", () => {
    setupProjectRoot()
    writeMemoryFile("active-context.md", "# Active Context\n\nCurrent focus")
    writeAgentIndexFile("{broken json")

    const block = buildProjectContextBlock(testDir)

    expect(block).toContain("Agent capabilities:")
    expect(block).toContain("- index: invalid")
    expect(block).toContain("- run /hecateq-agent-index to regenerate")
  })

  test("include_agent_index false omits the agent capability section", () => {
    setupProjectRoot()
    writeMemoryFile("active-context.md", "# Active Context\n\nCurrent focus")
    writeAgentIndexFile("{broken json")

    const block = buildProjectContextBlock(
      testDir,
      resolveProjectContextInjectorOptions({ include_agent_index: false }),
    )

    expect(block).not.toContain("Agent capabilities:")
  })

  test("includes git checkpoint section when provided", () => {
    setupProjectRoot()
    writeMemoryFile("active-context.md", "# Active Context\n\nCurrent focus")

    const block = buildProjectContextBlock(
      testDir,
      resolveProjectContextInjectorOptions(undefined),
      {
        options: {
          enabled: true,
          mode: "suggest",
          autoCheckpointCleanRepo: false,
          checkpointMessage: "chore: checkpoint before hecateq task",
          includeStatusInContext: true,
          includeDirtyFileList: true,
          includeDirtyFileCount: true,
          maxDirtyFiles: 50,
          blockDestructiveGit: true,
        },
        state: {
          kind: "CLEAN_REPO",
          projectRoot: testDir,
          checkpointCreated: false,
          message: "Repository is clean.",
        },
      },
    )

    expect(block).toContain("Git checkpoint:")
    expect(block).toContain("- state: CLEAN_REPO")
    expect(block).toContain("- mode: suggest")
  })

  test("compact mode shows dirty count without dirty file list", () => {
    setupProjectRoot()
    writeMemoryFile("active-context.md", "# Active Context\n\nCurrent focus")

    const block = buildProjectContextBlock(
      testDir,
      resolveProjectContextInjectorOptions(undefined),
      {
        options: {
          enabled: true,
          mode: "suggest",
          autoCheckpointCleanRepo: false,
          checkpointMessage: "chore: checkpoint before hecateq task",
          includeStatusInContext: true,
          includeDirtyFileList: true,
          includeDirtyFileCount: true,
          maxDirtyFiles: 2,
          blockDestructiveGit: true,
        },
        state: {
          kind: "DIRTY_REPO",
          projectRoot: testDir,
          checkpointCreated: false,
          dirtyFiles: ["a.ts", "b.ts"],
          dirtyFileCount: 4,
          truncated: true,
          message: "Repository has uncommitted changes.",
        },
      },
    )

    expect(block).toContain("- dirty_file_count: 4")
    expect(block).toContain("- dirty_files: omitted in compact mode")
    expect(block).not.toContain("  - a.ts")
    expect(block).not.toContain("... and 2 more")
  })

  test("expanded mode truncates dirty git file list in context block", () => {
    setupProjectRoot()
    writeMemoryFile("active-context.md", "# Active Context\n\nCurrent focus")

    const block = buildProjectContextBlock(
      testDir,
      resolveProjectContextInjectorOptions({ mode: "expanded" }),
      {
        options: {
          enabled: true,
          mode: "suggest",
          autoCheckpointCleanRepo: false,
          checkpointMessage: "chore: checkpoint before hecateq task",
          includeStatusInContext: true,
          includeDirtyFileList: true,
          includeDirtyFileCount: true,
          maxDirtyFiles: 2,
          blockDestructiveGit: true,
        },
        state: {
          kind: "DIRTY_REPO",
          projectRoot: testDir,
          checkpointCreated: false,
          dirtyFiles: ["a.ts", "b.ts"],
          dirtyFileCount: 4,
          truncated: true,
          message: "Repository has uncommitted changes.",
        },
      },
    )

    expect(block).toContain("  - a.ts")
    expect(block).toContain("  - b.ts")
    expect(block).toContain("... and 2 more")
  })

  test("expanded mode omits dirty file list when config disables it", () => {
    setupProjectRoot()
    writeMemoryFile("active-context.md", "# Active Context\n\nCurrent focus")

    const block = buildProjectContextBlock(
      testDir,
      resolveProjectContextInjectorOptions({ mode: "expanded" }),
      {
        options: {
          enabled: true,
          mode: "suggest",
          autoCheckpointCleanRepo: false,
          checkpointMessage: "chore: checkpoint before hecateq task",
          includeStatusInContext: true,
          includeDirtyFileList: false,
          includeDirtyFileCount: true,
          maxDirtyFiles: 2,
          blockDestructiveGit: true,
        },
        state: {
          kind: "DIRTY_REPO",
          projectRoot: testDir,
          checkpointCreated: false,
          dirtyFiles: undefined,
          dirtyFileCount: 4,
          truncated: false,
          message: "Repository has uncommitted changes.",
        },
      },
    )

    expect(block).toContain("- dirty_file_count: 4")
    expect(block).toContain("- dirty_files: omitted by config (4 files)")
    expect(block).not.toContain("  - a.ts")
  })

  test("uses configurable max memory chars and max total chars", () => {
    setupProjectRoot()
    for (const fileName of MEMORY_FILE_NAMES) {
      writeMemoryFile(fileName, `# ${fileName}\n\n${"x".repeat(500)}`)
    }

    const block = buildProjectContextBlock(
      testDir,
      resolveProjectContextInjectorOptions({
        mode: "expanded",
        max_memory_file_chars: 40,
        max_total_chars: 180,
      }),
    )

    expect(block).not.toBeNull()
    expect(block!.length).toBeLessThanOrEqual(180)
    expect(block).toContain("[truncated due to context budget]")
  })

  test("respects max_artifact_files and include flags", () => {
    setupProjectRoot()
    writeMemoryFile("active-context.md", "# Active Context\n\nGoal")
    for (let index = 0; index < 5; index += 1) {
      writeFileSync(join(testDir, PROJECT_CONTRACTS_DIR, `contract-${index}.md`), "c", "utf-8")
      writeFileSync(join(testDir, PROJECT_TASK_GRAPHS_DIR, `graph-${index}.md`), "g", "utf-8")
    }

    const limitedBlock = buildProjectContextBlock(
      testDir,
      resolveProjectContextInjectorOptions({ mode: "expanded", max_artifact_files: 2 }),
    )
    expect(limitedBlock?.match(/contract-\d+\.md/g)?.length).toBe(2)
    expect(limitedBlock?.match(/graph-\d+\.md/g)?.length).toBe(2)

    const noContracts = buildProjectContextBlock(
      testDir,
      resolveProjectContextInjectorOptions({ mode: "expanded", include_contracts: false }),
    )
    expect(noContracts).not.toContain("Contracts directory:")

    const noTaskGraphs = buildProjectContextBlock(
      testDir,
      resolveProjectContextInjectorOptions({ mode: "expanded", include_task_graphs: false }),
    )
    expect(noTaskGraphs).not.toContain("Task graphs directory:")
  })

  test("treats missing and empty memory files as non-fatal", () => {
    setupProjectRoot()
    writeMemoryFile("active-context.md", "")
    writeMemoryFile("progress.md", "# Progress\n\nTODO")

    const block = buildProjectContextBlock(testDir, resolveProjectContextInjectorOptions({ mode: "expanded" }))

    expect(block).not.toBeNull()
    expect(block).toContain("active-context.md: present but empty")
    expect(block).toContain("tasks.md: missing")
    expect(block).toContain("[template placeholder omitted]")
  })

  test("compact mode does not print full memory summaries or template placeholders", () => {
    setupProjectRoot()
    writeMemoryFile("active-context.md", "# Active Context\n\nCurrent focus")
    writeMemoryFile("progress.md", "# Progress\n\nTODO")

    const block = buildProjectContextBlock(testDir)

    expect(block).toContain("Memory:")
    expect(block).toContain("Read specific memory files only when needed.")
    expect(block).not.toContain("Memory summary:")
    expect(block).not.toContain("Current focus")
    expect(block).not.toContain("[template placeholder omitted]")
  })

  test("truncates oversized memory context and respects total limit", () => {
    setupProjectRoot()
    const huge = `# Active Context\n\n${"a".repeat(12000)}`
    for (const fileName of MEMORY_FILE_NAMES) {
      writeMemoryFile(fileName, huge)
    }

    const block = buildProjectContextBlock(testDir, resolveProjectContextInjectorOptions({ mode: "expanded" }))

    expect(block).not.toBeNull()
    expect(block!.length).toBeLessThanOrEqual(MAX_TOTAL_CONTEXT_CHARS)
    expect(block).toContain("[truncated due to context budget]")
  })

  test("compact mode keeps the default context block short", () => {
    setupProjectRoot()
    const huge = `# Active Context\n\n${"a".repeat(12000)}`
    for (const fileName of MEMORY_FILE_NAMES) {
      writeMemoryFile(fileName, huge)
    }
    for (let index = 0; index < 10; index += 1) {
      writeFileSync(join(testDir, PROJECT_CONTRACTS_DIR, `contract-${index}.md`), "c", "utf-8")
      writeFileSync(join(testDir, PROJECT_TASK_GRAPHS_DIR, `graph-${index}.md`), "g", "utf-8")
    }

    const block = buildProjectContextBlock(testDir)

    expect(block).not.toBeNull()
    expect(block!.length).toBeLessThanOrEqual(1800)
  })

  test("returns null when project root cannot be found", () => {
    // Use a path whose ancestors have no project markers (avoid /tmp/.opencode contamination)
    const noProjectPath = `/no-project-root-test-${randomUUID()}`
    const block = buildProjectContextBlock(noProjectPath)
    const snapshot = createProjectContextSnapshot(noProjectPath)

    expect(block).toBeNull()
    expect(snapshot).toBeNull()
  })

  test("returns null when context injection mode is off", () => {
    setupProjectRoot()
    writeMemoryFile("active-context.md", "# Active Context\n\nGoal")

    const block = buildProjectContextBlock(
      testDir,
      resolveProjectContextInjectorOptions({ mode: "off" }),
    )

    expect(block).toBeNull()
  })

  test("hook injects context only once for a hecateq session and remains read-only", async () => {
    setupProjectRoot()
    writeMemoryFile("active-context.md", "# Active Context\n\nGoal")
    const beforeFiles = existsSync(join(testDir, PROJECT_CONTRACTS_DIR, "current-contract.md"))
    const hook = createHecateqProjectContextInjectorHook({ directory: testDir } as never)
    const output = { parts: [{ type: "text", text: "Implement feature" }] }

    await hook["chat.message"]({ sessionID: "ses_1", agent: "hecateq-orchestrator" }, output)

    expect(output.parts[0].text).toContain("<hecateq-project-context>")
    expect(output.parts[0].text).toContain("Implement feature")
    expect(existsSync(join(testDir, PROJECT_CONTRACTS_DIR, "current-contract.md"))).toBe(beforeFiles)

    const onceInjected = output.parts[0].text
    await hook["chat.message"]({ sessionID: "ses_1", agent: "hecateq-orchestrator" }, output)
    expect(output.parts[0].text).toBe(onceInjected)
  })

  test("hook does not inject when context injection mode is off", async () => {
    setupProjectRoot()
    writeMemoryFile("active-context.md", "# Active Context\n\nGoal")
    const hook = createHecateqProjectContextInjectorHook(
      { directory: testDir } as never,
      { mode: "off" },
    )
    const output = { parts: [{ type: "text", text: "Implement feature" }] }

    await hook["chat.message"]({ sessionID: "ses_mode_off", agent: "hecateq-orchestrator" }, output)

    expect(output.parts[0].text).toBe("Implement feature")
  })

  test("omits git checkpoint section when git checkpoint helper is disabled", async () => {
    setupProjectRoot()
    initializeGitRepository()
    writeMemoryFile("active-context.md", "# Active Context\n\nGoal")
    const hook = createHecateqProjectContextInjectorHook(
      { directory: testDir } as never,
      undefined,
      { enabled: false },
    )
    const output = { parts: [{ type: "text", text: "Implement feature" }] }

    await hook["chat.message"]({ sessionID: "ses_git_disabled", agent: "hecateq-orchestrator" }, output)

    expect(output.parts[0].text).not.toContain("Git checkpoint:")
  })

  test("omits git checkpoint section when status injection is disabled", async () => {
    setupProjectRoot()
    initializeGitRepository()
    writeMemoryFile("active-context.md", "# Active Context\n\nGoal")
    const hook = createHecateqProjectContextInjectorHook(
      { directory: testDir } as never,
      undefined,
      {
        include_status_in_context: false,
        mode: "suggest",
      },
    )
    const output = { parts: [{ type: "text", text: "Implement feature" }] }

    await hook["chat.message"]({ sessionID: "ses_git_hidden", agent: "hecateq-orchestrator" }, output)

    expect(output.parts[0].text).not.toContain("Git checkpoint:")
    expect(output.parts[0].text).toContain("<hecateq-project-context>")
  })

  test("does not inject for non-hecateq agents", async () => {
    setupProjectRoot()
    writeMemoryFile("active-context.md", "# Active Context\n\nGoal")
    const hook = createHecateqProjectContextInjectorHook({ directory: testDir } as never)
    const output = { parts: [{ type: "text", text: "Implement feature" }] }

    await hook["chat.message"]({ sessionID: "ses_2", agent: "sisyphus" }, output)

    expect(output.parts[0].text).toBe("Implement feature")
  })

  test("injects for non-hecateq agents when hecateq_only is false", async () => {
    setupProjectRoot()
    writeMemoryFile("active-context.md", "# Active Context\n\nGoal")
    const hook = createHecateqProjectContextInjectorHook(
      { directory: testDir } as never,
      { hecateq_only: false },
    )
    const output = { parts: [{ type: "text", text: "Implement feature" }] }

    await hook["chat.message"]({ sessionID: "ses_5", agent: "sisyphus" }, output)

    expect(output.parts[0].text).toContain("<hecateq-project-context>")
  })

  test("does not inject on subagent sessions when inject_on_subagents is false", async () => {
    setupProjectRoot()
    writeMemoryFile("active-context.md", "# Active Context\n\nGoal")
    const { subagentSessions } = await import("../../features/claude-code-session-state")
    subagentSessions.add("ses_sub")
    const hook = createHecateqProjectContextInjectorHook({ directory: testDir } as never)
    const output = { parts: [{ type: "text", text: "Implement feature" }] }

    try {
      await hook["chat.message"]({ sessionID: "ses_sub", agent: "hecateq-orchestrator" }, output)
      expect(output.parts[0].text).toBe("Implement feature")
    } finally {
      subagentSessions.delete("ses_sub")
    }
  })

  test("injects on subagent sessions when inject_on_subagents is true", async () => {
    setupProjectRoot()
    writeMemoryFile("active-context.md", "# Active Context\n\nGoal")
    const { subagentSessions } = await import("../../features/claude-code-session-state")
    subagentSessions.add("ses_sub_true")
    const hook = createHecateqProjectContextInjectorHook(
      { directory: testDir } as never,
      { inject_on_subagents: true },
    )
    const output = { parts: [{ type: "text", text: "Implement feature" }] }

    try {
      await hook["chat.message"]({ sessionID: "ses_sub_true", agent: "hecateq-orchestrator" }, output)
      expect(output.parts[0].text).toContain("<hecateq-project-context>")
    } finally {
      subagentSessions.delete("ses_sub_true")
    }
  })

  test("does not inject when no project root exists and does not create files", async () => {
    const noProjectPath = `/no-project-root-test-${randomUUID()}`
    const hook = createHecateqProjectContextInjectorHook({ directory: noProjectPath } as never)
    const output = { parts: [{ type: "text", text: "Implement feature" }] }

    await hook["chat.message"]({ sessionID: "ses_3", agent: "hecateq-orchestrator" }, output)

    expect(output.parts[0].text).toBe("Implement feature")
    expect(existsSync(join(noProjectPath, PROJECT_MEMORY_DIR))).toBe(false)
    expect(existsSync(join(noProjectPath, PROJECT_CONTRACTS_DIR))).toBe(false)
    expect(existsSync(join(noProjectPath, PROJECT_TASK_GRAPHS_DIR))).toBe(false)
  })

  test("clears per-session state after session.deleted", async () => {
    setupProjectRoot()
    writeMemoryFile("active-context.md", "# Active Context\n\nGoal")
    const hook = createHecateqProjectContextInjectorHook({ directory: testDir } as never)
    const firstOutput = { parts: [{ type: "text", text: "First" }] }
    await hook["chat.message"]({ sessionID: "ses_4", agent: "hecateq-orchestrator" }, firstOutput)

    await hook.event({ event: { type: "session.deleted", properties: { sessionID: "ses_4" } } })

    const secondOutput = { parts: [{ type: "text", text: "Second" }] }
    await hook["chat.message"]({ sessionID: "ses_4", agent: "hecateq-orchestrator" }, secondOutput)

    expect(secondOutput.parts[0].text).toContain("<hecateq-project-context>")
  })

  // ─── Stage 1/2 Production Wiring ──────────────────────────────────────────

  describe("hecateq auto-spawn production wiring", () => {
    test("hook factory accepts autoSpawnConfig and delegationChainConfig without error", () => {
      setupProjectRoot()
      const hook = createHecateqProjectContextInjectorHook(
        { directory: testDir } as never,
        undefined,
        undefined,
        undefined,
        {
          enabled: true,
          max_concurrent_spawns: 5,
          spawn_timeout_ms: 300000,
          auto_retry_on_failure: true,
          max_failures_before_pause: 3,
          pause_duration_ms: 60000,
          allow_background_spawn: true,
          max_spawn_depth: 3,
        },
        { max_depth: 3 },
        undefined,
      )
      expect(hook).toBeDefined()
      expect(hook.HOOK_NAME).toBe("hecateq-project-context-injector")
    })

    test("hook does NOT trigger delegation consumption when autoSpawnConfig is disabled", async () => {
      setupProjectRoot()
      writeMemoryFile("active-context.md", "# Active Context\n\nGoal")

      const hook = createHecateqProjectContextInjectorHook(
        { directory: testDir } as never,
        undefined,
        undefined,
        undefined,
        {
          enabled: false,
          max_concurrent_spawns: 5,
          spawn_timeout_ms: 300000,
          auto_retry_on_failure: true,
          max_failures_before_pause: 3,
          pause_duration_ms: 60000,
          allow_background_spawn: true,
          max_spawn_depth: 3,
        },
        { max_depth: 3 },
      )

      const output = { parts: [{ type: "text", text: "First message" }] }
      await hook["chat.message"]({ sessionID: "ses_auto", agent: "hecateq-orchestrator" }, output)

      expect(output.parts[0].text).toContain("<hecateq-project-context>")
    })

    test("hook skips delegation consumption when no backgroundManager provided", async () => {
      setupProjectRoot()
      writeMemoryFile("active-context.md", "# Active Context\n\nGoal")

      const hook = createHecateqProjectContextInjectorHook(
        { directory: testDir } as never,
        undefined,
        undefined,
        undefined,
        {
          enabled: true,
          max_concurrent_spawns: 5,
          spawn_timeout_ms: 300000,
          auto_retry_on_failure: true,
          max_failures_before_pause: 3,
          pause_duration_ms: 60000,
          allow_background_spawn: true,
          max_spawn_depth: 3,
        },
        { max_depth: 5 },
        undefined,
      )

      const output = { parts: [{ type: "text", text: "First message" }] }
      await hook["chat.message"]({ sessionID: "ses_no_bm", agent: "hecateq-orchestrator" }, output)

      expect(output.parts[0].text).toContain("<hecateq-project-context>")
    })
  })
})
