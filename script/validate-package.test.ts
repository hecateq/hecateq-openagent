import { describe, expect, test } from "bun:test"
import {
  parsePackOutput,
  validatePackage,
  matchesPattern,
  matchesAnyPattern,
  formatViolations,
  REQUIRED_FILE_PATTERNS,
  FORBIDDEN_FILE_PATTERNS,
} from "./validate-package"

describe("matchesPattern", () => {
  test("matches exact paths", () => {
    expect(matchesPattern("dist/index.js", "dist/index.js")).toBe(true)
    expect(matchesPattern("dist/index2.js", "dist/index.js")).toBe(false)
    expect(matchesPattern("src/dist/index.js", "dist/index.js")).toBe(false)
  })

  test("matches nested glob patterns", () => {
    expect(matchesPattern("dist/index.js", "dist/**/*.js")).toBe(true)
    expect(matchesPattern("dist/sub/file.js", "dist/**/*.js")).toBe(true)
    expect(matchesPattern("src/index.js", "dist/**/*.js")).toBe(false)
  })

  test("matches directory prefix with trailing slash", () => {
    expect(matchesPattern("dist/__tests__/foo.test.ts", "dist/__tests__/")).toBe(true)
    expect(matchesPattern("dist/__tests__/sub/bar.test.ts", "dist/__tests__/")).toBe(true)
    expect(matchesPattern("dist/agents/index.d.ts", "dist/__tests__/")).toBe(false)
  })

  test("matches package prefix patterns", () => {
    expect(matchesPattern("packages/lsp-tools-mcp/dist/cli.js", "packages/lsp-tools-mcp/dist/")).toBe(true)
    expect(matchesPattern("packages/lsp-tools-mcp/dist/mcp.js", "packages/lsp-tools-mcp/dist/")).toBe(true)
    expect(matchesPattern("packages/other/file.js", "packages/lsp-tools-mcp/dist/")).toBe(false)
  })

  test("matches recursive glob anywhere", () => {
    expect(matchesPattern("node_modules/some-dep/index.js", "**/node_modules/**")).toBe(true)
    expect(matchesPattern("a/b/node_modules/x/y.js", "**/node_modules/**")).toBe(true)
    expect(matchesPattern("src/index.ts", "**/node_modules/**")).toBe(false)
  })

  test("matches file extension patterns", () => {
    expect(matchesPattern("dist/index.js", "dist/**/*.map")).toBe(false)
    expect(matchesPattern("dist/bundle.js.map", "dist/**/*.map")).toBe(true)
    expect(matchesPattern("dist/sub/file.js.map", "dist/**/*.map")).toBe(true)
  })

  test("strips size prefix from npm notice lines", () => {
    expect(matchesPattern("5.4MB dist/index.js", "dist/index.js")).toBe(true)
    expect(matchesPattern("34B dist/__tests__/foo.test.ts", "dist/__tests__/")).toBe(true)
  })

  test("handles simple file names", () => {
    expect(matchesPattern("package.json", "package.json")).toBe(true)
    expect(matchesPattern("README.md", "README.md")).toBe(true)
    expect(matchesPattern("some/package.json", "package.json")).toBe(false)
  })

  test("handles flat name matches", () => {
    expect(matchesPattern(".env", ".env")).toBe(true)
    expect(matchesPattern("some/path/.env", ".env")).toBe(false)
    expect(matchesPattern("some/path/.env.local", ".env")).toBe(false)
  })

  test("matches test file patterns anywhere", () => {
    expect(matchesPattern("src/foo.test.ts", "**/*.test.ts")).toBe(true)
    expect(matchesPattern("src/sub/bar.test.ts", "**/*.test.ts")).toBe(true)
    expect(matchesPattern("src/index.ts", "**/*.test.ts")).toBe(false)
  })
})

describe("matchesAnyPattern", () => {
  test("returns true if any pattern matches", () => {
    expect(matchesAnyPattern("dist/index.js", ["dist/**/*.js", "dist/**/*.map"])).toBe(true)
    expect(matchesAnyPattern("dist/index.map", ["dist/**/*.js", "dist/**/*.map"])).toBe(true)
    expect(matchesAnyPattern("src/index.js", ["dist/**/*.js", "dist/**/*.map"])).toBe(false)
  })
})

