import { afterEach, describe, expect, mock, test } from "bun:test"
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { readContinuationMarker, setContinuationMarkerSource } from "../run-continuation-state/storage"
import {
  extractHandoffFromAgentResponse,
  buildLiveHandoffContextSummary,
  buildOmoHandoffContextSummary,
  processHandoffInAgentResponse,
  recordHandoffToOmoState,
} from "./runtime-handoff-service"
import { OmoStateManager, HECATEQ_OMO_DIR } from "./omo-state-manager"
import { PROJECT_MEMORY_DIR } from "../../shared/memory-bootstrap"
import { TASK_STATE_MEMORY_FILENAME } from "../../shared/task-state-memory"
import { DECISION_LOG_FILENAME } from "../../shared/decision-log"
import * as taskStateMemoryModule from "../../shared/task-state-memory"
import * as decisionLogModule from "../../shared/decision-log"
import * as qualityWriterModule from "../../shared/memory-quality-writer"
import * as riskWriterModule from "../../shared/memory-risk-writer"
import * as changeImpactModule from "../../shared/memory-change-impact"

const tempDirs: string[] = []

function createTempDir(): string {
  const directory = mkdtempSync(join(tmpdir(), "omo-handoff-runtime-"))
  tempDirs.push(directory)
  return directory
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const directory = tempDirs.pop()
    if (directory) {
      rmSync(directory, { recursive: true, force: true })
    }
  }
})

describe("extractHandoffFromAgentResponse", () => {
  test("#given agent response with handoff block #then extracts handoff metadata", () => {
    const response = [
      "Here is the completed work.",
      "",
      "STATUS: DONE",
      'SIGNALS_EMITTED: [{"signal":"tests_passed","payload":{}}]',
      "HANDOFF: return_to_caller",
      "",
      "Additional notes here.",
    ].join("\n")

    const result = extractHandoffFromAgentResponse(response)

    expect(result).not.toBeNull()
    expect(result!.status).toBe("DONE")
    expect(result!.handoff).toBe("return_to_caller")
    expect(result!.signals).toHaveLength(1)
    expect(result!.signals[0]?.signal).toBe("tests_passed")
  })

  test("#given agent response IN_PROGRESS handoff #then extracts correctly", () => {
    const response = [
      "Working on the backend task.",
      "STATUS: IN_PROGRESS",
      'SIGNALS_EMITTED: [{"signal":"schema_ready","payload":{"version":2}}]',
      "HANDOFF: nodejs-backend-developer",
    ].join("\n")

    const result = extractHandoffFromAgentResponse(response)

    expect(result).not.toBeNull()
    expect(result!.status).toBe("IN_PROGRESS")
    expect(result!.handoff).toBe("nodejs-backend-developer")
    expect(result!.signals).toHaveLength(1)
    expect(result!.signals[0]?.signal).toBe("schema_ready")
  })

  test("#given agent response with no handoff block #then returns null", () => {
    const response = "Task completed successfully with no handoff information."

    const result = extractHandoffFromAgentResponse(response)

    expect(result).toBeNull()
  })

  test("#given empty text #then returns null", () => {
    expect(extractHandoffFromAgentResponse("")).toBeNull()
    expect(extractHandoffFromAgentResponse("  ")).toBeNull()
  })

  test("#given handoff with multi signals #then parses all", () => {
    const response = [
      "Here is my work result.",
      "",
      "STATUS: DONE",
      'SIGNALS_EMITTED: [{"signal":"tests_passed","payload":{}},{"signal":"performance_verified","payload":{"score":0.95}}]',
      "HANDOFF: return_to_parent_for_routing",
    ].join("\n")

    const result = extractHandoffFromAgentResponse(response)

    expect(result).not.toBeNull()
    expect(result!.status).toBe("DONE")
    expect(result!.signals).toHaveLength(2)
    expect(result!.signals[1]?.signal).toBe("performance_verified")
    expect(result!.handoff).toBe("return_to_parent_for_routing")
  })
})

