import { describe, expect, test } from "bun:test"
import { resolveReviewerAgent } from "./reviewer-routing"

describe("resolveReviewerAgent", () => {
  test("#given reviewer in runtime registry #then reviewer_found", () => {
    // given
    const runtime = new Set(["planner", "reviewer", "executor"])
    // when
    const result = resolveReviewerAgent(runtime)
    // then
    expect(result.decision).toBe("reviewer_found")
    expect(result.reviewer).toBe("reviewer")
  })

  test("#given reviewer missing with candidates in agent index #then reviewer_blocked with candidates", () => {
    // given
    const runtime = new Set(["planner", "executor"])
    const agentIndex = {
      agents: [
        { name: "planner", enabled: true },
        { name: "code-reviewer", enabled: true },
        { name: "auditor", enabled: false },
      ],
    }
    // when
    const result = resolveReviewerAgent(runtime, agentIndex)
    // then
    expect(result.decision).toBe("reviewer_blocked")
    expect(result.candidates).toEqual(["planner", "code-reviewer"])
    expect(result.blocker).toContain("reviewer agent not found")
  })

  test("#given reviewer missing and no candidates #then reviewer_blocked with blocker", () => {
    // given
    const runtime = new Set(["planner", "executor"])
    // when
    const result = resolveReviewerAgent(runtime)
    // then
    expect(result.decision).toBe("reviewer_blocked")
    expect(result.candidates).toBeUndefined()
    expect(result.blocker).toBe("reviewer agent not found in runtime registry")
  })

  test("#given reviewer missing and empty agent index #then reviewer_blocked with blocker", () => {
    // given
    const runtime = new Set(["planner"])
    const agentIndex = { agents: [] }
    // when
    const result = resolveReviewerAgent(runtime, agentIndex)
    // then
    expect(result.decision).toBe("reviewer_blocked")
    expect(result.candidates).toBeUndefined()
    expect(result.blocker).toContain("reviewer agent not found")
  })

  test("#given any runtime registry #then momus is NEVER returned as reviewer", () => {
    // given
    const runtime = new Set(["planner", "momus", "reviewer"])
    // when
    const result = resolveReviewerAgent(runtime)
    // then
    expect(result.reviewer).toBe("reviewer")
    expect(result.reviewer).not.toBe("momus")
  })

  test("#given a runtime registry with only momus #then reviewer_blocked, never momus", () => {
    // given
    const runtime = new Set(["planner", "momus"])
    const agentIndex = { agents: [{ name: "momus", enabled: true }] }
    // when
    const result = resolveReviewerAgent(runtime, agentIndex)
    // then
    expect(result.decision).toBe("reviewer_blocked")
    expect(result.reviewer).toBeUndefined()
    expect(result.candidates).toBeUndefined()
    expect(result.blocker).toContain("reviewer agent not found")
  })
})
