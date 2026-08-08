import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  EvidenceValidationFailedError,
  _resetEvidenceDirForTesting,
  _setEvidenceDirForTesting,
  assertEvidenceMatchesCurrent,
  captureCommandEvidence,
  captureFilesChangedFromResult,
  captureTestEvidence,
  listEvidence,
  readEvidence,
  recordEvidence,
  validateEvidenceFreshness,
} from "./evidence-store"
import type { HecateqTaskEvidence } from "./evidence-types"
import {
  _setHandoffHistoryFilePathForTesting,
  loadRecentRuntimeEvents,
} from "./handoff-history"

// ─── Shared fixtures ──────────────────────────────────────────────────────────

function makeEvidence(
  overrides: Partial<HecateqTaskEvidence> = {},
): HecateqTaskEvidence {
  return {
    evidenceId: "evt_fixture",
    taskGraphId: "tg_1",
    taskId: "T4",
    attempt: 1,
    executionId: "exec_A",
    agent: "nodejs-backend-developer",
    createdAt: "2026-08-08T14:30:00.000Z",
    ...overrides,
  }
}

function freshnessInput(evidence: HecateqTaskEvidence) {
  return {
    evidence,
    taskGraphId: "tg_1",
    taskId: "T4",
    attempt: 1,
    executionId: "exec_A",
  }
}

