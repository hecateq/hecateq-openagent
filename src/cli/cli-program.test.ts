import { describe, test, expect } from "bun:test"
import { readFile } from "node:fs/promises"
import path from "node:path"

describe("cli-program", () => {
  test("dashboard command is registered with views and serve subcommand", async () => {
    // given
    const cliProgramSource = await readFile(
      path.resolve(import.meta.dir, "cli-program.ts"),
      "utf-8",
    )

    // when — the dashboardCmd builder defines both the default view action and the serve subcommand
    const viewAction = cliProgramSource.match(
      /const dashboardCmd[\s\S]*?\.argument\("\[view\]"[\s\S]*?\.action\(/,
    )
    const serveCmd = cliProgramSource.match(
      /dashboardCmd\s*\n\s*\.command\("serve"\)/,
    )

    // then
    expect(viewAction).not.toBeNull()
    expect(viewAction?.[0]).toContain("[view]")
    expect(viewAction?.[0]).toContain("--json")
    expect(viewAction?.[0]).toContain("--watch")
    expect(viewAction?.[0]).toContain("--compact")
    expect(viewAction?.[0]).toContain("summary")
    expect(viewAction?.[0]).toContain("dag")
    expect(viewAction?.[0]).toContain("signals")
    expect(viewAction?.[0]).toContain("delegations")
    expect(viewAction?.[0]).toContain("spawns")
    expect(viewAction?.[0]).toContain("history")
    expect(viewAction?.[0]).toContain("state")

    expect(serveCmd).not.toBeNull()
    expect(serveCmd?.[0]).toContain('"serve"')
  })

  test("install command exposes 'setup' as an alias so the historical install path keeps working", async () => {
    // given
    const cliProgramSource = await readFile(
      path.resolve(import.meta.dir, "cli-program.ts"),
      "utf-8",
    )

    // when
    const installBlock = cliProgramSource.match(
      /program\s*\n\s*\.command\("install"\)([\s\S]*?)\.action\(/,
    )

    // then
    expect(installBlock).not.toBeNull()
    expect(installBlock?.[1]).toContain('.alias("setup")')
  })
})
