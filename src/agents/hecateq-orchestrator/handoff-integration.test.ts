import { describe, expect, it } from "bun:test"
import {
  consumeHandoffResponse,
  formatHandoffDecisionForPrompt,
  mapRoutingKindToAction,
} from "./handoff-integration"
import type { HandoffDecision } from "./handoff-integration"
import type { HecateqOrchestratorContext } from "./agent"
import { createHecateqOrchestratorAgent } from "./agent"
import { HECATEQ_HANDOFF_PROTOCOL } from "./default"
import { buildHecateqPromptPack } from "./prompt-pack"
import {
  decideRouting,
  createDefaultHandoffBlock,
} from "../../features/hecateq-orchestration"

const emptyContext: HecateqOrchestratorContext = {}

describe("consumeHandoffResponse", () => {
  // given: agent response with a valid handoff block
  describe("#given agent response with a valid DONE handoff block", () => {
    const response = `Task completed successfully.

Files changed:
- src/foo.ts — implemented feature X

STATUS: DONE
SIGNALS_EMITTED: [{"signal":"backend_ready","payload":{"endpoints_created":3}}]
HANDOFF: return_to_caller
NEXT_RECOMMENDED_AGENT: qa-test-engineer`

    it("#then returns action continue with parsed handoff and signals", () => {
      // when
      const decision = consumeHandoffResponse(response, emptyContext)

      // then
      expect(decision.action).toBe("continue")
      expect(decision.reason).toContain("return to caller")
      expect(decision.rawSignals).toHaveLength(1)
      expect(decision.rawSignals[0].signal).toBe("backend_ready")
      expect(decision.parsedHandoff).toBeDefined()
      expect(decision.parsedHandoff!.status).toBe("DONE")
      expect(decision.parsedHandoff!.nextRecommendedAgent).toBe("qa-test-engineer")
    })
  })

  // given: agent response with STATUS: BLOCKED
  describe("#given agent response with STATUS: BLOCKED", () => {
    const response = `Could not proceed.

STATUS: BLOCKED
SIGNALS_EMITTED: []
HANDOFF: return_to_parent_for_routing
BLOCKERS: ["missing API key", "no database connection"]`

    it("#then returns action blocked with blockers in parsed handoff", () => {
      // when
      const decision = consumeHandoffResponse(response, emptyContext)

      // then
      expect(decision.action).toBe("blocked")
      expect(decision.reason).toContain("BLOCKED")
      expect(decision.parsedHandoff).toBeDefined()
      expect(decision.parsedHandoff!.status).toBe("BLOCKED")
      expect(decision.parsedHandoff!.blockers).toContain("missing API key")
    })
  })

  // given: agent response with return_to_parent_for_routing
  describe("#given agent response with return_to_parent_for_routing", () => {
    const response = `Routing to parent for decision.

STATUS: DONE
SIGNALS_EMITTED: [{"signal":"tests_passed","payload":{"coverage":95}}]
HANDOFF: return_to_parent_for_routing`

    it("#then returns action reroute with signals", () => {
      // when
      const decision = consumeHandoffResponse(response, emptyContext)

      // then
      expect(decision.action).toBe("reroute")
      expect(decision.reason).toContain("parent")
      expect(decision.rawSignals).toHaveLength(1)
      expect(decision.rawSignals[0].signal).toBe("tests_passed")
    })
  })

  // given: agent response with no handoff block
  describe("#given agent response without any handoff block", () => {
    const response = `Task completed. All tests pass. No structured handoff block in this response.`

    it("#then returns action continue with no parsed handoff", () => {
      // when
      const decision = consumeHandoffResponse(response, emptyContext)

      // then
      expect(decision.action).toBe("continue")
      expect(decision.parsedHandoff).toBeUndefined()
      expect(decision.rawSignals).toHaveLength(0)
    })
  })

  // given: malformed handoff block with invalid JSON in signals
  describe("#given agent response with malformed SIGNALS_EMITTED JSON", () => {
    const response = `Task done.

STATUS: DONE
SIGNALS_EMITTED: not-json-at-all
HANDOFF: return_to_caller`

    it("#then returns action continue with validation issues in parsed handoff", () => {
      // when
      const decision = consumeHandoffResponse(response, emptyContext)

      // then
      expect(decision.action).toBe("continue")
      expect(decision.parsedHandoff).toBeDefined()
      expect(decision.parsedHandoff!.validationIssues.length).toBeGreaterThan(0)
      expect(decision.parsedHandoff!.validationIssues.some(
        (v) => v.field === "SIGNALS_EMITTED"
      )).toBe(true)
    })
  })

  // given: agent response with unknown handoff target
  describe("#given agent response with unknown handoff target", () => {
    const response = `Delegating to unknown agent.

STATUS: DONE
HANDOFF: some_mystery_agent`

    it("#then returns action reroute with unknown target fallback", () => {
      // when
      const decision = consumeHandoffResponse(response, emptyContext)

      // then
      expect(decision.action).toBe("reroute")
      expect(decision.reason).toContain("not a known agent ID")
      expect(decision.targetAgent).toBe("some_mystery_agent")
    })
  })
})

