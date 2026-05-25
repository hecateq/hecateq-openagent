import color from "picocolors"

import type {
  DagNodeItem,
  DagResponse,
  DelegationsResponse,
  DelegationChainItem,
  HealthResponse,
  HistoryResponse,
  SignalsResponse,
  SpawnSessionItem,
  SpawnsResponse,
  StateResponse,
  StateSummaryResponse,
} from "../../features/dashboard/types"
import type { DashboardView } from "./types"

// ─── Duration formatting ───────────────────────────────────────────────────

function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "-"
  if (ms < 1000) return `${ms}ms`
  const totalSec = Math.floor(ms / 1000)
  const sec = totalSec % 60
  const totalMin = Math.floor(totalSec / 60)
  const min = totalMin % 60
  const hr = Math.floor(totalMin / 60)
  if (hr > 0) return `${hr}h ${min}m ${sec}s`
  if (min > 0) return `${min}m ${sec}s`
  return `${sec}s`
}

function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return "-"
  return new Date(iso).toLocaleTimeString("en-US", { hour12: false })
}

function formatIso(iso: string | null | undefined): string {
  if (!iso) return "-"
  return new Date(iso).toISOString()
}

// ─── Status helpers ────────────────────────────────────────────────────────

function colorizeStatus(status: string): string {
  switch (status) {
    case "completed":
      return color.green(status)
    case "in_progress":
    case "running":
      return color.cyan(status)
    case "pending":
      return color.yellow(status)
    case "blocked":
    case "failed":
    case "crashed":
    case "timed_out":
      return color.red(status)
    case "paused":
      return color.yellow(status)
    default:
      return color.dim(status)
  }
}

function statusSymbol(status: string): string {
  switch (status) {
    case "completed":
      return color.green("\u2713")
    case "in_progress":
    case "running":
      return color.cyan("\u25CB")
    case "pending":
      return color.dim("\u25CB")
    case "blocked":
      return color.red("\u2717")
    case "failed":
    case "crashed":
      return color.red("\u2717")
    case "paused":
      return color.yellow("\u23F8")
    case "timed_out":
      return color.red("\u23F1")
    default:
      return color.dim("?")
  }
}

// ─── Progress bar ──────────────────────────────────────────────────────────

function formatProgressBar(completed: number, total: number, width = 10): string {
  if (total === 0) return color.dim("[" + "\u00B7".repeat(width) + "]")
  const filled = Math.round((completed / total) * width)
  const empty = width - filled
  const bar = color.green("\u2588".repeat(filled)) + color.dim("\u2591".repeat(empty))
  const pct = Math.round((completed / total) * 100)
  return `[${bar}] ${pct}%`
}

// ─── Status bar for watch mode ─────────────────────────────────────────────

export function formatWatcherHeader(
  iteration: number,
  intervalMs: number,
  health?: HealthResponse,
): string {
  const now = new Date().toLocaleTimeString("en-US", { hour12: false })
  const healthIcon = health?.status === "ok" ? color.green("\u25CF") : color.yellow("\u25CF")
  const parts = [
    color.dim(`[${now}]`),
    `${healthIcon}`,
    color.dim(`poll #${iteration + 1} every ${intervalMs / 1000}s`),
    color.dim("\u2014"),
    color.dim("Ctrl+C to stop"),
  ]
  return parts.join(" ")
}

// ─── Section: Health ───────────────────────────────────────────────────────

export function formatHealth(health: HealthResponse): string {
  const lines: string[] = []
  lines.push(color.bold("Server Health"))
  lines.push(color.dim("\u2500".repeat(48)))
  lines.push(`  Status:   ${health.status === "ok" ? color.green("OK") : color.yellow("Degraded")}`)
  lines.push(`  Version:  ${color.bold(health.version)}`)
  lines.push(`  Uptime:   ${formatDuration(health.uptime_ms)}`)
  lines.push(`  Hecateq:  ${health.hecateq_enabled ? color.green("enabled") : color.red("disabled")}`)
  lines.push(`  State:    ${health.state_file_exists ? color.green("file found") : color.yellow("no state file")}`)
  return lines.join("\n")
}

// ─── Section: Summary ──────────────────────────────────────────────────────