describe("hecateq task evidence", () => {
  let dir: string
  let evidenceDir: string
  let ledgerPath: string

  beforeEach(() => {
    // given a fresh temp evidence dir + ledger
    dir = mkdtempSync(join(tmpdir(), "hecateq-evidence-"))
    evidenceDir = join(dir, ".opencode", "state", "hecateq", "evidence")
    ledgerPath = join(dir, ".opencode", "state", "hecateq", "handoff-history.jsonl")
    _setEvidenceDirForTesting(evidenceDir)
    _setHandoffHistoryFilePathForTesting(ledgerPath)
  })

  afterEach(() => {
    _resetEvidenceDirForTesting()
    _setHandoffHistoryFilePathForTesting(null)
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  test("#given a valid input #when recording #then a JSON file is written and an evidence_recorded event is appended", () => {
    // given
    const input = {
      taskGraphId: "tg_1",
      taskId: "T4",
      attempt: 1,
      executionId: "exec_A",
      agent: "nodejs-backend-developer",
      filesChanged: ["src/a.ts", "src/b.ts"],
      tests: [{ command: "bun test", passed: 5, failed: 0, exitCode: 0 }],
      checks: [{ kind: "typecheck", status: "passed" as const }],
    }
    // when
    const evidence = recordEvidence(input)
    // then
    expect(existsSync(join(evidenceDir, `${evidence.evidenceId}.json`))).toBe(true)
    const fileContent = JSON.parse(
      readFileSync(join(evidenceDir, `${evidence.evidenceId}.json`), "utf-8"),
    ) as Record<string, unknown>
    expect(fileContent.evidenceId).toBe(evidence.evidenceId)
    expect(fileContent.taskGraphId).toBe("tg_1")
    expect(fileContent.taskId).toBe("T4")
    expect(fileContent.attempt).toBe(1)
    expect(fileContent.executionId).toBe("exec_A")

    const events = loadRecentRuntimeEvents(10)
    const recorded = events.find((event) => event.event === "evidence_recorded")
    expect(recorded).toBeDefined()
    expect(recorded?.execution_id).toBe("exec_A")
    expect(recorded?.task_id).toBe("T4")
    expect(recorded?.task_graph_id).toBe("tg_1")
    expect(recorded?.attempt).toBe(1)
    expect(recorded?.reason).toBe(evidence.evidenceId)
  })

  test("#given a recorded evidence #when reading by id #then the record round-trips", () => {
    // given
    const recorded = recordEvidence({
      taskGraphId: "tg_1",
      taskId: "T4",
      attempt: 1,
      executionId: "exec_A",
      agent: "nodejs-backend-developer",
      filesChanged: ["src/a.ts"],
      commands: [{ command: "bun run typecheck", exitCode: 0, durationMs: 1200 }],
    })
    // when
    const loaded = readEvidence(recorded.evidenceId)
    // then
    expect(loaded).not.toBeNull()
    expect(loaded).toEqual(recorded)
  })

  test("#given a missing id #when reading #then returns null", () => {
    // when
    const loaded = readEvidence("evt_missing")
    // then
    expect(loaded).toBeNull()
  })

  test("#given evidences for two tasks #when listing by task #then only that task's evidence is returned", () => {
    // given
    const a1 = recordEvidence({
      taskGraphId: "tg_1",
      taskId: "T4",
      attempt: 1,
      executionId: "exec_A",
      agent: "nodejs-backend-developer",
    })
    const a2 = recordEvidence({
      taskGraphId: "tg_1",
      taskId: "T4",
      attempt: 2,
      executionId: "exec_B",
      agent: "nodejs-backend-developer",
    })
    recordEvidence({
      taskGraphId: "tg_1",
      taskId: "T5",
      attempt: 1,
      executionId: "exec_C",
      agent: "nodejs-backend-developer",
    })
    recordEvidence({
      taskGraphId: "tg_2",
      taskId: "T4",
      attempt: 1,
      executionId: "exec_D",
      agent: "nodejs-backend-developer",
    })
    // when
    const listed = listEvidence("tg_1", "T4")
    // then
    expect(listed.map((evidence) => evidence.evidenceId).sort()).toEqual(
      [a1.evidenceId, a2.evidenceId].sort(),
    )
  })

  test("#given matching identity #when validating freshness #then returns fresh", () => {
    // when
    const freshness = validateEvidenceFreshness(freshnessInput(makeEvidence()))
    // then
    expect(freshness).toBe("fresh")
  })

  test("#given an executionId mismatch #when validating freshness #then returns stale", () => {
    // when
    const freshness = validateEvidenceFreshness(
      freshnessInput(makeEvidence({ executionId: "exec_OTHER" })),
    )
    // then
    expect(freshness).toBe("stale")
  })

  test("#given an attempt mismatch #when validating freshness #then returns stale", () => {
    // when
    const freshness = validateEvidenceFreshness(
      freshnessInput(makeEvidence({ attempt: 2 })),
    )
    // then
    expect(freshness).toBe("stale")
  })

  test("#given a taskId mismatch #when validating freshness #then returns invalid", () => {
    // when
    const freshness = validateEvidenceFreshness(
      freshnessInput(makeEvidence({ taskId: "T9" })),
    )
    // then
    expect(freshness).toBe("invalid")
  })

  test("#given a taskGraphId mismatch #when validating freshness #then returns invalid", () => {
    // when
    const freshness = validateEvidenceFreshness(
      freshnessInput(makeEvidence({ taskGraphId: "tg_9" })),
    )
    // then
    expect(freshness).toBe("invalid")
  })

  test("#given a stale evidence #when asserting freshness #then throws with structured reasons", () => {
    // given
    const input = freshnessInput(makeEvidence({ executionId: "exec_OTHER" }))
    // when / then
    expect(() => assertEvidenceMatchesCurrent(input)).toThrow(
      EvidenceValidationFailedError,
    )
    try {
      assertEvidenceMatchesCurrent(input)
      expect.unreachable("assertEvidenceMatchesCurrent should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(EvidenceValidationFailedError)
      const validationError = error as EvidenceValidationFailedError
      expect(validationError.kind).toBe("stale")
      expect(validationError.reasons.some((reason) => reason.includes("executionId"))).toBe(true)
    }
  })

  test("#given a fresh evidence #when asserting freshness #then does not throw", () => {
    // when / then
    expect(() =>
      assertEvidenceMatchesCurrent(freshnessInput(makeEvidence())),
    ).not.toThrow()
  })

  test("#given changed files with extra fields #when capturing #then strips non-path fields, deduplicates, and sorts", () => {
    // given
    const result = {
      changedFiles: [
        { path: "src/b.ts", stats: { size: 10 } },
        { filePath: "src/a.ts", mode: 0o644 },
        { path: "src/a.ts", stats: { size: 20 } },
        { path: "", mode: 0o644 },
        { filePath: "src/c.ts" },
      ],
    }
    // when
    const paths = captureFilesChangedFromResult(result)
    // then
    expect(paths).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"])
  })

  test("#given a command with prompt/output fields #when capturing #then only command/exitCode/durationMs are kept", () => {
    // given
    const cmd = {
      command: "bun test",
      exitCode: 0,
      durationMs: 850,
      prompt: "run the suite",
      output: "699 tests passed",
    }
    // when
    const captured = captureCommandEvidence(cmd)
    // then
    expect(captured).toEqual({ command: "bun test", exitCode: 0, durationMs: 850 })
    expect("prompt" in captured).toBe(false)
    expect("output" in captured).toBe(false)
  })

  test("#given a command without optional fields #when capturing #then omitted fields stay undefined", () => {
    // when
    const captured = captureCommandEvidence({ command: "bun run typecheck" })
    // then
    expect(captured).toEqual({ command: "bun run typecheck" })
  })

  test("#given a test result with stdout #when capturing #then only allowed fields are kept", () => {
    // given
    const test = {
      name: "unit",
      command: "bun test",
      passed: 42,
      failed: 1,
      exitCode: 1,
      stdout: "FAIL 1 of 43",
      stderr: "trace...",
    }
    // when
    const captured = captureTestEvidence(test)
    // then
    expect(captured).toEqual({
      name: "unit",
      command: "bun test",
      passed: 42,
      failed: 1,
      exitCode: 1,
    })
    expect("stdout" in captured).toBe(false)
    expect("stderr" in captured).toBe(false)
  })

  test("#given two evidences for the same task #when recording #then both coexist with distinct evidenceIds", () => {
    // given
    const first = recordEvidence({
      taskGraphId: "tg_1",
      taskId: "T4",
      attempt: 1,
      executionId: "exec_A",
      agent: "nodejs-backend-developer",
    })
    const second = recordEvidence({
      taskGraphId: "tg_1",
      taskId: "T4",
      attempt: 1,
      executionId: "exec_A",
      agent: "nodejs-backend-developer",
    })
    // when
    const listed = listEvidence("tg_1", "T4")
    // then
    expect(first.evidenceId).not.toBe(second.evidenceId)
    expect(listed).toHaveLength(2)
    expect(listed.map((evidence) => evidence.evidenceId)).toContain(first.evidenceId)
    expect(listed.map((evidence) => evidence.evidenceId)).toContain(second.evidenceId)
  })
})