describe("buildLiveHandoffContextSummary", () => {
  test("#given run-continuation marker with handoff reason #then builds summary", () => {
    const directory = createTempDir()
    const sessionId = "ses_handoff_live_1"

    setContinuationMarkerSource(directory, sessionId, "background-task", "active", JSON.stringify({
      status: "DONE",
      handoff: "return_to_caller",
      signalCount: 1,
      signals: [{ signal: "tests_passed", payload: {} }],
    }))

    const summary = buildLiveHandoffContextSummary(directory, sessionId)

    expect(summary.length).toBeGreaterThan(0)
    expect(summary).toMatch(/DONE/)
    expect(summary).toMatch(/return_to_caller/)
  })

  test("#given no handoff state #then returns empty string", () => {
    const directory = createTempDir()
    const sessionId = "ses_no_handoff"

    const summary = buildLiveHandoffContextSummary(directory, sessionId)

    expect(summary).toBe("")
  })

  test("#given marker with corrupted reason #then returns empty", () => {
    const directory = createTempDir()
    const sessionId = "ses_corrupted"

    setContinuationMarkerSource(directory, sessionId, "background-task", "active", "not valid json at all")

    const summary = buildLiveHandoffContextSummary(directory, sessionId)

    // Corrupted data should be silently skipped
    expect(summary).toBe("")
  })

  test("#given IN_PROGRESS handoff in marker #then summary contains target", () => {
    const directory = createTempDir()
    const sessionId = "ses_progress"

    setContinuationMarkerSource(directory, sessionId, "background-task", "active", JSON.stringify({
      status: "IN_PROGRESS",
      handoff: "nodejs-backend-developer",
      signalCount: 1,
      signals: [{ signal: "backend_ready", payload: {} }],
    }))

    const summary = buildLiveHandoffContextSummary(directory, sessionId)

    expect(summary).toMatch(/IN_PROGRESS/)
    expect(summary).toMatch(/nodejs-backend-developer/)
  })
})

describe("processHandoffInAgentResponse", () => {
  test("#given agent text with handoff block #then persists to continuation marker", () => {
    const directory = createTempDir()
    const sessionId = "ses_process_1"

    const response = [
      "Here is the result of the work.",
      "STATUS: DONE",
      'SIGNALS_EMITTED: [{"signal":"tests_passed","payload":{}}]',
      "HANDOFF: return_to_caller",
    ].join("\n")

    const result = processHandoffInAgentResponse(response, directory, sessionId)

    expect(result).not.toBeNull()
    expect(result!.status).toBe("DONE")
    expect(result!.handoff).toBe("return_to_caller")

    const marker = readContinuationMarker(directory, sessionId)
    expect(marker).not.toBeNull()
    expect(marker!.sources["background-task"]).toBeDefined()
    expect(marker!.sources["background-task"]!.reason).toBeDefined()

    const parsed = JSON.parse(marker!.sources["background-task"]!.reason!)
    expect(parsed.status).toBe("DONE")
    expect(parsed.handoff).toBe("return_to_caller")
  })

  test("#given agent text with IN_PROGRESS handoff #then persists correctly", () => {
    const directory = createTempDir()
    const sessionId = "ses_process_2"

    const response = [
      "Working on backend.",
      "STATUS: IN_PROGRESS",
      'SIGNALS_EMITTED: [{"signal":"backend_ready","payload":{}}]',
      "HANDOFF: nodejs-backend-developer",
    ].join("\n")

    const result = processHandoffInAgentResponse(response, directory, sessionId)

    expect(result).not.toBeNull()
    expect(result!.status).toBe("IN_PROGRESS")
    expect(result!.handoff).toBe("nodejs-backend-developer")

    const marker = readContinuationMarker(directory, sessionId)
    expect(marker).not.toBeNull()
    const parsed = JSON.parse(marker!.sources["background-task"]!.reason!)
    expect(parsed.status).toBe("IN_PROGRESS")
    expect(parsed.handoff).toBe("nodejs-backend-developer")
  })

  test("#given agent text without handoff #then does not write marker", () => {
    const directory = createTempDir()
    const sessionId = "ses_process_3"

    const result = processHandoffInAgentResponse("Task completed successfully.", directory, sessionId)

    expect(result).toBeNull()

    const marker = readContinuationMarker(directory, sessionId)
    expect(marker).toBeNull()
  })

  test("#given empty text #then returns null and writes nothing", () => {
    const directory = createTempDir()
    const sessionId = "ses_process_4"

    expect(processHandoffInAgentResponse("", directory, sessionId)).toBeNull()
    expect(processHandoffInAgentResponse("  ", directory, sessionId)).toBeNull()

    const marker = readContinuationMarker(directory, sessionId)
    expect(marker).toBeNull()
  })
})

