import type {
  DagResponse,
  DelegationsResponse,
  HealthResponse,
  HistoryResponse,
  SignalsResponse,
  SpawnsResponse,
  StateResponse,
  StateSummaryResponse,
  DashboardError,
} from "../../features/dashboard/types"
import type { DashboardOptions, DashboardView } from "./types"
import {
  formatApiError,
  formatHealth,
  formatJsonOutput,
  formatTextByView,
  formatWatcherHeader,
} from "./formatter"
import type { DashboardServer } from "../../features/dashboard/api-server"

// ─── Constants ─────────────────────────────────────────────────────────────

const DEFAULT_PORT = 3245
const DEFAULT_HOST = "127.0.0.1"
const DEFAULT_INTERVAL_MS = 3000

// ─── API endpoints ─────────────────────────────────────────────────────────

const ENDPOINTS: Record<DashboardView, string> = {
  summary: "/api/state/summary",
  dag: "/api/dag",
  signals: "/api/signals",
  delegations: "/api/delegations",
  spawns: "/api/spawns",
  history: "/api/history",
  state: "/api/state",
}

// ─── HTTP helper ───────────────────────────────────────────────────────────

async function fetchJson<T>(baseUrl: string, path: string): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`)
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`HTTP ${response.status}: ${body}`)
  }
  return response.json() as Promise<T>
}

function isDashboardError(data: unknown): data is DashboardError {
  if (typeof data !== "object" || data === null) return false
  const d = data as Record<string, unknown>
  return typeof d.error === "object" && d.error !== null && typeof (d.error as Record<string, unknown>).code === "string"
}

// ─── Ephemeral server management ───────────────────────────────────────────

async function tryHealthCheck(baseUrl: string): Promise<HealthResponse | null> {
  try {
    const response = await fetch(`${baseUrl}/api/health`)
    if (!response.ok) {
      return {
        status: "degraded",
        version: "unknown",
        uptime_ms: 0,
        hecateq_enabled: false,
        state_file_exists: false,
        ws_connections: 0,
      }
    }
    const body = await response.json()
    return body as HealthResponse
  } catch {
    return null
  }
}

async function startEphemeralServer(host: string, port: number): Promise<{ server: DashboardServer; port: number } | null> {
  try {
    const { createDashboardServer } = await import("../../features/dashboard/api-server")
    const server = createDashboardServer({
      port,
      host,
      projectDir: process.cwd(),
    })
    server.start()
    const health = await tryHealthCheck(`http://${host}:${port}`)
    if (!health) {
      server.stop()
      return null
    }
    return { server, port }
  } catch {
    return null
  }
}

// ─── Fetch and display (single-shot, used by both normal and watch modes) ───

async function fetchAndDisplay(
  view: DashboardView,
  options: DashboardOptions,
  baseUrl: string,
  health: HealthResponse,
): Promise<number> {
  // Build endpoint URL with optional query params
  let endpoint = options.json ? "/api/state/summary" : ENDPOINTS[view]
  const params = new URLSearchParams()
  if (options.graphId) params.set("graph_id", options.graphId)
  if (options.status) params.set("status", options.status)
  if (options.agent) params.set("agent", options.agent)
  if (options.signal) params.set("signal", options.signal)
  const queryString = params.toString()
  if (queryString) endpoint += `?${queryString}`

  let viewData: unknown
  try {
    viewData = await fetchJson(baseUrl, endpoint)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    process.stderr.write(`${formatApiError("FETCH_ERROR", message)}\n`)
    return 1
  }

  if (isDashboardError(viewData)) {
    const errPayload = (viewData as DashboardError).error
    if (options.json) {
      process.stdout.write(`${formatJsonOutput(viewData)}\n`)
      return 0
    }
    if (view === "summary") {
      const lines: string[] = []
      lines.push(formatHealth(health))
      lines.push("")
      lines.push(`  ${errPayload.code}: ${errPayload.message}`)
      process.stdout.write(`${lines.join("\n")}\n`)
      return 0
    }
    process.stderr.write(`${formatApiError(errPayload.code, errPayload.message)}\n`)
    return 0
  }

  if (options.json) {
    process.stdout.write(`${formatJsonOutput(viewData)}\n`)
    return 0
  }

  const compact = options.compact ?? false
  const body = formatTextByView(view, viewData, health, compact)
  process.stdout.write(`${body}\n`)
  return 0
}

// ─── Ensure server is running ──────────────────────────────────────────────

async function ensureServer(
  host: string,
  port: number,
): Promise<{ baseUrl: string; health: HealthResponse; ephemeral: DashboardServer | null } | { error: true; message: string }> {
  const baseUrl = `http://${host}:${port}`
  let health = await tryHealthCheck(baseUrl)
  let ephemeral: DashboardServer | null = null

  if (!health) {
    const result = await startEphemeralServer(host, port)
    if (!result) {
      return {
        error: true,
        message: `Error: Could not start Hecateq dashboard server on ${host}:${port}.\n`
          + `The port may be in use by another process, or the Hecateq state directory is not available.\n`
          + `Use --port to specify a different port.\n`,
      }
    }
    ephemeral = result.server
    health = await tryHealthCheck(baseUrl)
    if (!health) {
      ephemeral.stop()
      return { error: true, message: "Error: Ephemeral dashboard server started but not responding.\n" }
    }
  }

  return { baseUrl, health, ephemeral }
}

// ─── Main dashboard function ───────────────────────────────────────────────

export async function dashboard(options: DashboardOptions): Promise<number> {
  const host = options.host ?? DEFAULT_HOST
  const port = options.port ?? DEFAULT_PORT
  const view = options.view ?? "summary"
  const interval = options.interval ?? DEFAULT_INTERVAL_MS

  // 1. Ensure server is running (ephemeral auto-start if needed)
  const server = await ensureServer(host, port)
  if ("error" in server) {
    process.stderr.write(server.message)
    return 1
  }

  const { baseUrl, health, ephemeral } = server

  try {
    // 2. Watch mode — poll and redraw
    if (options.watch) {
      let iteration = 0
      // eslint-disable-next-line no-constant-condition
      while (true) {
        console.clear()
        // Print watcher header
        process.stdout.write(formatWatcherHeader(iteration, interval, health))
        process.stdout.write("\n\n")

        const result = await fetchAndDisplay(view, options, baseUrl, health)
        if (result !== 0) return result

        iteration++
        await new Promise((resolve) => setTimeout(resolve, interval))
      }
    }

    // 3. Normal mode — single-shot fetch and display
    return await fetchAndDisplay(view, options, baseUrl, health)
  } finally {
    if (ephemeral) {
      ephemeral.stop()
    }
  }
}