function formatSummary(summary: StateSummaryResponse): string {
  const lines: string[] = []
  lines.push(color.bold(color.cyan("Hecateq Dashboard")))
  lines.push(color.dim("\u2500".repeat(48)))
  const statusColor = summary.dag_status === "in_progress" ? color.cyan : color.green
  lines.push(
    `  ${statusSymbol(summary.dag_status)} Status: ${statusColor(summary.dag_status)}`
      + `    Uptime: ${color.bold(formatDuration(summary.uptime_ms))}`,
  )
  lines.push(
    `  Graphs: ${color.bold(String(summary.active_graphs))} active`
      + `  |  Signals: ${color.yellow(String(summary.pending_signals))} pending / ${color.green(String(summary.consumed_signals))} consumed`,
  )
  lines.push(
    `  Spawns: ${color.cyan(String(summary.active_spawns))} active`
      + `  |  Delegations: ${color.cyan(String(summary.active_delegations))} pending`,
  )
  if (summary.last_event_at) {
    lines.push(`  Last event: ${color.dim(formatIso(summary.last_event_at))}`)
  }
  return lines.join("\n")
}

function formatCompactSummary(summary: StateSummaryResponse): string {
  const statusColor = summary.dag_status === "in_progress" ? color.cyan : color.green
  return [
    `${statusSymbol(summary.dag_status)} ${statusColor(summary.dag_status.toUpperCase())}`
      + `  gr:${summary.active_graphs}  sig:${summary.pending_signals}P/${summary.consumed_signals}C`
      + `  sp:${summary.active_spawns}  dl:${summary.active_delegations}`
      + `  up:${formatDuration(summary.uptime_ms)}`,
  ].join("\n")
}

// ─── Section: DAG ──────────────────────────────────────────────────────────

function formatDagNode(node: DagNodeItem): string {
  const label = node.label.length > 40 ? node.label.slice(0, 39) + "\u2026" : node.label
  const duration = node.duration_ms != null ? formatDuration(node.duration_ms) : ""
  const extras: string[] = []
  if (node.required_signals.length > 0) extras.push(`needs: ${node.required_signals.join(", ")}`)
  if (node.emitted_signal) extras.push(`emits: ${node.emitted_signal}`)
  const extra = extras.length > 0 ? ` (${extras.join(", ")})` : ""
  return `  ${statusSymbol(node.status)} ${color.bold(label)} ${colorizeStatus(node.status)}${duration ? `  ${color.dim(duration)}` : ""}${color.dim(extra)}`
}

function formatCompactDagNode(node: DagNodeItem): string {
  const label = node.label.length > 30 ? node.label.slice(0, 29) + "\u2026" : node.label
  return `  ${statusSymbol(node.status)} ${label} ${colorizeStatus(node.status)}`
}

function formatDag(dag: DagResponse): string {
  const lines: string[] = []
  for (const graph of dag.active_graphs) {
    lines.push(color.bold(`DAG: ${graph.graph_id}`))
    lines.push(color.dim("\u2500".repeat(48)))
    lines.push(`  Status: ${colorizeStatus(graph.status)}  |  Nodes: ${graph.nodes.length}  |  Edges: ${graph.edges.length}`)

    if (graph.nodes.length > 0) {
      const completed = graph.nodes.filter((n) => n.status === "completed").length
      lines.push(`  Progress: ${formatProgressBar(completed, graph.nodes.length)}`)
    }

    if (graph.nodes.length > 0) {
      lines.push("")
      lines.push(color.dim("  Nodes:"))
      for (const node of graph.nodes) lines.push(formatDagNode(node))
    }
    if (graph.edges.length > 0) {
      lines.push("")
      lines.push(color.dim("  Edges:"))
      for (const edge of graph.edges) {
        lines.push(`    ${color.dim(edge.from)} ${color.cyan("\u2192")} ${color.dim(edge.to)}  ${color.dim(`[${edge.signal}]`)}`)
      }
    }
  }
  if (dag.pending_signals.length > 0) {
    lines.push("")
    lines.push(color.dim("  Pending Signals:"))
    for (const ps of dag.pending_signals) {
      const waited = formatDuration(Date.now() - new Date(ps.waiting_since).getTime())
      const timeout = formatDuration(new Date(ps.timeout_at).getTime() - Date.now())
      lines.push(`    ${color.yellow(ps.signal)}  expected by: ${color.dim(ps.expected_by.join(", "))}  (waited ${waited}, timeout ${timeout})`)
    }
  }
  return lines.join("\n")
}

