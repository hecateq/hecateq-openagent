/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { TeamSpecSchema } from "../types"

import type { Member, TeamSpec } from "../types"
import {
  TeamSpecValidationError,
  validateDualSupport,
  validateMemberEligibility,
  validateSpec,
} from "./validator"

const PROMETHEUS_REJECTION_MESSAGE =
  "Agent 'prometheus' is plan-mode-only; can only write to .omo/*.md (enforced by prometheusMdOnly hook). Cannot write to team mailbox. Use delegate-task with subagent_type: 'plan' instead."

function createSubagentMember(name: string, subagentType = "sisyphus-junior"): Member {
  return {
    kind: "subagent_type",
    name,
    subagent_type: subagentType,
    prompt: `implement the assigned work for ${name}`,
    backendType: "in-process",
    isActive: true,
  }
}

function createBaseTeamSpec(): TeamSpec {
  return {
    version: 1,
    name: "validator-team",
    createdAt: 1,
    leadAgentId: "lead",
    members: [createSubagentMember("lead"), createSubagentMember("reviewer")],
  }
}

describe("team-registry validator", () => {
  test("rejects members that specify both category and subagent_type", () => {
    // given
    const teamSpec = {
      ...createBaseTeamSpec(),
      members: [
        {
          kind: "subagent_type",
          name: "lead",
          category: "deep",
          subagent_type: "sisyphus",
          prompt: "implement the assigned work for lead",
        },
      ],
    }

    // when
    const result = TeamSpecSchema.safeParse(teamSpec)

    // then
    expect(result.success).toBe(false)
  })

  test("rejects prometheus subagent members with the exact plan message", () => {
    // given
    const member: Member = {
      kind: "subagent_type",
      name: "planner",
      subagent_type: "prometheus",
      backendType: "in-process",
      isActive: true,
    }

    // when
    const act = () => validateMemberEligibility(member)

    // then
    expect(act).toThrow(PROMETHEUS_REJECTION_MESSAGE)
    expect(act).toThrow(TeamSpecValidationError)
  })

  test("accepts hephaestus subagent members after the D-36 eligibility change", () => {
    // given
    const member: Member = {
      kind: "subagent_type",
      name: "craftsman",
      subagent_type: "hephaestus",
      backendType: "in-process",
      isActive: true,
    }

    // when
    const act = () => validateMemberEligibility(member)

    // then
    expect(act).not.toThrow()
  })

  test("rejects leadAgentId values that do not match a member name", () => {
    // given
    const teamSpec = { ...createBaseTeamSpec(), leadAgentId: "ghost" }

    // when
    const act = () => validateSpec(teamSpec)

    // then
    expect(act).toThrow("Team 'validator-team' leadAgentId 'ghost' must match exactly one member.name.")
  })

  test("rejects duplicate member names within a team", () => {
    // given
    const duplicateMember = createSubagentMember("lead")
    const teamSpec = { ...createBaseTeamSpec(), members: [createSubagentMember("lead"), duplicateMember] }

    // when
    const act = () => validateSpec(teamSpec)

    // then
    expect(act).toThrow("Member name 'lead' is duplicated within team 'validator-team'. Member names must be unique.")
  })

  test("rejects teams that exceed the 8-member cap", () => {
    // given
    const teamSpec = {
      ...createBaseTeamSpec(),
      members: Array.from({ length: 9 }, (_, index) => createSubagentMember(`member-${index}`)),
      leadAgentId: "member-0",
    }

    // when
    const act = () => validateSpec(teamSpec)

    // then
    expect(act).toThrow("Team 'validator-team' exceeds max 8 members.")
  })

  test("accepts teams with exactly 8 members", () => {
    // given
    const teamSpec = {
      ...createBaseTeamSpec(),
      members: Array.from({ length: 8 }, (_, index) => createSubagentMember(`member-${index}`)),
      leadAgentId: "member-0",
    }

    // when
    const act = () => validateSpec(teamSpec)

    // then
    expect(act).not.toThrow()
  })

  test("rejects category prompts that collapse to empty text", () => {
    // given
    const member: Member = {
      kind: "subagent_type",
      name: "lead",
      subagent_type: "sisyphus-junior",
      prompt: "   ",
      backendType: "in-process",
      isActive: true,
    }

    // when
    const act = () => validateDualSupport(member)

    // then
    expect(act).toThrow("Member 'lead' prompt must not be empty after trimming whitespace.")
  })
})
