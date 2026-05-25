import { afterEach, describe, expect, it } from "bun:test"
import { dashboardServe } from "./serve"
import { OmoStateManager } from "../../features/hecateq-orchestration/omo-state-manager"
import { mkdtempSync, rmSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

// ─── Helpers ───────────────────────────────────────────────────────────────

function capture(target: "stdout" | "stderr"): { ref: { value: string }; restore: () => void } {
  const ref = { value: "" }
  const original = process[target].write.bind(process[target])
  process[target].write = ((chunk: string | Uint8Array) => {
    ref.value += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8")
    return true
  }) as typeof process.stdout.write
  return { ref, restore: () => { process[target].write = original } }
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("dashboardServe", () => {
  const tempDirs: string[] = []
  const restores: Array<() => void> = []

  afterEach(() => {
    for (const r of restores) r()
    restores.length = 0
    for (const d of tempDirs) {
      try { rmSync(d, { recursive: true, force: true }) } catch {}
    }
    tempDirs.length = 0
  })

  function createTempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "omo-serve-test-"))
    tempDirs.push(dir)
    return dir
  }

  // ── Error: port in use ────────────────────────────────────────────────

  it("returns 1 when port is already in use", async () => {
    // Start a server on a known port to occupy it
    const blocker = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("OK") })
    const occupiedPort = blocker.port

    const err = capture("stderr")
    const ec = await dashboardServe({ host: "127.0.0.1", port: occupiedPort })
    err.restore()
    blocker.stop()

    expect(ec).toBe(1)
    expect(err.ref.value).toContain("Error")
    expect(err.ref.value).toContain(String(occupiedPort))
  })

  // ── Server responds to health and state endpoints ─────────────────────

  it("serves health and state endpoints when running", async () => {
    const dir = createTempDir()
    const stateMgr = new OmoStateManager(dir)
    const state = stateMgr.readOrCreate()
    stateMgr.emitSignal("schema_ready", { source: "database-specialist" })

    const origCwd = process.cwd
    process.cwd = () => dir
    restores.push(() => { process.cwd = origCwd })

    // Start serve in background, capture its port
    // Since dashboardServe blocks, we need to fork. Use startEphemeralServer
    // from dashboard.ts (it's imported above) instead for testing.
    // Actually, for testing the server's functionality, we can use createDashboardServer directly.
    const { createDashboardServer } = await import("../../features/dashboard/api-server")
    const server = createDashboardServer({ port: 0, host: "127.0.0.1", projectDir: dir })
    server.start()

    // Discover the actual port since port 0 was used
    // The DashboardServer interface doesn't expose the actual port.
    // Let's find it by checking the snapshotter output via a health fetch on a known port.
    // Actually, this is a limitation — with port 0 we can't discover the port.
    // Let's use a fixed port instead.
    server.stop()

    // Recreate with a known port
    const knownPort = 26201
    const server2 = createDashboardServer({ port: knownPort, host: "127.0.0.1", projectDir: dir })
    server2.start()

    const baseUrl = `http://127.0.0.1:${knownPort}`

    // Health
    const health = await fetch(`${baseUrl}/api/health`).then((r) => r.json())
    expect(health).toHaveProperty("status", "ok")
    expect(health).toHaveProperty("version")

    // Summary
    const summary = await fetch(`${baseUrl}/api/state/summary`).then((r) => r.json())
    expect(summary).toHaveProperty("pending_signals", 1)

    // Signals
    const signals = await fetch(`${baseUrl}/api/signals`).then((r) => r.json())
    expect(signals).toHaveProperty("known_signals")
    expect(signals.known_signals.length).toBeGreaterThanOrEqual(1)
    expect(signals.known_signals[0]).toHaveProperty("signal", "schema_ready")

    // State
    const stateResp = await fetch(`${baseUrl}/api/state`).then((r) => r.json())
    expect(stateResp).toHaveProperty("signal_registry")
    expect(stateResp).toHaveProperty("spawn")

    // 405 on POST
    const postResp = await fetch(`${baseUrl}/api/state`, { method: "POST" })
    expect(postResp.status).toBe(405)

    // 501 on unknown endpoint
    const unknownResp = await fetch(`${baseUrl}/api/control/pause`)
    expect(unknownResp.status).toBe(501)

    server2.stop()
  })
})

// ─── Client-connects-to-server integration ─────────────────────────────────

describe("client connects to persistent server", () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const d of tempDirs) {
      try { rmSync(d, { recursive: true, force: true }) } catch {}
    }
    tempDirs.length = 0
  })

  it("dashboard view command reads from a running persistent server", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omo-client-test-"))
    tempDirs.push(dir)
    const stateMgr = new OmoStateManager(dir)
    stateMgr.readOrCreate()
    stateMgr.emitSignal("schema_ready", { source: "db" })

    // 1. Start a persistent server
    const { createDashboardServer } = await import("../../features/dashboard/api-server")
    const server = createDashboardServer({ port: 26202, host: "127.0.0.1", projectDir: dir })
    server.start()

    // 2. Run the dashboard client command, which should find the existing server
    const { dashboard } = await import("./dashboard")
    let captured = ""
    const origStdout = process.stdout.write.bind(process.stdout)
    process.stdout.write = ((chunk: any) => { captured += String(chunk); return true }) as any
    const ec = await dashboard({ port: 26202, host: "127.0.0.1", view: "summary" })
    process.stdout.write = origStdout

    expect(ec).toBe(0)
    // Should have found the existing server and shown its data
    expect(captured).toContain("Server Health")
    expect(captured).toContain("Hecateq Dashboard")
    expect(captured).toContain("pending")

    // 3. Also test DAG view against the same server
    captured = ""
    process.stdout.write = ((chunk: any) => { captured += String(chunk); return true }) as any
    const ec2 = await dashboard({ port: 26202, host: "127.0.0.1", view: "dag" })
    process.stdout.write = origStdout
    expect(ec2).toBe(0)
    expect(captured).toContain("DAG")

    server.stop()
  })
})
