import { describe, expect, test } from "bun:test"
import {
  normalizePath,
  matchesPattern,
  matchesAnyPattern,
  classifyFile,
  resolveExitCode,
  DEFAULT_PACKAGE_POLICY,
  type CheckSeverity,
  type PackagePolicy,
} from "./package-policy"

describe("normalizePath", () => {
  test("converts Windows backslashes to forward slashes", () => {
    // #given
    const windowsPath = "dist\\index.js"
    // #when
    const result = normalizePath(windowsPath)
    // #then
    expect(result).toBe("dist/index.js")
  })

  test("handles nested Windows backslashes", () => {
    // #given
    const windowsPath = "dist\\__tests__\\foo.test.ts"
    // #when
    const result = normalizePath(windowsPath)
    // #then
    expect(result).toBe("dist/__tests__/foo.test.ts")
  })

  test("strips size prefix from npm notice lines", () => {
    // #given
    const noticeLine = "5.4MB dist/index.js"
    // #when
    const result = normalizePath(noticeLine)
    // #then
    expect(result).toBe("dist/index.js")
  })

  test("strips various size prefixes", () => {
    // #given
    const small = "34B dist/foo.d.ts"
    const large = "2.1GB dist/big.dat"
    // #when
    const smallResult = normalizePath(small)
    const largeResult = normalizePath(large)
    // #then
    expect(smallResult).toBe("dist/foo.d.ts")
    expect(largeResult).toBe("dist/big.dat")
  })

  test("trims leading and trailing whitespace", () => {
    // #given
    const spaced = "  dist/index.js  "
    // #when
    const result = normalizePath(spaced)
    // #then
    expect(result).toBe("dist/index.js")
  })

  test("handles path with size, backslash and whitespace combined", () => {
    // #given: size prefix + backslashes — but no leading whitespace
    // because normalizePath strips size prefix before trim()
    // Leading whitespace prevents ^\S+ from matching
    const messy = "125kB dist\\sub\\file.js  "
    // #when
    const result = normalizePath(messy)
    // #then
    expect(result).toBe("dist/sub/file.js")
  })

  test("handles already normalized paths unchanged", () => {
    // #given
    const normal = "packages/lsp-tools-mcp/dist/mcp.js"
    // #when
    const result = normalizePath(normal)
    // #then
    expect(result).toBe(normal)
  })

  test("handles empty string", () => {
    // #given
    const empty = ""
    // #when
    const result = normalizePath(empty)
    // #then
    expect(result).toBe("")
  })
})

describe("matchesPattern", () => {
  test("matches exact path", () => {
    expect(matchesPattern("package.json", "package.json")).toBe(true)
  })

  test("does not match different exact path", () => {
    expect(matchesPattern("dist/package.json", "package.json")).toBe(false)
  })

  test("matches glob star within single directory", () => {
    // `*` matches anything except `/`
    expect(matchesPattern("dist/index.js", "dist/*.js")).toBe(true)
    expect(matchesPattern("dist/foo.js", "dist/*.js")).toBe(true)
    expect(matchesPattern("dist/sub/deep.js", "dist/*.js")).toBe(false)
  })

  test("matches recursive glob **/ pattern", () => {
    expect(matchesPattern("node_modules/foo/index.js", "**/node_modules/**")).toBe(true)
    expect(matchesPattern("a/b/c/node_modules/x/y/z.js", "**/node_modules/**")).toBe(true)
    expect(matchesPattern("src/index.ts", "**/node_modules/**")).toBe(false)
  })

  test("matches directory prefix with trailing slash", () => {
    expect(matchesPattern("dist/__tests__/foo.test.ts", "dist/__tests__/")).toBe(true)
    expect(matchesPattern("dist/__tests__/sub/bar.test.ts", "dist/__tests__/")).toBe(true)
    expect(matchesPattern("dist/agents/index.d.ts", "dist/__tests__/")).toBe(false)
  })

  test("matches **/ pattern at root level", () => {
    // pattern like **/node_modules/** should match at any depth
    expect(matchesPattern("node_modules/pkg/index.js", "**/node_modules/**")).toBe(true)
  })

  test("handles regex special characters in path", () => {
    // Paths containing dots, plus signs, brackets should not break matching
    expect(matchesPattern("dist/index.test.js", "dist/index.test.js")).toBe(true)
    expect(matchesPattern("dist/file+v1.js", "dist/file+v1.js")).toBe(true)
    expect(matchesPattern("dist/[test]/file.js", "dist/[test]/file.js")).toBe(true)
  })

  test("matches .env exactly at root", () => {
    expect(matchesPattern(".env", ".env")).toBe(true)
    expect(matchesPattern("some/path/.env", ".env")).toBe(false)
  })

  test("matches .gitignore exactly", () => {
    expect(matchesPattern(".gitignore", ".gitignore")).toBe(true)
  })

  test("matches test file patterns with .test.d.ts extension", () => {
    expect(matchesPattern("dist/index.test.d.ts", "**/*.test.d.ts")).toBe(true)
    expect(matchesPattern("src/foo.test.d.ts", "**/*.test.d.ts")).toBe(true)
    expect(matchesPattern("dist/index.d.ts", "**/*.test.d.ts")).toBe(false)
  })
})