describe("formatHandoffDecisionForPrompt", () => {
  // given: a continue decision with parsed handoff
  describe("#given a continue decision with parsed handoff", () => {
    const decision: HandoffDecision = {
      action: "continue",
      reason: "Agent explicitly requested return to caller",
      parsedHandoff: {
        status: "DONE",
        signals: [{ signal: "backend_ready", payload: { endpoints_created: 3 } }],
        handoff: "return_to_caller",
        confidence: null,
        changedFiles: [],
        qualityNotes: null,
        blockers: [],
        nextRecommendedAgent: "qa-test-engineer",
        validationIssues: [],
        raw: "STATUS: DONE\nHANDOFF: return_to_caller",
      },
      rawSignals: [{ signal: "backend_ready", payload: { endpoints_created: 3 } }],
    }

    it("#then produces XML block with action attribute", () => {
      // when
      const result = formatHandoffDecisionForPrompt(decision)

      // then
      expect(result).toContain('<handoff_decision action="continue">')
      expect(result).toContain("</handoff_decision>")
    })

    it("#then includes reason and status", () => {
      // when
      const result = formatHandoffDecisionForPrompt(decision)

      // then
      expect(result).toContain("<reason>Agent explicitly requested return to caller</reason>")
      expect(result).toContain("<status>DONE</status>")
    })

    it("#then includes next recommended agent", () => {
      // when
      const result = formatHandoffDecisionForPrompt(decision)

      // then
      expect(result).toContain("<next_recommended_agent>qa-test-engineer</next_recommended_agent>")
    })

    it("#then includes signal names", () => {
      // when
      const result = formatHandoffDecisionForPrompt(decision)

      // then
      expect(result).toContain("<signals>backend_ready</signals>")
    })
  })

  // given: a blocked decision with target agent
  describe("#given a blocked decision with target agent and blockers", () => {
    const decision: HandoffDecision = {
      action: "blocked",
      targetAgent: "security-architect",
      reason: "Role policy violation: orchestrator cannot handoff to security-architect",
      parsedHandoff: {
        status: "BLOCKED",
        signals: [],
        handoff: "security-architect",
        confidence: null,
        changedFiles: [],
        qualityNotes: null,
        blockers: ["role policy violation"],
        nextRecommendedAgent: null,
        validationIssues: [],
        raw: "STATUS: BLOCKED\nHANDOFF: security-architect",
      },
      rawSignals: [],
    }

    it("#then includes target agent and blockers", () => {
      // when
      const result = formatHandoffDecisionForPrompt(decision)

      // then
      expect(result).toContain('<handoff_decision action="blocked">')
      expect(result).toContain("<target_agent>security-architect</target_agent>")
      expect(result).toContain("<blockers>role policy violation</blockers>")
    })

    it("#then includes BLOCKED status", () => {
      // when
      const result = formatHandoffDecisionForPrompt(decision)

      // then
      expect(result).toContain("<status>BLOCKED</status>")
    })
  })

  // given: a minimal decision with no optional fields
  describe("#given a minimal decision with no optional fields", () => {
    const decision: HandoffDecision = {
      action: "stop",
      reason: "Unknown routing decision kind encountered",
      rawSignals: [],
    }

    it("#then produces minimal XML without optional elements", () => {
      // when
      const result = formatHandoffDecisionForPrompt(decision)

      // then
      expect(result).toContain('<handoff_decision action="stop">')
      expect(result).toContain("<reason>Unknown routing decision kind encountered</reason>")
      expect(result).not.toContain("<target_agent>")
      expect(result).not.toContain("<status>")
      expect(result).not.toContain("<signals>")
    })
  })
})

