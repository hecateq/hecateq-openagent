import { existsSync, readdirSync } from "fs"
import { join } from "path"
import { isMarkdownFile } from "../../shared/file-utils"
import { getClaudeConfigDir } from "../../shared"
import { log } from "../../shared/logger"
import type { AgentScope, ClaudeCodeAgentConfig, LoadedAgent } from "./types"
import { getOpenCodeConfigDirs } from "../../shared/opencode-config-dir"
import { parseMarkdownAgentFile } from "./agent-definitions-loader"

function loadAgentsFromDir(agentsDir: string, scope: AgentScope): LoadedAgent[] {
  if (!existsSync(agentsDir)) {
    return []
  }

  const entries = readdirSync(agentsDir, { withFileTypes: true })
  const agents: LoadedAgent[] = []

  for (const entry of entries) {
    if (!isMarkdownFile(entry)) continue

    const agentPath = join(agentsDir, entry.name)
    const agent = parseMarkdownAgentFile(agentPath, scope)

    if (agent) {
      agents.push(agent)
    }
  }

  return agents
}

function buildAgentRecord(
  agents: LoadedAgent[],
  source: AgentScope,
  duplicateMode: "overwrite" | "first-wins" = "overwrite",
): Record<string, ClaudeCodeAgentConfig> {
  const result: Record<string, ClaudeCodeAgentConfig> = Object.create(null)

  for (const agent of agents) {
    if (agent.name in result) {
      log("[claude-code-agent-loader] Duplicate custom agent name discovered", {
        source,
        agentName: agent.name,
        duplicateMode,
      })

      if (duplicateMode === "first-wins") {
        continue
      }
    }

    result[agent.name] = agent.config
  }

  return result
}

export function loadUserAgents(): Record<string, ClaudeCodeAgentConfig> {
  const userAgentsDir = join(getClaudeConfigDir(), "agents")
  const agents = loadAgentsFromDir(userAgentsDir, "user")
  return buildAgentRecord(agents, "user")
}

export function loadProjectAgents(directory?: string): Record<string, ClaudeCodeAgentConfig> {
  const projectAgentsDir = join(directory ?? process.cwd(), ".claude", "agents")
  const agents = loadAgentsFromDir(projectAgentsDir, "project")
  return buildAgentRecord(agents, "project")
}

export function loadOpencodeGlobalAgents(): Record<string, ClaudeCodeAgentConfig> {
  const result: Record<string, ClaudeCodeAgentConfig> = Object.create(null)
  const configDirs = getOpenCodeConfigDirs({ binary: "opencode" })

  for (const configDir of configDirs) {
    const opencodeAgentsDir = join(configDir, "agents")
    const agents = loadAgentsFromDir(opencodeAgentsDir, "opencode")

    const merged = buildAgentRecord(agents, "opencode", "first-wins")
    for (const [agentName, agentConfig] of Object.entries(merged)) {
      if (agentName in result) {
        log("[claude-code-agent-loader] Duplicate custom agent name discovered across OpenCode config directories", {
          source: "opencode",
          agentName,
          duplicateMode: "first-wins",
        })
        continue
      }
      result[agentName] = agentConfig
    }
  }

  return result
}

export function loadOpencodeProjectAgents(directory?: string): Record<string, ClaudeCodeAgentConfig> {
  const opencodeProjectDir = join(directory ?? process.cwd(), ".opencode", "agents")
  const agents = loadAgentsFromDir(opencodeProjectDir, "opencode-project")
  return buildAgentRecord(agents, "opencode-project")
}
