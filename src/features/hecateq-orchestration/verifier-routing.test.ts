import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  _resetVerificationDirForTesting,
  _setVerificationDirForTesting,
  listVerificationResultsForExecution,
  readVerificationResult,
  recordVerificationResult,
  resolveVerifierAgent,
} from "./verifier-routing"
import type { HecateqVerificationResult } from "./verifier-routing"
import {
  _setHandoffHistoryFilePathForTesting,
  loadRecentRuntimeEvents,
} from "./handoff-history"

// ─── Shared fixtures ─────────────────────────────────────────────────────────

function makeVerificationResult(
  overrides: Partial<HecateqVerificationResult> = {},
): HecateqVerificationResult {
  return {
    resultId: "ver_fixture",
    taskGraphId: "tg_1",
    taskId: "T4",
    attempt: 1,
    executionId: "exec_A",
    status: "verified",
    blockers: [],
    createdAt: "2026-08-08T15:00:00.000Z",
    ...overrides,
  }
}

describe("hecateq verifier routing", () => {
  let dir: string
  let verificationDir: string
  let ledgerPath: string

  beforeEach(() => {
    // given a fresh temp verifications dir + ledger
    dir = mkdtempSync(join(tmpdir(), "hecateq-verification-"))
    verificationDir = join(dir, ".opencode", "state", "hecateq", "verifications")
    ledgerPath = join(dir, ".opencode", "state", "hecateq", "handoff-history.jsonl")
    _setVerificationDirForTesting(verificationDir)
    _setHandoffHistoryFilePathForTesting(ledgerPath)
  })

  afterEach(() => {
    _resetVerificationDirForTesting()
    _setHandoffHistoryFilePathForTesting(null)
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  describe("resolveVerifierAgent", () => {
    test("#given no input #when resolving #then returns qa-test-engineer by default", () => {
      // when
      const decision = resolveVerifierAgent()
      // then
      expect(decision.verifierAgent).toBe("qa-test-engineer")
      expect(decision.alternatives).toBeUndefined()
    })

    test("#given contract-like required checks #when resolving #then adds agent-contract-manager as alternative", () => {
      // given
      const input = {
        requiredChecks: [
          { kind: "contract", status: "passed" as const },
          { kind: "typecheck", status: "passed" as const },
        ],
      }
      // when
      const decision = resolveVerifierAgent(input)
      // then
      expect(decision.verifierAgent).toBe("qa-test-engineer")
      expect(decision.alternatives).toEqual(["agent-contract-manager"])
    })

    test("#given a review check #when resolving #then adds agent-contract-manager as alternative", () => {
      // given
      const input = {
        requiredChecks: [{ kind: "review", status: "failed" as const }],
      }
      // when
      const decision = resolveVerifierAgent(input)
      // then
      expect(decision.alternatives).toEqual(["agent-contract-manager"])
    })

    test("#given preferredAgents without contract checks #when resolving #then honors the first preferred agent", () => {
      // given
      const input = { preferredAgents: ["verifier-bot", "qa-test-engineer"] }
      // when
      const decision = resolveVerifierAgent(input)
      // then
      expect(decision.verifierAgent).toBe("verifier-bot")
      expect(decision.alternatives).toBeUndefined()
    })

    test("#given a preferred agent missing from the runtime registry #when resolving #then the exact agent is used with no category fallback", () => {
      // given — the exact preferred agent is NOT a registered runtime agent
      const input = { preferredAgents: ["qa-bot"] }
      // when
      const decision = resolveVerifierAgent(input)
      // then — the resolver never consults categories; the exact name wins, default is NOT substituted
      expect(decision.verifierAgent).toBe("qa-bot")
      expect(decision.alternatives).toBeUndefined()
      expect(decision.reason).toBe("preferred verifier agent: qa-bot")
    })

    test("#given preferredAgents containing momus #when resolving #then momus is silently excluded", () => {
      // given — momus must NEVER be returned as the verifier
      const input = { preferredAgents: ["momus"] }
      // when
      const decision = resolveVerifierAgent(input)
      // then
      expect(decision.verifierAgent).toBe("qa-test-engineer")
    })

    test("#given preferredAgents mixing momus with a valid agent #when resolving #then the valid agent wins", () => {
      // given
      const input = { preferredAgents: ["momus", "qa-test-engineer"] }
      // when
      const decision = resolveVerifierAgent(input)
      // then
      expect(decision.verifierAgent).toBe("qa-test-engineer")
    })

    test("#given contract checks plus momus in preferredAgents #when resolving #then neither the agent nor the alternative is momus", () => {
      // given
      const input = {
        preferredAgents: ["momus"],
        requiredChecks: [{ kind: "architecture", status: "unknown" as const }],
      }
      // when
      const decision = resolveVerifierAgent(input)
      // then
      expect(decision.verifierAgent).not.toBe("momus")
      expect(decision.alternatives ?? []).not.toContain("momus")
      expect(decision.verifierAgent).toBe("qa-test-engineer")
    })
  })

  describe("recordVerificationResult", () => {
    test("#given a valid result #when recording #then a JSON file is written and a handoff_created event is appended", () => {
      // given
      const input = makeVerificationResult()
      // when
      recordVerificationResult(input)
      // then
      expect(existsSync(join(verificationDir, "ver_fixture.json"))).toBe(true)
      const fileContent = JSON.parse(
        readFileSync(join(verificationDir, "ver_fixture.json"), "utf-8"),
      ) as Record<string, unknown>
      expect(fileContent.taskGraphId).toBe("tg_1")
      expect(fileContent.taskId).toBe("T4")
      expect(fileContent.attempt).toBe(1)
      expect(fileContent.executionId).toBe("exec_A")
      expect(fileContent.status).toBe("verified")

      const events = loadRecentRuntimeEvents(10)
      const created = events.find((event) => event.event === "handoff_created")
      expect(created).toBeDefined()
      expect(created?.reason).toBe("verification:verified")
      expect(created?.execution_id).toBe("exec_A")
      expect(created?.task_id).toBe("T4")
      expect(created?.attempt).toBe(1)
    })

    test("#given a rejected result #when recording #then the ledger reason reflects the status", () => {
      // given
      const input = makeVerificationResult({
        resultId: "ver_rejected",
        status: "rejected",
        blockers: ["tests failed"],
      })
      // when
      recordVerificationResult(input)
      // then
      const events = loadRecentRuntimeEvents(10)
      const created = events.find((event) => event.event === "handoff_created")
      expect(created?.reason).toBe("verification:rejected")
    })

    test("#given a result without resultId #when recording #then an id is generated", () => {
      // given
      const input = makeVerificationResult({ resultId: undefined })
      // when
      recordVerificationResult(input)
      // then
      const listed = listVerificationResultsForExecution("exec_A")
      expect(listed).toHaveLength(1)
      expect(listed[0]?.resultId).toBeDefined()
      expect(existsSync(join(verificationDir, `${listed[0]?.resultId}.json`))).toBe(true)
    })
  })

  describe("readVerificationResult", () => {
    test("#given a recorded result #when reading by id #then the record round-trips", () => {
      // given
      const input = makeVerificationResult({
        notes: "all checks passed",
        blockers: [],
      })
      recordVerificationResult(input)
      // when
      const loaded = readVerificationResult("ver_fixture")
      // then
      expect(loaded).not.toBeNull()
      expect(loaded).toEqual(input)
    })

    test("#given a missing id #when reading #then returns null", () => {
      // when
      const loaded = readVerificationResult("ver_missing")
      // then
      expect(loaded).toBeNull()
    })
  })

  describe("listVerificationResultsForExecution", () => {
    test("#given results for two executions #when listing #then only that execution's results are returned", () => {
      // given
      recordVerificationResult(
        makeVerificationResult({ resultId: "ver_a1", executionId: "exec_A" }),
      )
      recordVerificationResult(
        makeVerificationResult({
          resultId: "ver_a2",
          executionId: "exec_A",
          status: "rejected",
          blockers: ["flaky test"],
          createdAt: "2026-08-08T15:01:00.000Z",
        }),
      )
      recordVerificationResult(
        makeVerificationResult({ resultId: "ver_b1", executionId: "exec_B" }),
      )
      // when
      const listed = listVerificationResultsForExecution("exec_A")
      // then
      expect(listed.map((result) => result.resultId).sort()).toEqual(
        ["ver_a1", "ver_a2"].sort(),
      )
    })

    test("#given multiple results for the same execution #when listing #then all coexist with distinct ids", () => {
      // given
      recordVerificationResult(
        makeVerificationResult({ resultId: "ver_x1", executionId: "exec_A" }),
      )
      recordVerificationResult(
        makeVerificationResult({ resultId: "ver_x2", executionId: "exec_A" }),
      )
      recordVerificationResult(
        makeVerificationResult({ resultId: "ver_x3", executionId: "exec_A" }),
      )
      // when
      const listed = listVerificationResultsForExecution("exec_A")
      // then
      expect(listed).toHaveLength(3)
      expect(listed.map((result) => result.resultId)).toEqual([
        "ver_x1",
        "ver_x2",
        "ver_x3",
      ])
    })
  })
})
