import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

import { getKnownAgentIds } from "../features/hecateq-orchestration/handoff-parser"
import { getOpenCodeConfigDirs } from "./opencode-config-dir"
import type { AgentSource } from "./hecateq-agent-indexer"

export interface RuntimeAgentInventory {
  readonly ids: ReadonlySet<string>
  readonly byId: ReadonlyMap<string, { source: AgentSource; isSystem: boolean }>
}

interface OpencodeConfigShape {
  agents?: Record<string, unknown>
}

function stripJsonc(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/,(\s*[}\]])/g, "$1")
}

function collectMarkdownAgentIds(dirPath: string, into: Set<string>, byId: Map<string, { source: AgentSource; isSystem: boolean }>, source: AgentSource): void {
  if (!existsSync(dirPath)) return
  for (const entry of readdirSync(dirPath)) {
    if (!entry.endsWith(".md")) continue
    const id = entry.replace(/\.md$/, "").trim().toLowerCase()
    into.add(id)
    if (!byId.has(id)) {
      byId.set(id, { source, isSystem: false })
    }
  }
}

function collectConfigDefinedAgents(configDir: string, into: Set<string>, byId: Map<string, { source: AgentSource; isSystem: boolean }>, source: AgentSource): void {
  const configPath = join(configDir, "oh-my-openagent.jsonc")
  if (!existsSync(configPath)) return
  try {
    const text = readFileSync(configPath, "utf8")
    const parsed = JSON.parse(stripJsonc(text)) as OpencodeConfigShape
    if (parsed.agents) {
      for (const id of Object.keys(parsed.agents)) {
        const canon = id.trim().toLowerCase()
        into.add(canon)
        if (!byId.has(canon)) {
          byId.set(canon, { source, isSystem: false })
        }
      }
    }
  } catch {
    // Malformed config is ignored; runtime discovery stays authoritative.
  }
}

export function loadRuntimeAgentInventory(projectRoot: string): RuntimeAgentInventory {
  const ids = new Set<string>()
  const byId = new Map<string, { source: AgentSource; isSystem: boolean }>()

  for (const builtin of getKnownAgentIds()) {
    ids.add(builtin)
    byId.set(builtin, { source: "builtin", isSystem: true })
  }

  const configDirs = getOpenCodeConfigDirs({ binary: "opencode" })
  for (const dir of configDirs) {
    collectMarkdownAgentIds(join(dir, "agents"), ids, byId, "global")
    collectConfigDefinedAgents(dir, ids, byId, "global")
  }

  collectMarkdownAgentIds(join(projectRoot, ".opencode", "agents"), ids, byId, "project")
  collectMarkdownAgentIds(join(projectRoot, ".claude", "agents"), ids, byId, "project")

  return { ids, byId }
}
