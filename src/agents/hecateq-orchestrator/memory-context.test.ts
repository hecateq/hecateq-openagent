import { describe, expect, it, afterEach } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, symlinkSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { readMemoryContext, type MemoryContext } from "./memory-context"
import { PROJECT_MEMORY_DIR } from "../../shared/memory-bootstrap"
import { createHecateqOrchestratorAgent } from "./agent"

function makeTempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "hectest-"))
  return dir
}

function ensureMemoryDir(projectRoot: string): string {
  const dir = join(projectRoot, PROJECT_MEMORY_DIR)
  mkdirSync(dir, { recursive: true })
  return dir
}

function writeMemoryFile(projectRoot: string, fileName: string, content: string): string {
  const memoryDir = ensureMemoryDir(projectRoot)
  const filePath = join(memoryDir, fileName)
  writeFileSync(filePath, content, "utf-8")
  return filePath
}

afterEach(() => {
  // Cleanup handled by per-test tmp dirs + rmSync
})

describe("readMemoryContext", () => {
  describe("#given missing memory directory", () => {
    it("#then returns null", () => {
      // given
      const projectRoot = makeTempProject()
      try {
        // when
        const result = readMemoryContext(projectRoot)
        // then
        expect(result).toBeNull()
      } finally {
        rmSync(projectRoot, { recursive: true, force: true })
      }
    })
  })

  describe("#given all three memory files present", () => {
    it("#then returns MemoryContext with activeContext and fileMap and agentRouting and loadedAt timestamp", () => {
      // given
      const projectRoot = makeTempProject()
      try {
        writeMemoryFile(projectRoot, "active-context.md", "# Active Context\n\nCurrent goal: wire up memory\n")
        writeMemoryFile(projectRoot, "file-map.md", "# File Map\n\n- src/agents/hecateq-orchestrator/\n")
        writeMemoryFile(projectRoot, "agent-routing.md", "# Agent Routing\n\nPreferred: hephaestus for coding\n")

        // when
        const result = readMemoryContext(projectRoot)

        // then
        expect(result).not.toBeNull()
        const ctx = result as MemoryContext
        expect(ctx.activeContext).toContain("wire up memory")
        expect(ctx.fileMap).toContain("src/agents/hecateq-orchestrator")
        expect(ctx.agentRouting).toContain("hephaestus")
        expect(typeof ctx.loadedAt).toBe("number")
        expect(ctx.loadedAt).toBeGreaterThan(0)
      } finally {
        rmSync(projectRoot, { recursive: true, force: true })
      }
    })
  })

  describe("#given only one memory file present", () => {
    it("#then returns MemoryContext with only that field populated", () => {
      // given
      const projectRoot = makeTempProject()
      try {
        writeMemoryFile(projectRoot, "file-map.md", "# File Map\n\n- src/index.ts\n")

        // when
        const result = readMemoryContext(projectRoot)

        // then
        expect(result).not.toBeNull()
        const ctx = result as MemoryContext
        expect(ctx.fileMap).toContain("src/index.ts")
        expect(ctx.activeContext).toBeUndefined()
        expect(ctx.agentRouting).toBeUndefined()
        expect(typeof ctx.loadedAt).toBe("number")
      } finally {
        rmSync(projectRoot, { recursive: true, force: true })
      }
    })
  })

  describe("#given empty memory file", () => {
    it("#then that field is undefined", () => {
      // given
      const projectRoot = makeTempProject()
      try {
        writeMemoryFile(projectRoot, "active-context.md", "")
        writeMemoryFile(projectRoot, "file-map.md", "# File Map\n\n- src/index.ts\n")

        // when
        const result = readMemoryContext(projectRoot)

        // then
        expect(result).not.toBeNull()
        const ctx = result as MemoryContext
        expect(ctx.activeContext).toBeUndefined()
        expect(ctx.fileMap).toContain("src/index.ts")
      } finally {
        rmSync(projectRoot, { recursive: true, force: true })
      }
    })
  })

  describe("#given whitespace-only memory file", () => {
    it("#then that field is undefined", () => {
      // given
      const projectRoot = makeTempProject()
      try {
        writeMemoryFile(projectRoot, "active-context.md", "   \n  \n")
        writeMemoryFile(projectRoot, "file-map.md", "# Map\n- entry\n")

        // when
        const result = readMemoryContext(projectRoot)

        // then
        expect(result).not.toBeNull()
        const ctx = result as MemoryContext
        expect(ctx.activeContext).toBeUndefined()
        expect(ctx.fileMap).toContain("entry")
      } finally {
        rmSync(projectRoot, { recursive: true, force: true })
      }
    })
  })

  describe("#given file content exceeds maxChars", () => {
    it("#then content is truncated with ellipsis", () => {
      // given
      const projectRoot = makeTempProject()
      try {
        const longContent = "x".repeat(600)
        writeMemoryFile(projectRoot, "file-map.md", longContent)

        // when — default maxChars is 500
        const result = readMemoryContext(projectRoot)

        // then
        expect(result).not.toBeNull()
        const ctx = result as MemoryContext
        expect(ctx.fileMap).not.toBeNull()
        // 500 chars + "..." = 503
        expect(ctx.fileMap?.length).toBe(503)
        expect(ctx.fileMap).toContain("...")
        expect(ctx.fileMap?.startsWith("x".repeat(500))).toBe(true)
      } finally {
        rmSync(projectRoot, { recursive: true, force: true })
      }
    })
  })

  describe("#given content within maxChars limit", () => {
    it("#then content is not truncated and no ellipsis appended", () => {
      // given
      const projectRoot = makeTempProject()
      try {
        const shortContent = "x".repeat(200)
        writeMemoryFile(projectRoot, "file-map.md", shortContent)

        // when
        const result = readMemoryContext(projectRoot)

        // then
        expect(result).not.toBeNull()
        const ctx = result as MemoryContext
        expect(ctx.fileMap).toBe(shortContent)
        expect(ctx.fileMap).not.toContain("...")
      } finally {
        rmSync(projectRoot, { recursive: true, force: true })
      }
    })
  })

  describe("#given custom maxChars", () => {
    it("#then truncates at the custom limit", () => {
      // given
      const projectRoot = makeTempProject()
      try {
        const content = "y".repeat(300)
        writeMemoryFile(projectRoot, "active-context.md", content)

        // when
        const result = readMemoryContext(projectRoot, 100)

        // then
        expect(result).not.toBeNull()
        const ctx = result as MemoryContext
        expect(ctx.activeContext?.length).toBe(103) // 100 chars + "..."
        expect(ctx.activeContext).toContain("...")
      } finally {
        rmSync(projectRoot, { recursive: true, force: true })
      }
    })
  })

  describe("#given malformed projectRoot (nonexistent path)", () => {
    it("#then returns null without throwing", () => {
      // given
      const nonexistent = join(tmpdir(), "definitely-does-not-exist-" + Date.now())

      // when
      const result = readMemoryContext(nonexistent)

      // then
      expect(result).toBeNull()
    })
  })

  describe("#given memory dir exists but no files", () => {
    it("#then returns null (no files found)", () => {
      // given
      const projectRoot = makeTempProject()
      try {
        ensureMemoryDir(projectRoot)

        // when
        const result = readMemoryContext(projectRoot)

        // then
        expect(result).toBeNull()
      } finally {
        rmSync(projectRoot, { recursive: true, force: true })
      }
    })
  })

  describe("#given all files exist but all are empty", () => {
    it("#then returns null (no content found in any file)", () => {
      // given
      const projectRoot = makeTempProject()
      try {
        writeMemoryFile(projectRoot, "active-context.md", "")
        writeMemoryFile(projectRoot, "file-map.md", "")
        writeMemoryFile(projectRoot, "agent-routing.md", "")

        // when
        const result = readMemoryContext(projectRoot)

        // then
        expect(result).toBeNull()
      } finally {
        rmSync(projectRoot, { recursive: true, force: true })
      }
    })
  })

  describe("#given active-context.md exceeds maxChars with 600 chars", () => {
    it("#then active-context is truncated to 500 chars plus ellipsis", () => {
      // given
      const projectRoot = makeTempProject()
      try {
        writeMemoryFile(projectRoot, "active-context.md", "x".repeat(600))

        // when
        const result = readMemoryContext(projectRoot)

        // then
        expect(result).not.toBeNull()
        const ctx = result as MemoryContext
        expect(ctx.activeContext?.length).toBe(503)
        expect(ctx.activeContext).toContain("...")
        expect(ctx.activeContext?.startsWith("x".repeat(500))).toBe(true)
      } finally {
        rmSync(projectRoot, { recursive: true, force: true })
      }
    })
  })

  describe("#given file-map.md is very large at 5000 chars", () => {
    it("#then file-map is truncated to 500 chars plus ellipsis", () => {
      // given
      const projectRoot = makeTempProject()
      try {
        writeMemoryFile(projectRoot, "file-map.md", "y".repeat(5000))

        // when
        const result = readMemoryContext(projectRoot)

        // then
        expect(result).not.toBeNull()
        const ctx = result as MemoryContext
        expect(ctx.fileMap?.length).toBe(503)
        expect(ctx.fileMap).toContain("...")
        expect(ctx.fileMap?.startsWith("y".repeat(500))).toBe(true)
      } finally {
        rmSync(projectRoot, { recursive: true, force: true })
      }
    })
  })

  describe("#given agent-routing.md within limit at 100 chars", () => {
    it("#then agent-routing is not truncated and no ellipsis", () => {
      // given
      const projectRoot = makeTempProject()
      try {
        writeMemoryFile(projectRoot, "agent-routing.md", "z".repeat(100))

        // when
        const result = readMemoryContext(projectRoot)

        // then
        expect(result).not.toBeNull()
        const ctx = result as MemoryContext
        expect(ctx.agentRouting?.length).toBe(100)
        expect(ctx.agentRouting).not.toContain("...")
      } finally {
        rmSync(projectRoot, { recursive: true, force: true })
      }
    })
  })

  describe("#given custom maxChars of 100 for all files", () => {
    it("#then all content is truncated to 100 chars plus ellipsis", () => {
      // given
      const projectRoot = makeTempProject()
      try {
        writeMemoryFile(projectRoot, "active-context.md", "a".repeat(300))
        writeMemoryFile(projectRoot, "file-map.md", "b".repeat(300))
        writeMemoryFile(projectRoot, "agent-routing.md", "c".repeat(300))

        // when — custom maxChars = 100
        const result = readMemoryContext(projectRoot, 100)

        // then
        expect(result).not.toBeNull()
        const ctx = result as MemoryContext
        expect(ctx.activeContext?.length).toBe(103)
        expect(ctx.fileMap?.length).toBe(103)
        expect(ctx.agentRouting?.length).toBe(103)
        expect(ctx.activeContext).toContain("...")
        expect(ctx.fileMap).toContain("...")
        expect(ctx.agentRouting).toContain("...")
        expect(ctx.activeContext?.startsWith("a".repeat(100))).toBe(true)
        expect(ctx.fileMap?.startsWith("b".repeat(100))).toBe(true)
        expect(ctx.agentRouting?.startsWith("c".repeat(100))).toBe(true)
      } finally {
        rmSync(projectRoot, { recursive: true, force: true })
      }
    })
  })

  describe("#given projectRoot points to a file not a directory", () => {
    it("#then returns null without throwing", () => {
      // given
      const dir = makeTempProject()
      try {
        const filePath = join(dir, "some-file.txt")
        writeFileSync(filePath, "content", "utf-8")

        // when
        const result = readMemoryContext(filePath)

        // then
        expect(result).toBeNull()
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  })

  describe("#given projectRoot is a symlink to a directory with memory files", () => {
    it("#then resolves through the symlink and returns MemoryContext", () => {
      // given
      const targetDir = makeTempProject()
      try {
        writeMemoryFile(targetDir, "active-context.md", "Symlinked context content")
        const symlinkPath = join(tmpdir(), "hectest-symlink-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8))
        symlinkSync(targetDir, symlinkPath)
        try {
          // when
          const result = readMemoryContext(symlinkPath)

          // then
          expect(result).not.toBeNull()
          const ctx = result as MemoryContext
          expect(ctx.activeContext).toContain("Symlinked context")
        } finally {
          rmSync(symlinkPath, { recursive: true, force: true })
        }
      } finally {
        rmSync(targetDir, { recursive: true, force: true })
      }
    })
  })
})

describe("concurrent readMemoryContext calls", () => {
  describe("#given multiple project roots queried together", () => {
    it("#then returns independent results for different project roots", () => {
      // given
      const root1 = makeTempProject()
      const root2 = makeTempProject()
      try {
        writeMemoryFile(root1, "active-context.md", "Root one content")
        writeMemoryFile(root2, "active-context.md", "Root two content")

        // when
        const result1 = readMemoryContext(root1)
        const result2 = readMemoryContext(root2)

        // then
        expect(result1).not.toBeNull()
        expect(result2).not.toBeNull()
        const ctx1 = result1 as MemoryContext
        const ctx2 = result2 as MemoryContext
        expect(ctx1.activeContext).toContain("Root one")
        expect(ctx2.activeContext).toContain("Root two")
        expect(ctx1).not.toBe(ctx2)
      } finally {
        rmSync(root1, { recursive: true, force: true })
        rmSync(root2, { recursive: true, force: true })
      }
    })
  })

  describe("#given same project root queried twice", () => {
    it("#then returns equivalent data on both calls", () => {
      // given
      const projectRoot = makeTempProject()
      try {
        writeMemoryFile(projectRoot, "active-context.md", "Same content both times")

        // when
        const first = readMemoryContext(projectRoot)
        const second = readMemoryContext(projectRoot)

        // then — same data, even if different object reference
        expect(first).not.toBeNull()
        expect(second).not.toBeNull()
        const ctx1 = first as MemoryContext
        const ctx2 = second as MemoryContext
        expect(ctx1.activeContext).toBe(ctx2.activeContext)
        expect(ctx1.fileMap).toBe(ctx2.fileMap)
        expect(ctx1.agentRouting).toBe(ctx2.agentRouting)
      } finally {
        rmSync(projectRoot, { recursive: true, force: true })
      }
    })
  })

  describe("#given one result is mutated", () => {
    it("#then subsequent calls return the original data unchanged", () => {
      // given
      const projectRoot = makeTempProject()
      try {
        writeMemoryFile(projectRoot, "active-context.md", "Original data")

        // when
        const first = readMemoryContext(projectRoot)
        const second = readMemoryContext(projectRoot)

        // Mutate the first result
        if (first) {
          first.activeContext = "Mutated data"
        }

        // then — second call unaffected
        expect(second).not.toBeNull()
        const ctx = second as MemoryContext
        expect(ctx.activeContext).toContain("Original")
        expect(ctx.activeContext).not.toContain("Mutated")
      } finally {
        rmSync(projectRoot, { recursive: true, force: true })
      }
    })
  })
})

describe("readMemoryContext performance", () => {
  describe("#given a 10MB+ active-context.md file", () => {
    it("#then completes within reasonable time (under 10 seconds)", () => {
      // given
      const projectRoot = makeTempProject()
      try {
        const largeContent = "x".repeat(10 * 1024 * 1024)
        writeMemoryFile(projectRoot, "active-context.md", largeContent)

        // when
        const start = Date.now()
        const result = readMemoryContext(projectRoot)
        const elapsed = Date.now() - start

        // then
        expect(result).not.toBeNull()
        const ctx = result as MemoryContext
        expect(ctx.activeContext?.length).toBe(503)
        expect(elapsed).toBeLessThan(10_000)
      } finally {
        rmSync(projectRoot, { recursive: true, force: true })
      }
    })
  })

  describe("#given 100+ files in the memory directory", () => {
    it("#then completes quickly without hanging (under 5 seconds)", () => {
      // given
      const projectRoot = makeTempProject()
      try {
        const memoryDir = ensureMemoryDir(projectRoot)
        writeMemoryFile(projectRoot, "active-context.md", "Real content")
        for (let i = 0; i < 100; i++) {
          writeFileSync(join(memoryDir, `extra-file-${i}.md`), `irrelevant-${i}`, "utf-8")
        }

        // when
        const start = Date.now()
        const result = readMemoryContext(projectRoot)
        const elapsed = Date.now() - start

        // then — reads only the 3 target files, ignores extras
        expect(result).not.toBeNull()
        const ctx = result as MemoryContext
        expect(ctx.activeContext).toContain("Real content")
        expect(elapsed).toBeLessThan(5_000)
      } finally {
        rmSync(projectRoot, { recursive: true, force: true })
      }
    })
  })
})

describe("memory context injection into orchestrator prompt", () => {
  describe("#given projectRoot with memory files", () => {
    it("#then <memory_context> block appears in generated prompt", () => {
      // given
      const projectRoot = makeTempProject()
      try {
        writeMemoryFile(projectRoot, "active-context.md", "# Active Context\n\nGoal: test memory injection\n")
        writeMemoryFile(projectRoot, "file-map.md", "# File Map\n\n- src/agent.ts\n")

        // when
        const agent = createHecateqOrchestratorAgent(
          "openai/gpt-5.4",
          undefined, undefined, undefined, undefined,
          undefined, undefined, undefined,
          projectRoot,
        )

        // then
        expect(agent.prompt).toContain("<memory_context>")
        expect(agent.prompt).toContain("</memory_context>")
        expect(agent.prompt).toContain("<active-context>")
        expect(agent.prompt).toContain("test memory injection")
        expect(agent.prompt).toContain("<file-map>")
        expect(agent.prompt).toContain("src/agent.ts")
      } finally {
        rmSync(projectRoot, { recursive: true, force: true })
      }
    })
  })

  describe("#given no projectRoot", () => {
    it("#then no <memory_context> block appears in generated prompt", () => {
      // given — no projectRoot, just a model
      // when
      const agent = createHecateqOrchestratorAgent("openai/gpt-5.4")

      // then
      expect(agent.prompt).not.toContain("<memory_context>")
      expect(agent.prompt).not.toContain("<active-context>")
      expect(agent.prompt).not.toContain("<file-map>")
      expect(agent.prompt).not.toContain("<agent-routing>")
      // but core policy and identity still present
      expect(agent.prompt).toContain("HECATEQ ORCHESTRATOR POLICY")
      expect(agent.prompt).toContain("Hecateq God")
    })
  })

  describe("#given projectRoot with empty memory files", () => {
    it("#then no <memory_context> block appears (null memoryContext)", () => {
      // given
      const projectRoot = makeTempProject()
      try {
        ensureMemoryDir(projectRoot)
        writeMemoryFile(projectRoot, "active-context.md", "")
        writeMemoryFile(projectRoot, "file-map.md", "")

        // when
        const agent = createHecateqOrchestratorAgent(
          "openai/gpt-5.4",
          undefined, undefined, undefined, undefined,
          undefined, undefined, undefined,
          projectRoot,
        )

        // then — memoryContext is null, so no block
        expect(agent.prompt).not.toContain("<memory_context>")
        expect(agent.prompt).toContain("HECATEQ ORCHESTRATOR POLICY")
      } finally {
        rmSync(projectRoot, { recursive: true, force: true })
      }
    })
  })

  describe("#given only agent-routing present", () => {
    it("#then only agent-routing appears in <memory_context>", () => {
      // given
      const projectRoot = makeTempProject()
      try {
        writeMemoryFile(projectRoot, "agent-routing.md", "Preferred: hephaestus")

        // when
        const agent = createHecateqOrchestratorAgent(
          "openai/gpt-5.4",
          undefined, undefined, undefined, undefined,
          undefined, undefined, undefined,
          projectRoot,
        )

        // then
        expect(agent.prompt).toContain("<memory_context>")
        expect(agent.prompt).toContain("<agent-routing>")
        expect(agent.prompt).toContain("hephaestus")
        expect(agent.prompt).not.toContain("<active-context>")
        expect(agent.prompt).not.toContain("<file-map>")
      } finally {
        rmSync(projectRoot, { recursive: true, force: true })
      }
    })
  })

  describe("#given <memory_context> placement", () => {
    it("#then memory context sits after agent identity and before core policy", () => {
      // given
      const projectRoot = makeTempProject()
      try {
        writeMemoryFile(projectRoot, "active-context.md", "Goal: check placement")

        // when
        const agent = createHecateqOrchestratorAgent(
          "openai/gpt-5.4",
          undefined, undefined, undefined, undefined,
          undefined, undefined, undefined,
          projectRoot,
        )

        // then — memory_context appears after identity, before policy
        const prompt = agent.prompt ?? ""
        const identityIndex = prompt.indexOf("Hecateq God")
        const memoryIndex = prompt.indexOf("<memory_context>")
        const policyIndex = prompt.indexOf("HECATEQ ORCHESTRATOR POLICY")

        expect(identityIndex).toBeGreaterThan(-1)
        expect(memoryIndex).toBeGreaterThan(-1)
        expect(policyIndex).toBeGreaterThan(-1)
        expect(identityIndex).toBeLessThan(memoryIndex)
        expect(memoryIndex).toBeLessThan(policyIndex)
      } finally {
        rmSync(projectRoot, { recursive: true, force: true })
      }
    })
  })

  describe("#given all three memory files present with full factory signature", () => {
    it("#then prompt includes <memory_context> opening tag", () => {
      // given
      const projectRoot = makeTempProject()
      try {
        writeMemoryFile(projectRoot, "active-context.md", "# Active Context\nCurrent: testing\n")
        writeMemoryFile(projectRoot, "file-map.md", "# File Map\n- src/index.ts\n")
        writeMemoryFile(projectRoot, "agent-routing.md", "# Agent Routing\nPreferred: hephaestus\n")

        // when — exact factory signature from spec
        const agent = createHecateqOrchestratorAgent(
          "openai/gpt-5.4",
          undefined, undefined, undefined, undefined,
          undefined, false, undefined,
          projectRoot,
        )

        // then
        expect(agent.prompt).toContain("<memory_context>")
      } finally {
        rmSync(projectRoot, { recursive: true, force: true })
      }
    })

    it("#then <memory_context> block includes active-context content", () => {
      // given
      const projectRoot = makeTempProject()
      try {
        writeMemoryFile(projectRoot, "active-context.md", "# Active Context\nCurrent: testing\n")
        writeMemoryFile(projectRoot, "file-map.md", "# File Map\n- src/index.ts\n")
        writeMemoryFile(projectRoot, "agent-routing.md", "# Agent Routing\nPreferred: hephaestus\n")

        // when
        const agent = createHecateqOrchestratorAgent(
          "openai/gpt-5.4",
          undefined, undefined, undefined, undefined,
          undefined, false, undefined,
          projectRoot,
        )

        // then
        expect(agent.prompt).toContain("<active-context>")
        expect(agent.prompt).toContain("Current: testing")
      } finally {
        rmSync(projectRoot, { recursive: true, force: true })
      }
    })

    it("#then <memory_context> block includes file-map content", () => {
      // given
      const projectRoot = makeTempProject()
      try {
        writeMemoryFile(projectRoot, "active-context.md", "# Active Context\nCurrent: testing\n")
        writeMemoryFile(projectRoot, "file-map.md", "# File Map\n- src/index.ts\n")
        writeMemoryFile(projectRoot, "agent-routing.md", "# Agent Routing\nPreferred: hephaestus\n")

        // when
        const agent = createHecateqOrchestratorAgent(
          "openai/gpt-5.4",
          undefined, undefined, undefined, undefined,
          undefined, false, undefined,
          projectRoot,
        )

        // then
        expect(agent.prompt).toContain("<file-map>")
        expect(agent.prompt).toContain("src/index.ts")
      } finally {
        rmSync(projectRoot, { recursive: true, force: true })
      }
    })

    it("#then <memory_context> block includes agent-routing content", () => {
      // given
      const projectRoot = makeTempProject()
      try {
        writeMemoryFile(projectRoot, "active-context.md", "# Active Context\nCurrent: testing\n")
        writeMemoryFile(projectRoot, "file-map.md", "# File Map\n- src/index.ts\n")
        writeMemoryFile(projectRoot, "agent-routing.md", "# Agent Routing\nPreferred: hephaestus\n")

        // when
        const agent = createHecateqOrchestratorAgent(
          "openai/gpt-5.4",
          undefined, undefined, undefined, undefined,
          undefined, false, undefined,
          projectRoot,
        )

        // then
        expect(agent.prompt).toContain("<agent-routing>")
        expect(agent.prompt).toContain("hephaestus")
      } finally {
        rmSync(projectRoot, { recursive: true, force: true })
      }
    })

    it("#then <memory_context> block includes both opening and closing tags", () => {
      // given
      const projectRoot = makeTempProject()
      try {
        writeMemoryFile(projectRoot, "active-context.md", "# Active Context\nCurrent: testing\n")
        writeMemoryFile(projectRoot, "file-map.md", "# File Map\n- src/index.ts\n")
        writeMemoryFile(projectRoot, "agent-routing.md", "# Agent Routing\nPreferred: hephaestus\n")

        // when
        const agent = createHecateqOrchestratorAgent(
          "openai/gpt-5.4",
          undefined, undefined, undefined, undefined,
          undefined, false, undefined,
          projectRoot,
        )

        // then
        const prompt = agent.prompt ?? ""
        expect(prompt).toContain("<memory_context>")
        expect(prompt).toContain("</memory_context>")
        const openIndex = prompt.indexOf("<memory_context>")
        const closeIndex = prompt.indexOf("</memory_context>")
        expect(openIndex).toBeLessThan(closeIndex)
      } finally {
        rmSync(projectRoot, { recursive: true, force: true })
      }
    })
  })

  describe("#given projectRoot is undefined (explicit)", () => {
    it("#then no <memory_context> block appears in prompt", () => {
      // given — undefined as 9th arg
      // when
      const agent = createHecateqOrchestratorAgent(
        "openai/gpt-5.4",
        undefined, undefined, undefined, undefined,
        undefined, false, undefined,
        undefined,
      )

      // then
      expect(agent.prompt).not.toContain("<memory_context>")
      expect(agent.prompt).toContain("HECATEQ ORCHESTRATOR POLICY")
    })
  })

  describe("#given projectRoot is empty string", () => {
    it("#then no <memory_context> block appears in prompt", () => {
      // given — empty string is falsy, so memoryContext stays undefined
      // when
      const agent = createHecateqOrchestratorAgent(
        "openai/gpt-5.4",
        undefined, undefined, undefined, undefined,
        undefined, false, undefined,
        "",
      )

      // then
      expect(agent.prompt).not.toContain("<memory_context>")
      expect(agent.prompt).toContain("HECATEQ ORCHESTRATOR POLICY")
    })
  })

  describe("#given projectRoot is a non-existent path", () => {
    it("#then no <memory_context> block appears in prompt", () => {
      // given
      const nonexistent = join(tmpdir(), "hectest-nonexistent-" + Date.now())

      // when
      const agent = createHecateqOrchestratorAgent(
        "openai/gpt-5.4",
        undefined, undefined, undefined, undefined,
        undefined, false, undefined,
        nonexistent,
      )

      // then — readMemoryContext returns null, so no memory block
      expect(agent.prompt).not.toContain("<memory_context>")
    })
  })

  describe("#given projectRoot is a file not a directory", () => {
    it("#then no <memory_context> block appears in prompt", () => {
      // given
      const dir = makeTempProject()
      try {
        const filePath = join(dir, "some-file.txt")
        writeFileSync(filePath, "content", "utf-8")

        // when
        const agent = createHecateqOrchestratorAgent(
          "openai/gpt-5.4",
          undefined, undefined, undefined, undefined,
          undefined, false, undefined,
          filePath,
        )

        // then
        expect(agent.prompt).not.toContain("<memory_context>")
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  })

  describe("#given projectRoot is a symlink to a directory with memory files", () => {
    it("#then <memory_context> block appears in prompt, resolved through symlink", () => {
      // given
      const targetDir = makeTempProject()
      try {
        writeMemoryFile(targetDir, "active-context.md", "Symlinked context in prompt")
        const symlinkPath = join(tmpdir(), "hectest-symlink-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8))
        symlinkSync(targetDir, symlinkPath)
        try {
          // when
          const agent = createHecateqOrchestratorAgent(
            "openai/gpt-5.4",
            undefined, undefined, undefined, undefined,
            undefined, false, undefined,
            symlinkPath,
          )

          // then
          expect(agent.prompt).toContain("<memory_context>")
          expect(agent.prompt).toContain("Symlinked context in prompt")
        } finally {
          rmSync(symlinkPath, { recursive: true, force: true })
        }
      } finally {
        rmSync(targetDir, { recursive: true, force: true })
      }
    })
  })
})
