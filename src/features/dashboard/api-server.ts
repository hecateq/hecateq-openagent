import { createStateSnapshotter } from "./state-snapshotter"
import type { DashboardError } from "./types"

export interface DashboardServerConfig {
  port: number
  host: string
  projectDir: string
}

export interface DashboardServer {
  start: () => void
  stop: () => Promise<void>
  getUrl: () => string
}

const METHOD_NOT_ALLOWED = new Response(
  JSON.stringify({ error: { code: "METHOD_NOT_ALLOWED", message: "Only GET is supported in MVP", recoverable: false } }),
  { status: 405, headers: { "content-type": "application/json" } },
)

const NOT_IMPLEMENTED = (endpoint: string) => new Response(
  JSON.stringify({ error: { code: "NOT_IMPLEMENTED", message: `Endpoint ${endpoint} not available in this phase`, recoverable: false } }),
  { status: 501, headers: { "content-type": "application/json" } },
)

const INTERNAL_ERROR = (message: string) => new Response(
  JSON.stringify({ error: { code: "INTERNAL_ERROR", message, recoverable: false } }),
  { status: 500, headers: { "content-type": "application/json" } },
)

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

export function createDashboardServer(config: DashboardServerConfig): DashboardServer {
  const { port, host, projectDir } = config
  const startTime = Date.now()
  const snapshotter = createStateSnapshotter(projectDir)

  let server: ReturnType<typeof Bun.serve> | null = null

  function getUptimeMs(): number {
    return Date.now() - startTime
  }

  async function handleRequest(req: Request): Promise<Response> {
    if (req.method !== "GET") {
      return METHOD_NOT_ALLOWED
    }

    const url = new URL(req.url)
    const path = url.pathname

    try {
      switch (path) {
        case "/api/health":
          return jsonResponse(snapshotter.getHealth(getUptimeMs()))

        case "/api/state":
          return jsonResponse(snapshotter.getState())

        case "/api/state/summary":
          return jsonResponse(snapshotter.getSummary(getUptimeMs()))

        case "/api/dag": {
          const graphId = url.searchParams.get("graph_id") ?? undefined
          const status = url.searchParams.get("status") ?? undefined
          return jsonResponse(snapshotter.getDag({ graph_id: graphId, status }))
        }

        case "/api/signals":
          return jsonResponse(snapshotter.getSignals())

        case "/api/delegations":
          return jsonResponse(snapshotter.getDelegations())

        case "/api/spawns":
          return jsonResponse(snapshotter.getSpawns())

        case "/api/history":
          return jsonResponse(snapshotter.getHistory())

        default:
          return NOT_IMPLEMENTED(path)
      }
    } catch (err) {
      return INTERNAL_ERROR(err instanceof Error ? err.message : String(err))
    }
  }

  return {
    start() {
      server = Bun.serve({
        port,
        hostname: host,
        fetch: handleRequest,
      })
    },

    async stop() {
      if (server) {
        server.stop()
        server = null
      }
    },

    getUrl() {
      return `http://${host}:${port}`
    },
  }
}
