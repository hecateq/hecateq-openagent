import { OmoStateManager } from "../hecateq-orchestration/omo-state-manager"
import { KNOWN_SIGNALS } from "../hecateq-orchestration/signal-registry"
import type {
  HealthResponse,
  StateResponse,
  DagResponse,
  DagNodeItem,
  DagEdgeItem,
  DagGraphItem,
  PendingSignalItem,
  SignalsResponse,
  KnownSignalItem,
  SignalDetailItem,
  DelegationsResponse,
  DelegationChainItem,
  DelegationNodeItem,
  SpawnsResponse,
  SpawnSessionItem,
  HistoryResponse,
  RoutingDecisionItem,
  StateSummaryResponse,
  DashboardError,
  DashboardStatus,
} from "./types"

const VERSION = "1.0.0"

function mapStatus(status: string): DashboardStatus {
  switch (status) {
    case "pending": return "pending"
    case "in_progress": return "in_progress"
    case "completed": return "completed"
    case "failed": return "failed"
    case "blocked": return "blocked"
    case "skipped": return "blocked"
    case "running": return "in_progress"
    case "timeout": return "timed_out"
    case "aborted": return "crashed"
    case "executed": return "completed"
    case "guardrail_blocked": return "blocked"
    default: return "pending"
  }
}

function msSince(iso: string | undefined): number | null {
  if (!iso) return null
  return Date.now() - new Date(iso).getTime()
}

