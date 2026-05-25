import color from "picocolors"

import type { DashboardServer } from "../../features/dashboard/api-server"

// ─── Constants ─────────────────────────────────────────────────────────────

const DEFAULT_PORT = 3245
const DEFAULT_HOST = "127.0.0.1"

// ─── Serve options ─────────────────────────────────────────────────────────

export interface ServeOptions {
  host?: string
  port?: number
}

// ─── Persistent server lifecycle ───────────────────────────────────────────

/**
 * Start a long-lived dashboard server that stays running until Ctrl+C.
 * Reuses Stage 4b `createDashboardServer` with process.cwd() as project root.
 *
 * Prints a status banner, installs SIGINT/SIGTERM handlers for clean shutdown,
 * and blocks until the process is signalled.
 */
export async function dashboardServe(options: ServeOptions): Promise<number> {
  const host = options.host ?? DEFAULT_HOST
  const port = options.port ?? DEFAULT_PORT

  // 1. Create the server via Stage 4b runtime
  let server: DashboardServer
  try {
    const { createDashboardServer } = await import("../../features/dashboard/api-server")
    server = createDashboardServer({
      port,
      host,
      projectDir: process.cwd(),
    })
    server.start()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    process.stderr.write(
      `Error: Could not start dashboard server on ${host}:${port}.\n  ${message}\n`,
    )
    return 1
  }

  const url = `http://${host}:${port}`

  // 2. Verify the server is actually responding
  let healthy = false
  try {
    const res = await fetch(`${url}/api/health`)
    if (res.ok) healthy = true
  } catch {
    // Will check below
  }

  if (!healthy) {
    server.stop()
    process.stderr.write(
      `Error: Dashboard server started on ${host}:${port} but health check failed.\n`,
    )
    return 1
  }

  // 3. Print startup banner
  const banner = [
    "",
    color.bold(color.cyan("Hecateq Dashboard Server")),
    color.dim("\u2500".repeat(48)),
    `  URL:     ${color.bold(url)}`,
    `  Status:  ${color.green("running")}`,
    `  Project: ${color.dim(process.cwd())}`,
    color.dim("\u2500".repeat(48)),
    color.dim("  Press Ctrl+C to stop"),
    "",
  ].join("\n")

  process.stdout.write(banner)

  // 4. Install signal handlers for clean shutdown
  const shutdown = () => {
    process.stdout.write(`\n${color.dim("Shutting down dashboard server...")}\n`)
    server.stop()
    process.exit(0)
  }

  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)

  // 5. Block indefinitely. The process stays alive via the HTTP server.
  //    Bun.serve keeps the event loop alive. We just need to prevent
  //    the Promise from resolving.
  await new Promise<never>(() => {})
  return 0
}
