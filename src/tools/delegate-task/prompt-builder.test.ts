declare const require: (name: string) => unknown
const { describe, test, expect } = require("bun:test") as {
  describe: (name: string, fn: () => void) => void
  test: (name: string, fn: () => void) => void
  expect: (value: unknown) => {
    toBe: (expected: unknown) => void
    toContain: (expected: string) => void
    toBeUndefined: () => void
    toBeDefined: () => void
    not: {
      toContain: (expected: string) => void
      toBeUndefined: () => void
    }
  }
}

import { buildSystemContent, COMPACT_RESULT_GUIDANCE } from "./prompt-builder"
import { MEMORY_UPDATE_CONTRACT } from "../../shared/memory-update-signal"
import type { AvailableSkill, AvailableCategory } from "../../agents/dynamic-agent-prompt-builder"

describe("prompt-builder", () => {
  describe("buildSystemContent", () => {
    describe("#given non-plan agent with availableSkills", () => {
      test("#when availableSkills contains project-level skills #then system content includes available_skills section", () => {
        // given
        const availableSkills: AvailableSkill[] = [
          { name: "git-master", description: "Git workflow automation", location: "plugin" },
          { name: "my-project-skill", description: "Project-specific deployment", location: "project" },
        ]
        const availableCategories: AvailableCategory[] = [
          { name: "quick", description: "Trivial tasks", model: "openai/gpt-5.4-mini" },
        ]

        // when
        const result = buildSystemContent({
          agentName: "sisyphus-junior",
          availableSkills,
          availableCategories,
        })

        // then
        expect(result).toBeDefined()
        expect(result).toContain("my-project-skill")
        expect(result).toContain("git-master")
      })

      test("#when agent is explore #then system content includes available_skills section", () => {
        // given
        const availableSkills: AvailableSkill[] = [
          { name: "review-work", description: "Review code quality", location: "project" },
        ]

        // when
        const result = buildSystemContent({
          agentName: "explore",
          availableSkills,
        })

        // then
        expect(result).toBeDefined()
        expect(result).toContain("review-work")
      })

      test("#when availableSkills is empty #then system content does not include available_skills section", () => {
        // given
        const availableSkills: AvailableSkill[] = []

        // when
        const result = buildSystemContent({
          agentName: "sisyphus-junior",
          availableSkills,
          categoryPromptAppend: "some category context",
        })

        // then
        expect(result).toBeDefined()
        expect(result).not.toContain("available_skills")
      })
    })

    describe("#given plan agent with availableSkills", () => {
      test("#when availableSkills provided #then system content includes plan agent prepend with skills", () => {
        // given
        const availableSkills: AvailableSkill[] = [
          { name: "git-master", description: "Git workflow automation", location: "plugin" },
        ]
        const availableCategories: AvailableCategory[] = [
          { name: "quick", description: "Trivial tasks", model: "openai/gpt-5.4-mini" },
        ]

        // when
        const result = buildSystemContent({
          agentName: "plan",
          availableSkills,
          availableCategories,
        })

        // then
        expect(result).toBeDefined()
        expect(result).toContain("git-master")
        expect(result).toContain("AVAILABLE SKILLS")
      })
    })

    describe("#given non-plan agent with agentsContext override", () => {
      test("#when agentsContext is provided #then it takes precedence and skills section is appended", () => {
        // given
        const availableSkills: AvailableSkill[] = [
          { name: "deploy-skill", description: "Deployment automation", location: "project" },
        ]

        // when
        const result = buildSystemContent({
          agentName: "sisyphus-junior",
          agentsContext: "Custom agent context here",
          availableSkills,
        })

        // then
        expect(result).toBeDefined()
        expect(result).toContain("Custom agent context here")
        expect(result).toContain("deploy-skill")
      })
    })
  })

  describe("buildSystemContent — compact result guidance", () => {
    test("#given non-plan agent #then system content includes COMPACT_RESULT_GUIDANCE with structured shape", () => {
      // given
      const availableSkills: AvailableSkill[] = [
        { name: "git-master", description: "Git workflow", location: "plugin" },
      ]

      // when
      const result = buildSystemContent({
        agentName: "sisyphus-junior",
        availableSkills,
      })

      // then
      expect(result).toBeDefined()
      expect(result).toContain("COMPACT RESULT REQUIREMENT")
      expect(result).toContain("Summary")
      expect(result).toContain("Files inspected")
      expect(result).toContain("Files changed or created")
      expect(result).toContain("Tests run and their results")
      expect(result).toContain("Risks")
      expect(result).toContain("Follow-up needed")
      expect(result).toContain("Do not paste full file contents")
    })

    test("#given plan agent #then system content does NOT include COMPACT_RESULT_GUIDANCE", () => {
      // given
      const availableCategories = [
        { name: "quick", description: "Quick tasks", model: "openai/gpt-5.4-mini" },
      ]

      // when
      const result = buildSystemContent({
        agentName: "plan",
        availableCategories,
      })

      // then
      expect(result).toBeDefined()
      expect(result).not.toContain("COMPACT RESULT REQUIREMENT")
    })
  })
})