describe("recordHandoffToOmoState", () => {
  test("#given handoff block #then writes to .omo/hecateq/state.json", () => {
    const directory = createTempDir()

    const handoff = extractHandoffFromAgentResponse([
      "Result of work.",
      "STATUS: DONE",
      'SIGNALS_EMITTED: [{"signal":"tests_passed","payload":{}},{"signal":"backend_ready","payload":{}}]',
      "HANDOFF: return_to_caller",
    ].join("\n"))

    expect(handoff).not.toBeNull()

    const result = recordHandoffToOmoState(directory, handoff!)
    expect(result).toBe(true)

    // Verify the file was created and contains the handoff
    const omoStatePath = join(directory, HECATEQ_OMO_DIR, "state.json")
    expect(existsSync(omoStatePath)).toBe(true)

    const mgr = new OmoStateManager(directory)
    const active = mgr.getActiveHandoff()
    expect(active).not.toBeNull()
    expect(active!.status).toBe("DONE")
    expect(active!.target).toBe("return_to_caller")
    expect(active!.signalCount).toBe(2)
    expect(active!.signalNames).toEqual(["tests_passed", "backend_ready"])
    expect(active!.source).toBe("direct")
  })

  test("#given handoff block with IN_PROGRESS status #then persists correctly", () => {
    const directory = createTempDir()

    const handoff = extractHandoffFromAgentResponse([
      "Working on backend task.",
      "STATUS: IN_PROGRESS",
      'SIGNALS_EMITTED: [{"signal":"schema_ready","payload":{"version":2}}]',
      "HANDOFF: nodejs-backend-developer",
    ].join("\n"))

    const result = recordHandoffToOmoState(directory, handoff!)
    expect(result).toBe(true)

    const mgr = new OmoStateManager(directory)
    const active = mgr.getActiveHandoff()
    expect(active!.status).toBe("IN_PROGRESS")
    expect(active!.target).toBe("nodejs-backend-developer")
    expect(active!.signalCount).toBe(1)

    const history = mgr.getHandoffHistory()
    expect(history).toHaveLength(1)
    expect(history[0]!.status).toBe("IN_PROGRESS")
  })
})

describe("buildOmoHandoffContextSummary", () => {
  test("#given active handoff in .omo/hecateq #then returns summary", () => {
    const directory = createTempDir()
    const mgr = new OmoStateManager(directory)
    mgr.recordHandoff({
      status: "DONE",
      target: "return_to_caller",
      signalCount: 1,
      signalNames: ["tests_passed"],
      timestamp: new Date().toISOString(),
      source: "direct",
    })

    const summary = buildOmoHandoffContextSummary(directory)
    expect(summary.length).toBeGreaterThan(0)
    expect(summary).toMatch(/DONE/)
    expect(summary).toMatch(/return_to_caller/)
  })

  test("#given no .omo/hecateq/ state #then returns empty string", () => {
    const directory = createTempDir()
    const summary = buildOmoHandoffContextSummary(directory)
    expect(summary).toBe("")
  })

  test("#given handoff history but no active handoff #then uses most recent history entry", () => {
    const directory = createTempDir()
    const mgr = new OmoStateManager(directory)
    mgr.recordHandoff({
      status: "IN_PROGRESS",
      target: "nodejs-backend-developer",
      signalCount: 0,
      signalNames: [],
      timestamp: new Date().toISOString(),
      source: "direct",
    })
    mgr.clearActiveHandoff()

    const summary = buildOmoHandoffContextSummary(directory)
    expect(summary).toMatch(/IN_PROGRESS/)
    expect(summary).toMatch(/nodejs-backend-developer/)
  })
})

