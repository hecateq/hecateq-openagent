import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

import { CONFIG_BASENAME, LEGACY_CONFIG_BASENAME, getOpenCodeConfigDir } from "../../../../shared"
import type { DoctorIssue } from "../../types"
import {
  type SecretFinding,
  isRecord,
  readJsoncFile,
} from "./_shared"
import { PROJECT_MEMORY_DIR } from "../../../../shared/memory-bootstrap"

const SECRET_KEY_REGEX = /(discord_webhook_url|webhook|apiKey|api_key|token|secret)/i
const SECRET_VALUE_REGEX = /(Bearer\s+[A-Za-z0-9._-]+|sk-[A-Za-z0-9_-]+|ghp_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)/i

function maskSecretValue(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length <= 4) return "<redacted>"
  if (trimmed.length <= 8) return `${trimmed.slice(0, 1)}***${trimmed.slice(-1)}`
  return `${trimmed.slice(0, 2)}***${trimmed.slice(-2)}`
}

function getExistingProjectJsonFiles(cwd: string): string[] {
  const projectOpencodeDir = join(cwd, ".opencode")
  const files = [
    join(cwd, "opencode.json"),
    join(cwd, "opencode.jsonc"),
  ]

  if (existsSync(projectOpencodeDir)) {
    for (const entry of readdirSync(projectOpencodeDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue
      if (!entry.name.endsWith(".json") && !entry.name.endsWith(".jsonc")) continue
      files.push(join(projectOpencodeDir, entry.name))
    }
  }

  return Array.from(new Set(files.filter((filePath) => existsSync(filePath))))
}

function getExistingSecretScanPaths(cwd: string): string[] {
  const userConfigDir = getOpenCodeConfigDir({ binary: "opencode" })
  const candidates = [
    join(userConfigDir, `${CONFIG_BASENAME}.json`),
    join(userConfigDir, `${CONFIG_BASENAME}.jsonc`),
    join(userConfigDir, `${LEGACY_CONFIG_BASENAME}.json`),
    join(userConfigDir, `${LEGACY_CONFIG_BASENAME}.jsonc`),
    ...getExistingProjectJsonFiles(cwd),
  ]

  return Array.from(new Set(candidates.filter((filePath) => existsSync(filePath))))
}

function walkForSecrets(value: unknown, filePath: string, keyPath: string[] = []): SecretFinding[] {
  const findings: SecretFinding[] = []

  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      findings.push(...walkForSecrets(item, filePath, [...keyPath, String(index)]))
    }
    return findings
  }

  if (isRecord(value)) {
    for (const [key, nested] of Object.entries(value)) {
      const nextPath = [...keyPath, key]
      if (typeof nested === "string" && (SECRET_KEY_REGEX.test(key) || SECRET_VALUE_REGEX.test(nested))) {
        findings.push({
          filePath,
          keyPath: nextPath.join("."),
          maskedValue: maskSecretValue(nested),
        })
      }
      findings.push(...walkForSecrets(nested, filePath, nextPath))
    }
  }

  return findings
}

export function collectSecretFindings(cwd = process.cwd()): SecretFinding[] {
  const findings: SecretFinding[] = []
  for (const filePath of getExistingSecretScanPaths(cwd)) {
    const parsed = readJsoncFile(filePath)
    if (!parsed) continue
    findings.push(...walkForSecrets(parsed, filePath))
  }
  return findings
}

const SECRET_VALUE_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._\-+/=]{20,}/i,
  /sk-[A-Za-z0-9_-]{20,}/,
  /ghp_[A-Za-z0-9_]{20,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /-----BEGIN\s+(RSA |EC )?PRIVATE KEY-----/,
  /api[_-]?key[=:]\s*["']?[A-Za-z0-9._\-+/=]{16,}/i,
  /password[=:]\s*["']?\S{8,}["']?/i,
  /secret[=:]\s*["']?\S{8,}["']?/i,
  /token[=:]\s*["']?\S{8,}["']?/i,
]

export function collectEnvironmentSecretIssues(cwd = process.cwd()): DoctorIssue[] {
  const issues: DoctorIssue[] = []
  const filePath = join(cwd, PROJECT_MEMORY_DIR, "environment.md")

  if (!existsSync(filePath)) return issues

  const content = readFileSync(filePath, "utf-8")
  const lines = content.split("\n")
  const findings: Array<{ line: number; snippet: string }> = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line.length === 0) continue
    if (line.startsWith("#")) continue
    if (line.startsWith("<!--")) continue

    for (const pattern of SECRET_VALUE_PATTERNS) {
      if (pattern.test(line)) {
        findings.push({ line: i + 1, snippet: line.slice(0, 100) })
        break
      }
    }
  }

  if (findings.length > 0) {
    issues.push({
      title: "environment.md may contain secret values",
      description: `${findings.length} line(s) in environment.md match secret patterns: ${findings.map((f) => `line ${f.line}: "${f.snippet}"`).join("; ")}`,
      fix: "Remove any secret values from environment.md. Only environment variable NAMES should be listed, never their values.",
      severity: "error",
      affects: ["credential safety", "memory file security"],
    })
  }

  return issues
}
