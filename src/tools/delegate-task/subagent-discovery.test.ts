/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"

import {
  isHecateqAgentIndexStale,
  joinAgentIndexMetadata,
  normalizeAgentIndexName,
} from "../../shared/hecateq-agent-indexer"

type SubagentDiscoveryModule = typeof import("./subagent-discovery")

const loadUserAgentsMock = mock(() => ({} as Record<string, { mode?: string }>))
const loadProjectAgentsMock = mock((_directory?: string) => ({} as Record<string, { mode?: string }>))
const loadOpencodeGlobalAgentsMock = mock(() => ({} as Record<string, { mode?: string }>))
const loadOpencodeProjectAgentsMock = mock((_directory?: string) => ({} as Record<string, { mode?: string }>))
const readOpencodeConfigAgentsMock = mock((_directory?: string) => ({} as Record<string, { mode?: string }>))
const readHecateqAgentIndexFileMock = mock(() => null as Awaited<ReturnType<typeof import("../../shared/hecateq-agent-indexer")["readHecateqAgentIndexFile"]>>)

async function importFreshSubagentDiscoveryModule(): Promise<SubagentDiscoveryModule> {
  return import(`./subagent-discovery?test=${Date.now()}-${Math.random()}`)
}

describe("subagent-discovery", () => {
  let mergeWithDiscoveredAgents: SubagentDiscoveryModule["mergeWithDiscoveredAgents"]
  let formatUnknownAgentSuggestions: SubagentDiscoveryModule["formatUnknownAgentSuggestions"]

  beforeEach(async () => {
    mock.restore()
    loadUserAgentsMock.mockReset()
    loadProjectAgentsMock.mockReset()
    loadOpencodeGlobalAgentsMock.mockReset()
    loadOpencodeProjectAgentsMock.mockReset()
    readOpencodeConfigAgentsMock.mockReset()
    readHecateqAgentIndexFileMock.mockReset()
    loadUserAgentsMock.mockImplementation(() => ({}))
    loadProjectAgentsMock.mockImplementation(() => ({}))
    loadOpencodeGlobalAgentsMock.mockImplementation(() => ({}))
    loadOpencodeProjectAgentsMock.mockImplementation(() => ({}))
    readOpencodeConfigAgentsMock.mockImplementation(() => ({}))
    readHecateqAgentIndexFileMock.mockImplementation(() => null)

    mock.module("../../features/claude-code-agent-loader", () => ({
      loadUserAgents: loadUserAgentsMock,
      loadProjectAgents: loadProjectAgentsMock,
      loadOpencodeGlobalAgents: loadOpencodeGlobalAgentsMock,
      loadOpencodeProjectAgents: loadOpencodeProjectAgentsMock,
      readOpencodeConfigAgents: readOpencodeConfigAgentsMock,
    }))
    mock.module("../../shared/hecateq-agent-indexer", () => ({
      isHecateqAgentIndexStale,
      joinAgentIndexMetadata,
      normalizeAgentIndexName,
      readHecateqAgentIndexFile: readHecateqAgentIndexFileMock,
    }))

    ;({ mergeWithDiscoveredAgents, formatUnknownAgentSuggestions } = await importFreshSubagentDiscoveryModule())
  })

  afterEach(() => {
    mock.restore()
  })

  test("attaches generated metadata only to runtime-valid agents", () => {
    readHecateqAgentIndexFileMock.mockReturnValue({
      version: 1,
      generated_at: new Date().toISOString(),
      generator: "oh-my-openagent-hecateq",
      notice: "Generated file. Do not edit manually. Re-run /hecateq-agent-index.",
      enrichment_mode: "deterministic",
      source: { agents_dirs: ["/tmp/agents"] },
      summary: {
        agents_discovered: 2,
        agents_indexed: 2,
        weak_metadata: 0,
        duplicates: 0,
        high_ambiguity: 0,
        unknown_primary_domain: 0,
        domain_coverage: { backend: 1, docs: 1 },
      },
      agents: [
        {
          name: "nodejs-backend-architect",
          display_name: "Nodejs Backend Architect",
          filename: "nodejs-backend-architect.md",
          source_file: "/tmp/agents/nodejs-backend-architect.md",
          description: "Backend architecture expert",
          body_preview: "Backend architecture expert",
          role: "Backend architecture expert",
          domains: ["backend"],
          primary_domain: "backend",
          secondary_domains: [],
          agent_type: "specialist",
          capabilities: { can_plan: true, can_implement: false, can_review: true, can_test: false, can_document: false, can_coordinate: false },
          routing: { priority: 60, ambiguity: "low", best_for: [], not_for: [] },
          keywords: ["backend"],
          use_when: ["API design"],
          avoid_when: [],
          confidence: 0.91,
          signals: { filename: ["backend"], frontmatter: [], body: [] },
          warnings: [],
        },
        {
          name: "missing-runtime-agent",
          display_name: "Missing Runtime Agent",
          filename: "missing-runtime-agent.md",
          source_file: "/tmp/agents/missing-runtime-agent.md",
          description: "Missing runtime agent",
          body_preview: "Missing runtime agent",
          role: "Missing runtime agent",
          domains: ["docs"],
          primary_domain: "docs",
          secondary_domains: [],
          agent_type: "documentarian",
          capabilities: { can_plan: true, can_implement: false, can_review: true, can_test: false, can_document: true, can_coordinate: false },
          routing: { priority: 40, ambiguity: "low", best_for: [], not_for: [] },
          keywords: ["docs"],
          use_when: ["docs"],
          avoid_when: [],
          confidence: 0.74,
          signals: { filename: ["docs"], frontmatter: [], body: [] },
          warnings: [],
        },
      ],
    })

    const merged = mergeWithDiscoveredAgents([
      { name: "nodejs-backend-architect", mode: "subagent" },
      { name: "oracle", mode: "subagent" },
    ], "/tmp/project")

    expect(merged).toHaveLength(2)
    expect(merged[0]?.agentIndex?.primaryDomain).toBe("backend")
    expect(merged[1]?.agentIndex).toBeUndefined()
  })

  test("uses ranked suggestions when metadata is available", () => {
    const suggestions = formatUnknownAgentSuggestions(
      "backend-architect",
      [
        {
          name: "database-specialist",
          mode: "subagent",
          agentIndex: { primaryDomain: "database", confidence: 0.82, ambiguity: "low" },
        },
        {
          name: "nodejs-backend-developer",
          mode: "subagent",
          agentIndex: { primaryDomain: "backend", confidence: 0.86, ambiguity: "low" },
        },
        {
          name: "nodejs-backend-architect",
          mode: "subagent",
          agentIndex: { primaryDomain: "backend", confidence: 0.91, ambiguity: "low" },
        },
      ],
      { useForSuggestions: true, maxSuggestions: 3 },
    )

    const lines = suggestions.split("\n")
    expect(lines[0]).toContain("nodejs-backend-architect")
    expect(lines[1]).toContain("nodejs-backend-developer")
    expect(lines[2]).toContain("database-specialist")
  })

  test("falls back to legacy comma-separated suggestions when metadata suggestions are disabled", () => {
    const suggestions = formatUnknownAgentSuggestions(
      "backend-architect",
      [
        {
          name: "nodejs-backend-architect",
          mode: "subagent",
          agentIndex: { primaryDomain: "backend", confidence: 0.91, ambiguity: "low" },
        },
        {
          name: "database-specialist",
          mode: "subagent",
          agentIndex: { primaryDomain: "database", confidence: 0.82, ambiguity: "low" },
        },
      ],
      { useForSuggestions: false, maxSuggestions: 10 },
    )

    expect(suggestions).toBe("database-specialist, nodejs-backend-architect")
  })
})
