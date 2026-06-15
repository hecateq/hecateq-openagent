#!/usr/bin/env bun

import { DEFAULT_PACKAGE_POLICY, matchesPattern, matchesAnyPattern } from "./package-policy"
export { matchesPattern, matchesAnyPattern }

export interface ValidationViolation {
  type: "missing_required" | "unwanted_file"
  path: string
  message: string
}

export interface PackageValidationResult {
  packageName: string
  version: string
  totalFiles: number
  violations: ValidationViolation[]
  passed: boolean
}

export const REQUIRED_FILE_PATTERNS: string[] = DEFAULT_PACKAGE_POLICY.requiredFiles

export const FORBIDDEN_FILE_PATTERNS: string[] = DEFAULT_PACKAGE_POLICY.forbiddenPatterns

export interface PackManifest {
  files: string[]
  packageName: string
  version: string
}

export function parsePackOutput(output: string): PackManifest {
  const lines = output.split("\n")
  const files: string[] = []
  let packageName = ""
  let version = ""

  for (const line of lines) {
    const nameMatch = line.match(/^npm notice name:\s+(.+)$/)
    if (nameMatch) {
      packageName = nameMatch[1]!.trim()
      continue
    }
    const versionMatch = line.match(/^npm notice version:\s+(.+)$/)
    if (versionMatch) {
      version = versionMatch[1]!.trim()
      continue
    }

    if (
      !line.startsWith("npm notice ") ||
      line.includes("Tarball") ||
      line.includes("package size:") ||
      line.includes("unpacked size:") ||
      line.includes("shasum:") ||
      line.includes("integrity:") ||
      line.includes("total files:") ||
      line.includes("filename:")
    ) {
      continue
    }

    const fileMatch = line.match(/^npm notice\s+\S+\s+(.+)$/)
    if (fileMatch) {
      const path = fileMatch[1]!.trim()
      if (path !== "@" && !path.startsWith("@hecateq/")) {
        files.push(path)
      }
    }
  }

  return { files, packageName, version }
}

export function validatePackage(
  manifest: PackManifest,
  allowlist?: string[],
  denylist?: string[],
): PackageValidationResult {
  const violations: ValidationViolation[] = []
  const resolvedAllowlist = allowlist ?? REQUIRED_FILE_PATTERNS
  const resolvedDenylist = denylist ?? FORBIDDEN_FILE_PATTERNS

  for (const pattern of resolvedAllowlist) {
    const matched = manifest.files.some((f) => matchesPattern(f, pattern))
    if (!matched) {
      violations.push({
        type: "missing_required",
        path: pattern,
        message: `Required file matching "${pattern}" not found in package`,
      })
    }
  }

  for (const pattern of resolvedDenylist) {
    const matched = manifest.files.filter((f) => matchesPattern(f, pattern))
    if (matched.length > 0) {
      violations.push({
        type: "unwanted_file",
        path: pattern,
        message: `Found ${matched.length} file(s) matching forbidden pattern "${pattern}": ${matched.join(", ")}`,
      })
    }
  }

  return {
    packageName: manifest.packageName,
    version: manifest.version,
    totalFiles: manifest.files.length,
    violations,
    passed: violations.length === 0,
  }
}

export function formatViolations(result: PackageValidationResult): string {
  const lines: string[] = []
  lines.push("")
  lines.push("=".repeat(60))
  lines.push(`Package Validation: ${result.packageName}@${result.version}`)
  lines.push(`   Total files: ${result.totalFiles}`)
  lines.push(`   Status: ${result.passed ? "PASSED" : "FAILED"}`)
  lines.push("=".repeat(60))

  if (result.violations.length === 0) {
    lines.push("")
    lines.push("  All checks passed.")
    lines.push("")
    return lines.join("\n")
  }

  const missing = result.violations.filter((v) => v.type === "missing_required")
  const unwanted = result.violations.filter((v) => v.type === "unwanted_file")

  if (missing.length > 0) {
    lines.push("")
    lines.push(`  Missing required files (${missing.length}):`)
    for (const v of missing) {
      lines.push(`     - ${v.message}`)
    }
  }

  if (unwanted.length > 0) {
    lines.push("")
    lines.push(`  Unwanted files found (${unwanted.length}):`)
    for (const v of unwanted) {
      lines.push(`     - ${v.message}`)
    }
  }

  lines.push("")
  return lines.join("\n")
}

async function getPackOutput(): Promise<string> {
  const proc = Bun.spawn(["npm", "pack", "--dry-run"], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const stderr = await new Response(proc.stderr).text()
  return stderr
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const allowlistOnly = args.includes("--allowlist-only")
  const denylistOnly = args.includes("--denylist-only")

  console.log("Running package content validation...")
  console.log("   Running npm pack --dry-run...")

  const output = await getPackOutput()
  const manifest = parsePackOutput(output)

  console.log(`   Package: ${manifest.packageName}@${manifest.version}`)
  console.log(`   Files in tarball: ${manifest.files.length}`)

  const allowlist = allowlistOnly ? REQUIRED_FILE_PATTERNS : undefined
  const denylist = denylistOnly ? FORBIDDEN_FILE_PATTERNS : undefined

  const result = validatePackage(manifest, allowlist, denylist)
  console.log(formatViolations(result))

  if (!result.passed) {
    process.exit(1)
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("Fatal error:", error)
    process.exit(1)
  })
}