describe("buildLiveHandoffContextSummary — canonical read path", () => {
  test("#given .omo/hecateq has handoff #then reads it first and ignores fallback sources", () => {
    const directory = createTempDir()
    const sessionId = "ses_canonical_1"

    // Write to .omo/hecateq/ — canonical
    const mgr = new OmoStateManager(directory)
    mgr.recordHandoff({
      status: "DONE",
      target: "return_to_caller",
      signalCount: 1,
      signalNames: ["tests_passed"],
      timestamp: new Date().toISOString(),
      source: "direct",
    })

    // Also write a different handoff to continuation marker — should be ignored
    setContinuationMarkerSource(directory, sessionId, "background-task", "active", JSON.stringify({
      status: "IN_PROGRESS",
      handoff: "different-agent",
      signalCount: 0,
      signals: [],
    }))

    const summary = buildLiveHandoffContextSummary(directory, sessionId)
    expect(summary).toMatch(/DONE/)
    expect(summary).toMatch(/return_to_caller/)
    expect(summary).not.toMatch(/IN_PROGRESS/)
    expect(summary).not.toMatch(/different-agent/)
  })

  test("#given .omo/hecateq has no handoff #then falls back to continuation marker", () => {
    const directory = createTempDir()
    const sessionId = "ses_fallback_1"

    setContinuationMarkerSource(directory, sessionId, "background-task", "active", JSON.stringify({
      status: "IN_PROGRESS",
      handoff: "nodejs-backend-developer",
      signalCount: 1,
      signals: [{ signal: "backend_ready", payload: {} }],
    }))

    const summary = buildLiveHandoffContextSummary(directory, sessionId)
    expect(summary).toMatch(/IN_PROGRESS/)
    expect(summary).toMatch(/nodejs-backend-developer/)
  })
})

describe("processHandoffInAgentResponse — omo persistence", () => {
  test("#given handoff block #then writes to .omo/hecateq/ in addition to continuation marker", () => {
    const directory = createTempDir()
    const sessionId = "ses_omo_1"

    const response = [
      "Here is the result of the work.",
      "STATUS: DONE",
      'SIGNALS_EMITTED: [{"signal":"tests_passed","payload":{}}]',
      "HANDOFF: return_to_caller",
    ].join("\n")

    const result = processHandoffInAgentResponse(response, directory, sessionId)
    expect(result).not.toBeNull()
    expect(result!.status).toBe("DONE")

    // Verify .omo/hecateq/state.json was written
    const mgr = new OmoStateManager(directory)
    const active = mgr.getActiveHandoff()
    expect(active).not.toBeNull()
    expect(active!.status).toBe("DONE")
    expect(active!.target).toBe("return_to_caller")
    expect(active!.source).toBe("direct")

    // Verify continuation marker was also written (backward-compatible fallback)
    const marker = readContinuationMarker(directory, sessionId)
    expect(marker).not.toBeNull()
  })

  test("#given no handoff in response #then does not create .omo/hecateq state file", () => {
    const directory = createTempDir()
    const sessionId = "ses_omo_2"

    const result = processHandoffInAgentResponse("Task completed successfully.", directory, sessionId)
    expect(result).toBeNull()

    const omoStatePath = join(directory, HECATEQ_OMO_DIR, "state.json")
    expect(existsSync(omoStatePath)).toBe(false)
  })
})

// ─── Phase 3: Handoff → JSONL write integration tests ────────────────────

