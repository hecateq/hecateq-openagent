import { describe, expect, it } from "bun:test"
import {
  HECATEQ_ORCHESTRATOR_POLICY,
  HECATEQ_PROJECT_ROOT_MEMORY_POLICY,
  buildDefaultHecateqOrchestratorPrompt,
} from "./default"

describe("Hecateq God orchestrator prompt — Phase 3B.2a", () => {
  describe("#HECATEQ_PROJECT_ROOT_MEMORY_POLICY", () => {
    it("includes MEMORY_UPDATE contract reference", () => {
      expect(HECATEQ_PROJECT_ROOT_MEMORY_POLICY).toContain("MEMORY_UPDATE")
      expect(HECATEQ_PROJECT_ROOT_MEMORY_POLICY).toContain("<MEMORY_UPDATE>")
      expect(HECATEQ_PROJECT_ROOT_MEMORY_POLICY).toContain("</MEMORY_UPDATE>")
    })

    it("forbids subagents from directly editing memory files", () => {
      expect(HECATEQ_PROJECT_ROOT_MEMORY_POLICY).toContain(
        "MUST NOT directly edit"
      )
      expect(HECATEQ_PROJECT_ROOT_MEMORY_POLICY).toContain(
        ".opencode/state/memory/*"
      )
    })

    it("instructs subagents to emit MEMORY_UPDATE block at task completion", () => {
      expect(HECATEQ_PROJECT_ROOT_MEMORY_POLICY).toContain(
        "MEMORY_UPDATE block"
      )
      expect(HECATEQ_PROJECT_ROOT_MEMORY_POLICY).toContain(
        "task completion when useful project memory exists"
      )
    })

    it("instructs to use relative source paths only", () => {
      // The policy mentions project-scoped which implies relative paths
      expect(HECATEQ_PROJECT_ROOT_MEMORY_POLICY).toContain("relative source paths")
    })

    it("instructs to omit generated/build paths", () => {
      expect(HECATEQ_PROJECT_ROOT_MEMORY_POLICY).toContain(
        "omit generated/build paths"
      )
    })

    it("instructs to never invent tests, files, risks, decisions", () => {
      expect(HECATEQ_PROJECT_ROOT_MEMORY_POLICY).toContain(
        "never invent tests, files, risks, decisions"
      )
    })

    it("instructs to include decisions only for explicit durable decisions", () => {
      expect(HECATEQ_PROJECT_ROOT_MEMORY_POLICY).toContain(
        "explicit durable decision"
      )
    })

    it("instructs to include quality only when command actually ran", () => {
      expect(HECATEQ_PROJECT_ROOT_MEMORY_POLICY).toContain(
        "command actually ran"
      )
    })

    it("instructs to omit empty fields and omit entire block when no update", () => {
      expect(HECATEQ_PROJECT_ROOT_MEMORY_POLICY).toContain("Omit empty fields")
      expect(HECATEQ_PROJECT_ROOT_MEMORY_POLICY).toContain(
        "omit the entire block"
      )
    })
  })

  describe("#HECATEQ_ORCHESTRATOR_POLICY — routing language", () => {
    it("preserves exact-agent routing default", () => {
      expect(HECATEQ_ORCHESTRATOR_POLICY).toContain(
        "delegate_exact_agent"
      )
    })

    it("does not promote category routing as default", () => {
      // Category routing should not appear as a recommended or default path
      const categoryDefaultMatch =
        HECATEQ_ORCHESTRATOR_POLICY.match(
          /category.*default/i
        )
      expect(categoryDefaultMatch).toBeNull()
    })

    it("instructs not to silently fall back to category routing", () => {
      expect(HECATEQ_ORCHESTRATOR_POLICY).toContain(
        "Do not silently fall back"
      )
    })

    it("preserves blocked status for unknown agents", () => {
      expect(HECATEQ_ORCHESTRATOR_POLICY).toContain("STATUS: BLOCKED")
    })

    it("instructs exact runtime-valid agents only", () => {
      expect(HECATEQ_ORCHESTRATOR_POLICY).toContain(
        "Never invent agent names"
      )
      expect(HECATEQ_ORCHESTRATOR_POLICY).toContain(
        "Never call unknown or disabled agents"
      )
    })

    it("forbids write and edit tools for orchestrator agents", () => {
      expect(HECATEQ_ORCHESTRATOR_POLICY).toContain(
        "write"
      )
      expect(HECATEQ_ORCHESTRATOR_POLICY).toContain(
        "tools are denied at runtime for orchestrator agents"
      )
    })
  })

  describe("#buildDefaultHecateqOrchestratorPrompt", () => {
    it("includes MEMORY_UPDATE contract in output when memoryPolicySection is provided", () => {
      // given
      const input = {
        customAgentRegistrySection: "<custom-agent-registry />",
        taskToolNote: "Use task() for delegation",
        memoryPolicySection: HECATEQ_PROJECT_ROOT_MEMORY_POLICY,
      }

      // when
      const prompt = buildDefaultHecateqOrchestratorPrompt(input)

      // then
      expect(prompt).toContain("MEMORY_UPDATE")
      expect(prompt).toContain("MUST NOT directly edit")
    })

    it("does not include memory policy section when not provided", () => {
      // given
      const input = {
        customAgentRegistrySection: "<custom-agent-registry />",
        taskToolNote: "Use task() for delegation",
      }

      // when
      const prompt = buildDefaultHecateqOrchestratorPrompt(input)

      // then — the memory policy is injected separately via context
      expect(prompt).not.toContain("PROJECT-ROOT MEMORY POLICY")
    })

    it("respects delegationFirst flag", () => {
      // given
      const input = {
        customAgentRegistrySection: "<custom-agent-registry />",
        taskToolNote: "Use task() for delegation",
        delegationFirst: false,
      }

      // when
      const prompt = buildDefaultHecateqOrchestratorPrompt(input)

      // then
      expect(prompt).toContain("SOFTENED DELEGATION POLICY")
    })
  })
})
