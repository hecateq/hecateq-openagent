import { describe, expect, it } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

const orchestratorDir = join(import.meta.dir)

/**
 * Regression guard: prevents `task(category=...)` from creeping back into
 * the Hecateq God orchestrator prompt surface.
 *
 * Category routing is permanently disabled in this build
 * (disable_category_routing: true). Qwen models in this codebase read prompt
 * examples and emit `category=` calls, which are rejected at runtime.
 */
describe("category examples audit", () => {
  // given: the orchestrator source directory
  const tsFiles = readdirSync(orchestratorDir).filter(
    (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
  )

  for (const filename of tsFiles) {
    it(`#then ${filename} contains no task(category=...) examples`, () => {
      // given
      const content = readFileSync(join(orchestratorDir, filename), "utf-8")
      const lines = content.split("\n")

      // when: scan for any task(category= pattern
      const violations: { line: number; text: string }[] = []
      for (let i = 0; i < lines.length; i++) {
        // Allow the line ONLY if it explicitly says "Do not write task(category=..."
        if (
          lines[i].includes("task(category=") &&
          !lines[i].includes("Do not write task(category=")
        ) {
          violations.push({ line: i + 1, text: lines[i].trim() })
        }
      }

      // then: zero violations
      expect(violations).toEqual([])
    })
  }
})
