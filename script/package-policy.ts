export type CheckSeverity = "pass" | "warning" | "failure"

export interface PackagePolicy {
  requiredFiles: string[]
  forbiddenPatterns: string[]
  warningPatterns: string[]
}

export const DEFAULT_PACKAGE_POLICY: PackagePolicy = {
  requiredFiles: [
    "dist/index.js",
    "dist/index.d.ts",
    "dist/cli/index.js",
    "dist/cli/index.d.ts",
    "dist/oh-my-opencode.schema.json",
    "dist/hecateq-openagent.schema.json",
    "bin/oh-my-opencode.js",
    "bin/platform.js",
    "bin/platform.d.ts",
    "packages/ast-grep-mcp/dist/cli.js",
    "packages/lsp-tools-mcp/dist/",
    "postinstall.mjs",
    "package.json",
    "README.md",
    "LICENSE.md",
    "NOTICE.md",
    "CHANGELOG.md",
    "SECURITY.md",
  ],
  forbiddenPatterns: [
    "**/node_modules/**",
    ".env",
    ".env.local",
    ".env.example",
    "dist/**/*.map",
    "bin/**/*.map",
    ".sisyphus/",
    ".omo/",
    "dist/__tests__/",
    "dist/**/__tests__/",
    "**/*.test.ts",
    "**/*.test.js",
    "**/*.test.d.ts",
    "**/*.spec.ts",
    "**/*.spec.js",
    "**/*.spec.d.ts",
    "dist/**/fixtures/",
    "script/",
    "test-support/",
    "tests/",
    ".gitignore",
    ".npmignore",
    "tsconfig.json",
    "bun.lock",
    ".idea/",
    ".vscode/",
    ".DS_Store",
    "Thumbs.db",
    "**/*.tmp",
    "**/*.bak",
    "**/debug-*",
    "**/scratch-*",
    "**/pack-output*",
  ],
  warningPatterns: [
    "dist/**/*.js.map",
  ],
}

export function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\S+\s+/, "").trim()
}

export function matchesAnyPattern(filePath: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matchesPattern(filePath, pattern))
}

export function matchesPattern(filePath: string, pattern: string): boolean {
  return matchPath(normalizePath(filePath), pattern)
}

function matchPath(path: string, pattern: string): boolean {
  if (pattern.startsWith("**/")) {
    const suffix = pattern.slice(3)
    if (matchInner(path, suffix)) return true
    let idx = path.indexOf("/")
    while (idx !== -1) {
      if (matchInner(path.slice(idx + 1), suffix)) return true
      idx = path.indexOf("/", idx + 1)
    }
    return false
  }
  return matchInner(path, pattern)
}

function globToRegex(pattern: string): RegExp {
  let src = ""
  let i = 0
  while (i < pattern.length) {
    const c = pattern[i]
    if (c === "*" && pattern[i + 1] === "*" && pattern[i + 2] === "/") {
      src += "(?:.+/)?"
      i += 3
    } else if (c === "*" && pattern[i + 1] === "*" && i + 2 >= pattern.length) {
      src += ".*"
      i += 2
    } else if (c === "*") {
      src += "[^/]*"
      i += 1
    } else if (c === "?") {
      src += "[^/]"
      i += 1
    } else if ("+^${}()|[\\].".includes(c)) {
      src += "\\" + c
      i += 1
    } else {
      src += c
      i += 1
    }
  }
  if (!pattern.startsWith("*")) src = "^" + src
  if (!pattern.endsWith("*") && !pattern.endsWith("/")) src += "$"
  return new RegExp(src)
}

function matchInner(path: string, pattern: string): boolean {
  if (pattern.endsWith("/")) {
    return path.startsWith(pattern) || path === pattern.slice(0, -1)
  }
  return globToRegex(pattern).test(path)
}

export function classifyFile(filePath: string, policy: PackagePolicy = DEFAULT_PACKAGE_POLICY): CheckSeverity {
  if (matchesAnyPattern(filePath, policy.forbiddenPatterns)) return "failure"
  if (matchesAnyPattern(filePath, policy.warningPatterns)) return "warning"
  return "pass"
}

export function resolveExitCode(severities: CheckSeverity[]): number {
  if (severities.some((s) => s === "failure")) return 1
  return 0
}
