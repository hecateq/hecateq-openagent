import { describe, expect, test } from "bun:test"
import {
  HecateqCompletionGate,
  assertTaskVerified,
  evaluationStatus,
  isExecutionCompletedEqualsTaskVerified,
  isTaskVerified,
} from "./completion-gate"
import type { HecateqTaskEvidence } from "./evidence-types"
import type { HecateqVerificationResult } from "./verifier-routing"

// ─── Shared fixtures ─────────────────────────────────────────────────────────

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

function makeVerification(
  overrides: Partial<HecateqVerificationResult> = {},
): HecateqVerificationResult {
  return {
    taskGraphId: "tg_1",
    taskId: "T4",
    attempt: 1,
    executionId: "exec_A",
    status: "verified",
    blockers: [],
    ...overrides,
  }
}

describe("hecateq completion gate", () => {
  describe("isTaskVerified", () => {
    test("#given no verification #when checking #then returns false", () => {
      // given
      const evidence = makeEvidence()
      // when
      const verified = isTaskVerified(evidence, null)
      // then
      expect(verified).toBe(false)
    })

    test("#given a rejected verification #when checking #then returns false", () => {
      // given
      const evidence = makeEvidence()
      const verification = makeVerification({
        status: "rejected",
        blockers: ["tests failed"],
      })
      // when
      const verified = isTaskVerified(evidence, verification)
      // then
      expect(verified).toBe(false)
    })

    test("#given an insufficient_evidence verification #when checking #then returns false", () => {
      // given
      const evidence = makeEvidence()
      const verification = makeVerification({
        status: "insufficient_evidence",
        blockers: ["no evidence recorded"],
      })
      // when
      const verified = isTaskVerified(evidence, verification)
      // then
      expect(verified).toBe(false)
    })

    test("#given verified status but stale evidence #when checking #then returns false", () => {
      // given — evidence belongs to an older execution than the verification
      const evidence = makeEvidence({ executionId: "exec_OLD" })
      const verification = makeVerification({ status: "verified" })
      // when
      const verified = isTaskVerified(evidence, verification)
      // then
      expect(verified).toBe(false)
    })

    test("#given verified status AND fresh evidence #when checking #then returns true", () => {
      // given
      const evidence = makeEvidence()
      const verification = makeVerification({ status: "verified" })
      // when
      const verified = isTaskVerified(evidence, verification)
      // then
      expect(verified).toBe(true)
    })
  })

  describe("isExecutionCompletedEqualsTaskVerified", () => {
    test("#given completed state but no verification #when comparing #then executionCompleted=true and taskVerified=false", () => {
      // when
      const result = isExecutionCompletedEqualsTaskVerified("completed", null)
      // then
      expect(result.executionCompleted).toBe(true)
      expect(result.taskVerified).toBe(false)
    })

    test("#given completed state with a verified result #when comparing #then both are true", () => {
      // when
      const result = isExecutionCompletedEqualsTaskVerified(
        "completed",
        makeVerification({ status: "verified" }),
      )
      // then
      expect(result.executionCompleted).toBe(true)
      expect(result.taskVerified).toBe(true)
    })

    test("#given active state with a verified result #when comparing #then executionCompleted=false and taskVerified=true", () => {
      // when
      const result = isExecutionCompletedEqualsTaskVerified(
        "active",
        makeVerification({ status: "verified" }),
      )
      // then
      expect(result.executionCompleted).toBe(false)
      expect(result.taskVerified).toBe(true)
    })
  })

  describe("evaluationStatus", () => {
    test("#given no verification #when evaluating #then returns insufficient_evidence", () => {
      // when
      const status = evaluationStatus(makeEvidence(), null)
      // then
      expect(status).toBe("insufficient_evidence")
    })

    test("#given verified status AND fresh evidence #when evaluating #then returns verified", () => {
      // when
      const status = evaluationStatus(
        makeEvidence(),
        makeVerification({ status: "verified" }),
      )
      // then
      expect(status).toBe("verified")
    })

    test("#given verified status but stale evidence #when evaluating #then returns stale_evidence", () => {
      // given — attempt mismatch makes the evidence stale
      const evidence = makeEvidence({ attempt: 2 })
      const verification = makeVerification({ attempt: 1, status: "verified" })
      // when
      const status = evaluationStatus(evidence, verification)
      // then
      expect(status).toBe("stale_evidence")
    })

    test("#given rejected verification #when evaluating #then returns rejected", () => {
      // when
      const status = evaluationStatus(
        makeEvidence(),
        makeVerification({ status: "rejected", blockers: ["lint failed"] }),
      )
      // then
      expect(status).toBe("rejected")
    })
  })

  describe("assertTaskVerified", () => {
    test("#given a verified task #when asserting #then no-op", () => {
      // when
      assertTaskVerified(makeEvidence(), makeVerification({ status: "verified" }))
      // then — no throw
    })

    test("#given an unverified task #when asserting #then throws TaskNotVerifiedError", () => {
      // given
      const evidence = makeEvidence()
      // when / then
      expect(() => assertTaskVerified(evidence, null)).toThrow(/not verified/)
    })
  })

  describe("HecateqCompletionGate composite", () => {
    test("#given the composite gate #then it exposes all four pure checks", () => {
      // then
      expect(typeof HecateqCompletionGate.isTaskVerified).toBe("function")
      expect(typeof HecateqCompletionGate.assertTaskVerified).toBe("function")
      expect(typeof HecateqCompletionGate.evaluationStatus).toBe("function")
      expect(
        typeof HecateqCompletionGate.isExecutionCompletedEqualsTaskVerified,
      ).toBe("function")
    })
  })
})