function formatCompactDag(dag: DagResponse): string {
  const lines: string[] = []
  for (const graph of dag.active_graphs) {
    const completed = graph.nodes.filter((n) => n.status === "completed").length
    lines.push(`${color.bold("DAG")} ${graph.graph_id}  ${colorizeStatus(graph.status)}  ${formatProgressBar(completed, graph.nodes.length, 6)}`)
    for (const node of graph.nodes) lines.push(formatCompactDagNode(node))
  }
  if (dag.pending_signals.length > 0) {
    lines.push(color.yellow(`  pending: ${dag.pending_signals.map((ps) => ps.signal).join(", ")}`))
  }
  return lines.join("\n")
}

// ─── Section: Signals ──────────────────────────────────────────────────────

function formatSignals(signals: SignalsResponse): string {
  const lines: string[] = []
  lines.push(color.bold("Signals"))
  lines.push(color.dim("\u2500".repeat(48)))
  if (signals.known_signals.length > 0) {
    lines.push(`  Known (${signals.known_signals.length}):`)
    for (const ks of signals.known_signals) {
      lines.push(`    ${color.bold(ks.signal)}  ${color.dim(ks.emitters.join(", "))} ${color.cyan("\u2192")} ${color.dim(ks.consumers.join(", "))}`)
      lines.push(`      ${color.dim(ks.description)}`)
    }
  }
  if (signals.pending.length > 0) {
    lines.push("")
    lines.push(color.yellow(`  Pending (${signals.pending.length}):`))
    for (const s of signals.pending) {
      lines.push(`    ${color.yellow(s.signal)}  waiting since ${formatTimestamp(s.waiting_since)}`)
    }
  }
  if (signals.consumed.length > 0) {
    lines.push("")
    lines.push(color.green(`  Consumed (${signals.consumed.length}):`))
    for (const s of signals.consumed) {
      lines.push(`    ${color.green(s.signal)}  by ${color.dim(s.emitted_by ?? "-")}  at ${formatTimestamp(s.emitted_at)}`)
    }
  }
  return lines.join("\n")
}

function formatCompactSignals(signals: SignalsResponse): string {
  const lines: string[] = []
  if (signals.pending.length > 0) {
    lines.push(color.yellow(`pending: ${signals.pending.map((s) => s.signal).join(", ")}`))
  }
  if (signals.consumed.length > 0) {
    lines.push(color.green(`consumed: ${signals.consumed.map((s) => s.signal).join(", ")}`))
  }
  if (lines.length === 0) lines.push(color.dim("no signal activity"))
  return lines.join("\n")
}

// ─── Section: Delegations ──────────────────────────────────────────────────

function formatDelegationChain(chain: DelegationChainItem): string {
  const lines: string[] = []
  const elapsed = formatDuration(Date.now() - new Date(chain.started_at).getTime())
  lines.push(`  ${color.bold(chain.root_delegation_id)}  (depth ${chain.depth}, ${colorizeStatus(chain.status)})  ${color.dim(elapsed)}`)
  const sorted = [...chain.nodes].sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime())
  for (let i = 0; i < sorted.length; i++) {
    const node = sorted[i]!
    const isLast = i === sorted.length - 1
    const prefix = isLast ? "    \u2514\u2500 " : "    \u251C\u2500 "
    const nodeElapsed = node.completed_at
      ? formatDuration(new Date(node.completed_at).getTime() - new Date(node.started_at).getTime())
      : formatDuration(Date.now() - new Date(node.started_at).getTime())
    lines.push(`  ${prefix}${statusSymbol(node.status)} ${color.bold(node.target_agent)}  ${colorizeStatus(node.status)}  ${color.dim(nodeElapsed)}`)
  }
  return lines.join("\n")
}

function formatDelegations(delegations: DelegationsResponse): string {
  const lines: string[] = []
  lines.push(color.bold("Delegation Chains"))
  lines.push(color.dim("\u2500".repeat(48)))
  if (delegations.active_chains.length === 0) {
    lines.push("  No active delegation chains")
  }
  for (const chain of delegations.active_chains) {
    lines.push(formatDelegationChain(chain))
  }
  if (delegations.history.length > 0) {
    lines.push("")
    lines.push(color.dim(`  History: ${delegations.history.length} completed chains`))
  }
  return lines.join("\n")
}

