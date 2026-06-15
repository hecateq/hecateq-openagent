import { describe, expect, test } from "bun:test"
import { validatePackageJson, formatVersionIssues } from "./validate-version"

function validPackageJson(): Record<string, unknown> {
  return {
    name: "@hecateq/hecateq-openagent",
    version: "1.2.3",
    main: "./dist/index.js",
    types: "dist/index.d.ts",
    bin: { "hecateq-openagent": "bin/oh-my-opencode.js" },
    files: ["dist", "bin"],
    repository: { type: "git", url: "git+https://github.com/hecateq/hecateq-openagent.git" },
    engines: { node: ">=18" },
    packageManager: "bun@1.3.12",
  }
}

describe("validatePackageJson", () => {
  test("valid package.json passes all checks", () => {
    // #given
    const content = JSON.stringify(validPackageJson())
    // #when
    const result = validatePackageJson(content)
    // #then
    expect(result.valid).toBe(true)
    expect(result.issues).toHaveLength(0)
    expect(result.packageName).toBe("@hecateq/hecateq-openagent")
    expect(result.version).toBe("1.2.3")
  })

  test("missing name produces error", () => {
    // #given
    const pkg = validPackageJson()
    delete pkg.name
    // #when
    const result = validatePackageJson(JSON.stringify(pkg))
    // #then
    expect(result.valid).toBe(false)
    const nameIssue = result.issues.find((i) => i.field === "name")
    expect(nameIssue).toBeDefined()
    expect(nameIssue!.severity).toBe("error")
    expect(nameIssue!.message).toContain("missing 'name'")
  })

  test("missing version produces error", () => {
    // #given
    const pkg = validPackageJson()
    delete pkg.version
    // #when
    const result = validatePackageJson(JSON.stringify(pkg))
    // #then
    expect(result.valid).toBe(false)
    const versionIssue = result.issues.find((i) => i.field === "version")
    expect(versionIssue).toBeDefined()
    expect(versionIssue!.severity).toBe("error")
    expect(versionIssue!.message).toContain("missing 'version'")
  })

  test("invalid semver produces error", () => {
    // #given
    const pkg = validPackageJson()
    pkg.version = "not-a-version"
    // #when
    const result = validatePackageJson(JSON.stringify(pkg))
    // #then
    expect(result.valid).toBe(false)
    const versionIssue = result.issues.find((i) => i.field === "version")
    expect(versionIssue).toBeDefined()
    expect(versionIssue!.severity).toBe("error")
    expect(versionIssue!.message).toContain("not valid semver")
  })

  test("placeholder 0.0.0 produces error", () => {
    // #given
    const pkg = validPackageJson()
    pkg.version = "0.0.0"
    // #when
    const result = validatePackageJson(JSON.stringify(pkg))
    // #then
    expect(result.valid).toBe(false)
    const versionIssue = result.issues.find((i) => i.message.includes("placeholder"))
    expect(versionIssue).toBeDefined()
    expect(versionIssue!.severity).toBe("error")
  })

  test("placeholder 0.1.0 produces warning", () => {
    // #given
    const pkg = validPackageJson()
    pkg.version = "0.1.0"
    // #when
    const result = validatePackageJson(JSON.stringify(pkg))
    // #then: 0.1.0 is a warning, not an error
    expect(result.valid).toBe(true)
    const versionIssue = result.issues.find((i) => i.message.includes("starter placeholder"))
    expect(versionIssue).toBeDefined()
    expect(versionIssue!.severity).toBe("warning")
  })

  test("pre-release version (-beta.8) produces warning", () => {
    // #given
    const pkg = validPackageJson()
    pkg.version = "0.1.0-beta.8"
    // #when
    const result = validatePackageJson(JSON.stringify(pkg))
    // #then
    expect(result.valid).toBe(true)
    const preReleaseIssue = result.issues.find((i) => i.message.includes("pre-release"))
    expect(preReleaseIssue).toBeDefined()
    expect(preReleaseIssue!.severity).toBe("warning")
  })

  test("pre-release version (-alpha.1) produces warning", () => {
    // #given
    const pkg = validPackageJson()
    pkg.version = "2.0.0-alpha.1"
    // #when
    const result = validatePackageJson(JSON.stringify(pkg))
    // #then
    expect(result.valid).toBe(true)
    const preReleaseIssue = result.issues.find((i) => i.message.includes("pre-release"))
    expect(preReleaseIssue).toBeDefined()
  })

  test("missing main produces error", () => {
    // #given
    const pkg = validPackageJson()
    delete pkg.main
    // #when
    const result = validatePackageJson(JSON.stringify(pkg))
    // #then
    expect(result.valid).toBe(false)
    const mainIssue = result.issues.find((i) => i.field === "main")
    expect(mainIssue).toBeDefined()
    expect(mainIssue!.severity).toBe("error")
    expect(mainIssue!.message).toContain("missing 'main'")
  })

  test("missing types produces error", () => {
    // #given
    const pkg = validPackageJson()
    delete pkg.types
    // #when
    const result = validatePackageJson(JSON.stringify(pkg))
    // #then
    expect(result.valid).toBe(false)
    const typesIssue = result.issues.find((i) => i.field === "types")
    expect(typesIssue).toBeDefined()
    expect(typesIssue!.severity).toBe("error")
    expect(typesIssue!.message).toContain("missing 'types'")
  })

  test("missing bin produces error", () => {
    // #given
    const pkg = validPackageJson()
    delete pkg.bin
    // #when
    const result = validatePackageJson(JSON.stringify(pkg))
    // #then
    expect(result.valid).toBe(false)
    const binIssue = result.issues.find((i) => i.field === "bin")
    expect(binIssue).toBeDefined()
    expect(binIssue!.severity).toBe("error")
    expect(binIssue!.message).toContain("missing 'bin'")
  })

  test("empty bin produces error", () => {
    // #given
    const pkg = validPackageJson()
    pkg.bin = {}
    // #when
    const result = validatePackageJson(JSON.stringify(pkg))
    // #then
    expect(result.valid).toBe(false)
    const binIssue = result.issues.find((i) => i.field === "bin")
    expect(binIssue).toBeDefined()
    expect(binIssue!.severity).toBe("error")
    expect(binIssue!.message).toContain("empty object")
  })

  test("missing files produces error", () => {
    // #given
    const pkg = validPackageJson()
    delete pkg.files
    // #when
    const result = validatePackageJson(JSON.stringify(pkg))
    // #then
    expect(result.valid).toBe(false)
    const filesIssue = result.issues.find((i) => i.field === "files")
    expect(filesIssue).toBeDefined()
    expect(filesIssue!.severity).toBe("error")
    expect(filesIssue!.message).toContain("missing 'files'")
  })

  test("bad main path (not ./ or dist/) produces error", () => {
    // #given
    const pkg = validPackageJson()
    pkg.main = "lib/index.js"
    // #when
    const result = validatePackageJson(JSON.stringify(pkg))
    // #then
    expect(result.valid).toBe(false)
    const mainIssue = result.issues.find((i) => i.field === "main")
    expect(mainIssue).toBeDefined()
    expect(mainIssue!.severity).toBe("error")
    expect(mainIssue!.message).toContain('should start with "./" or "dist/"')
  })

  test("bad types path produces error", () => {
    // #given
    const pkg = validPackageJson()
    pkg.types = "types"
    // #when
    const result = validatePackageJson(JSON.stringify(pkg))
    // #then
    expect(result.valid).toBe(false)
    const typesIssue = result.issues.find((i) => i.field === "types")
    expect(typesIssue).toBeDefined()
    expect(typesIssue!.severity).toBe("error")
  })

  test("missing repository produces warning", () => {
    // #given
    const pkg = validPackageJson()
    delete pkg.repository
    // #when
    const result = validatePackageJson(JSON.stringify(pkg))
    // #then: warnings don't affect validity
    expect(result.valid).toBe(true)
    const repoIssue = result.issues.find((i) => i.field === "repository")
    expect(repoIssue).toBeDefined()
    expect(repoIssue!.severity).toBe("warning")
  })

  test("missing engines produces warning", () => {
    // #given
    const pkg = validPackageJson()
    delete pkg.engines
    // #when
    const result = validatePackageJson(JSON.stringify(pkg))
    // #then
    expect(result.valid).toBe(true)
    const enginesIssue = result.issues.find((i) => i.field === "engines")
    expect(enginesIssue).toBeDefined()
    expect(enginesIssue!.severity).toBe("warning")
  })

  test("missing packageManager produces warning", () => {
    // #given
    const pkg = validPackageJson()
    delete pkg.packageManager
    // #when
    const result = validatePackageJson(JSON.stringify(pkg))
    // #then
    expect(result.valid).toBe(true)
    const pmIssue = result.issues.find((i) => i.field === "packageManager")
    expect(pmIssue).toBeDefined()
    expect(pmIssue!.severity).toBe("warning")
  })

  test("private: true produces warning", () => {
    // #given
    const pkg = validPackageJson()
    pkg.private = true
    // #when
    const result = validatePackageJson(JSON.stringify(pkg))
    // #then
    expect(result.valid).toBe(true)
    const privateIssue = result.issues.find((i) => i.field === "private")
    expect(privateIssue).toBeDefined()
    expect(privateIssue!.severity).toBe("warning")
  })

  test("legacy package name produces warning", () => {
    // #given
    const pkg = validPackageJson()
    pkg.name = "oh-my-opencode"
    // #when
    const result = validatePackageJson(JSON.stringify(pkg))
    // #then
    expect(result.valid).toBe(true)
    const nameIssue = result.issues.find((i) => i.field === "name")
    expect(nameIssue).toBeDefined()
    expect(nameIssue!.severity).toBe("warning")
    expect(nameIssue!.message).toContain("legacy")
  })

  test("multiple errors produce valid: false", () => {
    // #given
    const pkg = validPackageJson()
    delete pkg.name
    delete pkg.version
    delete pkg.main
    delete pkg.types
    delete pkg.bin
    delete pkg.files
    // #when
    const result = validatePackageJson(JSON.stringify(pkg))
    // #then
    expect(result.valid).toBe(false)
    const errors = result.issues.filter((i) => i.severity === "error")
    expect(errors.length).toBeGreaterThanOrEqual(5)
  })

  test("multiple warnings produce valid: true", () => {
    // #given
    const pkg = validPackageJson()
    delete pkg.repository
    delete pkg.engines
    delete pkg.packageManager
    pkg.private = true
    pkg.version = "0.1.0-beta.8"
    // #when
    const result = validatePackageJson(JSON.stringify(pkg))
    // #then: warnings only — still valid
    expect(result.valid).toBe(true)
    const warnings = result.issues.filter((i) => i.severity === "warning")
    expect(warnings.length).toBeGreaterThanOrEqual(4)
    const errors = result.issues.filter((i) => i.severity === "error")
    expect(errors).toHaveLength(0)
  })

  test("invalid JSON produces error", () => {
    // #given
    const invalidJson = "{ not valid json }"
    // #when
    const result = validatePackageJson(invalidJson)
    // #then
    expect(result.valid).toBe(false)
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0]!.severity).toBe("error")
    expect(result.issues[0]!.message).toContain("Invalid JSON")
  })

  test("wrong canonical name produces error", () => {
    // #given
    const pkg = validPackageJson()
    pkg.name = "some-other-package"
    // #when
    const result = validatePackageJson(JSON.stringify(pkg))
    // #then
    expect(result.valid).toBe(false)
    const nameIssue = result.issues.find((i) => i.field === "name")
    expect(nameIssue).toBeDefined()
    expect(nameIssue!.severity).toBe("error")
    expect(nameIssue!.message).toContain("does not match canonical name")
  })

  test("bin with non-.js extension produces warning", () => {
    // #given
    const pkg = validPackageJson()
    pkg.bin = { "my-cli": "bin/my-cli.ts" }
    // #when
    const result = validatePackageJson(JSON.stringify(pkg))
    // #then
    expect(result.valid).toBe(true)
    const binIssue = result.issues.find((i) => i.field === "bin")
    expect(binIssue).toBeDefined()
    expect(binIssue!.severity).toBe("warning")
    expect(binIssue!.message).toContain(".js extension")
  })

  test("string bin without .js extension produces warning", () => {
    // #given
    const pkg = validPackageJson()
    pkg.bin = "bin/my-cli.ts"
    // #when
    const result = validatePackageJson(JSON.stringify(pkg))
    // #then
    expect(result.valid).toBe(true)
    const binIssue = result.issues.find((i) => i.field === "bin")
    expect(binIssue).toBeDefined()
    expect(binIssue!.severity).toBe("warning")
    expect(binIssue!.message).toContain(".js extension")
  })
})