describe("prompt includes handoff protocol section", () => {
  // given: prompt pack assembled with handoff protocol
  describe("#given handoffProtocolSection is provided to prompt pack", () => {
    const baseInput = {
      customAgentRegistrySection: "",
      taskToolNote: "Use task() for delegation",
      profileDetection: {
        prompt_profile: "auto" as const,
        model: "openai/gpt-5.4",
      },
    }

    it("#then generated prompt contains HANDOFF PROTOCOL header", () => {
      // when — without handoff protocol
      const withoutHandoff = buildHecateqPromptPack(baseInput)
      expect(withoutHandoff).not.toContain("HANDOFF PROTOCOL")

      // when — with handoff protocol
      const withHandoff = buildHecateqPromptPack({
        ...baseInput,
        handoffProtocolSection: HECATEQ_HANDOFF_PROTOCOL,
      })
      // then
      expect(withHandoff).toContain("HANDOFF PROTOCOL")
    })

    it("#then includes handoff decision table", () => {
      // when
      const prompt = buildHecateqPromptPack({
        ...baseInput,
        handoffProtocolSection: HECATEQ_HANDOFF_PROTOCOL,
      })

      // then
      expect(prompt).toContain("STATUS: BLOCKED")
      expect(prompt).toContain("return_to_caller")
      expect(prompt).toContain("Routing Policy Engine")
      expect(prompt).toContain("HandoffDecision")
    })

    it("#then includes signal integration section", () => {
      // when
      const prompt = buildHecateqPromptPack({
        ...baseInput,
        handoffProtocolSection: HECATEQ_HANDOFF_PROTOCOL,
      })

      // then
      expect(prompt).toContain("Signal Integration")
      expect(prompt).toContain("<namespace>:<action>")
    })
  })

  // given: HECATEQ_HANDOFF_PROTOCOL constant exists
  describe("#given the HECATEQ_HANDOFF_PROTOCOL constant", () => {
    it("#then is a non-empty string", () => {
      expect(typeof HECATEQ_HANDOFF_PROTOCOL).toBe("string")
      expect(HECATEQ_HANDOFF_PROTOCOL.length).toBeGreaterThan(100)
    })

    it("#then describes emitting handoff blocks", () => {
      expect(HECATEQ_HANDOFF_PROTOCOL).toContain("Emitting Handoff")
    })

    it("#then describes consuming handoff blocks", () => {
      expect(HECATEQ_HANDOFF_PROTOCOL).toContain("Consuming Handoff")
    })

    it("#then describes routing policy engine decisions", () => {
      expect(HECATEQ_HANDOFF_PROTOCOL).toContain("return_to_caller")
      expect(HECATEQ_HANDOFF_PROTOCOL).toContain("invalid_target_blocked")
    })
  })
})

// ─── Routing Decision Mapping ─────────────────────────────────────────────────

describe("mapRoutingKindToAction", () => {
  // given: each RoutingDecisionKind value
  describe("#given return_to_caller routing kind", () => {
    it("#then maps to continue action", () => {
      // when
      const action = mapRoutingKindToAction("return_to_caller")
      // then
      expect(action).toBe("continue")
    })
  })

  describe("#given return_to_parent_for_routing routing kind", () => {
    it("#then maps to reroute action", () => {
      // when
      const action = mapRoutingKindToAction("return_to_parent_for_routing")
      // then
      expect(action).toBe("reroute")
    })
  })

  describe("#given invalid_target_blocked routing kind", () => {
    it("#then maps to blocked action", () => {
      // when
      const action = mapRoutingKindToAction("invalid_target_blocked")
      // then
      expect(action).toBe("blocked")
    })
  })

  describe("#given no_handoff_data routing kind", () => {
    it("#then maps to continue action", () => {
      // when
      const action = mapRoutingKindToAction("no_handoff_data")
      // then
      expect(action).toBe("continue")
    })
  })

  describe("#given unknown_target_fallback routing kind", () => {
    it("#then maps to reroute action", () => {
      // when
      const action = mapRoutingKindToAction("unknown_target_fallback")
      // then
      expect(action).toBe("reroute")
    })
  })

  describe("#given role_policy_violation routing kind", () => {
    it("#then maps to blocked action", () => {
      // when
      const action = mapRoutingKindToAction("role_policy_violation")
      // then
      expect(action).toBe("blocked")
    })
  })
})

