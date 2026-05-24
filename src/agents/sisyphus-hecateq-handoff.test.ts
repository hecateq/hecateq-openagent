/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import type { HecateqCustomAgentSummary } from "./hecateq-orchestrator"
import * as shared from "../shared"

const TEST_DEFAULT_MODEL = "openai/gpt-5.4"

let createBuiltinAgents: (typeof import("./builtin-agents"))["createBuiltinAgents"]

async function importFreshBuiltinAgentsModule(): Promise<typeof import("./builtin-agents")> {
  return import(`./builtin-agents?hecateq-handoff-test=${Date.now()}-${Math.random()}`)
}

beforeEach(async () => {
  mock.restore()
  ;({ createBuiltinAgents } = await importFreshBuiltinAgentsModule())
})

afterEach(() => {
  mock.restore()
})

describe("Sisyphus Hecateq handoff policy", () => {
  test("injects prompt-level Hecateq handoff guidance into Sisyphus without changing Hecateq-only policy blocks", async () => {
    const fetchSpy = spyOn(shared, "fetchAvailableModels").mockResolvedValue(
      new Set(["anthropic/claude-opus-4-7", "openai/gpt-5.4"]),
    )

    const customAgentSummaries: HecateqCustomAgentSummary[] = [
      {
        name: "backend-engineer",
        description: "Custom backend specialist",
        hidden: false,
      },
    ]

    try {
      const agents = await createBuiltinAgents(
        [],
        {},
        undefined,
        TEST_DEFAULT_MODEL,
        undefined,
        undefined,
        [],
        customAgentSummaries,
      )

      expect(agents.sisyphus.prompt).toContain("SISYPHUS → HECATEQ HANDOFF POLICY")
      expect(agents.sisyphus.prompt).toContain("This looks like a large multi-domain orchestration task. Do you want me to hand this over to Hecateq Orchestrator?")
      expect(agents.sisyphus.prompt).toContain("Bu görev büyük ve çok alanlı görünüyor. Bunu Hecateq Orchestrator’a devretmemi ister misin?")
      expect(agents.sisyphus.prompt).toContain("task(subagent_type=\"hecateq-orchestrator\", ...)")
      expect(agents.sisyphus.prompt).toContain("Do not auto-switch at runtime.")
      expect(agents.sisyphus.prompt).toContain("If Hecateq is unknown, unavailable, or disabled")

      expect(agents["hecateq-orchestrator"].prompt).toContain("Hecateq God")
      expect(agents["hecateq-orchestrator"].prompt).toContain("PROJECT-ROOT MEMORY POLICY")
      expect(agents["hecateq-orchestrator"].prompt).toContain("GIT CHECKPOINT POLICY")
      expect(agents["hecateq-orchestrator"].prompt).toContain("PROMPT INTAKE / TASK ANALYZER POLICY")
      expect(agents["hecateq-orchestrator"].prompt).toContain("MINIMUM AGENT PRINCIPLE")
      expect(agents["hecateq-orchestrator"].prompt).toContain("DELEGATION TOOLING POLICY")
      expect(agents["hecateq-orchestrator"].prompt).toContain("BACKGROUND / FOREGROUND DELEGATION POLICY")
      expect(agents["hecateq-orchestrator"].prompt).toContain("CATEGORY FALLBACK POLICY")
      expect(agents["hecateq-orchestrator"].prompt).toContain("Hecateq God is orchestration-first and must not become the default implementation owner.")
      expect(agents["hecateq-orchestrator"].prompt).toContain("For any implementation task beyond a tiny safe bridging fix, delegate to an owner agent instead of doing the work directly.")
      expect(agents["hecateq-orchestrator"].prompt).toContain("Allow direct edits only for tiny safe bridging fixes")
      expect(agents["hecateq-orchestrator"].prompt).toContain("Do not use tiny safe bridging fixes for feature implementation")
      expect(agents["hecateq-orchestrator"].prompt).toContain("TINY SAFE BRIDGING FIX GATE")
      expect(agents["hecateq-orchestrator"].prompt).toContain("If any condition fails, delegate the work.")
      expect(agents["hecateq-orchestrator"].prompt).toContain("AGENT INDEX USAGE POLICY")
      expect(agents["hecateq-orchestrator"].prompt).toContain("AGENT INDEX RUNTIME VALIDATION RULE")
      expect(agents["hecateq-orchestrator"].prompt).toContain('task(subagent_type="<exact-agent-name>", ...)')
      expect(agents["hecateq-orchestrator"].prompt).toContain("is denied at runtime for orchestrator agents.")
      expect(agents["hecateq-orchestrator"].prompt).toContain("INTAKE SUMMARY:")
      expect(agents["hecateq-orchestrator"].prompt).toContain("<custom-agent-registry>")
      expect(agents["hecateq-orchestrator"].prompt).toContain("TASK DEPENDENCY GRAPH POLICY")
      expect(agents["hecateq-orchestrator"].prompt).toContain("SHARED CONTRACT ARTIFACT POLICY")
      expect(agents["hecateq-orchestrator"].prompt).toContain("TASK GRAPH:")
      expect(agents["hecateq-orchestrator"].prompt).toContain("SHARED CONTRACT:")
      expect(agents["hecateq-orchestrator"].prompt).toContain("contract_required")
      expect(agents["hecateq-orchestrator"].prompt).toContain(".opencode/task-graphs/")
      expect(agents["hecateq-orchestrator"].prompt).toContain(".opencode/contracts/")
      expect(agents.sisyphus.prompt).not.toContain("PROJECT-ROOT MEMORY POLICY")
      expect(agents.sisyphus.prompt).not.toContain("GIT CHECKPOINT POLICY")
      expect(agents.sisyphus.prompt).not.toContain("PROMPT INTAKE / TASK ANALYZER POLICY")
      expect(agents.sisyphus.prompt).not.toContain("TASK DEPENDENCY GRAPH POLICY")
      expect(agents.sisyphus.prompt).not.toContain("SHARED CONTRACT ARTIFACT POLICY")
      expect(agents.sisyphus.prompt).not.toContain("AGENT INDEX USAGE POLICY")
      expect(agents.sisyphus.prompt).not.toContain("DELEGATION TOOLING POLICY")
    } finally {
      fetchSpy.mockRestore()
    }
  })
})
