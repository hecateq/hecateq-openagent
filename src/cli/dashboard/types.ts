export type DashboardView =
  | "summary"
  | "dag"
  | "signals"
  | "delegations"
  | "spawns"
  | "history"
  | "state"

export type DisplayMode = "normal" | "compact"

export interface DashboardOptions {
  host?: string
  port?: number
  view?: DashboardView
  json?: boolean
  /** Live refresh mode — polls every `interval` ms */
  watch?: boolean
  /** Poll interval in ms (default: 3000) */
  interval?: number
  /** Compact display — denser output, fewer details */
  compact?: boolean
  /** Filter DAG by graph ID */
  graphId?: string
  /** Filter DAG nodes by status */
  status?: string
  /** Filter spawns/delegations by agent name */
  agent?: string
  /** Filter signals by signal name */
  signal?: string
}

export interface DashboardCliError {
  error: string
  hint?: string
}