function formatCompactDelegations(delegations: DelegationsResponse): string {
  const lines: string[] = []
  for (const chain of delegations.active_chains) {
    lines.push(`  ${chain.root_delegation_id}  depth:${chain.depth}  ${colorizeStatus(chain.status)}  ${chain.nodes.length} nodes`)
    for (const node of chain.nodes) {
      lines.push(`    ${statusSymbol(node.status)} ${node.target_agent}  ${colorizeStatus(node.status)}`)
    }
  }
  if (lines.length === 0) lines.push(color.dim("no active delegations"))
  return lines.join("\n")
}

// ─── Section: Spawns ───────────────────────────────────────────────────────

function formatSpawnRow(s: SpawnSessionItem): string {
  const elapsed = formatDuration(s.elapsed_ms)
  const timeout = s.timeout_ms ? formatDuration(s.timeout_ms) : "-"
  return `  ${statusSymbol(s.status)} ${color.bold(s.session_id)}  ${color.dim(s.target_agent)}  ${colorizeStatus(s.status)}  ${elapsed}/${timeout}`
}

function formatSpawns(spawns: SpawnsResponse): string {
  const lines: string[] = []
  lines.push(color.bold("Active Spawns"))
  lines.push(color.dim("\u2500".repeat(48)))
  if (spawns.active_sessions.length === 0) {
    lines.push("  No active spawn sessions")
  }
  for (const s of spawns.active_sessions) {
    lines.push(formatSpawnRow(s))
  }
  if (spawns.history.length > 0) {
    lines.push("")
    lines.push(color.dim("  History:"))
    for (const s of spawns.history) {
      const elapsed = formatDuration(s.elapsed_ms)
      const errorStr = s.error ? color.red(` [${s.error}]`) : ""
      lines.push(
        `    ${statusSymbol(s.status)} ${color.dim(s.session_id)}  ${s.target_agent}  ${colorizeStatus(s.status)}  ${color.dim(elapsed)}${errorStr}`,
      )
    }
  }
  lines.push("")
  lines.push(color.dim("  Config:"))
  lines.push(`    Max concurrent: ${spawns.config.max_concurrent}`)
  lines.push(`    Total spawned:  ${spawns.config.total_spawned}`)
  lines.push(`    Active:         ${spawns.config.active_count}`)
  if (spawns.config.paused_until) {
    lines.push(`    Paused until:   ${spawns.config.paused_until}`)
  }
  return lines.join("\n")
}

function formatCompactSpawns(spawns: SpawnsResponse): string {
  const lines: string[] = []
  for (const s of spawns.active_sessions) {
    lines.push(`  ${statusSymbol(s.status)} ${s.target_agent}  ${colorizeStatus(s.status)}  ${formatDuration(s.elapsed_ms)}`)
  }
  if (spawns.history.length > 0) {
    lines.push(color.dim(`  past: ${spawns.history.length} completed`))
  }
  lines.push(color.dim(`  ${spawns.config.active_count}/${spawns.config.max_concurrent} active, ${spawns.config.total_spawned} total`))
  return lines.join("\n")
}

// ─── Section: History ──────────────────────────────────────────────────────

function formatHistory(history: HistoryResponse): string {
  const lines: string[] = []
  lines.push(color.bold("Orchestration History"))
  lines.push(color.dim("\u2500".repeat(48)))
  lines.push(`  ${color.bold("Summary:")}`)
  lines.push(`    Total graphs:          ${history.history_summary.total_graphs}`)
  lines.push(`    Routing decisions:     ${history.history_summary.total_routing_decisions}`)
  lines.push(`    Signals emitted:       ${history.history_summary.total_signals_emitted}`)
  lines.push(`    Total spawns:          ${history.history_summary.total_spawns}`)
  lines.push(`    Oldest entry:          ${history.history_summary.oldest_entry ?? "-"}`)
  if (history.completed_graphs.length > 0) {
    lines.push("")
    lines.push(color.dim("  Completed Graphs:"))
    for (const g of history.completed_graphs) {
      const duration = g.completed_at
        ? formatDuration(new Date(g.completed_at).getTime() - new Date(g.started_at).getTime())
        : "-"
      lines.push(`    ${color.bold(g.graph_id)}  ${colorizeStatus(g.status)}  ${g.node_count} nodes  ${color.dim(duration)}`)
      if (g.summary) lines.push(`      ${color.dim(g.summary)}`)
    }
  }
  if (history.routing_history.length > 0) {
    lines.push("")
    lines.push(color.dim("  Recent Routing:"))
    const recent = history.routing_history.slice(-5)
    for (const r of recent) {
      lines.push(`    ${color.dim(r.decision_kind)}  ${color.dim(r.target ?? "-")}  ${colorizeStatus(r.status)}  ${formatTimestamp(r.decided_at)}`)
    }
    if (history.routing_history.length > 5) {
      lines.push(color.dim(`    ... and ${history.routing_history.length - 5} more`))
    }
  }
  return lines.join("\n")
}