describe("parsePackOutput", () => {
  test("parses npm pack dry-run output correctly", () => {
    const output = [
      "npm notice",
      'npm notice @  hecateq/hecateq-openagent@0.1.0-beta.8',
      "npm notice Tarball Contents",
      "npm notice 5.4MB dist/index.js",
      "npm notice 215.7kB dist/oh-my-opencode.schema.json",
      "npm notice 4.0kB bin/oh-my-opencode.js",
      "npm notice 3.7kB postinstall.mjs",
      "npm notice 5.8kB package.json",
      "npm notice 21.3kB CHANGELOG.md",
      "npm notice Tarball Details",
      "npm notice name: @hecateq/hecateq-openagent",
      "npm notice version: 0.1.0-beta.8",
      "npm notice filename: hecateq-hecateq-openagent-0.1.0-beta.8.tgz",
      "npm notice package size: 2.0 MB",
      "npm notice total files: 6",
    ].join("\n")
    const manifest = parsePackOutput(output)

    expect(manifest.packageName).toBe("@hecateq/hecateq-openagent")
    expect(manifest.version).toBe("0.1.0-beta.8")
    expect(manifest.files).toContain("dist/index.js")
    expect(manifest.files).toContain("dist/oh-my-opencode.schema.json")
    expect(manifest.files).toContain("bin/oh-my-opencode.js")
    expect(manifest.files).toContain("postinstall.mjs")
    expect(manifest.files).toContain("package.json")
    expect(manifest.files).toContain("CHANGELOG.md")
    expect(manifest.files).not.toContain("Tarball")
    expect(manifest.files).not.toContain("@")
  })
})

describe("validatePackage", () => {
  const mockManifest = {
    files: [
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
      "packages/lsp-tools-mcp/dist/mcp.js",
      "postinstall.mjs",
      "package.json",
      "README.md",
      "LICENSE.md",
      "NOTICE.md",
      "CHANGELOG.md",
      "SECURITY.md",
    ],
    packageName: "@hecateq/hecateq-openagent",
    version: "0.1.0-beta.8",
  }

  test("passes when all required files present and no forbidden files", () => {
    const result = validatePackage(mockManifest, REQUIRED_FILE_PATTERNS, [])
    expect(result.passed).toBe(true)
    expect(result.violations).toHaveLength(0)
    expect(result.packageName).toBe("@hecateq/hecateq-openagent")
    expect(result.version).toBe("0.1.0-beta.8")
    expect(result.totalFiles).toBe(18)
  })

  test("detects missing required files", () => {
    const manifest = {
      files: ["package.json", "README.md"],
      packageName: "test",
      version: "1.0.0",
    }
    const result = validatePackage(manifest, ["dist/index.js", "README.md"], [])
    expect(result.passed).toBe(false)
    expect(result.violations).toHaveLength(1)
    expect(result.violations[0]!.type).toBe("missing_required")
    expect(result.violations[0]!.path).toBe("dist/index.js")
  })

  test("detects unwanted files", () => {
    const manifest = {
      files: [
        "package.json",
        "README.md",
        "node_modules/some-dep/index.js",
        ".env",
      ],
      packageName: "test",
      version: "1.0.0",
    }
    const result = validatePackage(manifest, ["package.json", "README.md"], FORBIDDEN_FILE_PATTERNS)
    expect(result.passed).toBe(false)

    const unwanted = result.violations.filter((v) => v.type === "unwanted_file")
    expect(unwanted.length).toBeGreaterThanOrEqual(2)

    const nodeModulesViolation = unwanted.find((v) => v.path === "**/node_modules/**")
    expect(nodeModulesViolation).toBeDefined()
    expect(nodeModulesViolation!.message).toContain("node_modules/some-dep/index.js")

    const dotEnvViolation = unwanted.find((v) => v.path === ".env")
    expect(dotEnvViolation).toBeDefined()
    expect(dotEnvViolation!.message).toContain(".env")
  })

  test("passes with empty allowlist and denylist", () => {
    const manifest = { files: ["anything.txt"], packageName: "test", version: "1.0.0" }
    const result = validatePackage(manifest, [], [])
    expect(result.passed).toBe(true)
    expect(result.violations).toHaveLength(0)
  })

  test("reports violation for test files in dist", () => {
    const manifest = {
      files: ["dist/index.js", "dist/__tests__/perf/fixture.d.ts"],
      packageName: "test",
      version: "1.0.0",
    }
    const result = validatePackage(manifest, ["dist/index.js"], ["dist/__tests__/"])
    expect(result.passed).toBe(false)
    const unwanted = result.violations.filter((v) => v.type === "unwanted_file")
    expect(unwanted).toHaveLength(1)
    expect(unwanted[0]!.path).toBe("dist/__tests__/")
  })
})

