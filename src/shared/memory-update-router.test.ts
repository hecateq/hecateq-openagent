import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { PROJECT_MEMORY_DIR } from "./memory-bootstrap"
import { parseMemoryUpdateSignals } from "./memory-update-signal"
import {
  routeMemoryUpdateSignals,
  type MemoryUpdateRouteContext,
} from "./memory-update-router"

function setupTempDir(): string {
  const dir = join(tmpdir(), `omo-mur-${randomUUID()}`)
  mkdirSync(join(dir, PROJECT_MEMORY_DIR), { recursive: true })
  return dir
}

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
}

function getMemoryFilePath(root: string, filename: string): string {
  return join(root, PROJECT_MEMORY_DIR, filename)
}

function fileContent(root: string, filename: string): string {
  const fp = getMemoryFilePath(root, filename)
  if (!existsSync(fp)) return ""
  return readFileSync(fp, "utf-8")
}

function makeRouteContext(root: string): MemoryUpdateRouteContext {
  return {
    projectRoot: root,
    sessionId: `ses_${randomUUID().slice(0, 8)}`,
    agentName: "hephaestus",
  }
}

describe("memory-update-router", () => {
  describe("#routeMemoryUpdateSignals", () => {
    describe("#given decisions entry", () => {
      it("routes decisions to decisions.jsonl through Decision Writer", () => {
        const root = setupTempDir()
        const ctx = makeRouteContext(root)

        const text = `<MEMORY_UPDATE>{"entries":[{"target":"decisions","data":{"title":"Use Redis","decision":"Use Redis for caching layer","rationale":"Better performance","impact_area":"backend"}}]}</MEMORY_UPDATE>`
        const signals = parseMemoryUpdateSignals(text).signals
        const result = routeMemoryUpdateSignals(signals, ctx)

        expect(result.attempted).toBe(1)
        expect(result.routed).toBe(1)
        expect(result.skipped).toBe(0)
        expect(result.errors).toEqual([])
        expect(result.writtenFiles).toContain("decisions.jsonl")

        const content = fileContent(root, "decisions.jsonl")
        expect(content).toContain("Use Redis")

        cleanup(root)
      })

      it("does not write decisions.md", () => {
        const root = setupTempDir()
        const ctx = makeRouteContext(root)

        const text = `<MEMORY_UPDATE>{"entries":[{"target":"decisions","data":{"title":"Test","decision":"Test decision","rationale":"Testing","impact_area":"general"}}]}</MEMORY_UPDATE>`
        const signals = parseMemoryUpdateSignals(text).signals
        routeMemoryUpdateSignals(signals, ctx)

        const content = fileContent(root, "decisions.md")
        expect(content).toBe("")

        cleanup(root)
      })
    })

    describe("#given quality entry", () => {
      it("routes quality to quality-history.md with actual command/result", () => {
        const root = setupTempDir()
        const ctx = makeRouteContext(root)

        const text = `<MEMORY_UPDATE>{"entries":[{"target":"quality","data":{"command":"bun test","passed":true,"summary":"All 42 tests passed"}}]}</MEMORY_UPDATE>`
        const signals = parseMemoryUpdateSignals(text).signals
        const result = routeMemoryUpdateSignals(signals, ctx)

        expect(result.routed).toBe(1)
        expect(result.writtenFiles).toContain("quality-history.md")

        const content = fileContent(root, "quality-history.md")
        expect(content).toContain("PASS")

        cleanup(root)
      })

      it("skips quality entry without actual data", () => {
        const root = setupTempDir()
        const ctx = makeRouteContext(root)

        const text = `<MEMORY_UPDATE>{"entries":[{"target":"quality","data":{}}]}</MEMORY_UPDATE>`
        const signals = parseMemoryUpdateSignals(text).signals
        const result = routeMemoryUpdateSignals(signals, ctx)

        expect(result.routed).toBe(0)
        expect(result.skipped).toBe(1)
        expect(result.skippedReasons.some((r) => r.includes("no actual command/result"))).toBe(true)

        cleanup(root)
      })
    })

    describe("#given changed_files entry", () => {
      it("routes changed_files to file-map.md", () => {
        const root = setupTempDir()
        const ctx = makeRouteContext(root)

        const text = `<MEMORY_UPDATE>{"entries":[{"target":"changed_files","data":{"files":["src/shared/foo.ts","src/utils/bar.ts"]}}]}</MEMORY_UPDATE>`
        const signals = parseMemoryUpdateSignals(text).signals
        const result = routeMemoryUpdateSignals(signals, ctx)

        expect(result.routed).toBe(1)
        expect(result.writtenFiles).toContain("file-map.md")

        const content = fileContent(root, "file-map.md")
        expect(content).toContain("Change Impact Map")

        cleanup(root)
      })

      it("filters generated paths from changed_files", () => {
        const root = setupTempDir()
        const ctx = makeRouteContext(root)

        const text = `<MEMORY_UPDATE>{"entries":[{"target":"changed_files","data":{"files":["dist/bundle.js","src/foo.ts","node_modules/pkg/index.js","build/output.js","src/bar.ts"]}}]}</MEMORY_UPDATE>`
        const signals = parseMemoryUpdateSignals(text).signals
        const result = routeMemoryUpdateSignals(signals, ctx)

        expect(result.routed).toBe(1)
        const content = fileContent(root, "file-map.md")
        expect(content).toContain("src/foo.ts")
        expect(content).toContain("src/bar.ts")
        expect(content).not.toContain("dist/bundle.js")
        expect(content).not.toContain("node_modules/pkg")

        cleanup(root)
      })
    })

    describe("#given risks entry", () => {
      it("routes valid risks to risk-profile.md", () => {
        const root = setupTempDir()
        const ctx = makeRouteContext(root)

        const text = `<MEMORY_UPDATE>{"entries":[{"target":"risks","data":{"description":"Migration changes critical auth logic","category":"migration_risk","filePaths":["src/db/migration/001.sql"]}}]}</MEMORY_UPDATE>`
        const signals = parseMemoryUpdateSignals(text).signals
        const result = routeMemoryUpdateSignals(signals, ctx)

        expect(result.routed).toBe(1)
        expect(result.writtenFiles).toContain("risk-profile.md")

        cleanup(root)
      })

      it("routes risk with real file paths from data.filePaths", () => {
        const root = setupTempDir()
        const ctx = makeRouteContext(root)

        const text = `<MEMORY_UPDATE>{"entries":[{"target":"risks","data":{"description":"Migration changes critical auth logic","category":"migration_risk","filePaths":["src/auth/login.ts",".env"],"severity":"high"}}]}</MEMORY_UPDATE>`
        const signals = parseMemoryUpdateSignals(text).signals
        const result = routeMemoryUpdateSignals(signals, ctx)

        expect(result.routed).toBe(1)
        expect(result.writtenFiles).toContain("risk-profile.md")

        cleanup(root)
      })

      it("skips category-only risk entry without file paths (no-op would otherwise)", () => {
        const root = setupTempDir()
        const ctx = makeRouteContext(root)

        // Category-only risk without file paths is a no-op — updateRiskProfile
        // only writes when it can match actual paths against risk detection rules.
        const text = `<MEMORY_UPDATE>{"entries":[{"target":"risks","data":{"description":"Critical security vulnerability in auth","category":"security","severity":"critical"}}]}</MEMORY_UPDATE>`
        const signals = parseMemoryUpdateSignals(text).signals
        const result = routeMemoryUpdateSignals(signals, ctx)

        expect(result.routed).toBe(0)
        expect(result.skipped).toBe(1)
        expect(result.skippedReasons.some((r) => r.includes("no evidence-backed"))).toBe(true)

        cleanup(root)
      })

      it("skips category-only risk entry with priority fallback (no file paths)", () => {
        const root = setupTempDir()
        const ctx = makeRouteContext(root)

        const text = `<MEMORY_UPDATE>{"entries":[{"target":"risks","data":{"description":"High priority security concern","category":"security","priority":"high"}}]}</MEMORY_UPDATE>`
        const signals = parseMemoryUpdateSignals(text).signals
        const result = routeMemoryUpdateSignals(signals, ctx)

        expect(result.routed).toBe(0)
        expect(result.skipped).toBe(1)

        cleanup(root)
      })

      it("skips vague risk entries", () => {
        const root = setupTempDir()
        const ctx = makeRouteContext(root)

        const text = `<MEMORY_UPDATE>{"entries":[{"target":"risks","data":{"description":"risk"}}]}</MEMORY_UPDATE>`
        const signals = parseMemoryUpdateSignals(text).signals
        const result = routeMemoryUpdateSignals(signals, ctx)

        expect(result.routed).toBe(0)
        expect(result.skipped).toBe(1)
        expect(result.skippedReasons.some((r) => r.includes("too vague"))).toBe(true)

        cleanup(root)
      })

      it("skips risk entry without file paths (no category, no paths)", () => {
        const root = setupTempDir()
        const ctx = makeRouteContext(root)

        const text = `<MEMORY_UPDATE>{"entries":[{"target":"risks","data":{"description":"This is a valid risk description but no file paths","severity":"medium"}}]}</MEMORY_UPDATE>`
        const signals = parseMemoryUpdateSignals(text).signals
        const result = routeMemoryUpdateSignals(signals, ctx)

        // Should be skipped because no evidence-backed file paths
        expect(result.skipped).toBe(1)

        cleanup(root)
      })

      it("routes risk with file paths even without category", () => {
        const root = setupTempDir()
        const ctx = makeRouteContext(root)

        const text = `<MEMORY_UPDATE>{"entries":[{"target":"risks","data":{"description":"Database schema change detected","filePaths":["src/schema/user.ts"],"severity":"critical"}}]}</MEMORY_UPDATE>`
        const signals = parseMemoryUpdateSignals(text).signals
        const result = routeMemoryUpdateSignals(signals, ctx)

        // Should be routed because file paths exist (no category required)
        expect(result.routed).toBe(1)
        expect(result.writtenFiles).toContain("risk-profile.md")

        cleanup(root)
      })
    })

    describe("#given open_questions entry", () => {
      it("routes open_questions to open-questions.md via dedicated writer", () => {
        const root = setupTempDir()
        const ctx = makeRouteContext(root)

        const text = `<MEMORY_UPDATE>{"entries":[{"target":"open_questions","data":{"question":"Should we use Redis or Memcached?"}}]}</MEMORY_UPDATE>`
        const signals = parseMemoryUpdateSignals(text).signals
        const result = routeMemoryUpdateSignals(signals, ctx)

        expect(result.routed).toBe(1)
        expect(result.writtenFiles).toContain("open-questions.md")

        const content = fileContent(root, "open-questions.md")
        expect(content).toContain("Should we use Redis or Memcached?")

        cleanup(root)
      })

      it("propagates manifest updates from open_questions router", () => {
        const root = setupTempDir()
        const ctx = makeRouteContext(root)

        // Create memory.json so manifest can be updated
        const memDir = join(root, PROJECT_MEMORY_DIR)
        writeFileSync(
          join(memDir, "memory.json"),
          JSON.stringify({ schema_version: 2, manifest_revision: 1, manifest_updated_at: new Date().toISOString(), token_budget: { total_cost_chars: 0, estimated_total_tokens: 0, reading_cost: "low", recommended_read_order: [] }, files: {}, required_files: [], optional_files: [], deprecated_files: [], locks: {}, migrations_applied: [], harness_timestamps: { opencode: null, "claude-code": null, codex: null, cli: null }, project_identity: { project_id: "test", project_name: "test", workspace_kind: "single" }, discovery: { pointer_file: "", authoritative_root: "", continuation_path: "" }, resume: { continuation_state: "missing", summary: "", primary_task_ref: "", next_step_hint: "", suggested_reads: [], last_handoff_at: null } }),
          "utf-8",
        )

        const text = `<MEMORY_UPDATE>{"entries":[{"target":"open_questions","data":{"question":"Manifest test question?"}}]}</MEMORY_UPDATE>`
        const signals = parseMemoryUpdateSignals(text).signals
        const result = routeMemoryUpdateSignals(signals, ctx)

        expect(result.manifestUpdates).toBeDefined()
        expect(result.manifestUpdates!.length).toBeGreaterThanOrEqual(1)
        const mu = result.manifestUpdates!.find((m) => m.fileName === "open-questions.md")
        expect(mu).toBeDefined()

        cleanup(root)
      })
    })

    describe("#given next_actions entry", () => {
      it("routes next_actions to tasks.jsonl via task_state_writer", () => {
        const root = setupTempDir()
        const ctx = makeRouteContext(root)

        const text = `<MEMORY_UPDATE>{"entries":[{"target":"next_actions","data":{"action":"Run integration tests"}}]}</MEMORY_UPDATE>`
        const signals = parseMemoryUpdateSignals(text).signals
        const result = routeMemoryUpdateSignals(signals, ctx)

        expect(result.routed).toBe(1)
        expect(result.writtenFiles).toContain("tasks.jsonl")

        const tasksContent = fileContent(root, "tasks.jsonl")
        expect(tasksContent).toContain("Run integration tests")

        // tasks.md should still be empty (rendered separately)
        const mdContent = fileContent(root, "tasks.md")
        expect(mdContent).toBe("")

        cleanup(root)
      })
    })

    describe("#given multiple entries", () => {
      it("routes multiple entries correctly", () => {
        const root = setupTempDir()
        const ctx = makeRouteContext(root)

        const text = `<MEMORY_UPDATE>{"entries":[{"target":"decisions","data":{"title":"D1","decision":"Decision one","rationale":"r","impact_area":"general"}},{"target":"quality","data":{"command":"lint","passed":true}}]}</MEMORY_UPDATE>`
        const signals = parseMemoryUpdateSignals(text).signals
        const result = routeMemoryUpdateSignals(signals, ctx)

        expect(result.attempted).toBe(2)
        expect(result.routed).toBe(2)
        expect(result.writtenFiles).toContain("decisions.jsonl")
        expect(result.writtenFiles).toContain("quality-history.md")

        cleanup(root)
      })
    })

    describe("#given invalid/malformed input", () => {
      it("does not throw on empty signals", () => {
        const root = setupTempDir()
        const ctx = makeRouteContext(root)

        expect(() => routeMemoryUpdateSignals([], ctx)).not.toThrow()

        cleanup(root)
      })

      it("returns zeroes for missing projectRoot", () => {
        const signals = parseMemoryUpdateSignals(
          `<MEMORY_UPDATE>{"entries":[{"target":"decisions","data":{}}]}</MEMORY_UPDATE>`,
        ).signals

        const result = routeMemoryUpdateSignals(signals, {
          projectRoot: "",
          sessionId: "test",
        })

        expect(result.errors.some((e) => e.includes("Missing projectRoot"))).toBe(true)
      })

      it("skips unknown targets", () => {
        const root = setupTempDir()
        const ctx = makeRouteContext(root)

        const text = `<MEMORY_UPDATE>{"entries":[{"target":"nonexistent_target","data":{}}]}</MEMORY_UPDATE>`
        const signals = parseMemoryUpdateSignals(text).signals
        const result = routeMemoryUpdateSignals(signals, ctx)

        expect(result.attempted).toBe(1)
        expect(result.routed).toBe(0)
        expect(result.skipped).toBe(1)
        expect(result.skippedReasons.some((r) => r.includes("No router"))).toBe(true)

        cleanup(root)
      })
    })

    describe("#write failure is non-blocking", () => {
      it("catches write errors without throwing", () => {
        const root = setupTempDir()
        const memDir = join(root, PROJECT_MEMORY_DIR)
        const ctx = makeRouteContext(root)

        const text = `<MEMORY_UPDATE>{"entries":[{"target":"decisions","data":{"title":"Test","decision":"T","rationale":"R","impact_area":"general"}}]}</MEMORY_UPDATE>`
        const signals = parseMemoryUpdateSignals(text).signals

        let result: ReturnType<typeof routeMemoryUpdateSignals> | undefined
        expect(() => {
          result = routeMemoryUpdateSignals(signals, ctx)
        }).not.toThrow()

        expect(result).toBeDefined()
        expect(result!.attempted).toBe(1)

        cleanup(root)
      })
    })
  })
})
