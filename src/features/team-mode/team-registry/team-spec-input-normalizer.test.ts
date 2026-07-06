/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { resolveCallerTeamLead } from "../resolve-caller-team-lead"
import { normalizeTeamSpecInput } from "./team-spec-input-normalizer"

describe("normalizeTeamSpecInput", () => {
  test("injects the caller as lead when no lead is specified", () => {
    // given
    const rawSpec = {
      name: "alpha-team",
      members: [{ kind: "subagent_type", subagent_type: "sisyphus", prompt: "Inspect the workspace" }],
    }

    // when
    const normalizedSpec = normalizeTeamSpecInput(rawSpec, {
      callerTeamLead: resolveCallerTeamLead("\u200BSisyphus - Ultraworker"),
    })

    // then
    expect(normalizedSpec).toMatchObject({
      leadAgentId: "lead",
      members: [
        { name: "lead", kind: "subagent_type", subagent_type: "sisyphus" },
        { name: "sisyphus-1", kind: "subagent_type", subagent_type: "sisyphus" },
      ],
    })
  })

  test("keeps an explicit leadAgentId unchanged when the caller is eligible", () => {
    // given
    const rawSpec = {
      name: "alpha-team",
      leadAgentId: "captain",
      members: [
        { kind: "subagent_type", name: "captain", subagent_type: "atlas" },
        { kind: "subagent_type", name: "member-1", subagent_type: "sisyphus-junior", prompt: "Inspect the workspace" },
      ],
    }

    // when
    const normalizedSpec = normalizeTeamSpecInput(rawSpec, {
      callerTeamLead: resolveCallerTeamLead("Sisyphus - Ultraworker"),
    })

    // then
    expect(normalizedSpec).toEqual(rawSpec)
  })

  test("prefers isLead over the caller when both are present", () => {
    // given
    const rawSpec = {
      name: "alpha-team",
      members: [
        { kind: "subagent_type", name: "captain", subagent_type: "atlas", isLead: true },
        { kind: "subagent_type", subagent_type: "sisyphus-junior", prompt: "Inspect the workspace" },
      ],
    }

    // when
    const normalizedSpec = normalizeTeamSpecInput(rawSpec, {
      callerTeamLead: resolveCallerTeamLead("Sisyphus - Ultraworker"),
    })

    // then
    expect(normalizedSpec).toMatchObject({
      leadAgentId: "captain",
      members: [
        { kind: "subagent_type", name: "captain", subagent_type: "atlas" },
        { kind: "subagent_type", name: "sisyphus-junior-1", subagent_type: "sisyphus-junior" },
      ],
    })
  })

  test("throws a clear error when the caller is not eligible and no lead is specified", () => {
    // given
    const rawSpec = {
      name: "alpha-team",
      members: [{ kind: "subagent_type", subagent_type: "sisyphus", prompt: "Inspect the workspace" }],
    }

    // when
    const result = () => normalizeTeamSpecInput(rawSpec, {
      callerTeamLead: resolveCallerTeamLead("explore"),
    })

    // then
    expect(result).toThrow("Caller agent explore is not eligible as team lead; specify leadAgentId explicitly")
  })

  test("still requires an eligible caller or explicit lead for 8 inline members", () => {
    // given
    const rawSpec = {
      name: "eight-member-team",
      members: Array.from({ length: 8 }, () => ({
        subagent_type: "sisyphus-junior",
        prompt: "Complete one validation task.",
      })),
    }

    // when
    const result = () => normalizeTeamSpecInput(rawSpec, {
      callerTeamLead: resolveCallerTeamLead("explore"),
    })

    // then
    expect(result).toThrow("Caller agent explore is not eligible as team lead; specify leadAgentId explicitly")
  })

  test("normalizes natural inline names to schema-safe names", () => {
    // given
    const rawSpec = {
      name: "Project Analysis Team",
      leadAgentId: "Agent Lead",
      members: [
        { kind: "subagent_type", name: "Agent Lead", subagent_type: "atlas", prompt: "Lead the analysis work" },
        { kind: "subagent_type", name: "Agent 1: Structure Analyst", subagent_type: "sisyphus-junior", prompt: "Inspect the workspace" },
        { kind: "subagent_type", name: "Agent 1 Structure Analyst", subagent_type: "sisyphus-junior", prompt: "Inspect related tests" },
      ],
    }

    // when
    const normalizedSpec = normalizeTeamSpecInput(rawSpec, {
      callerTeamLead: resolveCallerTeamLead("Sisyphus - Ultraworker"),
    })

    // then
    expect(normalizedSpec).toMatchObject({
      name: "project-analysis-team",
      leadAgentId: "agent-lead",
      members: [
        { name: "agent-lead" },
        { name: "agent-1-structure-analyst" },
        { name: "agent-1-structure-analyst-2" },
      ],
    })
  })

  test("leaves subagent_type empty for role-only natural members (validator rejects)", () => {
    // given
    const rawSpec = {
      name: "analysis-team",
      members: [
        { name: "Structure Analyst", role: "Structure Analyst", capabilities: ["structure", "modules"] },
      ],
    }

    // when
    const normalizedSpec = normalizeTeamSpecInput(rawSpec, {
      callerTeamLead: resolveCallerTeamLead("Sisyphus - Ultraworker"),
      defaultCategoryName: "sisyphus-junior",
    }) as { members: Array<{ name: string; kind: string; subagent_type: string; prompt: string }> }

    // then
    // defaultCategoryName is no longer injected — subagent_type is left empty for the validator to catch
    const naturalMember = normalizedSpec.members.find((m) => m.name === "structure-analyst")
    expect(naturalMember).toBeDefined()
    expect(naturalMember!.kind).toBe("subagent_type")
    expect(naturalMember!.subagent_type).toBe("")
    expect(naturalMember!.prompt).toMatch(/Structure Analyst/)
  })

  test("uses the first generated member as lead when 8 inline members leave no room for implicit lead injection", () => {
    // given
    const rawSpec = {
      name: "eight-member-team",
      members: Array.from({ length: 8 }, () => ({
        subagent_type: "sisyphus-junior",
        prompt: "Complete one validation task.",
      })),
    }

    // when
    const normalizedSpec = normalizeTeamSpecInput(rawSpec, {
      callerTeamLead: resolveCallerTeamLead("Sisyphus - Ultraworker"),
    })

    // then
    expect(normalizedSpec).toMatchObject({
      leadAgentId: "sisyphus-junior-1",
      members: [
        { name: "sisyphus-junior-1", kind: "subagent_type" },
        { name: "sisyphus-junior-2", kind: "subagent_type" },
        { name: "sisyphus-junior-3", kind: "subagent_type" },
        { name: "sisyphus-junior-4", kind: "subagent_type" },
        { name: "sisyphus-junior-5", kind: "subagent_type" },
        { name: "sisyphus-junior-6", kind: "subagent_type" },
        { name: "sisyphus-junior-7", kind: "subagent_type" },
        { name: "sisyphus-junior-8", kind: "subagent_type" },
      ],
    })
  })
})
