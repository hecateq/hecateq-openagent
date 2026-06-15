#!/usr/bin/env bun

import { $ } from "bun"
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { tmpdir } from "node:os"
import { type CheckSeverity, DEFAULT_PACKAGE_POLICY, classifyFile } from "./package-policy"

export interface SmokeCheck {
  name: string
  severity: CheckSeverity
  detail?: string
}

export interface SmokeTestResult {
  passed: boolean
  checks: SmokeCheck[]
  failureCount: number
  warningCount: number
  passCount: number
}

interface WalkedFile {
  relativePath: string
  size: number
}

function walkPackageDir(rootDir: string): WalkedFile[] {
  const results: WalkedFile[] = []

  function walk(dir: string): void {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const name of entries) {
      const fullPath = join(dir, name)
      let st
      try {
        st = statSync(fullPath)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        walk(fullPath)
      } else if (st.isFile()) {
        results.push({
          relativePath: relative(rootDir, fullPath),
          size: st.size,
        })
      }
    }
  }

  walk(rootDir)
  return results
}

async function packPackage(tmpDir: string, pkgPath: string): Promise<string | null> {
  try {
    const packResult = await $`npm pack --pack-destination ${tmpDir}`.cwd(pkgPath)
    const allOutput = packResult.text().trim()
    const lines = allOutput.split("\n").filter((l) => l.trim())
    const tarballName = lines[lines.length - 1]?.trim()
    const tarballPath = tarballName ? join(tmpDir, tarballName) : ""
    if (tarballName && existsSync(tarballPath)) {
      return tarballName
    }
    const entries = readdirSyncSafe(tmpDir)
    if (entries) {
      const tgzFile = entries.find((e) => e.endsWith(".tgz"))
      if (tgzFile) return tgzFile
    }
    return null
  } catch {
    return null
  }
}

function readdirSyncSafe(dir: string): string[] | null {
  try {
    const { readdirSync: rds } = require("node:fs") as typeof import("node:fs")
    return rds(dir)
  } catch {
    return null
  }
}

async function installPackage(tmpDir: string, tarballPath: string): Promise<string | null> {
  try {
    const installDir = join(tmpDir, "install")
    rmSync(installDir, { recursive: true, force: true })
    await $`mkdir -p ${installDir}`
    await Bun.write(join(installDir, "package.json"), JSON.stringify({
      name: "smoke-test",
      version: "0.0.0",
      private: true,
    }))
    await $`npm install ${tarballPath}`.cwd(installDir)
    return installDir
  } catch {
    return null
  }
}

