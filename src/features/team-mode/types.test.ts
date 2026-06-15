import { describe, expect, test } from "bun:test"
import {
  AGENT_ELIGIBILITY_REGISTRY,
  MemberSchema,
  parseMember,
  SubagentMemberSchema,
  TeamSpecSchema,
} from "./types"

describe("team-mode types", () => {
  test("member subagent_type branch parses and narrows", () => {
    // given
    const member = { kind: "subagent_type", name: "m1", subagent_type: "sisyphus", prompt: "impl X" }

    // when
    const result = MemberSchema.safeParse(member)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toMatchObject(member)
      expect(result.data).toMatchObject({ kind: "subagent_type", subagent_type: "sisyphus" })
    }
  })

  test("both kinds rejected", () => {
    // given
    const member = {
      kind: "subagent_type",
      name: "m1",
      category: "deep",
      subagent_type: "sisyphus",
      prompt: "impl X",
    }

    // when
    const result = MemberSchema.safeParse(member)

    // then
    expect(result.success).toBe(false)
  })

  test("parseMember emits exact missing kind error", () => {
    // given
    const member = { name: "m1" }

    // when
    try {
      parseMember(member)
    } catch (error) {
      // then
      expect(error instanceof Error ? error.message : String(error)).toBe(
        "Member 'm1' missing 'kind' discriminator and subagent_type. Specify {kind:'subagent_type', subagent_type}.",
      )
    }
  })

  test("parseMember emits exact unknown subagent error", () => {
    // given
    const member = { name: "m1", kind: "subagent_type", subagent_type: "foobar" }

    // when
    try {
      parseMember(member)
    } catch (error) {
      // then
      expect(error instanceof Error ? error.message : String(error)).toBe(
        "Unknown subagent_type 'foobar'. Available ELIGIBLE agents: sisyphus, hecateq-orchestrator, atlas, sisyphus-junior, hephaestus (if D-36 applied). Use delegate-task for read-only agents like oracle, librarian, explore, metis, momus, multimodal-looker.",
      )
    }
  })

  test("parseMember rejects hard-reject subagent types with exact messages", () => {
    // given
    const cases = [
      [
        "oracle",
        "Agent 'oracle' is read-only (cannot write files). Team members must write to mailbox inbox files. Use delegate-task with subagent_type: 'oracle' for read-only analysis instead.",
      ],
      [
        "librarian",
        "Agent 'librarian' is read-only (write/edit denied). Cannot write to mailbox as team member. Use delegate-task for research queries instead.",
      ],
      [
        "explore",
        "Agent 'explore' is read-only (write/edit denied). Cannot write to mailbox as team member. Use delegate-task for codebase exploration instead.",
      ],
      [
        "multimodal-looker",
        "Agent 'multimodal-looker' has read-only tool access (only 'read' allowed). Cannot write to mailbox as team member.",
      ],
      [
        "metis",
        "Agent 'metis' is read-only (pre-planning consultant). Cannot write to mailbox as team member. Use delegate-task for pre-planning analysis instead.",
      ],
      [
        "momus",
        "Agent 'momus' is read-only (plan reviewer). Cannot write to mailbox as team member. Use delegate-task for plan review instead.",
      ],
      [
        "prometheus",
        "Agent 'prometheus' is plan-mode-only; can only write to .omo/*.md (enforced by prometheusMdOnly hook). Cannot write to team mailbox. Use delegate-task with subagent_type: 'plan' instead.",
      ],
    ] as const

    // when
    for (const [subagentType, expectedMessage] of cases) {
      // then
      expect(() =>
        parseMember({ kind: "subagent_type", name: "x", subagent_type: subagentType }),
      ).toThrow(expectedMessage)
    }
  })

  test("parseMember returns valid subagent member", () => {
    // given
    const member = { name: "m1", kind: "subagent_type", subagent_type: "sisyphus" }

    // when
    const result = parseMember(member)

    // then
    expect(result).toMatchObject(member)
  })

  test("parseMember returns parsed hephaestus and atlas subagent members", () => {
    // given
    const hephaestusMember = { name: "m1", kind: "subagent_type", subagent_type: "hephaestus" }
    const atlasMember = { name: "m1", kind: "subagent_type", subagent_type: "atlas" }

    // when
    const hephaestusResult = parseMember(hephaestusMember)
    const atlasResult = parseMember(atlasMember)

    // then
    expect(hephaestusResult).toMatchObject(hephaestusMember)
    expect(atlasResult).toMatchObject(atlasMember)
  })

  test("parseMember returns parsed hecateq-orchestrator subagent member", () => {
    // given
    const member = { name: "m1", kind: "subagent_type", subagent_type: "hecateq-orchestrator" }

    // when
    const result = parseMember(member)

    // then
    expect(result).toMatchObject(member)
  })

  test("team spec defaults version when omitted", () => {
    // given
    const teamSpec = { name: "solo-team", members: [{ kind: "subagent_type", name: "solo", subagent_type: "sisyphus", prompt: "implement the assigned work" }] }

    // when
    const result = TeamSpecSchema.parse(teamSpec)

    // then
    expect(result.version).toBe(1)
    expect(result.leadAgentId).toBe("solo")
  })

  test("team spec defaults createdAt from Date.now when omitted", () => {
    // given
    const originalDateNow = Date.now
    Date.now = () => 123_456_789
    const teamSpec = { name: "solo-team", members: [{ kind: "subagent_type", name: "solo", subagent_type: "sisyphus", prompt: "implement the assigned work" }] }

    try {
      // when
      const result = TeamSpecSchema.parse(teamSpec)

      // then
      expect(result.createdAt).toBe(123_456_789)
    } finally {
      Date.now = originalDateNow
    }
  })

  test("team spec rejects multi-member configs without a lead hint", () => {
    // given
    const teamSpec = {
      name: "pair-team",
      members: [
        { kind: "subagent_type", name: "m1", subagent_type: "sisyphus", prompt: "implement the assigned work" },
        { kind: "subagent_type", name: "m2", subagent_type: "sisyphus-junior", prompt: "review the assigned work" },
      ],
    }

    // when
    const result = TeamSpecSchema.safeParse(teamSpec)

    // then
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues).toContainEqual(expect.objectContaining({
        path: ["leadAgentId"],
        message: "leadAgentId required (or write a `lead: {...}` field, or mark one member with `isLead: true`)",
      }))
    }
  })

  test("eligibility registry shape", () => {
    // given
    const entries = Object.entries(AGENT_ELIGIBILITY_REGISTRY)

    // when
    const verdictCounts = entries.reduce(
      (counts, [, value]) => {
        counts[value.verdict] += 1
        return counts
      },
      { eligible: 0, conditional: 0, "hard-reject": 0 },
    )

    // then
    expect(entries).toHaveLength(12)
    expect(verdictCounts).toEqual({ eligible: 4, conditional: 1, "hard-reject": 7 })
    expect(AGENT_ELIGIBILITY_REGISTRY["hecateq-orchestrator"]).toEqual({ verdict: "eligible" })
    expect(AGENT_ELIGIBILITY_REGISTRY.hephaestus.rejectionMessage).toBe(
      "Agent 'hephaestus' lacks teammate permission. Either apply D-36 (add teammate: \"allow\" in tool-config-handler.ts) or use subagent_type: \"sisyphus\" instead.",
    )
    expect(AGENT_ELIGIBILITY_REGISTRY.oracle.rejectionMessage).toBe(
      "Agent 'oracle' is read-only (cannot write files). Team members must write to mailbox inbox files. Use delegate-task with subagent_type: 'oracle' for read-only analysis instead.",
    )
    expect(AGENT_ELIGIBILITY_REGISTRY.librarian.rejectionMessage).toBe(
      "Agent 'librarian' is read-only (write/edit denied). Cannot write to mailbox as team member. Use delegate-task for research queries instead.",
    )
    expect(AGENT_ELIGIBILITY_REGISTRY.explore.rejectionMessage).toBe(
      "Agent 'explore' is read-only (write/edit denied). Cannot write to mailbox as team member. Use delegate-task for codebase exploration instead.",
    )
    expect(AGENT_ELIGIBILITY_REGISTRY["multimodal-looker"].rejectionMessage).toBe(
      "Agent 'multimodal-looker' has read-only tool access (only 'read' allowed). Cannot write to mailbox as team member.",
    )
    expect(AGENT_ELIGIBILITY_REGISTRY.metis.rejectionMessage).toBe(
      "Agent 'metis' is read-only (pre-planning consultant). Cannot write to mailbox as team member. Use delegate-task for pre-planning analysis instead.",
    )
    expect(AGENT_ELIGIBILITY_REGISTRY.momus.rejectionMessage).toBe(
      "Agent 'momus' is read-only (plan reviewer). Cannot write to mailbox as team member. Use delegate-task for plan review instead.",
    )
    expect(AGENT_ELIGIBILITY_REGISTRY.prometheus.rejectionMessage).toBe(
      "Agent 'prometheus' is plan-mode-only; can only write to .omo/*.md (enforced by prometheusMdOnly hook). Cannot write to team mailbox. Use delegate-task with subagent_type: 'plan' instead.",
    )
    expect(SubagentMemberSchema).toBeDefined()
  })
})