// ─── formatHandoffDecisionForPrompt — additional action type tests ────────────

describe("formatHandoffDecisionForPrompt action-specific XML", () => {
  // given: a reroute decision with target agent
  describe("#given a reroute decision with target agent", () => {
    const decision: HandoffDecision = {
      action: "reroute",
      targetAgent: "qa-test-engineer",
      reason: "Agent requested parent-level routing",
      rawSignals: [],
    }

    it("#then produces reroute action XML tag", () => {
      // when
      const result = formatHandoffDecisionForPrompt(decision)
      // then
      expect(result).toContain('<handoff_decision action="reroute">')
      expect(result).toContain("</handoff_decision>")
    })

    it("#then includes target_agent tag", () => {
      // when
      const result = formatHandoffDecisionForPrompt(decision)
      // then
      expect(result).toContain("<target_agent>qa-test-engineer</target_agent>")
    })
  })

  // given: all four action types produce correctly tagged XML
  describe("#given each action type", () => {
    const actions: HandoffDecision["action"][] = ["continue", "reroute", "stop", "blocked"]

    for (const action of actions) {
      it(`#then ${action} produces <handoff_decision action="${action}">`, () => {
        // when
        const result = formatHandoffDecisionForPrompt({
          action,
          reason: "Test reason",
          rawSignals: [],
        })
        // then
        expect(result).toContain(`<handoff_decision action="${action}">`)
      })
    }
  })
})

// ─── End-to-End Scenario Tests ───────────────────────────────────────────────

