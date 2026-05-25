import { afterEach, describe, expect, it } from "bun:test"
import { dashboard } from "./dashboard"
import { formatWatcherHeader, formatTextByView } from "./formatter"
import type { StateSummaryResponse, DagResponse, SpawnsResponse } from "../../features/dashboard/types"

// ─── Capture stdout/stderr ────────────────────────────────────────────────

interface Capture {
  value: string
}

function captureOutput(target: "stdout" | "stderr", sink: Capture): () => void {
  const original = process[target].write.bind(process[target])
  process[target].write = ((chunk: string | Uint8Array) => {
    sink.value += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8")
    return true
  }) as typeof process.stdout.write
  return () => {
    process[target].write = original
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

async function withTestServer(
  handler: (req: Request) => Response,
  fn: (port: number) => Promise<void>,
): Promise<void> {
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: handler,
  })
  try {
    await fn(server.port)
  } finally {
    server.stop()
  }
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("dashboard command", () => {
  const restores: Array<() => void> = []

  afterEach(() => {
    for (const r of restores) {
      r()
    }
    restores.length = 0
  })

  function capture(target: "stdout" | "stderr"): Capture {
    const sink: Capture = { value: "" }
    restores.push(captureOutput(target, sink))
    return sink
  }

  // ── Auto-start ────────────────────────────────────────────────────────

  it("auto-starts ephemeral server on a usable port", async () => {
    const probe = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("OK") })
    const usedPort = probe.port
    probe.stop()
    const stderr = capture("stderr")
    const ec = await dashboard({ host: "127.0.0.1", port: usedPort })
    expect(ec).toBe(0)
    expect(stderr.value).toBe("")
  })

  // ── Compact mode ──────────────────────────────────────────────────────

  it("compact summary omits health header, shows compact status", async () => {
    await withTestServer(
      (req) => {
        const url = new URL(req.url)
        if (url.pathname === "/api/health") {
          return Response.json({ status: "ok", version: "1.0.0", uptime_ms: 1000, hecateq_enabled: true, state_file_exists: true, ws_connections: 0 })
        }
        if (url.pathname === "/api/state/summary") {
          return Response.json({ active_graphs: 1, active_delegations: 2, active_spawns: 3, pending_signals: 4, consumed_signals: 5, dag_status: "in_progress", uptime_ms: 1000, last_event_at: "2026-05-25T10:00:00.000Z" })
        }
        return new Response("Not Found", { status: 404 })
      },
      async (port) => {
        const stdout = capture("stdout")
        const ec = await dashboard({ port, host: "127.0.0.1", compact: true })
        expect(ec).toBe(0)
        expect(stdout.value).not.toContain("Server Health")
        expect(stdout.value).toContain("IN_PROGRESS")
      },
    )
  })

  it("compact dag shows progress bar", async () => {
    await withTestServer(
      (req) => {
        const url = new URL(req.url)
        if (url.pathname === "/api/health") {
          return Response.json({ status: "ok", version: "1.0.0", uptime_ms: 1000, hecateq_enabled: true, state_file_exists: true, ws_connections: 0 })
        }
        if (url.pathname === "/api/dag") {
          return Response.json({
            active_graphs: [{
              graph_id: "dag_test", started_at: "2026-05-25T10:00:00.000Z", status: "in_progress",
              nodes: [
                { id: "n1", label: "db", domain: "db", status: "completed", required_signals: [], emitted_signal: "schema_ready", started_at: "2026-05-25T10:00:00.000Z", completed_at: "2026-05-25T10:05:00.000Z", duration_ms: 300000, error: null },
                { id: "n2", label: "backend", domain: "be", status: "in_progress", required_signals: ["schema_ready"], emitted_signal: null, started_at: "2026-05-25T10:06:00.000Z", completed_at: null, duration_ms: null, error: null },
              ],
              edges: [{ from: "n1", to: "n2", signal: "schema_ready" }],
            }],
            pending_signals: [{ signal: "backend_ready", expected_by: ["qa"], waiting_since: "2026-05-25T10:06:00.000Z", timeout_at: "2026-05-25T10:16:00.000Z" }],
            history: [],
          })
        }
        return new Response("Not Found", { status: 404 })
      },
      async (port) => {
        const stdout = capture("stdout")
        const ec = await dashboard({ port, host: "127.0.0.1", view: "dag", compact: true })
        expect(ec).toBe(0)
        expect(stdout.value).toContain("DAG")
        expect(stdout.value).toContain("dag_test")
        expect(stdout.value).toMatch(/[\u2588\u2591]/)
      },
    )
  })

  it("compact spawns shows agent/status/ratio", async () => {
    await withTestServer(
      (req) => {
        const url = new URL(req.url)
        if (url.pathname === "/api/health") {
          return Response.json({ status: "ok", version: "1.0.0", uptime_ms: 1000, hecateq_enabled: true, state_file_exists: true, ws_connections: 0 })
        }
        if (url.pathname === "/api/spawns") {
          return Response.json({
            active_sessions: [{ session_id: "ses_1", delegation_id: "dlg_1", target_agent: "database-specialist", routing_depth: 1, status: "running", spawned_at: new Date().toISOString(), elapsed_ms: 45000, timeout_ms: 300000 }],
            history: [{ session_id: "ses_0", delegation_id: "dlg_0", target_agent: "sisyphus", routing_depth: 0, status: "completed", spawned_at: new Date(Date.now() - 300000).toISOString(), elapsed_ms: 300000, timeout_ms: 300000, completed_at: new Date().toISOString(), error: null }],
            config: { max_concurrent: 5, paused_until: null, total_spawned: 2, active_count: 1 },
          })
        }
        return new Response("Not Found", { status: 404 })
      },
      async (port) => {
        const stdout = capture("stdout")
        const ec = await dashboard({ port, host: "127.0.0.1", view: "spawns", compact: true })
        expect(ec).toBe(0)
        expect(stdout.value).toContain("database-specialist")
        expect(stdout.value).toContain("1/5")
      },
    )
  })

  // ── Filter options ────────────────────────────────────────────────────

  it("agent filter passes query param", async () => {
    let capturedUrl = ""
    await withTestServer(
      (req) => {
        capturedUrl = req.url
        if (new URL(req.url).pathname === "/api/health") {
          return Response.json({ status: "ok", version: "1.0.0", uptime_ms: 1000, hecateq_enabled: true, state_file_exists: true, ws_connections: 0 })
        }
        return Response.json({ active_sessions: [], history: [], config: { max_concurrent: 5, paused_until: null, total_spawned: 0, active_count: 0 } })
      },
      async (port) => {
        await dashboard({ port, host: "127.0.0.1", view: "spawns", agent: "database-specialist" })
        expect(capturedUrl).toContain("agent=database-specialist")
      },
    )
  })

  it("signal filter passes query param", async () => {
    let capturedUrl = ""
    await withTestServer(
      (req) => {
        capturedUrl = req.url
        if (new URL(req.url).pathname === "/api/health") {
          return Response.json({ status: "ok", version: "1.0.0", uptime_ms: 1000, hecateq_enabled: true, state_file_exists: true, ws_connections: 0 })
        }
        return Response.json({ known_signals: [], pending: [], consumed: [] })
      },
      async (port) => {
        await dashboard({ port, host: "127.0.0.1", view: "signals", signal: "schema_ready" })
        expect(capturedUrl).toContain("signal=schema_ready")
      },
    )
  })

  // ── Regression: existing server tests ─────────────────────────────────

  it("returns 0 with health + summary for default view", async () => {
    await withTestServer(
      (req) => {
        const url = new URL(req.url)
        if (url.pathname === "/api/health") {
          return Response.json({ status: "ok", version: "1.0.0", uptime_ms: 5000, hecateq_enabled: true, state_file_exists: true, ws_connections: 0 })
        }
        if (url.pathname === "/api/state/summary") {
          return Response.json({ active_graphs: 1, active_delegations: 2, active_spawns: 3, pending_signals: 4, consumed_signals: 5, dag_status: "in_progress", uptime_ms: 5000, last_event_at: "2026-05-25T10:00:00.000Z" })
        }
        return new Response("Not Found", { status: 404 })
      },
      async (port) => {
        const stdout = capture("stdout")
        const ec = await dashboard({ port, host: "127.0.0.1" })
        expect(ec).toBe(0)
        expect(stdout.value).toContain("Server Health")
        expect(stdout.value).toContain("Hecateq Dashboard")
        expect(stdout.value).toContain("in_progress")
      },
    )
  })

  it("returns 0 with JSON output", async () => {
    await withTestServer(
      (req) => {
        if (new URL(req.url).pathname === "/api/health") {
          return Response.json({ status: "ok", version: "1.0.0", uptime_ms: 5000, hecateq_enabled: true, state_file_exists: true, ws_connections: 0 })
        }
        return Response.json({ message: "json mode" })
      },
      async (port) => {
        const stdout = capture("stdout")
        const ec = await dashboard({ port, host: "127.0.0.1", json: true })
        expect(ec).toBe(0)
        expect(JSON.parse(stdout.value)).toHaveProperty("message", "json mode")
      },
    )
  })

  it("handles STATE_FILE_NOT_FOUND gracefully", async () => {
    await withTestServer(
      (req) => {
        const url = new URL(req.url)
        if (url.pathname === "/api/health") {
          return Response.json({ status: "degraded", version: "1.0.0", uptime_ms: 1000, hecateq_enabled: true, state_file_exists: false, ws_connections: 0 })
        }
        if (url.pathname === "/api/state/summary") {
          return Response.json({ error: { code: "STATE_FILE_NOT_FOUND", message: "Hecateq state file not found", recoverable: false } })
        }
        return new Response("Not Found", { status: 404 })
      },
      async (port) => {
        const stdout = capture("stdout")
        const ec = await dashboard({ port, host: "127.0.0.1" })
        expect(ec).toBe(0)
        expect(stdout.value).toContain("Degraded")
        expect(stdout.value).toContain("STATE_FILE_NOT_FOUND")
      },
    )
  })

  it("returns 1 on unexpected server response", async () => {
    await withTestServer(
      () => new Response("Service Unavailable", { status: 503 }),
      async (port) => {
        const stderr = capture("stderr")
        const ec = await dashboard({ port, host: "127.0.0.1" })
        expect(ec).toBe(1)
        expect(stderr.value).toContain("HTTP 503")
      },
    )
  })
})