describe("formatVersionIssues", () => {
  test("formats passing result", () => {
    // #given
    const result = {
      packageName: "@hecateq/hecateq-openagent",
      version: "1.2.3",
      valid: true,
      issues: [],
    }
    // #when
    const output = formatVersionIssues(result)
    // #then
    expect(output).toContain("VALID")
    expect(output).toContain("@hecateq/hecateq-openagent")
    expect(output).toContain("All version checks passed")
  })

  test("formats failing result with errors and warnings", () => {
    // #given
    const result = {
      packageName: "test-pkg",
      version: "0.0.0",
      valid: false,
      issues: [
        { severity: "error" as const, field: "version", message: 'Version "0.0.0" is placeholder' },
        { severity: "warning" as const, field: "repository", message: "missing 'repository' field" },
      ],
    }
    // #when
    const output = formatVersionIssues(result)
    // #then
    expect(output).toContain("INVALID")
    expect(output).toContain("Errors")
    expect(output).toContain("Warnings")
    expect(output).toContain("placeholder")
    expect(output).toContain("repository")
  })

  test("formats single error result", () => {
    // #given
    const result = {
      packageName: "test-pkg",
      version: "1.0.0",
      valid: false,
      issues: [
        { severity: "error" as const, field: "main", message: "missing 'main' field" },
      ],
    }
    // #when
    const output = formatVersionIssues(result)
    // #then
    expect(output).toContain("INVALID")
    expect(output).toContain("Errors (1)")
    expect(output).toContain("[main]")
  })

  test("formats with warnings only (valid still true)", () => {
    // #given
    const result = {
      packageName: "test-pkg",
      version: "0.1.0-beta.1",
      valid: true,
      issues: [
        { severity: "warning" as const, field: "version", message: "pre-release" },
      ],
    }
    // #when
    const output = formatVersionIssues(result)
    // #then
    expect(output).toContain("VALID")
    expect(output).toContain("Warnings")
  })
})
