import { afterEach, describe, expect, it, mock, spyOn } from "bun:test"
import * as loggerModule from "../logger"
import type { RoutingDecision } from "./routing-contract"

type RoutingLogModule = typeof import("./routing-log")

async function importFreshRoutingLogModule(): Promise<RoutingLogModule> {
  return await import(`./routing-log?test=${Date.now()}-${Math.random()}`)
}

describe("logRoutingDecision", () => {
  afterEach(() => {
    mock.restore()
  })

  describe("#given decision is null", () => {
    it("#when logRoutingDecision is called #then log is NOT called", async () => {
      // given
      const logSpy = spyOn(loggerModule, "log").mockImplementation(() => {})
      const { logRoutingDecision } = await importFreshRoutingLogModule()

      // when
      logRoutingDecision("some-agent", null)

      // then
      expect(logSpy).not.toHaveBeenCalled()
    })
  })

  describe("#given exact_agent_found decision", () => {
    it("#when logRoutingDecision is called #then log is called with correct message and payload", async () => {
      // given
      const logSpy = spyOn(loggerModule, "log").mockImplementation(() => {})
      const { logRoutingDecision } = await importFreshRoutingLogModule()
      const decision: RoutingDecision = {
        status: "exact_agent_found",
        target: "nodejs-backend-architect",
        source: "custom",
        indexUsed: false,
        reason: "agent found in custom registry",
      }

      // when
      logRoutingDecision("nodejs-backend-architect", decision)

      // then
      expect(logSpy).toHaveBeenCalledTimes(1)
      const [message, payload] = logSpy.mock.calls[0]
      expect(message).toContain("ROUTING: exact_agent_found")
      expect(message).toContain("subagent=nodejs-backend-architect")
      expect(message).toContain("target=nodejs-backend-architect")
      expect(payload).toMatchObject({
        target: "nodejs-backend-architect",
        source: "custom",
        indexUsed: false,
      })
    })
  })

  describe("#given exact_agent_disabled decision", () => {
    it("#when logRoutingDecision is called #then payload includes target and status in message", async () => {
      // given
      const logSpy = spyOn(loggerModule, "log").mockImplementation(() => {})
      const { logRoutingDecision } = await importFreshRoutingLogModule()
      const decision: RoutingDecision = {
        status: "exact_agent_disabled",
        target: "oracle",
        reason: "agent is disabled in config",
      }

      // when
      logRoutingDecision("oracle", decision)

      // then
      expect(logSpy).toHaveBeenCalledTimes(1)
      const [message, payload] = logSpy.mock.calls[0]
      expect(message).toContain("ROUTING: exact_agent_disabled")
      expect(message).toContain("target=oracle")
      expect(payload).toMatchObject({
        target: "oracle",
      })
    })
  })

  describe("#given exact_agent_unknown decision", () => {
    it("#when logRoutingDecision is called #then payload includes suggestions", async () => {
      // given
      const logSpy = spyOn(loggerModule, "log").mockImplementation(() => {})
      const { logRoutingDecision } = await importFreshRoutingLogModule()
      const decision: RoutingDecision = {
        status: "exact_agent_unknown",
        requested: "some-agent",
        suggestions: ["security-architect", "nodejs-backend-architect"],
        reason: "no matching agent found",
      }

      // when
      logRoutingDecision("some-agent", decision)

      // then
      expect(logSpy).toHaveBeenCalledTimes(1)
      const [message, payload] = logSpy.mock.calls[0]
      expect(message).toContain("ROUTING: exact_agent_unknown")
      expect(payload).toMatchObject({
        suggestions: ["security-architect", "nodejs-backend-architect"],
      })
    })
  })

  describe("#given undefined requested", () => {
    it("#when logRoutingDecision is called with found decision #then log is called and does not throw", async () => {
      // given
      const logSpy = spyOn(loggerModule, "log").mockImplementation(() => {})
      const { logRoutingDecision } = await importFreshRoutingLogModule()
      const decision: RoutingDecision = {
        status: "exact_agent_found",
        target: "nodejs-backend-architect",
        source: "builtin",
        indexUsed: false,
        reason: "found",
      }

      // when
      logRoutingDecision(undefined, decision)

      // then
      expect(logSpy).toHaveBeenCalledTimes(1)
    })
  })

  describe("#given log() throws", () => {
    it("#when logRoutingDecision is called #then it does not propagate the error", async () => {
      // given
      spyOn(loggerModule, "log").mockImplementation(() => {
        throw new Error("log failure")
      })
      const { logRoutingDecision } = await importFreshRoutingLogModule()
      const decision: RoutingDecision = {
        status: "exact_agent_found",
        target: "nodejs-backend-architect",
        source: "builtin",
        indexUsed: false,
        reason: "found",
      }

      // when + then
      expect(() => logRoutingDecision("test", decision)).not.toThrow()
    })
  })
})
