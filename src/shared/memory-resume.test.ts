import { describe, expect, it } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  buildPortableResumePlan,
  buildResumePlanAsJson,
  formatResumePlanForInjection,
  type PortableResumePlan,
  type SuggestedRead,
} from "./memory-resume"
import {
  PROJECT_MEMORY_DIR,
  FILE_TEMPLATES,
  PROJECT_MEMORY_FILES,
  bootstrapMemoryFiles,
  bootstrapMemoryManifest,
  bootstrapMemoryPointer,
} from "./memory-bootstrap"
import {
  readManifest,
  writeManifest,
  refreshFileEntry,
  type MemoryManifest,
} from "./memory-manifest"
import {
  buildContinuation,
  writeContinuation,
  type MemoryContinuation,
} from "./memory-continuation"

describe("memory-resume", () => {
  let testDir = ""

  function setupTempDir(): string {
    testDir = join(tmpdir(), `omo-mem-resume-${randomUUID()}`)
    mkdirSync(testDir, { recursive: true })
    mkdirSync(join(testDir, ".opencode"), { recursive: true })
    bootstrapMemoryFiles(testDir)
    bootstrapMemoryManifest(testDir, "opencode")
    bootstrapMemoryPointer(testDir)
    return testDir
  }

  function cleanup(): void {
    if (testDir) rmSync(testDir, { recursive: true, force: true })
  }

  function writeMemoryContent(root: string, fileName: string, content: string): void {
    const filePath = join(root, PROJECT_MEMORY_DIR, fileName)
    writeFileSync(filePath, content, "utf-8")
    // Refresh manifest to pick up new content
    const manifest = readManifest(root)
    if (manifest) {
      const updated = refreshFileEntry(root, manifest, fileName)
      writeManifest(root, updated)
    }
  }

  function buildAndWriteContinuation(
    root: string,
    overrides: Partial<Parameters<typeof buildContinuation>[1]> = {},
  ): MemoryContinuation {
    const manifest = readManifest(root)!
    const input = {
      objective: "Implement cross-harness resume flow",
      primaryTaskRef: "tasks.md#current",
      primaryTaskTitle: "Build memory-resume module",
      primaryTaskState: "next" as const,
      nextActions: ["Write memory-resume.ts", "Add tests", "Wire into compact injector"],
      touchedPaths: ["src/shared/memory-resume.ts", "src/hooks/hecateq-project-context-injector/index.ts"],
      blockers: [],
      verificationPending: [],
      mustRead: [
        { path: "active-context.md", reason: "Understand current project state" },
        { path: "tasks.md", reason: "Review pending tasks" },
      ],
      branch: "dev",
      fromHarness: "opencode",
      handoffReason: "Session ended",
      handoffNotes: "Continue with stage-2 implementation",
      updatedByAgent: "sisyphus",
      updatedBySession: "ses_abc123",
      manifest,
      ...overrides,
    }
    const cont = buildContinuation(manifest.manifest_revision!, input)
    writeContinuation(root, cont)
    return cont
  }

  describe("buildPortableResumePlan", () => {
    it("returns null when no project root found", () => {
      // given a non-project directory
      const root = join(tmpdir(), `omo-noproj-${randomUUID()}`)
      mkdirSync(root, { recursive: true })

      // when
      const plan = buildPortableResumePlan(root)

      // then
      expect(plan).toBeNull()

      rmSync(root, { recursive: true, force: true })
    })

    it("returns a plan with manifestExists=true and continuationState=missing for fresh bootstrap", () => {
      // given a bootstrapped project with no continuation
      const root = setupTempDir()

      // when
      const plan = buildPortableResumePlan(root)

      // then
      expect(plan).not.toBeNull()
      expect(plan!.projectRoot).toBe(root)
      expect(plan!.manifestExists).toBe(true)
      expect(plan!.continuationExists).toBe(false)
      expect(plan!.continuationState).toBe("missing")
      expect(plan!.actionable).toBe(false)
      expect(plan!.objective).toBeNull()
      expect(plan!.primaryTask).toBeNull()
      expect(plan!.nextActions).toEqual([])
      expect(plan!.suggestedReads.length).toBeGreaterThan(0)

      cleanup()
    })

    it("detects fresh continuation and returns structured data", () => {
      // given a project with a fresh continuation
      const root = setupTempDir()
      writeMemoryContent(root, "active-context.md", "# Active Context\n\nWorking on memory portability.\n")
      writeMemoryContent(root, "tasks.md", "# Tasks\n\n- [ ] Build resume flow\n")
      buildAndWriteContinuation(root)

      // when
      const plan = buildPortableResumePlan(root)

      // then
      expect(plan).not.toBeNull()
      expect(plan!.continuationState).toBe("fresh")
      expect(plan!.actionable).toBe(true)
      expect(plan!.objective).toBe("Implement cross-harness resume flow")
      expect(plan!.primaryTask).not.toBeNull()
      expect(plan!.primaryTask!.title).toBe("Build memory-resume module")
      expect(plan!.primaryTask!.state).toBe("next")
      expect(plan!.nextActions.length).toBe(3)
      expect(plan!.nextActions).toContain("Write memory-resume.ts")
      expect(plan!.blockers).toEqual([])
      expect(plan!.handoffFrom).toBe("opencode")

      cleanup()
    })

    it("detects stale continuation when memory files change after handoff", () => {
      // given a continuation written against the old manifest state
      const root = setupTempDir()
      writeMemoryContent(root, "active-context.md", "# Active Context\n\nWorking on memory portability stage 2.\n")
      buildAndWriteContinuation(root)

      // when the memory file changes (making the continuation stale)
      writeMemoryContent(root, "active-context.md", "# Active Context\n\nWorking on a completely different task now.\n")

    // then refresh manifest (hash changes)
    const manifest = readManifest(root)!
    const updated = refreshFileEntry(root, manifest, "active-context.md")
    writeManifest(root, updated)

      // when
      const plan = buildPortableResumePlan(root)

      // then
      expect(plan!.continuationState).toBe("stale")
      expect(plan!.actionable).toBe(false)
      expect(plan!.compactSummary).toContain("STALE")

      cleanup()
    })

    it("includes suggested reads from manifest recommended_read_order", () => {
      // given
      const root = setupTempDir()
      const manifest = readManifest(root)!

      // when
      const plan = buildPortableResumePlan(root)

      // then suggested reads follow manifest recommended_read_order
      const names = plan!.suggestedReads.map((r) => r.fileName)
      expect(names[0]).toBe("active-context.md") // first in recommended order
      expect(names[1]).toBe("progress.md")
      // entries 2+ follow the DEFAULT_RECOMMENDED_READ_ORDER
      expect(names.slice(2)).toContain("file-map.md")
      expect(names.slice(2)).toContain("decisions.md")
      expect(names.slice(2)).toContain("tasks.md")

      cleanup()
    })

    it("marks placeholder files appropriately in suggested reads", () => {
      // given raw TODO placeholder files (written directly, bypassing hydrated bootstrap)
      const root = setupTempDir()
      for (const fileName of PROJECT_MEMORY_FILES) {
        writeFileSync(join(root, PROJECT_MEMORY_DIR, fileName), FILE_TEMPLATES[fileName] ?? "", "utf-8")
      }
      // Rebuild manifest to reflect placeholder state
      const manifest = readManifest(root)
      if (manifest) {
        let updated = manifest
        for (const fileName of PROJECT_MEMORY_FILES) {
          updated = refreshFileEntry(root, updated, fileName)
        }
        writeManifest(root, updated)
      }

      // when
      const plan = buildPortableResumePlan(root)

      // then all files are placeholders
      for (const read of plan!.suggestedReads) {
        expect(read.isPlaceholder).toBe(true)
      }

      cleanup()
    })

    it("marks populated files as non-placeholders in suggested reads", () => {
      // given a project with real content in one file
      const root = setupTempDir()
      writeMemoryContent(root, "active-context.md", "# Active Context\n\n## Current Goal\n- Build the resume flow\n\n## Current State\n- Stage 2 in progress\n")

      // Overwrite other files with raw TODO templates so they remain placeholders
      for (const fileName of PROJECT_MEMORY_FILES) {
        if (fileName === "active-context.md") continue
        writeFileSync(join(root, PROJECT_MEMORY_DIR, fileName), FILE_TEMPLATES[fileName] ?? "", "utf-8")
      }

      // Refresh manifest so placeholder flags are up to date
      const manifest = readManifest(root)
      if (manifest) {
        let updated = manifest
        for (const fileName of PROJECT_MEMORY_FILES) {
          updated = refreshFileEntry(root, updated, fileName)
        }
        writeManifest(root, updated)
      }

      // when
      const plan = buildPortableResumePlan(root)

      // then active-context is not a placeholder
      const acRead = plan!.suggestedReads.find((r) => r.fileName === "active-context.md")
      expect(acRead).toBeDefined()
      expect(acRead!.isPlaceholder).toBe(false)

      // other files are still placeholders
      const tasksRead = plan!.suggestedReads.find((r) => r.fileName === "tasks.md")
      expect(tasksRead!.isPlaceholder).toBe(true)

      cleanup()
    })

    it("returns verificationPending from fresh continuation", () => {
      // given
      const root = setupTempDir()
      buildAndWriteContinuation(root, {
        verificationPending: ["Test memory-resume.ts", "Verify TypeScript diagnostics"],
      })

      // when
      const plan = buildPortableResumePlan(root)

      // then
      expect(plan!.verificationPending).toContain("Test memory-resume.ts")

      cleanup()
    })

    it("returns blockers from fresh continuation", () => {
      // given
      const root = setupTempDir()
      buildAndWriteContinuation(root, {
        blockers: ["Waiting for stage-1 approval", "Need clarification on CLI interface"],
      })

      // when
      const plan = buildPortableResumePlan(root)

      // then
      expect(plan!.blockers).toContain("Waiting for stage-1 approval")
      // Blockers are listed in compact summary
      expect(plan!.compactSummary).toContain("Blockers")

      cleanup()
    })
  })

  describe("formatResumePlanForInjection", () => {
    it("formats a fresh continuation plan compactly", () => {
      // given
      const root = setupTempDir()
      writeMemoryContent(root, "active-context.md", "# Active\n## Goal\n- Resume flow\n")
      buildAndWriteContinuation(root)
      const plan = buildPortableResumePlan(root)!

      // when
      const formatted = formatResumePlanForInjection(plan)

      // then
      expect(formatted).toContain("fresh continuation")
      expect(formatted).toContain("Objective:")
      expect(formatted).toContain("Primary task:")
      expect(formatted).toContain("Next actions:")
      expect(formatted).toContain("Suggested reads:")
      expect(formatted).toContain("Build memory-resume module")

      cleanup()
    })

    it("formats a stale continuation plan with warning", () => {
      // given a stale plan
      const root = setupTempDir()
      writeMemoryContent(root, "active-context.md", "# Active Context\n\nOriginal implementation work.\n")
      buildAndWriteContinuation(root)
      writeMemoryContent(root, "active-context.md", "# Active Context\n\nSwitched to a different feature.\n")

      const manifest = readManifest(root)!
      const updated = refreshFileEntry(root, manifest, "active-context.md")
      writeManifest(root, updated)

      const plan = buildPortableResumePlan(root)!

      // when
      const formatted = formatResumePlanForInjection(plan)

      // then
      expect(formatted).toContain("STALE")
      expect(formatted).toContain("re-evaluate")

      cleanup()
    })

    it("formats a new session plan with first-read hint", () => {
      // given no continuation
      const root = setupTempDir()
      writeMemoryContent(root, "active-context.md", "# Active Context\n\n## Current Goal\n- Build resume flow\n")
      const plan = buildPortableResumePlan(root)!

      // when
      const formatted = formatResumePlanForInjection(plan)

      // then
      expect(formatted).toContain("new session")
      expect(formatted).toContain("Start by reading")
      expect(formatted).toContain("active-context.md")

      cleanup()
    })

    it("includes handoff metadata when present", () => {
      // given
      const root = setupTempDir()
      buildAndWriteContinuation(root, {
        fromHarness: "codex",
        handoffReason: "Switching to OpenCode for implementation",
      })
      const plan = buildPortableResumePlan(root)!

      // when
      const formatted = formatResumePlanForInjection(plan)

      // then
      expect(formatted).toContain("Handoff from: codex")
      expect(formatted).toContain("Switching to OpenCode")

      cleanup()
    })

    it("is compact (under 1000 chars for typical plans)", () => {
      // given
      const root = setupTempDir()
      writeMemoryContent(root, "active-context.md", "# Active\n- Build\n")
      buildAndWriteContinuation(root)
      const plan = buildPortableResumePlan(root)!

      // when
      const formatted = formatResumePlanForInjection(plan)

      // then — should stay under 1000 chars even with all sections
      expect(formatted.length).toBeLessThan(1000)

      cleanup()
    })
  })

  describe("buildResumePlanAsJson", () => {
    it("returns valid JSON for a valid project", () => {
      // given
      const root = setupTempDir()
      writeMemoryContent(root, "active-context.md", "# Project context\n")
      buildAndWriteContinuation(root)

      // when
      const json = buildResumePlanAsJson(root)

      // then
      expect(json).not.toBeNull()
      const parsed = JSON.parse(json!)
      expect(parsed.projectRoot).toBe(root)
      expect(parsed.continuationState).toBe("fresh")
      expect(Array.isArray(parsed.suggestedReads)).toBe(true)
      expect(typeof parsed.compactSummary).toBe("string")

      cleanup()
    })

    it("returns null for a non-project directory", () => {
      // given
      const root = join(tmpdir(), `omo-nojson-${randomUUID()}`)
      mkdirSync(root, { recursive: true })

      // when
      const json = buildResumePlanAsJson(root)

      // then
      expect(json).toBeNull()

      rmSync(root, { recursive: true, force: true })
    })

    it("JSON output is harness-agnostic (no OpenCode-specific fields)", () => {
      // given
      const root = setupTempDir()
      buildAndWriteContinuation(root)
      const json = buildResumePlanAsJson(root)!
      const parsed = JSON.parse(json)

      // then — verify no OpenCode-specific internals leak
      expect(parsed.sessionID).toBeUndefined()
      expect(parsed.ctx).toBeUndefined()
      expect(parsed.pluginInput).toBeUndefined()

      // Core fields are present
      expect(parsed.projectRoot).toBeDefined()
      expect(parsed.manifestExists).toBeDefined()
      expect(parsed.continuationState).toBeDefined()
      expect(parsed.suggestedReads).toBeDefined()

      cleanup()
    })
  })

  describe("freshness transitions", () => {
    it("missing → fresh when continuation is written", () => {
      // given a fresh bootstrap
      const root = setupTempDir()

      // when no continuation exists
      const plan1 = buildPortableResumePlan(root)
      expect(plan1!.continuationState).toBe("missing")

      // when a continuation is written
      writeMemoryContent(root, "active-context.md", "# Content\n")
      buildAndWriteContinuation(root)

      // then
      const plan2 = buildPortableResumePlan(root)
      expect(plan2!.continuationState).toBe("fresh")

      cleanup()
    })

    it("fresh → stale when any source file changes", () => {
      // given
      const root = setupTempDir()
      writeMemoryContent(root, "active-context.md", "# Active Context\n\nInitial task: build resume flow.\n")
      writeMemoryContent(root, "tasks.md", "# Tasks\n\n- [ ] Do stuff\n- [ ] More stuff\n")
      buildAndWriteContinuation(root)

      // when
      const plan1 = buildPortableResumePlan(root)
      expect(plan1!.continuationState).toBe("fresh")

      // change a source file
      writeMemoryContent(root, "tasks.md", "# Tasks\n\n## Changed\n- [x] Different task entirely\n")

      // then
      const plan2 = buildPortableResumePlan(root)
      expect(plan2!.continuationState).toBe("stale")

      cleanup()
    })

    it("stale remains stale until a new continuation is written", () => {
      // given
      const root = setupTempDir()
      writeMemoryContent(root, "active-context.md", "# Active Context\n\nFirst version of the work.\n")
      buildAndWriteContinuation(root)

      // make it stale
      writeMemoryContent(root, "active-context.md", "# Active Context\n\nUpdated to a new version.\n")

      // when
      const plan1 = buildPortableResumePlan(root)
      expect(plan1!.continuationState).toBe("stale")

      // write a new continuation
      buildAndWriteContinuation(root)

      // then
      const plan2 = buildPortableResumePlan(root)
      expect(plan2!.continuationState).toBe("fresh")

      cleanup()
    })
  })
})