function formatCompactHistory(history: HistoryResponse): string {
  const h = history.history_summary
  return [
    `  graphs:${h.total_graphs}  routes:${h.total_routing_decisions}  signals:${h.total_signals_emitted}  spawns:${h.total_spawns}`,
    history.routing_history.length > 0
      ? color.dim(`  last: ${history.routing_history[history.routing_history.length - 1]?.decision_kind ?? "-"}`)
      : "",
  ].filter(Boolean).join("\n")
}

// ─── Section: Full State ───────────────────────────────────────────────────

function formatState(state: StateResponse): string {
  const lines: string[] = []
  lines.push(color.bold("Full State"))
  lines.push(color.dim("\u2500".repeat(48)))
  lines.push(`  Handoff: ${state.handoff.active ? color.cyan("active") : color.dim("none")}`)
  lines.push(`  Handoff history: ${state.handoff.history.length} entries`)
  lines.push(`  Signals: ${state.signal_registry.pending.length} pending, ${state.signal_registry.consumed.length} consumed`)
  lines.push(`  Routing: target=${state.routing.active_target ?? color.dim("none")}, queue=${state.routing.queue.length}, decisions=${state.routing.history.length}`)
  lines.push(`  Delegation: ${state.delegation.pending.length} pending, ${state.delegation.consumed.length} consumed, depth=${state.delegation.depth}`)
  lines.push(`  Spawn: ${state.spawn.active_sessions.length} active, ${state.spawn.history.length} in history`)
  return lines.join("\n")
}

function formatCompactState(state: StateResponse): string {
  return [
    `  handoff:${state.handoff.active ? "active" : "none"}  sig:${state.signal_registry.pending.length}P/${state.signal_registry.consumed.length}C`
      + `  route:${state.routing.history.length}  dl:${state.delegation.pending.length}P/${state.delegation.consumed.length}C`
      + `  sp:${state.spawn.active_sessions.length}A/${state.spawn.history.length}H`,
  ].join("\n")
}

// ─── Public dispatch ───────────────────────────────────────────────────────

export function formatTextByView(
  view: DashboardView,
  data: unknown,
  health?: HealthResponse,
  compact?: boolean,
): string {
  const parts: string[] = []
  if (health && !compact) {
    parts.push(formatHealth(health))
    parts.push("")
  }
  const body = compact ? formatCompactViewBody(view, data) : formatViewBody(view, data)
  parts.push(body)
  return parts.join("\n")
}

function formatViewBody(view: DashboardView, data: unknown): string {
  switch (view) {
    case "summary":
      return formatSummary(data as StateSummaryResponse)
    case "dag":
      return formatDag(data as DagResponse)
    case "signals":
      return formatSignals(data as SignalsResponse)
    case "delegations":
      return formatDelegations(data as DelegationsResponse)
    case "spawns":
      return formatSpawns(data as SpawnsResponse)
    case "history":
      return formatHistory(data as HistoryResponse)
    case "state":
      return formatState(data as StateResponse)
    default:
      return formatSummary(data as StateSummaryResponse)
  }
}

function formatCompactViewBody(view: DashboardView, data: unknown): string {
  switch (view) {
    case "summary":
      return formatCompactSummary(data as StateSummaryResponse)
    case "dag":
      return formatCompactDag(data as DagResponse)
    case "signals":
      return formatCompactSignals(data as SignalsResponse)
    case "delegations":
      return formatCompactDelegations(data as DelegationsResponse)
    case "spawns":
      return formatCompactSpawns(data as SpawnsResponse)
    case "history":
      return formatCompactHistory(data as HistoryResponse)
    case "state":
      return formatCompactState(data as StateResponse)
    default:
      return formatCompactSummary(data as StateSummaryResponse)
  }
}

export function formatJsonOutput(data: unknown): string {
  return JSON.stringify(data, null, 2)
}

export function formatApiError(code: string, message: string): string {
  return [color.bold(color.red(`API Error [${code}]`)), `  ${message}`].join("\n")
}
