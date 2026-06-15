#!/usr/bin/env bun

import { readFileSync } from "node:fs"

const CANONICAL_PACKAGE_NAME = "@hecateq/hecateq-openagent"
const LEGACY_PACKAGE_NAMES = ["oh-my-opencode", "oh-my-openagent"]

export interface VersionValidationResult {
  packageName: string
  version: string
  valid: boolean
  issues: VersionIssue[]
}

export interface VersionIssue {
  severity: "error" | "warning"
  field: string
  message: string
}

const SEMVER_REGEX = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/

export function validatePackageJson(content: string, packagePath?: string): VersionValidationResult {
  const issues: VersionIssue[] = []
  let pkg: Record<string, unknown>

  try {
    pkg = JSON.parse(content) as Record<string, unknown>
  } catch {
    return {
      packageName: "unknown",
      version: "unknown",
      valid: false,
      issues: [{ severity: "error", field: "package.json", message: `Invalid JSON in package.json${packagePath ? ` (${packagePath})` : ""}` }],
    }
  }

  const issuesForPkg: VersionIssue[] = []
  const name = pkg.name as string | undefined
  const version = pkg.version as string | undefined

  if (!name) {
    issuesForPkg.push({ severity: "error", field: "name", message: "package.json missing 'name' field" })
  } else if (name !== CANONICAL_PACKAGE_NAME) {
    if (LEGACY_PACKAGE_NAMES.includes(name)) {
      issuesForPkg.push({ severity: "warning", field: "name", message: `Package name "${name}" is legacy — canonical name is "${CANONICAL_PACKAGE_NAME}"` })
    } else {
      issuesForPkg.push({ severity: "error", field: "name", message: `Package name "${name}" does not match canonical name "${CANONICAL_PACKAGE_NAME}"` })
    }
  }

  if (!version) {
    issuesForPkg.push({ severity: "error", field: "version", message: "package.json missing 'version' field" })
  } else {
    if (!SEMVER_REGEX.test(version)) {
      issuesForPkg.push({ severity: "error", field: "version", message: `Version "${version}" is not valid semver (expected format: X.Y.Z or X.Y.Z-pre.id)` })
    }

    const baseVersion = version.split("-")[0]!
    if (baseVersion === "0.0.0") {
      issuesForPkg.push({ severity: "error", field: "version", message: `Version "${version}" is placeholder "0.0.0" — must be bumped before publish` })
    }
    if (baseVersion === "0.1.0") {
      issuesForPkg.push({ severity: "warning", field: "version", message: `Version "${version}" looks like a starter placeholder — verify it's intentional` })
    }

    const preReleaseMarkers = ["-beta", "-alpha", "-rc", "-dev", "-next", "-canary", "-preview", "-experimental"]
    for (const marker of preReleaseMarkers) {
      if (version.includes(marker)) {
        issuesForPkg.push({ severity: "warning", field: "version", message: `Version "${version}" is a pre-release` })
        break
      }
    }
  }

  // main field
  const main = pkg.main
  if (!main) {
    issuesForPkg.push({ severity: "error", field: "main", message: "package.json missing 'main' field" })
  } else if (typeof main === "string") {
    if (!main.startsWith("./") && !main.startsWith("dist/")) {
      issuesForPkg.push({ severity: "error", field: "main", message: `Main entry "${main}" should start with "./" or "dist/"` })
    }
  }

  // types field
  const types = pkg.types
  if (!types) {
    issuesForPkg.push({ severity: "error", field: "types", message: "package.json missing 'types' field" })
  } else if (typeof types === "string") {
    if (!types.startsWith("./") && !types.includes("/")) {
      issuesForPkg.push({ severity: "error", field: "types", message: `Types entry "${types}" does not look like a valid file path` })
    }
  }

  // bin field
  const bin = pkg.bin
  if (!bin) {
    issuesForPkg.push({ severity: "error", field: "bin", message: "package.json missing 'bin' field" })
  } else if (typeof bin === "object" && bin !== null) {
    const binObj = bin as Record<string, unknown>
    const binKeys = Object.keys(binObj)
    if (binKeys.length === 0) {
      issuesForPkg.push({ severity: "error", field: "bin", message: "'bin' field is an empty object" })
    } else {
      for (const key of binKeys) {
        const value = binObj[key]
        if (typeof value === "string" && !value.endsWith(".js")) {
          issuesForPkg.push({ severity: "warning", field: "bin", message: `Bin entry "${key}: ${value}" does not have .js extension` })
        }
      }
    }
  } else if (typeof bin === "string") {
    if (!bin.endsWith(".js")) {
      issuesForPkg.push({ severity: "warning", field: "bin", message: `Bin path "${bin}" does not have .js extension` })
    }
  }

  // files field
  if (!pkg.files) {
    issuesForPkg.push({ severity: "error", field: "files", message: "package.json missing 'files' field — this is dangerous for npm publish" })
  }

  // private field
  if (pkg.private === true) {
    issuesForPkg.push({ severity: "warning", field: "private", message: "package.json has 'private: true' which contradicts publish intent" })
  }

  // repository field
  if (!pkg.repository) {
    issuesForPkg.push({ severity: "warning", field: "repository", message: "package.json missing 'repository' field" })
  }

  // engines field
  if (!pkg.engines) {
    issuesForPkg.push({ severity: "warning", field: "engines", message: "package.json missing 'engines' field" })
  }

  // packageManager field
  if (!pkg.packageManager) {
    issuesForPkg.push({ severity: "warning", field: "packageManager", message: "package.json missing 'packageManager' field" })
  }

  return {
    packageName: name ?? "unknown",
    version: version ?? "unknown",
    valid: issuesForPkg.filter((i) => i.severity === "error").length === 0,
    issues: issuesForPkg,
  }
}

export function formatVersionIssues(result: VersionValidationResult): string {
  const lines: string[] = []
  lines.push("")
  lines.push("=".repeat(60))
  lines.push(`📋 Version Metadata: ${result.packageName}@${result.version}`)
  lines.push(`   Status: ${result.valid ? "✅ VALID" : "❌ INVALID"}`)
  lines.push("=".repeat(60))

  if (result.issues.length === 0) {
    lines.push("")
    lines.push("  All version checks passed.")
    lines.push("")
    return lines.join("\n")
  }

  const errors = result.issues.filter((i) => i.severity === "error")
  const warnings = result.issues.filter((i) => i.severity === "warning")

  if (errors.length > 0) {
    lines.push("")
    lines.push(`  ❌ Errors (${errors.length}):`)
    for (const issue of errors) {
      lines.push(`     - [${issue.field}] ${issue.message}`)
    }
  }

  if (warnings.length > 0) {
    lines.push("")
    lines.push(`  ⚠️  Warnings (${warnings.length}):`)
    for (const issue of warnings) {
      lines.push(`     - [${issue.field}] ${issue.message}`)
    }
  }

  lines.push("")
  return lines.join("\n")
}

async function main(): Promise<void> {
  const pkgPath = process.argv[2] ?? "package.json"

  console.log(`🔍 Validating version metadata: ${pkgPath}`)

  let content: string
  try {
    content = readFileSync(pkgPath, "utf8")
  } catch (error) {
    console.error(`❌ Cannot read ${pkgPath}: ${error}`)
    process.exit(1)
  }

  const result = validatePackageJson(content, pkgPath)
  console.log(formatVersionIssues(result))

  if (!result.valid) {
    process.exit(1)
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("Fatal error:", error)
    process.exit(1)
  })
}