describe("end-to-end handoff scenarios", () => {
  // given: DONE status with return_to_caller handoff
  describe("#given DONE status with return_to_caller handoff", () => {
    const response = `All tests pass.

Files changed:
- src/auth.ts — fixed login redirect bug

STATUS: DONE
SIGNALS_EMITTED: [{"signal":"tests_passed","payload":{"pass":42,"fail":0}}]
HANDOFF: return_to_caller`

    it("#then returns continue action and preserves handoff target in targetAgent", () => {
      // when
      const decision = consumeHandoffResponse(response, emptyContext)
      // then — action is continue, meaning no rerouting needed
      expect(decision.action).toBe("continue")
      // targetAgent reflects original handoff target (routing directive)
      expect(decision.targetAgent).toBe("return_to_caller")
      expect(decision.parsedHandoff).toBeDefined()
      expect(decision.parsedHandoff!.status).toBe("DONE")
      expect(decision.parsedHandoff!.handoff).toBe("return_to_caller")
    })
  })

  // given: IN_PROGRESS status with return_to_parent_for_routing and next agent
  describe("#given IN_PROGRESS status with parent routing and next agent", () => {
    const response = `Partial implementation completed.

STATUS: IN_PROGRESS
SIGNALS_EMITTED: [{"signal":"backend_ready","payload":{"endpoints":["POST /api/users"]}}]
HANDOFF: return_to_parent_for_routing
NEXT_RECOMMENDED_AGENT: qa-test-engineer`

    it("#then returns reroute action with next recommended agent in parsed handoff", () => {
      // when
      const decision = consumeHandoffResponse(response, emptyContext)
      // then
      expect(decision.action).toBe("reroute")
      expect(decision.reason).toContain("parent")
      expect(decision.parsedHandoff).toBeDefined()
      expect(decision.parsedHandoff!.status).toBe("IN_PROGRESS")
      expect(decision.parsedHandoff!.nextRecommendedAgent).toBe("qa-test-engineer")
      expect(decision.rawSignals).toHaveLength(1)
      expect(decision.rawSignals[0].signal).toBe("backend_ready")
    })
  })

  // given: BLOCKED status with blockers list
  describe("#given BLOCKED status with blockers list", () => {
    const response = `Cannot complete the task.

STATUS: BLOCKED
HANDOFF: return_to_parent_for_routing
BLOCKERS: ["Missing API credentials", "Database connection refused", "Unresolved merge conflict"]`

    it("#then returns blocked action with all blockers captured", () => {
      // when
      const decision = consumeHandoffResponse(response, emptyContext)
      // then
      expect(decision.action).toBe("blocked")
      expect(decision.reason).toContain("BLOCKED")
      expect(decision.parsedHandoff).toBeDefined()
      expect(decision.parsedHandoff!.blockers).toHaveLength(3)
      expect(decision.parsedHandoff!.blockers).toContain("Missing API credentials")
      expect(decision.parsedHandoff!.blockers).toContain("Database connection refused")
      expect(decision.parsedHandoff!.blockers).toContain("Unresolved merge conflict")
    })
  })

  // given: response with multiple signals
  describe("#given response with 3+ signals emitted", () => {
    const response = `Multi-signal completion.

STATUS: DONE
SIGNALS_EMITTED: [{"signal":"schema_ready","payload":{"tables":["users","orders"]}},{"signal":"backend_ready","payload":{"endpoints_created":5}},{"signal":"tests_passed","payload":{"coverage":92}}]
HANDOFF: return_to_caller`

    it("#then all signals are captured in rawSignals", () => {
      // when
      const decision = consumeHandoffResponse(response, emptyContext)
      // then
      expect(decision.rawSignals).toHaveLength(3)
      const signalNames = decision.rawSignals.map((s) => s.signal)
      expect(signalNames).toContain("schema_ready")
      expect(signalNames).toContain("backend_ready")
      expect(signalNames).toContain("tests_passed")
    })
  })

  // given: response with no handoff block at all
  describe("#given response with no handoff block", () => {
    const response = `Done with the task. Everything looks good. No structured metadata here.`

    it("#then returns continue with empty parsedHandoff", () => {
      // when
      const decision = consumeHandoffResponse(response, emptyContext)
      // then
      expect(decision.action).toBe("continue")
      expect(decision.parsedHandoff).toBeUndefined()
      expect(decision.rawSignals).toHaveLength(0)
    })
  })
})

// ─── Edge Case Tests ─────────────────────────────────────────────────────────

describe("edge cases", () => {
  // given: empty string response
  describe("#given empty string response", () => {
    it("#then returns continue with empty parsedHandoff", () => {
      // when
      const decision = consumeHandoffResponse("", emptyContext)
      // then
      expect(decision.action).toBe("continue")
      expect(decision.parsedHandoff).toBeUndefined()
      expect(decision.rawSignals).toHaveLength(0)
    })
  })

  // given: malformed handoff block
  describe("#given malformed handoff block with typos and unclosed tags", () => {
    const response = `Task done.

STATUS: DUN
SIGNAL_EMITTED: [{"signal":"test"}]
HANDOF: return_to_caller`

    it("#then does not throw and returns a graceful continue decision", () => {
      // when
      const decision = consumeHandoffResponse(response, emptyContext)
      // then — gracefully handles malformed fields without throwing
      expect(decision.action).toBe("continue")
      // STATUS: DUN is not a valid status (DUN !== DONE), so handoff is empty
      // SIGNAL_EMITTED: prefix doesn't match parser's SIGNALS_EMITTED:
      // HANDOF: prefix doesn't match parser's HANDOFF:
      // All malformed fields produce a benign fallback to "continue"
      expect(decision.rawSignals).toHaveLength(0)
      expect(decision.reason).toBeTruthy()
    })
  })

  // given: very long response
  describe("#given response with very long content", () => {
    const longBody = "A".repeat(10000)
    const response = `${longBody}

STATUS: DONE
HANDOFF: return_to_caller`

    it("#then does not hang or crash and returns continue", () => {
      // when
      const decision = consumeHandoffResponse(response, emptyContext)
      // then
      expect(decision.action).toBe("continue")
      expect(decision.parsedHandoff).toBeDefined()
      expect(decision.parsedHandoff!.status).toBe("DONE")
      expect(decision.parsedHandoff!.raw.length).toBeGreaterThan(10000)
    })
  })

  // given: unicode content in handoff
  describe("#given response with unicode in handoff", () => {
    const response = `Task with unicode.

STATUS: DONE
SIGNALS_EMITTED: [{"signal":"backend_ready","payload":{"label":"ünicödé täsk"}}]
HANDOFF: return_to_caller
NEXT_RECOMMENDED_AGENT: ünicödé-ägënt`

    it("#then unicode signals are preserved correctly", () => {
      // when
      const decision = consumeHandoffResponse(response, emptyContext)
      // then
      expect(decision.action).toBe("continue")
      expect(decision.rawSignals).toHaveLength(1)
      expect(decision.rawSignals[0].payload.label).toBe("ünicödé täsk")
      expect(decision.parsedHandoff).toBeDefined()
      expect(decision.parsedHandoff!.nextRecommendedAgent).toBe("ünicödé-ägënt")
    })
  })
})