describe("processHandoffInAgentResponse — task state memory writes", () => {
  test("#given handoff with DONE status #then appends completed task entry to tasks.jsonl", () => {
    const directory = createTempDir()
    const sessionId = "ses_tsm_done"

    const response = [
      "Here is the result of the work.",
      "STATUS: DONE",
      'SIGNALS_EMITTED: [{"signal":"tests_passed","payload":{}}]',
      "HANDOFF: return_to_caller",
    ].join("\n")

    processHandoffInAgentResponse(response, directory, sessionId)

    const taskStatePath = join(directory, PROJECT_MEMORY_DIR, TASK_STATE_MEMORY_FILENAME)
    expect(existsSync(taskStatePath)).toBe(true)

    const raw = readFileSync(taskStatePath, "utf-8")
    const lines = raw.trim().split("\n")
    expect(lines.length).toBeGreaterThanOrEqual(1)

    const entry = JSON.parse(lines[0])
    expect(entry.action).toBe("complete")
    expect(entry.status).toBe("completed")
    expect(entry.source_session_id).toBe(sessionId)
  })

  test("#given handoff with BLOCKED status #then appends blocked task entry with blockers", () => {
    const directory = createTempDir()
    const sessionId = "ses_tsm_blocked"

    const response = [
      "STATUS: BLOCKED",
      'SIGNALS_EMITTED: [{"signal":"blocked","payload":{"reason":"awaiting review"}}]',
      "HANDOFF: return_to_caller",
      'BLOCKERS: ["Awaiting PR review on auth module","Database migration required"]',
    ].join("\n")

    processHandoffInAgentResponse(response, directory, sessionId)

    const taskStatePath = join(directory, PROJECT_MEMORY_DIR, TASK_STATE_MEMORY_FILENAME)
    const raw = readFileSync(taskStatePath, "utf-8")
    const entry = JSON.parse(raw.trim().split("\n")[0])

    expect(entry.action).toBe("block")
    expect(entry.status).toBe("blocked")
    expect(entry.blockers).toEqual(["Awaiting PR review on auth module", "Database migration required"])
  })

  test("#given handoff with NEXT_RECOMMENDED_AGENT #then appends next_action", () => {
    const directory = createTempDir()
    const sessionId = "ses_tsm_next"

    const response = [
      "STATUS: IN_PROGRESS",
      'SIGNALS_EMITTED: [{"signal":"backend_ready","payload":{}}]',
      "HANDOFF: nodejs-backend-developer",
      "NEXT_RECOMMENDED_AGENT: oracle",
    ].join("\n")

    processHandoffInAgentResponse(response, directory, sessionId)

    const taskStatePath = join(directory, PROJECT_MEMORY_DIR, TASK_STATE_MEMORY_FILENAME)
    const raw = readFileSync(taskStatePath, "utf-8")
    const entry = JSON.parse(raw.trim().split("\n")[0])

    expect(entry.next_action).toBe("Handoff to oracle")
    expect(entry.status).toBe("in_progress")
  })

  test("#given handoff with CHANGED_FILES #then preserves changed_files", () => {
    const directory = createTempDir()
    const sessionId = "ses_tsm_files"

    const response = [
      "STATUS: DONE",
      'SIGNALS_EMITTED: [{"signal":"tests_passed","payload":{}}]',
      "HANDOFF: return_to_caller",
      'CHANGED_FILES: [{"path":"src/auth.ts","changeType":"modified"},{"path":"src/types.ts","changeType":"created"}]',
    ].join("\n")

    processHandoffInAgentResponse(response, directory, sessionId)

    const taskStatePath = join(directory, PROJECT_MEMORY_DIR, TASK_STATE_MEMORY_FILENAME)
    const raw = readFileSync(taskStatePath, "utf-8")
    const entry = JSON.parse(raw.trim().split("\n")[0])

    expect(entry.changed_files).toEqual(["src/auth.ts", "src/types.ts"])
  })

  test("#given handoff with DONE status and quality notes #then verification field is populated", () => {
    const directory = createTempDir()
    const sessionId = "ses_tsm_verify"

    const response = [
      "STATUS: DONE",
      'SIGNALS_EMITTED: [{"signal":"tests_passed","payload":{}}]',
      "HANDOFF: return_to_caller",
      "QUALITY_NOTES: All 42 tests pass, typecheck clean, build succeeds",
    ].join("\n")

    processHandoffInAgentResponse(response, directory, sessionId)

    const taskStatePath = join(directory, PROJECT_MEMORY_DIR, TASK_STATE_MEMORY_FILENAME)
    const raw = readFileSync(taskStatePath, "utf-8")
    const entry = JSON.parse(raw.trim().split("\n")[0])

    expect(entry.action).toBe("complete")
    expect(entry.status).toBe("completed")
    expect(entry.verification).toBe("All 42 tests pass, typecheck clean, build succeeds")
  })
})

describe("processHandoffInAgentResponse — decision log writes", () => {
  test("#given handoff without decision-like content #then does not write decision entry", () => {
    const directory = createTempDir()
    const sessionId = "ses_dl_no_decision"

    const response = [
      "STATUS: DONE",
      'SIGNALS_EMITTED: [{"signal":"tests_passed","payload":{}}]',
      "HANDOFF: return_to_caller",
    ].join("\n")

    processHandoffInAgentResponse(response, directory, sessionId)

    const decisionLogPath = join(directory, PROJECT_MEMORY_DIR, DECISION_LOG_FILENAME)
    expect(existsSync(decisionLogPath)).toBe(false)
  })

  test("#given handoff with explicit decision-like content #then writes a Decision Log record", () => {
    const directory = createTempDir()
    const sessionId = "ses_dl_decision"

    const response = [
      "STATUS: DONE",
      'SIGNALS_EMITTED: [{"signal":"tests_passed","payload":{}}]',
      "HANDOFF: return_to_caller",
      "QUALITY_NOTES: Architecture decision to use bcrypt for password hashing",
    ].join("\n")

    processHandoffInAgentResponse(response, directory, sessionId)

    const decisionLogPath = join(directory, PROJECT_MEMORY_DIR, DECISION_LOG_FILENAME)
    expect(existsSync(decisionLogPath)).toBe(true)

    const raw = readFileSync(decisionLogPath, "utf-8")
    const entry = JSON.parse(raw.trim().split("\n")[0])
    expect(entry.action).toBe("record")
    expect(entry.status).toBe("active")
    expect(entry.decision).toContain("Architecture decision")
  })
})

