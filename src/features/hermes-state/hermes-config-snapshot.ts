import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { OhMyOpenCodeConfig } from "../../config"
import { HermesStateWriter } from "./hermes-state-writer"

const CONFIG_SNAPSHOT_FILE = "plugin-config-snapshot.json"

interface ConfigSnapshot {
  plugin_version: string
  generated_at: string
  hecateq: {
    enabled: boolean
    orchestration_enabled: boolean
    context_injection_enabled: boolean
    memory_bootstrap_enabled: boolean
  }
  features: {
    team_mode_enabled: boolean
    task_system_enabled: boolean
    telemetry_enabled: boolean
    auto_update_enabled: boolean
  }
  counts: {
    agents_total: number
    agents_disabled: number
    hooks_total: number
    hooks_disabled: number
    tools_total: number
    tools_disabled: number
  }
  providers: string[]
  has_mcp_config: boolean
}

export interface HermesConfigSnapshotDeps {
  connectedProviders?: string[]
}

export class HermesConfigSnapshot {
  private writer: HermesStateWriter

  constructor(projectRoot: string) {
    this.writer = new HermesStateWriter(projectRoot)
  }

  writeSnapshot(
    config: OhMyOpenCodeConfig,
    pluginVersion: string,
    deps: HermesConfigSnapshotDeps = {},
  ): boolean {
    const providers = (deps.connectedProviders ?? []).map((p) => p.toLowerCase()).sort()
    const snapshot: ConfigSnapshot = {
      plugin_version: pluginVersion,
      generated_at: new Date().toISOString(),
      hecateq: {
        enabled: config.hecateq?.enabled ?? true,
        orchestration_enabled: config.hecateq?.orchestration?.enabled ?? true,
        context_injection_enabled: config.hecateq?.context_injection?.enabled ?? true,
        memory_bootstrap_enabled: config.hecateq?.memory_bootstrap?.enabled ?? true,
      },
      features: {
        team_mode_enabled: config.team_mode?.enabled ?? false,
        task_system_enabled: config.experimental?.task_system ?? false,
        telemetry_enabled: false,
        auto_update_enabled: config.auto_update ?? false,
      },
      counts: {
        agents_total: 11,
        agents_disabled: config.disabled_agents?.length ?? 0,
        hooks_total: config.team_mode?.enabled ? 61 : 54,
        hooks_disabled: config.disabled_hooks?.length ?? 0,
        tools_total: 20,
        tools_disabled: config.disabled_tools?.length ?? 0,
      },
      providers,
      has_mcp_config: detectMcpConfigPresence(this.writer.projectRoot, config),
    }
    return this.writer.writeAtomically(CONFIG_SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2))
  }
}

function detectMcpConfigPresence(projectRoot: string, config: OhMyOpenCodeConfig): boolean {
  const mcpJsonPaths = [
    join(projectRoot, ".mcp.json"),
    join(homedir(), ".mcp.json"),
    join(homedir(), ".config", "opencode", ".mcp.json"),
  ]
  for (const p of mcpJsonPaths) {
    try {
      if (existsSync(p)) return true
    } catch {
      // best-effort — permission errors or broken symlinks treated as absent
    }
  }
  return (config.disabled_mcps && config.disabled_mcps.length > 0) ? true : false
}