// ─── Formatter unit tests ─────────────────────────────────────────────────

describe("formatter", () => {
  describe("formatWatcherHeader", () => {
    it("includes iteration count and interval", () => {
      const r = formatWatcherHeader(0, 3000)
      expect(r).toContain("poll #1")
      expect(r).toContain("3s")
      expect(r).toContain("Ctrl+C")
    })

    it("increments iteration number", () => {
      expect(formatWatcherHeader(0, 3000)).toContain("poll #1")
      expect(formatWatcherHeader(5, 3000)).toContain("poll #6")
    })
  })

  describe("formatTextByView compact", () => {
    const health = { status: "ok" as const, version: "1.0.0", uptime_ms: 1000, hecateq_enabled: true, state_file_exists: true, ws_connections: 0 }

    it("compact summary omits health section", () => {
      const s: StateSummaryResponse = { active_graphs: 0, active_delegations: 0, active_spawns: 0, pending_signals: 0, consumed_signals: 0, dag_status: "completed", uptime_ms: 1000, last_event_at: null }
      const normal = formatTextByView("summary", s, health, false)
      const compact = formatTextByView("summary", s, health, true)
      expect(normal).toContain("Server Health")
      expect(compact).not.toContain("Server Health")
      expect(compact).toContain("COMPLETED")
    })

    it("compact dag shows progress bar", () => {
      const dag: DagResponse = {
        active_graphs: [{
          graph_id: "test", started_at: "2026-01-01T00:00:00.000Z", status: "in_progress",
          nodes: [
            { id: "n1", label: "alpha", domain: "a", status: "completed", required_signals: [], emitted_signal: null, started_at: "2026-01-01T00:00:00.000Z", completed_at: "2026-01-01T00:01:00.000Z", duration_ms: 60000, error: null },
            { id: "n2", label: "beta", domain: "b", status: "in_progress", required_signals: [], emitted_signal: null, started_at: "2026-01-01T00:01:00.000Z", completed_at: null, duration_ms: null, error: null },
          ],
          edges: [],
        }],
        pending_signals: [],
        history: [],
      }
      const r = formatTextByView("dag", dag, health, true)
      expect(r).toContain("test")
      expect(r).not.toContain("Server Health")
    })

    it("compact spawns shows ratio", () => {
      const sp: SpawnsResponse = {
        active_sessions: [{ session_id: "s1", delegation_id: "d1", target_agent: "oracle", routing_depth: 1, status: "in_progress", spawned_at: new Date().toISOString(), elapsed_ms: 10000, timeout_ms: 300000 }],
        history: [],
        config: { max_concurrent: 5, paused_until: null, total_spawned: 1, active_count: 1 },
      }
      const r = formatTextByView("spawns", sp, health, true)
      expect(r).toContain("oracle")
      expect(r).toContain("1/5")
    })
  })
})