describe("processHandoffInAgentResponse — duplicate prevention", () => {
  test("#given duplicate handoff processing #then does not create duplicate JSONL entries", () => {
    const directory = createTempDir()
    const sessionId = "ses_dup"

    const response = [
      "STATUS: DONE",
      'SIGNALS_EMITTED: [{"signal":"tests_passed","payload":{}}]',
      "HANDOFF: return_to_caller",
    ].join("\n")

    processHandoffInAgentResponse(response, directory, sessionId)
    processHandoffInAgentResponse(response, directory, sessionId)

    const taskStatePath = join(directory, PROJECT_MEMORY_DIR, TASK_STATE_MEMORY_FILENAME)
    const raw = readFileSync(taskStatePath, "utf-8")
    const lines = raw.trim().split("\n").filter((l: string) => l.length > 0)
    expect(lines.length).toBe(1)
  })

  test("#given duplicate handoff with decision content #then does not duplicate decision entries", () => {
    const directory = createTempDir()
    const sessionId = "ses_dup_dl"

    const response = [
      "STATUS: IN_PROGRESS",
      'SIGNALS_EMITTED: [{"signal":"backend_ready","payload":{}}]',
      "HANDOFF: nodejs-backend-developer",
      "QUALITY_NOTES: Tradeoff analysis chose bcrypt over argon2 for broader ecosystem support",
    ].join("\n")

    processHandoffInAgentResponse(response, directory, sessionId)
    processHandoffInAgentResponse(response, directory, sessionId)

    const decisionLogPath = join(directory, PROJECT_MEMORY_DIR, DECISION_LOG_FILENAME)
    const raw = readFileSync(decisionLogPath, "utf-8")
    const lines = raw.trim().split("\n").filter((l: string) => l.length > 0)
    expect(lines.length).toBe(1)
  })
})

describe("processHandoffInAgentResponse — JSONL write failure does not break handoff", () => {
  test("#given task-state write failure #then existing handoff persistence still works", () => {
    const directory = createTempDir()
    const sessionId = "ses_fail_tsm"

    mock.module("../../shared/task-state-memory", () => ({
      ...taskStateMemoryModule,
      appendTaskEntry: () => { throw new Error("simulated disk full") },
    }))

    const response = [
      "STATUS: DONE",
      'SIGNALS_EMITTED: [{"signal":"tests_passed","payload":{}}]',
      "HANDOFF: return_to_caller",
    ].join("\n")

    const result = processHandoffInAgentResponse(response, directory, sessionId)
    expect(result).not.toBeNull()
    expect(result!.status).toBe("DONE")
    expect(result!.handoff).toBe("return_to_caller")

    const marker = readContinuationMarker(directory, sessionId)
    expect(marker).not.toBeNull()
    const parsed = JSON.parse(marker!.sources["background-task"]!.reason!)
    expect(parsed.status).toBe("DONE")
  })

  test("#given decision-log write failure #then existing handoff persistence still works", () => {
    const directory = createTempDir()
    const sessionId = "ses_fail_dl"

    mock.module("../../shared/decision-log", () => ({
      ...decisionLogModule,
      appendDecisionEntry: () => { throw new Error("simulated disk full") },
    }))

    const response = [
      "STATUS: DONE",
      'SIGNALS_EMITTED: [{"signal":"tests_passed","payload":{}}]',
      "HANDOFF: return_to_caller",
      "QUALITY_NOTES: Architecture decision to use JWT for auth tokens",
    ].join("\n")

    const result = processHandoffInAgentResponse(response, directory, sessionId)
    expect(result).not.toBeNull()
    expect(result!.status).toBe("DONE")

    const marker = readContinuationMarker(directory, sessionId)
    expect(marker).not.toBeNull()
    const parsed = JSON.parse(marker!.sources["background-task"]!.reason!)
    expect(parsed.status).toBe("DONE")
  })
})

