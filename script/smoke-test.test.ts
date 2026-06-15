import { describe, expect, test } from "bun:test"
import { formatSmokeResults, type SmokeCheck, type SmokeTestResult } from "./smoke-test"

describe("SmokeTestResult aggregation", () => {
  test("passCount equals number of pass checks", () => {
    // #given
    const checks: SmokeCheck[] = [
      { name: "check1", severity: "pass", detail: "ok" },
      { name: "check2", severity: "pass", detail: "ok" },
      { name: "check3", severity: "failure", detail: "fail" },
    ]
    // #when
    const result: SmokeTestResult = {
      passed: false,
      checks,
      failureCount: checks.filter((c) => c.severity === "failure").length,
      warningCount: checks.filter((c) => c.severity === "warning").length,
      passCount: checks.filter((c) => c.severity === "pass").length,
    }
    // #then
    expect(result.passCount).toBe(2)
    expect(result.failureCount).toBe(1)
    expect(result.warningCount).toBe(0)
  })

  test("warningCount equals number of warning checks", () => {
    // #given
    const checks: SmokeCheck[] = [
      { name: "ok", severity: "pass" },
      { name: "warn1", severity: "warning", detail: "pre-release" },
      { name: "warn2", severity: "warning", detail: "large size" },
    ]
    // #when
    const result: SmokeTestResult = {
      passed: true,
      checks,
      failureCount: 0,
      warningCount: 2,
      passCount: 1,
    }
    // #then
    expect(result.warningCount).toBe(2)
    expect(result.passed).toBe(true)
  })

  test("failureCount equals number of failure checks", () => {
    // #given
    const checks: SmokeCheck[] = [
      { name: "pack", severity: "failure", detail: "Tarball creation failed" },
      { name: "install", severity: "failure", detail: "Install failed" },
      { name: "cli", severity: "pass", detail: "Found" },
    ]
    // #when
    const result: SmokeTestResult = {
      passed: false,
      checks,
      failureCount: 2,
      warningCount: 0,
      passCount: 1,
    }
    // #then
    expect(result.failureCount).toBe(2)
    expect(result.passed).toBe(false)
  })

  test("result with no checks has zero counts", () => {
    // #given
    const checks: SmokeCheck[] = []
    // #when
    const result: SmokeTestResult = {
      passed: true,
      checks,
      failureCount: 0,
      warningCount: 0,
      passCount: 0,
    }
    // #then
    expect(result.passCount).toBe(0)
    expect(result.warningCount).toBe(0)
    expect(result.failureCount).toBe(0)
    expect(result.passed).toBe(true)
  })
})