describe("buildSystemContent — nativeSkillInfos merging", () => {
  test("#given a nativeSkill name not in availableSkills #when block is built #then native name appears", () => {
    // given
    const availableSkills: AvailableSkill[] = [
      { name: "omo-skill", description: "From OMO disk", location: "project" },
    ]
    const nativeSkillInfos = [
      { name: "test-driven-development", description: "TDD discipline", location: "/fake/SKILL.md" },
    ]

    // when
    const result = buildSystemContent({
      agentName: "explore",
      availableSkills,
      nativeSkillInfos,
    })

    // then
    expect(result).toBeDefined()
    expect(result).toContain("omo-skill")
    expect(result).toContain("test-driven-development")
    expect(result).toContain("TDD discipline")
  })

  test("#given a name in BOTH availableSkills AND nativeSkillInfos #when block is built #then OMO description wins", () => {
    // given
    const availableSkills: AvailableSkill[] = [
      { name: "shared", description: "omo-version-of-shared", location: "project" },
    ]
    const nativeSkillInfos = [
      { name: "shared", description: "native-version-of-shared", location: "/fake/SKILL.md" },
    ]

    // when
    const result = buildSystemContent({
      agentName: "explore",
      availableSkills,
      nativeSkillInfos,
    })

    // then
    expect(result).toBeDefined()
    expect(result).toContain("omo-version-of-shared")
    expect(result).not.toContain("native-version-of-shared")
  })

  test("#given empty availableSkills and a nativeSkillInfo #when block is built #then native skill renders", () => {
    // given
    const nativeSkillInfos = [
      { name: "brainstorming", description: "Use before any creative work", location: "/fake/SKILL.md" },
    ]

    // when
    const result = buildSystemContent({
      agentName: "explore",
      availableSkills: [],
      nativeSkillInfos,
    })

    // then
    expect(result).toBeDefined()
    expect(result).toContain("brainstorming")
  })
})

// Phase 3B.2a — MEMORY_UPDATE prompt contract injection tests
describe("buildSystemContent — MEMORY_UPDATE contract injection", () => {
  test("#given non-plan agent #then system content includes MEMORY_UPDATE contract", () => {
    // given
    const availableSkills: AvailableSkill[] = [
      { name: "git-master", description: "Git workflow", location: "plugin" },
    ]

    // when
    const result = buildSystemContent({
      agentName: "sisyphus-junior",
      availableSkills,
    })

    // then
    expect(result).toBeDefined()
    expect(result).toContain("MEMORY UPDATE COMPLETION CONTRACT")
    expect(result).toContain("<MEMORY_UPDATE>")
    expect(result).toContain("</MEMORY_UPDATE>")
  })

  test("#given plan agent #then system content does NOT include MEMORY_UPDATE contract", () => {
    // given
    const availableCategories = [
      { name: "quick", description: "Quick tasks", model: "openai/gpt-5.4-mini" },
    ]

    // when
    const result = buildSystemContent({
      agentName: "plan",
      availableCategories,
    })

    // then
    expect(result).toBeDefined()
    expect(result).not.toContain("MEMORY UPDATE COMPLETION CONTRACT")
  })

  test("#given non-plan agent #then MEMORY_UPDATE contract forbids direct memory file edits", () => {
    // given
    const availableSkills: AvailableSkill[] = [
      { name: "git-master", description: "Git workflow", location: "plugin" } as const,
    ]

    // when
    const result = buildSystemContent({
      agentName: "explore",
      availableSkills,
    })

    // then
    expect(result).toContain("Do NOT directly edit files under .opencode/state/memory/")
  })

  test("#given non-plan agent #then MEMORY_UPDATE contract forbids generated paths", () => {
    // given
    const availableSkills: AvailableSkill[] = [
      { name: "git-master", description: "Git workflow", location: "plugin" } as const,
    ]

    // when
    const result = buildSystemContent({
      agentName: "sisyphus-junior",
      availableSkills,
    })

    // then
    expect(result).toContain("Do NOT include generated/build paths")
    expect(result).toContain(".next/")
    expect(result).toContain("node_modules/")
  })

  test("#given non-plan agent #then MEMORY_UPDATE contract forbids invented facts", () => {
    // when
    const result = buildSystemContent({
      agentName: "explore",
      availableSkills: [],
    })

    // then
    expect(result).toContain("Do NOT invent tests, files, risks, decisions")
  })

  test("#given non-plan agent #then MEMORY_UPDATE contract requires relative paths only", () => {
    // when
    const result = buildSystemContent({
      agentName: "sisyphus-junior",
      availableSkills: [],
    })

    // then
    expect(result).toContain("Use RELATIVE source paths only")
  })

  test("#given non-plan agent #then MEMORY_UPDATE contract does not mention category fallback", () => {
    // when
    const result = buildSystemContent({
      agentName: "sisyphus-junior",
      availableSkills: [],
    })

    // then
    expect(result).not.toContain("category fallback")
    expect(result).not.toContain("category routing")
  })

  test("#given non-plan agent #then COMPACT_RESULT_GUIDANCE still present alongside MEMORY_UPDATE", () => {
    // when
    const result = buildSystemContent({
      agentName: "sisyphus-junior",
      availableSkills: [],
    })

    // then
    expect(result).toContain("COMPACT RESULT REQUIREMENT")
    expect(result).toContain("MEMORY UPDATE COMPLETION CONTRACT")
    // COMPACT_RESULT_GUIDANCE appears before MEMORY_UPDATE_CONTRACT
    const compactIndex = result!.indexOf("COMPACT RESULT REQUIREMENT")
    const memoryUpdateIndex = result!.indexOf("MEMORY UPDATE COMPLETION CONTRACT")
    expect(compactIndex < memoryUpdateIndex).toBe(true)
  })
})
