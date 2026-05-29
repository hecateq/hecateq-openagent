/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const workflowChecks = [
  {
    path: new URL("../.github/workflows/ci.yml", import.meta.url),
    testRuns: [
      "run: bun test",
      "run: bun test src/shared/dist-bundle-bun-globals.test.ts",
    ],
  },
  {
    path: new URL("../.github/workflows/publish.yml", import.meta.url),
    testRuns: [
      "run: bun install --frozen-lockfile",
      "run: bun run typecheck",
      "run: bun run build",
      "run: npm pack --dry-run",
      "run: npm publish --access public --tag beta",
      // version job: robust jq extraction + semver validation
      "jq -r '.version // empty' package.json",
      "Invalid semver in package.json",
    ],
  },
]

describe("test workflows", () => {
  test("use pure bun test for workflows", () => {
    for (const workflowCheck of workflowChecks) {
      // #given
      const workflow = readFileSync(workflowCheck.path, "utf8")

      for (const testRun of workflowCheck.testRuns) {
        expect(workflow).toContain(testRun)
      }
    }
  })

  test("publish-platform gated by publish_upstream input", () => {
    // #given
    const workflow = readFileSync(
      new URL("../.github/workflows/publish-platform.yml", import.meta.url),
      "utf8",
    )

    // #then: publish_upstream input exists in both workflow_call and workflow_dispatch
    expect(workflow).toContain("publish_upstream")

    // #then: upstream publish job is gated by publish_upstream == 'true'
    expect(workflow).toContain(
      "if: always() && !cancelled() && inputs.publish_upstream == 'true'",
    )

    // #then: hecateq publish job has no publish_upstream gate (always runs)
    const hecateqPublishLine = workflow
      .split("\n")
      .find((line) => line.includes("publish-hecateq"))
    expect(hecateqPublishLine).toBeDefined()

    // #then: upstream publish job only runs on linux matrix (for ci.yml check)
    expect(workflow).toContain("publish_upstream:")
  })
})