describe("processHandoffInAgentResponse — quality history writes", () => {
  test("#given handoff with quality notes #then writes to quality-history.md", () => {
    const directory = createTempDir()
    const sessionId = "ses_qh_write"

    const response = [
      "STATUS: DONE",
      'SIGNALS_EMITTED: [{"signal":"tests_passed","payload":{}}]',
      "HANDOFF: return_to_caller",
      "QUALITY_NOTES: All tests pass, typecheck clean, build succeeds",
    ].join("\n")

    processHandoffInAgentResponse(response, directory, sessionId)

    const qualityPath = join(directory, PROJECT_MEMORY_DIR, "quality-history.md")
    expect(existsSync(qualityPath)).toBe(true)
    const content = readFileSync(qualityPath, "utf-8")
    expect(content).toContain("Quality Gate Run")
    expect(content).toContain("All tests pass")
  })

  test("#given handoff without quality notes #then does not write quality history", () => {
    const directory = createTempDir()
    const sessionId = "ses_qh_no_notes"

    const response = [
      "STATUS: DONE",
      'SIGNALS_EMITTED: [{"signal":"tests_passed","payload":{}}]',
      "HANDOFF: return_to_caller",
    ].join("\n")

    processHandoffInAgentResponse(response, directory, sessionId)

    const qualityPath = join(directory, PROJECT_MEMORY_DIR, "quality-history.md")
    expect(existsSync(qualityPath)).toBe(false)
  })

  test("#given quality-write failure #then existing handoff persistence still works", () => {
    const directory = createTempDir()
    const sessionId = "ses_qh_fail"

    mock.module("../../shared/memory-quality-writer", () => ({
      ...qualityWriterModule,
      writeQualityHistory: () => { throw new Error("simulated disk full") },
    }))

    const response = [
      "STATUS: DONE",
      'SIGNALS_EMITTED: [{"signal":"tests_passed","payload":{}}]',
      "HANDOFF: return_to_caller",
      "QUALITY_NOTES: All tests pass",
    ].join("\n")

    const result = processHandoffInAgentResponse(response, directory, sessionId)
    expect(result).not.toBeNull()
    expect(result!.status).toBe("DONE")

    const marker = readContinuationMarker(directory, sessionId)
    expect(marker).not.toBeNull()
    const parsed = JSON.parse(marker!.sources["background-task"]!.reason!)
    expect(parsed.status).toBe("DONE")
  })
})

describe("processHandoffInAgentResponse — risk detection writes", () => {
  test("#given handoff with changed files matching risk rules #then writes risk entries", () => {
    const directory = createTempDir()
    const sessionId = "ses_risk_detect"

    const response = [
      "STATUS: DONE",
      'SIGNALS_EMITTED: [{"signal":"tests_passed","payload":{}}]',
      "HANDOFF: return_to_caller",
      'CHANGED_FILES: [{"path":".env.example","changeType":"modified"},{"path":"prisma/migration.sql","changeType":"created"}]',
    ].join("\n")

    processHandoffInAgentResponse(response, directory, sessionId)

    const riskPath = join(directory, PROJECT_MEMORY_DIR, "risk-profile.md")
    expect(existsSync(riskPath)).toBe(true)
    const content = readFileSync(riskPath, "utf-8")
    expect(content).toContain("Active Risks")
  })

  test("#given handoff without changed files #then does not write risk entries", () => {
    const directory = createTempDir()
    const sessionId = "ses_risk_none"

    const response = [
      "STATUS: DONE",
      'SIGNALS_EMITTED: [{"signal":"tests_passed","payload":{}}]',
      "HANDOFF: return_to_caller",
    ].join("\n")

    processHandoffInAgentResponse(response, directory, sessionId)

    const riskPath = join(directory, PROJECT_MEMORY_DIR, "risk-profile.md")
    expect(existsSync(riskPath)).toBe(false)
  })

  test("#given risk-detection failure #then existing handoff persistence still works", () => {
    const directory = createTempDir()
    const sessionId = "ses_risk_fail"

    mock.module("../../shared/memory-risk-writer", () => ({
      ...riskWriterModule,
      updateRiskProfile: () => { throw new Error("simulated disk full") },
    }))

    const response = [
      "STATUS: DONE",
      'SIGNALS_EMITTED: [{"signal":"tests_passed","payload":{}}]',
      "HANDOFF: return_to_caller",
      'CHANGED_FILES: [{"path":"src/auth.ts","changeType":"modified"}]',
    ].join("\n")

    const result = processHandoffInAgentResponse(response, directory, sessionId)
    expect(result).not.toBeNull()
    expect(result!.status).toBe("DONE")

    const marker = readContinuationMarker(directory, sessionId)
    expect(marker).not.toBeNull()
    const parsed = JSON.parse(marker!.sources["background-task"]!.reason!)
    expect(parsed.status).toBe("DONE")
  })
})