describe("formatViolations", () => {
  test("formats passing result", () => {
    const result = {
      packageName: "@hecateq/hecateq-openagent",
      version: "1.0.0",
      totalFiles: 10,
      violations: [],
      passed: true,
    }
    const output = formatViolations(result)
    expect(output).toContain("PASSED")
    expect(output).toContain("@hecateq/hecateq-openagent")
    expect(output).toContain("All checks passed")
  })

  test("formats failing result with violations", () => {
    const result = {
      packageName: "test-pkg",
      version: "1.0.0",
      totalFiles: 5,
      violations: [
        {
          type: "missing_required" as const,
          path: "dist/index.js",
          message: 'Required file matching "dist/index.js" not found in package',
        },
        {
          type: "unwanted_file" as const,
          path: ".env",
          message: 'Found 1 file(s) matching forbidden pattern ".env"',
        },
      ],
      passed: false,
    }
    const output = formatViolations(result)
    expect(output).toContain("FAILED")
    expect(output).toContain("Missing required files")
    expect(output).toContain("Unwanted files found")
    expect(output).toContain("dist/index.js")
    expect(output).toContain(".env")
  })
})

describe("matchesPattern — platform-independent paths", () => {
  test("matches Windows backslash paths against forward-slash pattern", () => {
    // #given: Windows paths with backslashes should be normalized
    // #then
    expect(matchesPattern("dist\\index.js", "dist/index.js")).toBe(true)
    expect(matchesPattern("dist\\__tests__\\foo.test.ts", "dist/__tests__/")).toBe(true)
    expect(matchesPattern("dist\\sub\\file.js", "dist/**/*.js")).toBe(true)
  })

  test("matches nested Windows backslash paths against glob patterns", () => {
    // #given: patterns ending with / use literal startsWith — globs are not expanded
    // So dist/**/__tests__/ (with trailing slash) does NOT match paths with ** in them
    // Use dist/**/__tests__/** (without trailing slash) for glob-style matching
    // #then
    expect(matchesPattern("dist\\__tests__\\perf\\fixtures\\foo.d.ts", "dist/**/__tests__/**")).toBe(true)
    expect(matchesPattern("dist\\sub\\__tests__\\bar.test.ts", "dist/**/__tests__/**")).toBe(true)
    expect(matchesPattern("dist\\foo.test.d.ts", "**/*.test.d.ts")).toBe(true)
  })

  test("matches Windows paths with size prefix", () => {
    // #given: npm notice lines with size prefix and backslashes
    // #then
    expect(matchesPattern("5.4MB dist\\index.js", "dist/index.js")).toBe(true)
    expect(matchesPattern("34B dist\\__tests__\\foo.test.ts", "dist/__tests__/")).toBe(true)
  })

  test("does not falsely match when path does not match after normalization", () => {
    // #given
    // #then
    expect(matchesPattern("src\\index.ts", "dist/index.js")).toBe(false)
    expect(matchesPattern("dist\\index.js", "src/index.js")).toBe(false)
  })
})