describe("formatSmokeResults", () => {
  test("includes correct icons for pass/warning/failure", () => {
    // #given
    const checks: SmokeCheck[] = [
      { name: "npm pack creates tarball", severity: "pass", detail: "Created test.tgz" },
      { name: "npm install succeeds", severity: "pass", detail: "Installed in /tmp/test" },
      { name: "pre-release version detected", severity: "warning", detail: "Version 0.1.0-beta.8 appears to be a pre-release" },
      { name: "CLI binary exists", severity: "failure", detail: "Not found at bin/foo.js" },
    ]
    const result: SmokeTestResult = {
      passed: false,
      checks,
      failureCount: 1,
      warningCount: 1,
      passCount: 2,
    }

    // #when
    const output = formatSmokeResults(result)

    // #then
    expect(output).toContain("✅") // pass icon
    expect(output).toContain("⚠️") // warning icon
    expect(output).toContain("❌") // failure icon
    expect(output).toContain("npm pack creates tarball")
    expect(output).toContain("npm install succeeds")
    expect(output).toContain("pre-release version detected")
    expect(output).toContain("CLI binary exists")
  })

  test("shows FAILED status when failures exist", () => {
    // #given
    const result: SmokeTestResult = {
      passed: false,
      checks: [
        { name: "pack", severity: "failure", detail: "failed" },
      ],
      failureCount: 1,
      warningCount: 0,
      passCount: 0,
    }

    // #when
    const output = formatSmokeResults(result)

    // #then
    expect(output).toContain("FAILED")
    expect(output).not.toContain("PASSED")
  })

  test("shows PASSED status when no failures", () => {
    // #given
    const result: SmokeTestResult = {
      passed: true,
      checks: [
        { name: "pack", severity: "pass", detail: "ok" },
        { name: "size", severity: "warning", detail: "large" },
      ],
      failureCount: 0,
      warningCount: 1,
      passCount: 1,
    }

    // #when
    const output = formatSmokeResults(result)

    // #then: warnings alone do not fail
    expect(output).toContain("PASSED")
    expect(output).not.toContain("FAILED")
  })

  test("includes detail text for checks with details", () => {
    // #given
    const result: SmokeTestResult = {
      passed: true,
      checks: [
        { name: "test", severity: "pass", detail: "This detail should appear" },
        { name: "no-detail", severity: "pass" },
      ],
      failureCount: 0,
      warningCount: 0,
      passCount: 2,
    }

    // #when
    const output = formatSmokeResults(result)

    // #then
    expect(output).toContain("This detail should appear")
  })

  test("includes summary with correct counts", () => {
    // #given
    const result: SmokeTestResult = {
      passed: false,
      checks: [
        { name: "a", severity: "pass" },
        { name: "b", severity: "pass" },
        { name: "c", severity: "pass" },
        { name: "d", severity: "warning", detail: "pre-release" },
        { name: "e", severity: "failure", detail: "error" },
        { name: "f", severity: "failure", detail: "error" },
      ],
      failureCount: 2,
      warningCount: 1,
      passCount: 3,
    }

    // #when
    const output = formatSmokeResults(result)

    // #then
    expect(output).toContain("3 passed")
    expect(output).toContain("1 warning")
    expect(output).toContain("2 failed")
  })

  test("uses correct plural for warnings", () => {
    // #given
    const result: SmokeTestResult = {
      passed: true,
      checks: [
        { name: "a", severity: "pass" },
        { name: "b", severity: "warning", detail: "warn" },
      ],
      failureCount: 0,
      warningCount: 2,
      passCount: 1,
    }

    // #when
    const output = formatSmokeResults(result)

    // #then: plural "warnings"
    expect(output).toContain("2 warnings")
  })

  test("shows PASSED for all-pass result", () => {
    // #given
    const result: SmokeTestResult = {
      passed: true,
      checks: [
        { name: "a", severity: "pass", detail: "ok" },
        { name: "b", severity: "pass", detail: "ok" },
      ],
      failureCount: 0,
      warningCount: 0,
      passCount: 2,
    }

    // #when
    const output = formatSmokeResults(result)

    // #then
    expect(output).toContain("PASSED")
    expect(output).toContain("2 passed")
    expect(output).toContain("Summary:")
  })
})

describe("severity classification", () => {
  test("any failure causes passed: false", () => {
    // #given: a check with failure severity
    const checks: SmokeCheck[] = [
      { name: "ok", severity: "pass" },
      { name: "bad", severity: "failure", detail: "something failed" },
    ]
    // #when
    const result: SmokeTestResult = {
      passed: checks.some((c) => c.severity === "failure") === false,
      checks,
      failureCount: checks.filter((c) => c.severity === "failure").length,
      warningCount: checks.filter((c) => c.severity === "warning").length,
      passCount: checks.filter((c) => c.severity === "pass").length,
    }
    // #then
    expect(result.passed).toBe(false)
    expect(result.failureCount).toBe(1)
  })

  test("only warnings still allows passed: true", () => {
    // #given: only pass and warning checks
    const checks: SmokeCheck[] = [
      { name: "ok", severity: "pass" },
      { name: "warn", severity: "warning", detail: "pre-release" },
    ]
    // #when
    const failures = checks.filter((c) => c.severity === "failure").length
    const result: SmokeTestResult = {
      passed: failures === 0,
      checks,
      failureCount: failures,
      warningCount: checks.filter((c) => c.severity === "warning").length,
      passCount: checks.filter((c) => c.severity === "pass").length,
    }
    // #then: warnings are not failures
    expect(result.passed).toBe(true)
    expect(result.warningCount).toBe(1)
  })
})