export async function runSmokeTests(packagePath?: string): Promise<SmokeTestResult> {
  const checks: SmokeCheck[] = []
  const tmpDir = mkdtempSync(join(tmpdir(), "hecateq-smoke-"))

  try {
    const resolvedPkgPath = packagePath ?? join(import.meta.dir!, "..")

    const tarballName = await packPackage(tmpDir, resolvedPkgPath)
    if (tarballName) {
      checks.push({
        name: "npm pack creates tarball",
        severity: "pass",
        detail: `Created ${tarballName}`,
      })
    } else {
      checks.push({
        name: "npm pack creates tarball",
        severity: "failure",
        detail: "Tarball creation failed",
      })
    }

    if (!tarballName) {
      const failures = checks.filter((c) => c.severity === "failure").length
      const warnings = checks.filter((c) => c.severity === "warning").length
      const passes = checks.filter((c) => c.severity === "pass").length
      return { passed: false, checks, failureCount: failures, warningCount: warnings, passCount: passes }
    }

    const installDir = await installPackage(tmpDir, join(tmpDir, tarballName))
    if (installDir) {
      checks.push({
        name: "npm install from tarball succeeds",
        severity: "pass",
        detail: `Installed in ${installDir}`,
      })
    } else {
      checks.push({
        name: "npm install from tarball succeeds",
        severity: "failure",
        detail: "Install failed",
      })
    }

    if (!installDir) {
      const failures = checks.filter((c) => c.severity === "failure").length
      const warnings = checks.filter((c) => c.severity === "warning").length
      const passes = checks.filter((c) => c.severity === "pass").length
      return { passed: false, checks, failureCount: failures, warningCount: warnings, passCount: passes }
    }

    const nodeModules = join(installDir, "node_modules", "@hecateq", "hecateq-openagent")

    // Check: plugin entry loads via require
    const requireResult = await (async () => {
      try {
        const result = await $`node -e "const m = require('${nodeModules}'); console.log('loaded:', typeof m)"`
        return result.text().trim()
      } catch (err) {
        return `failed: ${err}`
      }
    })()
    checks.push({
      name: "plugin entry loads via require",
      severity: requireResult.includes("loaded:") ? "pass" : "failure",
      detail: requireResult,
    })

    // Check: CLI binary exists
    const cliPath = join(nodeModules, "bin", "oh-my-opencode.js")
    checks.push({
      name: "CLI binary exists",
      severity: existsSync(cliPath) ? "pass" : "failure",
      detail: existsSync(cliPath) ? `Found at ${cliPath}` : `Not found at ${cliPath}`,
    })

    // Check: schema JSON files present
    const schema1 = join(nodeModules, "dist", "oh-my-opencode.schema.json")
    const schema2 = join(nodeModules, "dist", "hecateq-openagent.schema.json")
    const schemasOk = existsSync(schema1) && existsSync(schema2)
    checks.push({
      name: "schema JSON files present",
      severity: schemasOk ? "pass" : "failure",
      detail: `oh-my-opencode: ${existsSync(schema1)}, hecateq: ${existsSync(schema2)}`,
    })

    // Check: postinstall.mjs present
    const postinstallPath = join(nodeModules, "postinstall.mjs")
    checks.push({
      name: "postinstall.mjs present",
      severity: existsSync(postinstallPath) ? "pass" : "failure",
      detail: existsSync(postinstallPath) ? "Found" : "Not found",
    })

    // Check: package.json version present
    const versionCheck = await (async () => {
      try {
        const installedPkg = await Bun.file(join(nodeModules, "package.json")).json()
        const ver: string | undefined = installedPkg.version
        return { version: ver ?? null, error: null as string | null }
      } catch (err) {
        return { version: null as string | null, error: String(err) }
      }
    })()
    checks.push({
      name: "package.json version present",
      severity: versionCheck.version ? "pass" : "failure",
      detail: versionCheck.version
        ? `Version: ${versionCheck.version}`
        : (versionCheck.error ?? "No version field"),
    })

    // Walk installed package for policy checks and size
    const pkgFiles = walkPackageDir(nodeModules)
    const forbiddenFiles: string[] = []
    const warningFiles: string[] = []
    let totalUnpackedSize = 0

    for (const file of pkgFiles) {
      totalUnpackedSize += file.size
      const severity = classifyFile(file.relativePath, DEFAULT_PACKAGE_POLICY)
      if (severity === "failure") {
        forbiddenFiles.push(file.relativePath)
      } else if (severity === "warning") {
        warningFiles.push(file.relativePath)
      }
    }

    // Check: no forbidden files in package (policy-based scan)
    checks.push({
      name: "no forbidden files in package",
      severity: forbiddenFiles.length === 0 ? "pass" : "failure",
      detail: forbiddenFiles.length === 0
        ? "No forbidden files found"
        : `Found ${forbiddenFiles.length} forbidden: ${forbiddenFiles.join(", ")}`,
    })

    // Check: beta/pre-release version detected (warning)
    const isBeta = versionCheck.version ? /beta|alpha|rc|pre|dev|canary/i.test(versionCheck.version) : false
    checks.push({
      name: "beta/pre-release version detected",
      severity: isBeta ? "warning" : "pass",
      detail: isBeta
        ? `Version ${versionCheck.version} appears to be a pre-release`
        : versionCheck.version
          ? `Version ${versionCheck.version} looks stable`
          : "Version unknown",
    })

    // Check: package size within recommended limit (warning if > 10MB)
    const sizeMB = totalUnpackedSize / (1024 * 1024)
    checks.push({
      name: "package size within recommended limit",
      severity: sizeMB > 10 ? "warning" : "pass",
      detail: sizeMB > 10
        ? `Unpacked size ${sizeMB.toFixed(1)}MB exceeds 10MB threshold`
        : `Unpacked size ${sizeMB.toFixed(1)}MB (under 10MB limit)`,
    })

    const failures = checks.filter((c) => c.severity === "failure").length
    const warnings = checks.filter((c) => c.severity === "warning").length
    const passes = checks.filter((c) => c.severity === "pass").length

    return { passed: failures === 0, checks, failureCount: failures, warningCount: warnings, passCount: passes }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

export function formatSmokeResults(result: SmokeTestResult): string {
  const lines: string[] = []
  const iconMap: Record<CheckSeverity, string> = {
    pass: "✅",
    warning: "⚠️",
    failure: "❌",
  }

  lines.push("")
  lines.push("=".repeat(60))
  const hasFailures = result.failureCount > 0
  lines.push(`🔥 Smoke Test Results: ${hasFailures ? "❌ FAILED" : "✅ PASSED"}`)
  lines.push("=".repeat(60))

  for (const check of result.checks) {
    const icon = iconMap[check.severity]
    lines.push(`  ${icon} ${check.name}`)
    if (check.detail) {
      lines.push(`       ${check.detail}`)
    }
  }

  lines.push("")
  const parts: string[] = []
  if (result.passCount > 0) parts.push(`${result.passCount} passed`)
  if (result.warningCount > 0) parts.push(`${result.warningCount} warning${result.warningCount !== 1 ? "s" : ""}`)
  if (result.failureCount > 0) parts.push(`${result.failureCount} failed`)
  lines.push(`  Summary: ${parts.join(", ")}`)
  lines.push("")
  return lines.join("\n")
}

async function main(): Promise<void> {
  console.log("🔥 Running fresh install smoke tests...")

  const result = await runSmokeTests()
  console.log(formatSmokeResults(result))

  const hasFailures = result.checks.some((c) => c.severity === "failure")
  if (hasFailures) {
    process.exit(1)
  }
  // warnings only → exit 0
  process.exit(0)
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("Fatal error:", error)
    process.exit(1)
  })
}
