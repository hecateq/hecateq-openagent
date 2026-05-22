import { afterEach, describe, expect, it } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import {
  checkHecateqWorkflow,
  collectCustomAgentIssues,
  collectHecateqConfigIssues,
  collectProjectRootMemoryIssues,
  collectSafetyHookIssues,
  collectSecretFindings,
} from "./hecateq-workflow"
import { PROJECT_MEMORY_FILES } from "../../../shared/memory-bootstrap"

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
})
