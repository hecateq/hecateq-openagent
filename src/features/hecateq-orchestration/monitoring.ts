import { log } from "../../shared/logger"

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OrchestrationMetrics {
  delegationsTotal: number
  delegationsByAgent: Record<string, number>
  handoffsTotal: number
  handoffsByAction: Record<"continue" | "reroute" | "stop" | "blocked", number>
  routingDecisions: Record<"exact_agent" | "category" | "blocked", number>
  averageRoutingDepth: number
  successRate: number
  averageDelegationMs: number
  startedAt: number
  lastUpdatedAt: number
}

export interface OrchestrationEvent {
  type: "delegation" | "handoff" | "routing" | "completion" | "failure"
  agent?: string
  action?: string
  durationMs?: number
  metadata?: Record<string, unknown>
}

// ─── Valid action / decision sets ─────────────────────────────────────────────

const VALID_HANDOFF_ACTIONS = new Set(["continue", "reroute", "stop", "blocked"])
const VALID_ROUTING_DECISIONS = new Set(["exact_agent", "category", "blocked"])

function isHandoffAction(value: string): value is "continue" | "reroute" | "stop" | "blocked" {
  return VALID_HANDOFF_ACTIONS.has(value)
}

function isRoutingDecision(value: string): value is "exact_agent" | "category" | "blocked" {
  return VALID_ROUTING_DECISIONS.has(value)
}

function emptyHandoffActions(): Record<"continue" | "reroute" | "stop" | "blocked", number> {
  return { continue: 0, reroute: 0, stop: 0, blocked: 0 }
}

function emptyRoutingDecisions(): Record<"exact_agent" | "category" | "blocked", number> {
  return { exact_agent: 0, category: 0, blocked: 0 }
}

// ─── Monitor Implementation ───────────────────────────────────────────────────

export interface OrchestrationMonitor {
  recordEvent(event: OrchestrationEvent): void
  getMetrics(): OrchestrationMetrics
  reset(): void
  logSnapshot(): void
}

export function createOrchestrationMonitor(): OrchestrationMonitor {
  const events: OrchestrationEvent[] = []

  // Running accumulators
  let delegationsTotal = 0
  const delegationsByAgent: Record<string, number> = {}
  let handoffsTotal = 0
  const handoffsByAction = emptyHandoffActions()
  const routingDecisions = emptyRoutingDecisions()
  let routingDepthSum = 0
  let routingDepthCount = 0
  let completionCount = 0
  let failureCount = 0
  let delegationDurationSum = 0
  let delegationDurationCount = 0
  const startedAt = Date.now()
  let lastUpdatedAt = startedAt

  const monitor: OrchestrationMonitor = {
    recordEvent(event: OrchestrationEvent): void {
      events.push(event)
      lastUpdatedAt = Date.now()

      switch (event.type) {
        case "delegation": {
          delegationsTotal++
          if (event.agent) {
            const key = event.agent
            delegationsByAgent[key] = (delegationsByAgent[key] ?? 0) + 1
          }
          if (event.durationMs !== undefined && event.durationMs > 0) {
            delegationDurationSum += event.durationMs
            delegationDurationCount++
          }
          if (event.metadata?.routingDepth !== undefined) {
            const depth = Number(event.metadata.routingDepth)
            if (!isNaN(depth) && depth >= 0) {
              routingDepthSum += depth
              routingDepthCount++
            }
          }
          break
        }
        case "handoff": {
          handoffsTotal++
          if (event.action && isHandoffAction(event.action)) {
            handoffsByAction[event.action]++
          }
          break
        }
        case "routing": {
          if (event.action && isRoutingDecision(event.action)) {
            routingDecisions[event.action]++
          }
          break
        }
        case "completion": {
          completionCount++
          break
        }
        case "failure": {
          failureCount++
          break
        }
      }
    },

    getMetrics(): OrchestrationMetrics {
      const total = completionCount + failureCount
      const successRate = total > 0 ? completionCount / total : 1.0
      const averageRoutingDepth = routingDepthCount > 0
        ? routingDepthSum / routingDepthCount
        : 0
      const averageDelegationMs = delegationDurationCount > 0
        ? delegationDurationSum / delegationDurationCount
        : 0

      return {
        delegationsTotal,
        delegationsByAgent: { ...delegationsByAgent },
        handoffsTotal,
        handoffsByAction: { ...handoffsByAction },
        routingDecisions: { ...routingDecisions },
        averageRoutingDepth: Math.round(averageRoutingDepth * 100) / 100,
        successRate: Math.round(successRate * 10000) / 10000,
        averageDelegationMs: Math.round(averageDelegationMs * 100) / 100,
        startedAt,
        lastUpdatedAt,
      }
    },

    reset(): void {
      events.length = 0
      delegationsTotal = 0
      for (const key of Object.keys(delegationsByAgent)) {
        delete delegationsByAgent[key]
      }
      handoffsTotal = 0
      Object.assign(handoffsByAction, emptyHandoffActions())
      Object.assign(routingDecisions, emptyRoutingDecisions())
      routingDepthSum = 0
      routingDepthCount = 0
      completionCount = 0
      failureCount = 0
      delegationDurationSum = 0
      delegationDurationCount = 0
      lastUpdatedAt = Date.now()
    },

    logSnapshot(): void {
      const metrics = monitor.getMetrics()
      log("orchestration-monitor:snapshot", {
        delegationsTotal: metrics.delegationsTotal,
        delegationsByAgent: metrics.delegationsByAgent,
        handoffsTotal: metrics.handoffsTotal,
        handoffsByAction: metrics.handoffsByAction,
        routingDecisions: metrics.routingDecisions,
        averageRoutingDepth: metrics.averageRoutingDepth,
        successRate: metrics.successRate,
        averageDelegationMs: metrics.averageDelegationMs,
        startedAt: new Date(metrics.startedAt).toISOString(),
        lastUpdatedAt: new Date(metrics.lastUpdatedAt).toISOString(),
      })
    },
  }

  return monitor
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let instance: OrchestrationMonitor | null = null

export function getOrchestrationMonitor(): OrchestrationMonitor {
  if (!instance) {
    instance = createOrchestrationMonitor()
  }
  return instance
}

export function _resetOrchestrationMonitorForTesting(): void {
  if (instance) {
    instance.reset()
  }
  instance = null
}