describe("processHandoffInAgentResponse — change impact map writes", () => {
  test("#given handoff with changed files #then appends change impact entries to file-map.md", () => {
    const directory = createTempDir()
    const sessionId = "ses_ci_write"

    const response = [
      "STATUS: DONE",
      'SIGNALS_EMITTED: [{"signal":"tests_passed","payload":{}}]',
      "HANDOFF: return_to_caller",
      'CHANGED_FILES: [{"path":"src/auth.ts","changeType":"modified"},{"path":"src/types.ts","changeType":"created"}]',
    ].join("\n")

    processHandoffInAgentResponse(response, directory, sessionId)

    const fileMapPath = join(directory, PROJECT_MEMORY_DIR, "file-map.md")
    expect(existsSync(fileMapPath)).toBe(true)
    const content = readFileSync(fileMapPath, "utf-8")
    expect(content).toContain("## Change Impact Map")
    expect(content).toContain("src/auth.ts")
    expect(content).toContain("src/types.ts")
  })

  test("#given handoff without changed files #then does not write change impact entries", () => {
    const directory = createTempDir()
    const sessionId = "ses_ci_none"

    const response = [
      "STATUS: DONE",
      'SIGNALS_EMITTED: [{"signal":"tests_passed","payload":{}}]',
      "HANDOFF: return_to_caller",
    ].join("\n")

    processHandoffInAgentResponse(response, directory, sessionId)

    const fileMapPath = join(directory, PROJECT_MEMORY_DIR, "file-map.md")
    expect(existsSync(fileMapPath)).toBe(false)
  })

  test("#given duplicate changed files #then does not duplicate change impact entries", () => {
    const directory = createTempDir()
    const sessionId = "ses_ci_dup"

    const response = [
      "STATUS: DONE",
      'SIGNALS_EMITTED: [{"signal":"tests_passed","payload":{}}]',
      "HANDOFF: return_to_caller",
      'CHANGED_FILES: [{"path":"src/auth.ts","changeType":"modified"}]',
    ].join("\n")

    processHandoffInAgentResponse(response, directory, sessionId)
    processHandoffInAgentResponse(response, directory, sessionId)

    const fileMapPath = join(directory, PROJECT_MEMORY_DIR, "file-map.md")
    const content = readFileSync(fileMapPath, "utf-8")
    const matches = content.match(/`src\/auth\.ts`/g)
    expect(matches).not.toBeNull()
    expect(matches!.length).toBe(1)
  })

  test("#given change-impact write failure #then existing handoff persistence still works", () => {
    const directory = createTempDir()
    const sessionId = "ses_ci_fail"

    mock.module("../../shared/memory-change-impact", () => ({
      ...changeImpactModule,
      appendChangeImpactEntries: () => { throw new Error("simulated disk full") },
    }))

    const response = [
      "STATUS: DONE",
      'SIGNALS_EMITTED: [{"signal":"tests_passed","payload":{}}]',
      "HANDOFF: return_to_caller",
      'CHANGED_FILES: [{"path":"src/auth.ts","changeType":"modified"}]',
    ].join("\n")

    const result = processHandoffInAgentResponse(response, directory, sessionId)
    expect(result).not.toBeNull()
    expect(result!.status).toBe("DONE")

    const marker = readContinuationMarker(directory, sessionId)
    expect(marker).not.toBeNull()
    const parsed = JSON.parse(marker!.sources["background-task"]!.reason!)
    expect(parsed.status).toBe("DONE")
  })
})