describe("matchesAnyPattern", () => {
  test("returns true when any pattern matches", () => {
    // #given
    const patterns = ["dist/**/*.js", "dist/**/*.map", "**/*.test.ts"]
    // #then
    expect(matchesAnyPattern("dist/index.js", patterns)).toBe(true)
    expect(matchesAnyPattern("dist/bundle.js.map", patterns)).toBe(true)
    expect(matchesAnyPattern("src/foo.test.ts", patterns)).toBe(true)
  })

  test("returns false when no pattern matches", () => {
    // #given
    const patterns = ["dist/**/*.js", "dist/**/*.map"]
    // #then
    expect(matchesAnyPattern("src/index.ts", patterns)).toBe(false)
    expect(matchesAnyPattern("README.md", patterns)).toBe(false)
  })

  test("returns false for empty patterns array", () => {
    // #given
    const patterns: string[] = []
    // #then
    expect(matchesAnyPattern("anything.txt", patterns)).toBe(false)
    expect(matchesAnyPattern("dist/index.js", patterns)).toBe(false)
  })
})

describe("classifyFile", () => {
  const testPolicy: PackagePolicy = {
    requiredFiles: [],
    forbiddenPatterns: ["**/node_modules/**", ".env", "dist/__tests__/", "**/*.test.ts"],
    warningPatterns: ["dist/**/*.js.map"],
  }

  test("returns 'failure' for forbidden patterns", () => {
    expect(classifyFile("node_modules/pkg/index.js", testPolicy)).toBe("failure")
    expect(classifyFile(".env", testPolicy)).toBe("failure")
    expect(classifyFile("dist/__tests__/foo.test.ts", testPolicy)).toBe("failure")
    expect(classifyFile("src/bar.test.ts", testPolicy)).toBe("failure")
  })

  test("returns 'warning' for warning patterns", () => {
    expect(classifyFile("dist/bundle.js.map", testPolicy)).toBe("warning")
    expect(classifyFile("dist/sub/file.js.map", testPolicy)).toBe("warning")
  })

  test("returns 'pass' for files matching neither", () => {
    expect(classifyFile("dist/index.js", testPolicy)).toBe("pass")
    expect(classifyFile("package.json", testPolicy)).toBe("pass")
    expect(classifyFile("README.md", testPolicy)).toBe("pass")
  })

  test("uses default policy when none provided", () => {
    // #given: DEFAULT_PACKAGE_POLICY has these patterns
    // #then
    expect(classifyFile("node_modules/pkg/index.js")).toBe("failure")
    expect(classifyFile(".env")).toBe("failure")
    expect(classifyFile("dist/index.js")).toBe("pass")
  })
})

describe("resolveExitCode", () => {
  test("returns 1 when any failure severity exists", () => {
    // #given
    const severities: CheckSeverity[] = ["pass", "pass", "failure", "warning"]
    // #when
    const code = resolveExitCode(severities)
    // #then
    expect(code).toBe(1)
  })

  test("returns 0 when only warnings exist", () => {
    // #given
    const severities: CheckSeverity[] = ["pass", "warning", "pass"]
    // #when
    const code = resolveExitCode(severities)
    // #then
    expect(code).toBe(0)
  })

  test("returns 0 when all pass", () => {
    // #given
    const severities: CheckSeverity[] = ["pass", "pass", "pass"]
    // #when
    const code = resolveExitCode(severities)
    // #then
    expect(code).toBe(0)
  })

  test("returns 0 for empty array", () => {
    // #given
    const severities: CheckSeverity[] = []
    // #when
    const code = resolveExitCode(severities)
    // #then
    expect(code).toBe(0)
  })

  test("returns 1 even if single failure among many passes", () => {
    // #given
    const severities: CheckSeverity[] = ["pass", "pass", "pass", "pass", "failure"]
    // #when
    const code = resolveExitCode(severities)
    // #then
    expect(code).toBe(1)
  })
})