// ─── createHecateqOrchestratorAgent Prompt Injection Tests ────────────────────

describe("createHecateqOrchestratorAgent prompt injection", () => {
  // given: minimal agent config
  describe("#given minimal agent config", () => {
    const agent = createHecateqOrchestratorAgent("anthropic/claude-sonnet-4-6")
    const prompt = agent.prompt

    it("#then prompt includes HANDOFF PROTOCOL section", () => {
      expect(prompt).toContain("HANDOFF PROTOCOL")
    })

    it("#then prompt includes how to emit handoff blocks guidance", () => {
      expect(prompt).toContain("Emitting Handoff")
    })

    it("#then prompt includes how to parse handoff blocks guidance", () => {
      expect(prompt).toContain("Consuming Handoff")
    })

    it("#then prompt includes HandoffDecision reference", () => {
      expect(prompt).toContain("HandoffDecision")
    })

    it("#then prompt mentions all 4 action types (continue, reroute, stop, blocked)", () => {
      expect(prompt).toContain("continue")
      expect(prompt).toContain("reroute")
      expect(prompt).toContain("stop")
      expect(prompt).toContain("blocked")
    })
  })
})

// ─── decideRouting Integration: role_policy_violation through feature module ──

describe("decideRouting role_policy_violation scenario", () => {
  // given: reviewer-auditor source agent targeting an implementer
  describe("#given qa-test-engineer (reviewer-auditor) handoffs to nodejs-backend-developer (implementer)", () => {
    it("#then decideRouting returns role_policy_violation kind", () => {
      // given
      const block = createDefaultHandoffBlock({
        status: "DONE",
        handoff: "nodejs-backend-developer",
      })
      // when
      const routing = decideRouting(block, {
        sourceAgent: "qa-test-engineer",
      })
      // then
      expect(routing.kind).toBe("role_policy_violation")
      expect(routing.reason).toContain("reviewer-auditor")
      expect(routing.reason).toContain("qa-test-engineer")
      expect(routing.originalTarget).toBe("nodejs-backend-developer")
    })
  })

  // given: docs-research source agent targeting an implementer
  describe("#given librarian (docs-research) handoffs to nodejs-backend-developer (implementer)", () => {
    it("#then decideRouting returns role_policy_violation kind", () => {
      // given
      const block = createDefaultHandoffBlock({
        status: "DONE",
        handoff: "nodejs-backend-developer",
      })
      // when
      const routing = decideRouting(block, {
        sourceAgent: "librarian",
      })
      // then
      expect(routing.kind).toBe("role_policy_violation")
      expect(routing.reason).toContain("docs-research")
    })
  })

  // given: architect-builder source agent targeting another architect-builder
  describe("#given nodejs-backend-architect (architect-builder) handoffs to security-architect (architect-builder)", () => {
    it("#then decideRouting returns role_policy_violation kind", () => {
      // given
      const block = createDefaultHandoffBlock({
        status: "DONE",
        handoff: "security-architect",
      })
      // when
      const routing = decideRouting(block, {
        sourceAgent: "nodejs-backend-architect",
      })
      // then
      expect(routing.kind).toBe("role_policy_violation")
      expect(routing.reason).toContain("architect-builder")
    })
  })
})
