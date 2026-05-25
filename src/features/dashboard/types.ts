export type DashboardStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed"
  | "blocked"
  | "crashed"
  | "paused"
  | "timed_out"

export interface HealthResponse {
  status: "ok" | "degraded"
  version: string
  uptime_ms: number
  hecateq_enabled: boolean
  state_file_exists: boolean
  ws_connections: number
}

export interface StateResponse {
  handoff: {
    active: Record<string, unknown> | null
    history: Record<string, unknown>[]
  }
  signal_registry: {
    pending: SignalState[]
    consumed: SignalState[]
  }
  routing: {
    active_target: string | null
    queue: string[]
    history: RoutingDecisionItem[]
  }
  delegation: {
    pending: DelegationStateItem[]
    consumed: DelegationStateItem[]
    depth: number
  }
  spawn: {
    active_sessions: SpawnSessionItem[]
    history: SpawnSessionItem[]
  }
}

export interface DagNodeItem {
  id: string
  label: string
  domain: string
  status: DashboardStatus
  required_signals: string[]
  emitted_signal: string | null
  started_at: string | null
  completed_at: string | null
  duration_ms: number | null
  error: string | null
}

export interface DagEdgeItem {
  from: string
  to: string
  signal: string
}

export interface DagGraphItem {
  graph_id: string
  started_at: string
  status: DashboardStatus
  nodes: DagNodeItem[]
  edges: DagEdgeItem[]
}

export interface PendingSignalItem {
  signal: string
  expected_by: string[]
  waiting_since: string
  timeout_at: string
}

export interface DagResponse {
  active_graphs: DagGraphItem[]
  pending_signals: PendingSignalItem[]
  history: DagGraphItem[]
}

export interface KnownSignalItem {
  signal: string
  emitters: string[]
  consumers: string[]
  description: string
}

export interface SignalDetailItem {
  signal: string
  emitted_by: string | null
  emitted_at: string | null
  consumed_by: string[]
  status: "waiting" | "consumed"
  waiting_since?: string
}

export interface SignalsResponse {
  known_signals: KnownSignalItem[]
  pending: SignalDetailItem[]
  consumed: SignalDetailItem[]
}

export interface DelegationNodeItem {
  id: string
  parent_id: string | null
  target_agent: string
  depth: number
  status: DashboardStatus
  started_at: string
  completed_at: string | null
}

export interface DelegationChainItem {
  root_delegation_id: string
  depth: number
  started_at: string
  fan_out_count: number
  status: DashboardStatus
  nodes: DelegationNodeItem[]
}

export interface DelegationsResponse {
  active_chains: DelegationChainItem[]
  history: DelegationChainItem[]
}

export interface SpawnSessionItem {
  session_id: string
  delegation_id: string
  target_agent: string
  routing_depth: number
  status: DashboardStatus
  spawned_at: string
  elapsed_ms: number | null
  timeout_ms: number | null
  completed_at?: string
  error?: string | null
}

export interface SpawnsResponse {
  active_sessions: SpawnSessionItem[]
  history: SpawnSessionItem[]
  config: {
    max_concurrent: number
    paused_until: string | null
    total_spawned: number
    active_count: number
  }
}

export interface RoutingDecisionItem {
  routing_id: string
  decision_kind: string
  source_task_id: string | undefined
  decided_at: string
  target: string | null
  status: DashboardStatus
}

export interface HistoryResponse {
  completed_graphs: {
    graph_id: string
    started_at: string
    completed_at: string
    node_count: number
    status: DashboardStatus
    summary: string
  }[]
  routing_history: RoutingDecisionItem[]
  history_summary: {
    total_graphs: number
    total_routing_decisions: number
    total_signals_emitted: number
    total_spawns: number
    oldest_entry: string | null
  }
}

export interface StateSummaryResponse {
  active_graphs: number
  active_delegations: number
  active_spawns: number
  pending_signals: number
  consumed_signals: number
  dag_status: DashboardStatus
  uptime_ms: number
  last_event_at: string | null
}

export interface SignalState {
  signal: string
  payload: Record<string, unknown>
  emittedAt: string
  consumedAt?: string
  emitterAgent?: string
}

export interface DelegationStateItem {
  id: string
  target_agent: string
  prompt: string
  source_task_id?: string
  source_agent?: string
  created_at: string
  status: string
  routing_depth: number
}

export interface DashboardError {
  error: {
    code: string
    message: string
    recoverable: boolean
  }
}