describe("matchesPattern — new forbidden patterns", () => {
  test("detects dist/**/__tests__/** pattern", () => {
    // #given: patterns ending with / use literal startsWith — globs are NOT expanded.
    // "dist/**/__tests__/" (trailing slash) does literal startsWith — path would need
    // to LITERALLY contain "**" to match. Use "dist/**/__tests__/**" or "dist/**/__tests__/*" for glob.
    // "dist/__tests__/" (no **) uses literal prefix and matches.
    // #then
    expect(matchesPattern("dist/__tests__/perf/fixtures/foo.d.ts", "dist/__tests__/")).toBe(true)
    expect(matchesPattern("dist/sub/__tests__/bar.test.ts", "dist/**/__tests__/**")).toBe(true)
    expect(matchesPattern("dist/agents/index.d.ts", "dist/__tests__/")).toBe(false)
  })

  test("detects **/*.test.d.ts pattern", () => {
    // #given: DEFAULT_PACKAGE_POLICY has "**/*.test.d.ts"
    // #then
    expect(matchesPattern("dist/index.test.d.ts", "**/*.test.d.ts")).toBe(true)
    expect(matchesPattern("packages/utils/src/foo.test.d.ts", "**/*.test.d.ts")).toBe(true)
    expect(matchesPattern("dist/index.d.ts", "**/*.test.d.ts")).toBe(false)
    expect(matchesPattern("dist/index.test.ts", "**/*.test.d.ts")).toBe(false)
  })

  test("detects test-support/ pattern", () => {
    // #given: DEFAULT_PACKAGE_POLICY has "test-support/"
    // #then
    expect(matchesPattern("test-support/data.ts", "test-support/")).toBe(true)
    expect(matchesPattern("test-support/sub/fixture.json", "test-support/")).toBe(true)
    expect(matchesPattern("src/test-support/helper.ts", "test-support/")).toBe(false)
  })
})

describe("validatePackage — integration with forbidden files", () => {
  test("detects forbidden files from parsed pack output", () => {
    // #given: pack output containing forbidden files
    const packOutput = [
      "npm notice",
      'npm notice @  test-pkg@1.0.0',
      "npm notice Tarball Contents",
      "npm notice 5.4MB dist/index.js",
      "npm notice 1.2kB dist/__tests__/perf/fixtures/foo.d.ts",
      "npm notice 0.5kB dist/index.test.d.ts",
      "npm notice 2.1kB dist/sub/__tests__/bar.test.ts",
      "npm notice 0.3kB test-support/data.ts",
      "npm notice 3.7kB postinstall.mjs",
      "npm notice Tarball Details",
      "npm notice name: test-pkg",
      "npm notice version: 1.0.0",
      "npm notice filename: test-pkg-1.0.0.tgz",
      "npm notice package size: 1.0 MB",
      "npm notice total files: 6",
    ].join("\n")
    const manifest = parsePackOutput(packOutput)

    // #when: validate with full forbidden patterns (but empty allowlist to focus on unwanted)
    const result = validatePackage(manifest, [], FORBIDDEN_FILE_PATTERNS)

    // #then
    expect(result.passed).toBe(false)
    const unwanted = result.violations.filter((v) => v.type === "unwanted_file")
    expect(unwanted.length).toBeGreaterThanOrEqual(4)

    // Check each pattern category is detected
    expect(unwanted.some((v) => v.path === "dist/__tests__/")).toBe(true)
    expect(unwanted.some((v) => v.path === "**/*.test.d.ts")).toBe(true)
    expect(unwanted.some((v) => v.path === "test-support/")).toBe(true)
  })

  test("passes clean pack output validates successfully", () => {
    // #given: clean pack output with no forbidden files
    const packOutput = [
      "npm notice",
      'npm notice @  clean-pkg@2.0.0',
      "npm notice Tarball Contents",
      "npm notice 5.4MB dist/index.js",
      "npm notice 3.7kB postinstall.mjs",
      "npm notice 5.8kB package.json",
      "npm notice Tarball Details",
      "npm notice name: clean-pkg",
      "npm notice version: 2.0.0",
      "npm notice filename: clean-pkg-2.0.0.tgz",
      "npm notice package size: 1.0 MB",
      "npm notice total files: 3",
    ].join("\n")
    const manifest = parsePackOutput(packOutput)

    // #when: validate with empty denylist
    const result = validatePackage(manifest, ["dist/index.js", "postinstall.mjs", "package.json"], [])

    // #then
    expect(result.passed).toBe(true)
    expect(result.violations).toHaveLength(0)
  })
})
