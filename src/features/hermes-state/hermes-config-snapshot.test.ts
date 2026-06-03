import { describe, it, expect, afterEach } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { HermesConfigSnapshot } from "./hermes-config-snapshot"
import type { OhMyOpenCodeConfig } from "../../config"

function createTestDir(): string {
  const dir = join(tmpdir(), `hermes-config-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

function makeConfig(overrides: Partial<OhMyOpenCodeConfig> = {}): OhMyOpenCodeConfig {
  return {
    hecateq: {
      enabled: true,
      orchestration: { enabled: true },
      context_injection: { enabled: true },
      memory_bootstrap: { enabled: false },
    },
    team_mode: { enabled: false },
    experimental: { task_system: true },
    auto_update: true,
    disabled_agents: ["oracle"],
    disabled_hooks: ["auto-update-checker", "ralph-loop"],
    disabled_tools: [],
    disabled_mcps: [],
    ...overrides,
  } as OhMyOpenCodeConfig
}

describe("HermesConfigSnapshot", () => {
  let testDir: string
  let snapshot: HermesConfigSnapshot

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }) } catch { /* cleanup */ }
  })

  // given a plugin config
  // when writeSnapshot is called
  // then the snapshot file exists with allowlisted fields
  it("writes plugin-config-snapshot.json with allowlisted fields", () => {
    testDir = createTestDir()
    snapshot = new HermesConfigSnapshot(testDir)
    const config = makeConfig()
    const result = snapshot.writeSnapshot(config, "4.3.0")
    expect(result).toBe(true)
    const filePath = join(testDir, ".opencode", "state", "plugin-config-snapshot.json")
    expect(existsSync(filePath)).toBe(true)
    const content = JSON.parse(readFileSync(filePath, "utf-8"))
    expect(content.plugin_version).toBe("4.3.0")
    expect(content.hecateq.enabled).toBe(true)
    expect(content.hecateq.orchestration_enabled).toBe(true)
    expect(content.features.task_system_enabled).toBe(true)
    expect(content.features.team_mode_enabled).toBe(false)
    expect(content.counts.agents_disabled).toBe(1)
    expect(content.counts.hooks_disabled).toBe(2)
    expect(content.has_mcp_config).toBe(false)
  })

  // given a config with team mode enabled
  // when writeSnapshot is called
  // then hook count reflects team-mode additions
  it("reflects team-mode hook count when enabled", () => {
    testDir = createTestDir()
    snapshot = new HermesConfigSnapshot(testDir)
    const config = makeConfig({
      team_mode: {
        enabled: true,
        tmux_visualization: false,
        max_parallel_members: 4,
        max_members: 8,
        max_messages_per_run: 10000,
        max_wall_clock_minutes: 120,
        max_member_turns: 500,
        message_payload_max_bytes: 32768,
        recipient_unread_max_bytes: 262144,
        mailbox_poll_interval_ms: 3000,
      },
    } as OhMyOpenCodeConfig)
    snapshot.writeSnapshot(config, "0.1.0-beta.8")
    const filePath = join(testDir, ".opencode", "state", "plugin-config-snapshot.json")
    const content = JSON.parse(readFileSync(filePath, "utf-8"))
    expect(content.counts.hooks_total).toBe(61)
  })

  // given no connected providers are provided
  // when writeSnapshot is called
  // then providers array is empty
  it("returns empty providers when none provided", () => {
    testDir = createTestDir()
    snapshot = new HermesConfigSnapshot(testDir)
    const config = makeConfig()
    snapshot.writeSnapshot(config, "1.0.0")
    const filePath = join(testDir, ".opencode", "state", "plugin-config-snapshot.json")
    const content = JSON.parse(readFileSync(filePath, "utf-8"))
    expect(content.providers).toEqual([])
  })

  // given connected providers are injected
  // when writeSnapshot is called
  // then providers are in the snapshot
  it("includes provided connected providers in snapshot", () => {
    testDir = createTestDir()
    snapshot = new HermesConfigSnapshot(testDir)
    const config = makeConfig()
    snapshot.writeSnapshot(config, "1.0.0", {
      connectedProviders: ["Anthropic", "OpenAI", "openRouter"],
    })
    const filePath = join(testDir, ".opencode", "state", "plugin-config-snapshot.json")
    const content = JSON.parse(readFileSync(filePath, "utf-8"))
    expect(content.providers).toEqual(["anthropic", "openai", "openrouter"])
  })

  // given a config with disabled MCPs
  // when writeSnapshot is called
  // then has_mcp_config is true
  it("sets has_mcp_config when disabled_mcps is non-empty", () => {
    testDir = createTestDir()
    snapshot = new HermesConfigSnapshot(testDir)
    const config = makeConfig({ disabled_mcps: ["context7"] })
    snapshot.writeSnapshot(config, "1.0.0")
    const filePath = join(testDir, ".opencode", "state", "plugin-config-snapshot.json")
    const content = JSON.parse(readFileSync(filePath, "utf-8"))
    expect(content.has_mcp_config).toBe(true)
  })

  // given a project root with a .mcp.json file
  // when writeSnapshot is called with empty disabled_mcps
  // then has_mcp_config is true from the file presence
  it("sets has_mcp_config true when .mcp.json exists in project root", () => {
    testDir = createTestDir()
    writeFileSync(join(testDir, ".mcp.json"), '{"mcpServers":{}}', "utf-8")
    snapshot = new HermesConfigSnapshot(testDir)
    const config = makeConfig({ disabled_mcps: [] })
    snapshot.writeSnapshot(config, "1.0.0")
    const filePath = join(testDir, ".opencode", "state", "plugin-config-snapshot.json")
    const content = JSON.parse(readFileSync(filePath, "utf-8"))
    expect(content.has_mcp_config).toBe(true)
  })

  // given no .mcp.json and empty disabled_mcps
  // when writeSnapshot is called
  // then has_mcp_config is false
  it("sets has_mcp_config false when no .mcp.json and no disabled_mcps", () => {
    testDir = createTestDir()
    snapshot = new HermesConfigSnapshot(testDir)
    const config = makeConfig({ disabled_mcps: [] })
    snapshot.writeSnapshot(config, "1.0.0")
    const filePath = join(testDir, ".opencode", "state", "plugin-config-snapshot.json")
    const content = JSON.parse(readFileSync(filePath, "utf-8"))
    expect(content.has_mcp_config).toBe(false)
  })
})
