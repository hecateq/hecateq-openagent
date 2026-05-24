import { existsSync, readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import type {
  QualityGateKind,
  QualityGateResult,
  QualityGateReport,
  ResolvedOrchestrationConfig,
} from "./types"

/**
 * Script key mapping for quality gate commands.
 */
const QUALITY_GATE_SCRIPTS: Record<QualityGateKind, string[]> = {
  typecheck: ["typecheck", "type-check", "typescript", "tsc", "typecheck:ci"],
  lint: ["lint", "lint:ci", "eslint"],
  test: ["test", "ci", "test:ci", "test:run"],
  build: ["build", "build:ci", "compile"],
  doctor: ["doctor", "check"],
}

interface PackageJsonScripts {
  [key: string]: string
}

/**
 * Discover available scripts from package.json.
 */
function discoverScripts(projectDir: string): PackageJsonScripts {
  const pkgPath = `${projectDir}/package.json`
  if (!existsSync(pkgPath)) return {}
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { scripts?: PackageJsonScripts }
    return pkg.scripts ?? {}
  } catch {
    return {}
  }
}

/**
 * Resolve the best matching script for a quality gate from available scripts.
 */
function resolveScript(
  gate: QualityGateKind,
  availableScripts: PackageJsonScripts,
): string | null {
  const candidates = QUALITY_GATE_SCRIPTS[gate]
  for (const candidate of candidates) {
    if (candidate in availableScripts) return candidate
  }
  return null
}

/**
 * Run a single quality gate command.
 */
function runQualityGate(gate: QualityGateKind, scriptName: string, cwd: string, timeoutMs: number): QualityGateResult {
  try {
    const stdoutBuffer: string[] = []
    const stderrBuffer: string[] = []

    const result = execFileSync(
      "bun",
      ["run", scriptName],
      {
        cwd,
        encoding: "utf-8",
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      },
    )

    stdoutBuffer.push(result)

    // Attempt parsing as BunExecFileResult
    const stdout = typeof result === "string" ? result : stdoutBuffer.join("\n")

    return {
      gate,
      passed: true,
      command: `bun run ${scriptName}`,
      exitCode: 0,
      stdout: stdout.slice(0, 500),
      stderr: "",
      message: `${gate} check passed`,
      skipped: false,
    }
  } catch (error: unknown) {
    const err = error as {
      status?: number
      stdout?: string | Buffer
      stderr?: string | Buffer
      message?: string
    }

    const exitCode = err.status ?? 1
    const stderr = typeof err.stderr === "string"
      ? err.stderr
      : err.stderr?.toString("utf-8") ?? err.message ?? ""

    return {
      gate,
      passed: exitCode === 0,
      command: `bun run ${scriptName}`,
      exitCode,
      stdout: typeof err.stdout === "string" ? err.stdout.slice(0, 500) : "",
      stderr: stderr.slice(0, 500),
      message: exitCode === 0 ? `${gate} check passed` : `${gate} check failed (exit ${exitCode})`,
      skipped: false,
    }
  }
}

/**
 * Run quality gates on a project.
 *
 * Detects available project scripts and runs the relevant validation commands
 * (typecheck, lint, test, build, doctor) based on config.
 * Does NOT claim success for missing gates — reports them as skipped.
 */
export function runQualityGates(
  projectDir: string,
  config: ResolvedOrchestrationConfig,
  timeoutMs = 300000,
): QualityGateReport {
  const gateKinds: QualityGateKind[] = ["typecheck", "lint", "test", "build", "doctor"]
  const activeGates = gateKinds.filter((gate) => config.qualityGates[gate])

  const scripts = discoverScripts(projectDir)
  const discoveredCommands: Record<string, string> = {}

  const results: QualityGateResult[] = []

  for (const gate of activeGates) {
    const scriptName = resolveScript(gate, scripts)
    if (!scriptName) {
      results.push({
        gate,
        passed: false,
        message: `No matching script found in package.json for "${gate}"`,
        skipped: true,
        command: undefined,
      })
      continue
    }

    discoveredCommands[gate] = scriptName
    const result = runQualityGate(gate, scriptName, projectDir, timeoutMs)
    results.push(result)
  }

  const passedCount = results.filter((r) => r.passed).length
  const failedCount = results.filter((r) => !r.passed && !r.skipped).length
  const skippedCount = results.filter((r) => r.skipped).length

  return {
    results,
    allPassed: failedCount === 0,
    passedCount,
    failedCount,
    skippedCount,
    discoveredCommands,
  }
}