describe("DEFAULT_PACKAGE_POLICY", () => {
  test("has required files defined", () => {
    expect(DEFAULT_PACKAGE_POLICY.requiredFiles.length).toBeGreaterThan(0)
    expect(DEFAULT_PACKAGE_POLICY.requiredFiles).toContain("dist/index.js")
    expect(DEFAULT_PACKAGE_POLICY.requiredFiles).toContain("dist/index.d.ts")
    expect(DEFAULT_PACKAGE_POLICY.requiredFiles).toContain("package.json")
    expect(DEFAULT_PACKAGE_POLICY.requiredFiles).toContain("README.md")
    expect(DEFAULT_PACKAGE_POLICY.requiredFiles).toContain("LICENSE.md")
    expect(DEFAULT_PACKAGE_POLICY.requiredFiles).toContain("CHANGELOG.md")
    expect(DEFAULT_PACKAGE_POLICY.requiredFiles).toContain("postinstall.mjs")
  })

  test("has forbidden patterns defined", () => {
    expect(DEFAULT_PACKAGE_POLICY.forbiddenPatterns.length).toBeGreaterThan(0)
    expect(DEFAULT_PACKAGE_POLICY.forbiddenPatterns).toContain("**/node_modules/**")
    expect(DEFAULT_PACKAGE_POLICY.forbiddenPatterns).toContain(".env")
    expect(DEFAULT_PACKAGE_POLICY.forbiddenPatterns).toContain(".gitignore")
    expect(DEFAULT_PACKAGE_POLICY.forbiddenPatterns).toContain("dist/__tests__/")
    expect(DEFAULT_PACKAGE_POLICY.forbiddenPatterns).toContain("dist/**/__tests__/")
    expect(DEFAULT_PACKAGE_POLICY.forbiddenPatterns).toContain("**/*.test.ts")
    expect(DEFAULT_PACKAGE_POLICY.forbiddenPatterns).toContain("**/*.test.d.ts")
    expect(DEFAULT_PACKAGE_POLICY.forbiddenPatterns).toContain("test-support/")
    expect(DEFAULT_PACKAGE_POLICY.forbiddenPatterns).toContain("script/")
    expect(DEFAULT_PACKAGE_POLICY.forbiddenPatterns).toContain("tsconfig.json")
  })

  test("has warning patterns defined", () => {
    expect(DEFAULT_PACKAGE_POLICY.warningPatterns.length).toBeGreaterThan(0)
    expect(DEFAULT_PACKAGE_POLICY.warningPatterns).toContain("dist/**/*.js.map")
  })
})

describe("classifyFile with DEFAULT_PACKAGE_POLICY", () => {
  test("detects forbidden test files in dist/__tests__/", () => {
    // #given: dist/__tests__/ and dist/**/__tests__/ are forbidden
    // #then
    expect(classifyFile("dist/__tests__/perf/fixtures/foo.d.ts")).toBe("failure")
    expect(classifyFile("dist/sub/__tests__/bar.test.ts")).toBe("failure")
    expect(classifyFile("dist/__tests__/unit/test.test.ts")).toBe("failure")
  })

  test("detects forbidden test-support directory", () => {
    // #given: "test-support/" is a directory prefix pattern — literal startsWith match
    // So "test-support/data.ts" matches (starts with "test-support/")
    // But "src/test-support/helper.ts" does NOT (doesn't start with "test-support/")
    expect(classifyFile("test-support/data.ts")).toBe("failure")
    expect(classifyFile("src/test-support/helper.ts")).toBe("pass")
  })

  test("detects forbidden .test.d.ts files anywhere", () => {
    expect(classifyFile("dist/index.test.d.ts")).toBe("failure")
    expect(classifyFile("packages/utils/src/foo.test.d.ts")).toBe("failure")
  })

  test("does not flag normal .d.ts files", () => {
    expect(classifyFile("dist/index.d.ts")).toBe("pass")
    expect(classifyFile("dist/cli/index.d.ts")).toBe("pass")
  })

  test("detects .map files in dist as failure via forbidden pattern", () => {
    // #given: DEFAULT_PACKAGE_POLICY has "dist/**/*.map" as forbidden (catches all .map files)
    // and "dist/**/*.js.map" as warning (would match if not already caught by forbidden)
    // Since classifyFile checks forbidden first, all .map files in dist are "failure"
    expect(classifyFile("dist/bundle.js.map")).toBe("failure")
    expect(classifyFile("dist/sub/file.js.map")).toBe("failure")
  })
})