export function createStateSnapshotter(projectDir: string) {
  const stateMgr = new OmoStateManager(projectDir)

  function hasState(): boolean {
    return stateMgr.read() !== null
  }

  function getHealth(uptimeMs: number): HealthResponse {
    return {
      status: hasState() ? "ok" : "degraded",
      version: VERSION,
      uptime_ms: uptimeMs,
      hecateq_enabled: true,
      state_file_exists: hasState(),
      ws_connections: 0,
    }
  }

  function getState(): StateResponse | DashboardError {
    const state = stateMgr.read()
    if (!state) return stateNotFoundError()

    return {
      handoff: {
        active: state.handoff?.active as Record<string, unknown> | null ?? null,
        history: (state.handoff?.history ?? []).map((h) => ({
          status: h.status,
          target: h.target,
          signalCount: h.signalCount,
          signalNames: h.signalNames,
          timestamp: h.timestamp,
          source: h.source,
        })),
      },
      signal_registry: {
        pending: (state.signal_registry?.pending ?? []).map((s) => ({
          signal: s.signal,
          payload: s.payload,
          emittedAt: s.emittedAt,
          consumedAt: s.consumedAt,
          emitterAgent: s.emitterAgent,
        })),
        consumed: (state.signal_registry?.consumed ?? []).map((s) => ({
          signal: s.signal,
          payload: s.payload,
          emittedAt: s.emittedAt,
          consumedAt: s.consumedAt,
          emitterAgent: s.emitterAgent,
        })),
      },
      routing: {
        active_target: state.routing?.active_target ?? null,
        queue: state.routing?.queue ?? [],
        history: (state.routing?.decisions ?? []).map((d, i) => ({
          routing_id: `routing_${i}`,
          decision_kind: d.decision,
          source_task_id: d.sourceTaskId,
          decided_at: d.decidedAt,
          target: d.originalTarget,
          status: "completed" as DashboardStatus,
        })),
      },
      delegation: {
        pending: (state.delegation?.pending ?? []).map((d) => ({
          id: d.id,
          target_agent: d.targetAgent,
          prompt: d.prompt,
          source_task_id: d.sourceTaskId,
          source_agent: d.sourceAgent,
          created_at: d.createdAt,
          status: d.status,
          routing_depth: d.routingDepth,
        })),
        consumed: (state.delegation?.history ?? []).map((d) => ({
          id: d.id,
          target_agent: d.targetAgent,
          prompt: "",
          source_task_id: d.sourceTaskId,
          source_agent: d.sourceAgent,
          created_at: d.decidedAt,
          status: d.result,
          routing_depth: 0,
        })),
        depth: state.delegation?.routingDepth ?? 0,
      },
      spawn: {
        active_sessions: (state.spawn?.activeSessions ?? []).map((s) => ({
          session_id: s.sessionId,
          delegation_id: s.delegationId,
          target_agent: s.targetAgent,
          routing_depth: s.routingDepth,
          status: mapStatus(s.status),
          spawned_at: s.spawnedAt,
          elapsed_ms: msSince(s.spawnedAt),
          timeout_ms: null,
          completed_at: s.completedAt,
          error: s.errorSummary ?? null,
        })),
        history: (state.spawn?.history ?? []).map((s) => ({
          session_id: s.sessionId,
          delegation_id: s.delegationId,
          target_agent: s.targetAgent,
          routing_depth: s.routingDepth,
          status: mapStatus(s.status),
          spawned_at: s.spawnedAt,
          elapsed_ms: s.completedAt ? new Date(s.completedAt).getTime() - new Date(s.spawnedAt).getTime() : null,
          timeout_ms: null,
          completed_at: s.completedAt,
          error: s.errorSummary ?? null,
        })),
      },
    }
  }

  function getDag(_query?: { graph_id?: string; status?: string }): DagResponse | DashboardError {
    const state = stateMgr.read()
    if (!state) return stateNotFoundError()

    const pendingSignals = state.signal_registry?.pending ?? []
    const consumedSignals = state.signal_registry?.consumed ?? []
    const dynamicNodes = state.dynamic_dag?.nodes ?? []
    const dynamicEdges = state.dynamic_dag?.edges ?? []

    const nodes: DagNodeItem[] = []
    const edges: DagEdgeItem[] = []

    for (const sig of consumedSignals) {
      nodes.push({
        id: `node_${sig.signal}`,
        label: sig.emitterAgent ?? sig.signal,
        domain: "unknown",
        status: "completed",
        required_signals: [],
        emitted_signal: sig.signal,
        started_at: sig.emittedAt,
        completed_at: sig.consumedAt ?? sig.emittedAt,
        duration_ms: sig.consumedAt
          ? new Date(sig.consumedAt).getTime() - new Date(sig.emittedAt).getTime()
          : null,
        error: null,
      })
    }

    for (const sig of pendingSignals) {
      const consumers = KNOWN_SIGNALS.find((ks) => ks.signal === sig.signal)?.consumedBy ?? []
      nodes.push({
        id: `pending_${sig.signal}`,
        label: `waiting: ${sig.signal}`,
        domain: "unknown",
        status: "blocked",
        required_signals: [sig.signal],
        emitted_signal: null,
        started_at: null,
        completed_at: null,
        duration_ms: null,
        error: null,
      })
      for (const consumer of consumers) {
        edges.push({
          from: `pending_${sig.signal}`,
          to: `consumer_${consumer}`,
          signal: sig.signal,
        })
      }
    }

    const graph: DagGraphItem = {
      graph_id: "dag_current",
      started_at: state.last_updated,
      status: pendingSignals.length > 0 ? "in_progress" : "completed",
      nodes: [
        ...nodes,
        ...dynamicNodes.map((n) => ({
          id: n.id,
          label: n.label,
          domain: n.domain,
          status: mapStatus(n.status),
          required_signals: n.requiredSignals,
          emitted_signal: n.emittedSignal,
          started_at: n.createdAt,
          completed_at: null,
          duration_ms: null,
          error: null,
        })),
      ],
      edges: [
        ...edges,
        ...dynamicEdges.map((e) => ({
          from: e.from,
          to: e.to,
          signal: e.signal ?? "",
        })),
      ],
    }

    const pendingSignalItems: PendingSignalItem[] = pendingSignals.map((s) => ({
      signal: s.signal,
      expected_by: KNOWN_SIGNALS.find((ks) => ks.signal === s.signal)?.consumedBy ?? [],
      waiting_since: s.emittedAt,
      timeout_at: new Date(new Date(s.emittedAt).getTime() + 600000).toISOString(),
    }))

    return {
      active_graphs: [graph],
      pending_signals: pendingSignalItems,
      history: [],
    }
  }

  function getSignals(): SignalsResponse | DashboardError {
    const state = stateMgr.read()
    if (!state) return stateNotFoundError()

    const knownSignals: KnownSignalItem[] = KNOWN_SIGNALS.map((s) => ({
      signal: s.signal,
      emitters: s.emittedBy,
      consumers: s.consumedBy,
      description: s.description,
    }))

    const pending: SignalDetailItem[] = (state.signal_registry?.pending ?? []).map((s) => ({
      signal: s.signal,
      emitted_by: s.emitterAgent ?? null,
      emitted_at: s.emittedAt,
      consumed_by: [],
      status: "waiting" as const,
      waiting_since: s.emittedAt,
    }))

    const consumed: SignalDetailItem[] = (state.signal_registry?.consumed ?? []).map((s) => ({
      signal: s.signal,
      emitted_by: s.emitterAgent ?? null,
      emitted_at: s.emittedAt,
      consumed_by: [],
      status: "consumed" as const,
    }))

    return { known_signals: knownSignals, pending, consumed }
  }

  function getDelegations(): DelegationsResponse | DashboardError {
    const state = stateMgr.read()
    if (!state) return stateNotFoundError()

    const pendingDelegations = state.delegation?.pending ?? []
    const delegationHistory = state.delegation?.history ?? []

    const chainNodes: DelegationNodeItem[] = [
      ...pendingDelegations.map((d) => ({
        id: d.id,
        parent_id: null as string | null,
        target_agent: d.targetAgent,
        depth: d.routingDepth,
        status: mapStatus(d.status),
        started_at: d.createdAt,
        completed_at: null as string | null,
      })),
      ...delegationHistory.map((d) => ({
        id: d.id,
        parent_id: null as string | null,
        target_agent: d.targetAgent,
        depth: 0,
        status: mapStatus(d.result),
        started_at: d.decidedAt,
        completed_at: d.executedAt ?? null,
      })),
    ]

    const activeChain: DelegationChainItem = {
      root_delegation_id: pendingDelegations[0]?.id ?? "no_active_chain",
      depth: state.delegation?.routingDepth ?? 0,
      started_at: pendingDelegations[0]?.createdAt ?? new Date().toISOString(),
      fan_out_count: pendingDelegations.length,
      status: pendingDelegations.length > 0 ? "in_progress" : "completed",
      nodes: chainNodes,
    }

    return {
      active_chains: pendingDelegations.length > 0 ? [activeChain] : [],
      history: delegationHistory.length > 0 ? [activeChain] : [],
    }
  }

  function getSpawns(): SpawnsResponse | DashboardError {
    const state = stateMgr.read()
    if (!state) return stateNotFoundError()

    const activeSessions = state.spawn?.activeSessions ?? []
    const history = state.spawn?.history ?? []

    return {
      active_sessions: activeSessions.map((s) => ({
        session_id: s.sessionId,
        delegation_id: s.delegationId,
        target_agent: s.targetAgent,
        routing_depth: s.routingDepth,
        status: mapStatus(s.status),
        spawned_at: s.spawnedAt,
        elapsed_ms: msSince(s.spawnedAt),
        timeout_ms: null,
      })),
      history: history.map((s) => ({
        session_id: s.sessionId,
        delegation_id: s.delegationId,
        target_agent: s.targetAgent,
        routing_depth: s.routingDepth,
        status: mapStatus(s.status),
        spawned_at: s.spawnedAt,
        elapsed_ms: s.completedAt ? new Date(s.completedAt).getTime() - new Date(s.spawnedAt).getTime() : null,
        timeout_ms: null,
        completed_at: s.completedAt,
        error: s.errorSummary ?? null,
      })),
      config: {
        max_concurrent: state.spawn?.config.maxConcurrent ?? 5,
        paused_until: state.spawn?.config.pausedUntil ?? null,
        total_spawned: activeSessions.length + history.length,
        active_count: activeSessions.length,
      },
    }
  }

  function getHistory(): HistoryResponse | DashboardError {
    const state = stateMgr.read()
    if (!state) return stateNotFoundError()

    const routingHistory: RoutingDecisionItem[] = (state.routing?.decisions ?? []).map((d, i) => ({
      routing_id: `routing_${i}`,
      decision_kind: d.decision,
      source_task_id: d.sourceTaskId,
      decided_at: d.decidedAt,
      target: d.originalTarget,
      status: "completed" as DashboardStatus,
    }))

    const signalCount = (state.signal_registry?.pending.length ?? 0)
      + (state.signal_registry?.consumed.length ?? 0)

    const spawnCount = (state.spawn?.activeSessions.length ?? 0)
      + (state.spawn?.history.length ?? 0)

    return {
      completed_graphs: [],
      routing_history: routingHistory,
      history_summary: {
        total_graphs: 0,
        total_routing_decisions: routingHistory.length,
        total_signals_emitted: signalCount,
        total_spawns: spawnCount,
        oldest_entry: routingHistory[routingHistory.length - 1]?.decided_at ?? null,
      },
    }
  }

  function getSummary(uptimeMs: number): StateSummaryResponse | DashboardError {
    const state = stateMgr.read()
    if (!state) return stateNotFoundError()

    const activeSpawns = state.spawn?.activeSessions.length ?? 0
    const pendingSignals = state.signal_registry?.pending.length ?? 0
    const consumedSignals = state.signal_registry?.consumed.length ?? 0
    const activeDelegations = state.delegation?.pending.length ?? 0

    return {
      active_graphs: 0,
      active_delegations: activeDelegations,
      active_spawns: activeSpawns,
      pending_signals: pendingSignals,
      consumed_signals: consumedSignals,
      dag_status: activeDelegations > 0 ? "in_progress" : "completed",
      uptime_ms: uptimeMs,
      last_event_at: state.last_updated,
    }
  }

  return {
    hasState,
    getHealth,
    getState,
    getDag,
    getSignals,
    getDelegations,
    getSpawns,
    getHistory,
    getSummary,
  }
}

function stateNotFoundError(): DashboardError {
  return {
    error: {
      code: "STATE_FILE_NOT_FOUND",
      message: "Hecateq state file not found at .opencode/state/hecateq/state.json",
      recoverable: false,
    },
  }
}
