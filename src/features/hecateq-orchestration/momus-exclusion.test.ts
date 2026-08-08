import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

/**
 * Momus Exclusion Guard
 *
 * Momus must never be WIRED into new Hecateq code paths — never imported,
 * never routed to, never surfaced as a reviewer candidate. The only
 * permitted occurrences of "momus" in the scanned directories are
 * EXCLUSION references:
 *
 *  1. Prompt instructions telling the model not to use momus
 *     ("Do NOT use ... momus", "... momus ... excluded ...")
 *  2. Rejection guards comparing against the "momus" literal
 *     (=== "momus", !== "momus", includes("momus"))
 *
 * The scan covers `src/features/hecateq-orchestration/` and
 * `src/agents/hecateq-planner/` (the v2 planner lives under the latter).
 * `src/agents/momus.ts` is outside the scan and intentionally untouched.
 *
 * Exception (Part L): `momus-exclusion.ts` is the canonical guard module.
 * It is exempt from the per-line scan because its entire purpose is the
 * exclusion itself. Consumer files may reference the guard in sanctioned
 * ways, all treated as exclusion references below:
 *
 *  3. Importing / re-exporting the guard module (`"./momus-exclusion"`)
 *  4. Referencing the guard module's exported symbols (`isMomus`,
 *     `filterMomus`, `assertNoMomus`, `HECATEQ_MOMUS_GUARD_DESCRIPTION`)
 */

const SCAN_DIRS = [
  import.meta.dir,
  join(import.meta.dir, "..", "..", "agents", "hecateq-planner"),
]

const THIS_TEST_FILE = "momus-exclusion.test.ts"

/** Canonical guard module: exempt from the per-line scan (see docstring). */
const GUARD_MODULE_FILE = "momus-exclusion.ts"

function collectTypeScriptFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stats = statSync(full)
    if (stats.isDirectory()) {
      files.push(...collectTypeScriptFiles(full))
    } else if (entry.endsWith(".ts")) {
      files.push(full)
    }
  }
  return files
}

/**
 * Remove `//` and `/* *​/` comments so comment-only references are not
 * treated as code references. Handles the common single-pass case for
 * this narrow scan (JSDoc and trailing inline comments).
 */
function stripComments(content: string): string {
  let out = ""
  let i = 0
  while (i < content.length) {
    const two = content.slice(i, i + 2)
    if (two === "//") {
      const newline = content.indexOf("\n", i)
      if (newline < 0) break
      out += "\n"
      i = newline + 1
    } else if (two === "/*") {
      const end = content.indexOf("*/", i + 2)
      if (end < 0) break
      out += "\n".repeat(content.slice(i, end + 2).split("\n").length - 1)
      i = end + 2
    } else {
      out += content[i] ?? ""
      i += 1
    }
  }
  return out
}

function isAllowedExclusionReference(line: string): boolean {
  const lower = line.toLowerCase()
  if (!lower.includes("momus")) return true

  // Guard module API: importing / re-exporting the canonical exclusion
  // module or referencing its exported symbols (`isMomus`, `filterMomus`,
  // `assertNoMomus`, `HECATEQ_MOMUS_GUARD_DESCRIPTION`) is an exclusion
  // reference, never a wiring of the forbidden agent.
  if (
    lower.includes('"./momus-exclusion"') ||
    lower.includes("ismomus") ||
    lower.includes("filtermomus") ||
    lower.includes("assertnomomus") ||
    lower.includes("momus_guard_description")
  ) {
    return true
  }

  // Prompt instruction: "Do NOT use `momus` ..." / "... momus ... excluded ..."
  if (lower.includes("do not use") && lower.includes("momus")) return true
  if (lower.includes("excluded")) return true

  // Rejection guards: comparisons against the "momus" literal
  if (
    /["'`]momus["'`]/.test(lower) &&
    (lower.includes("===") || lower.includes("!==") || lower.includes("includes("))
  ) {
    return true
  }

  // Trace event fired when a momus-containing chain is blocked
  if (lower.includes("momus") && lower.includes("blocked")) return true

  return false
}

describe("momus exclusion", () => {
  test("#given the orchestration and planner v2 directories #then no new code path wires momus in", () => {
    // given
    const files = SCAN_DIRS.flatMap((dir) => collectTypeScriptFiles(dir))
    const violations: Array<{ file: string; line: number; text: string }> = []

    // when — scan every line of every non-test file for non-exclusion references
    for (const file of files) {
      const rel = relative(import.meta.dir, file)
      if (rel.endsWith(THIS_TEST_FILE)) continue
      if (rel.endsWith(GUARD_MODULE_FILE)) continue
      if (rel.endsWith(".test.ts")) continue

      const content = stripComments(readFileSync(file, "utf-8"))
      const lines = content.split("\n")
      for (let i = 0; i < lines.length; i += 1) {
        if (lines[i]?.toLowerCase().includes("momus") && !isAllowedExclusionReference(lines[i] ?? "")) {
          violations.push({ file: rel, line: i + 1, text: lines[i] ?? "" })
        }
      }
    }

    // then
    expect(violations).toEqual([])
  })

  test("#given the scan #then it covers the v2 planner prompt exclusion directive", () => {
    // given — sanity: the scan must actually see the v2 planner prompt,
    // otherwise the guard could pass vacuously
    const files = SCAN_DIRS.flatMap((dir) => collectTypeScriptFiles(dir))
    const v2Agent = files.find((file) => file.endsWith(join("v2", "agent.ts")))
    // then
    expect(v2Agent).toBeDefined()
    if (v2Agent) {
      const content = readFileSync(v2Agent, "utf-8")
      expect(content.toLowerCase()).toContain("momus")
      expect(content.toLowerCase()).toContain("excluded")
    }
  })
})

// ─── Part L: Momus hard exclusion module ────────────────────────────────────

import { evaluatePlannerGate } from "./planner-gate"
import { resolveReviewerAgent } from "./reviewer-routing"
import { resolveVerifierAgent } from "./verifier-routing"
import {
  HECATEQ_FORBIDDEN_AGENTS,
  HECATEQ_FORBIDDEN_AGENT_SET,
  HECATEQ_MOMUS_GUARD_DESCRIPTION,
  assertNoMomus,
  filterMomus,
  isMomus,
} from "./momus-exclusion"

describe("momus hard exclusion module", () => {
  test("#given the forbidden critic in any casing #then isMomus returns true", () => {
    // when / then
    expect(isMomus("momus")).toBe(true)
    expect(isMomus("Momus")).toBe(true)
    expect(isMomus("MOMUS")).toBe(true)
  })

  test("#given a non-critic agent #then isMomus returns false", () => {
    // when / then
    expect(isMomus("oracle")).toBe(false)
    expect(isMomus("")).toBe(false)
    expect(isMomus("momuss")).toBe(false)
  })

  test("#given a candidate list with the critic in mixed casing #then filterMomus removes it", () => {
    // when
    const filtered = filterMomus(["a", "momus", "b", "Momus", "MOMUS"])
    // then
    expect(filtered).toEqual(["a", "b"])
  })

  test("#given the critic present #then assertNoMomus throws", () => {
    // when / then
    expect(() => assertNoMomus(["a", "momus", "b"], "test-context")).toThrow(
      "test-context",
    )
  })

  test("#given the critic absent #then assertNoMomus does not throw", () => {
    // when / then
    expect(() => assertNoMomus(["a", "b"], "test-context")).not.toThrow()
  })

  test("#given the guard constants #then they carry the canonical exclusion", () => {
    // then
    expect(HECATEQ_FORBIDDEN_AGENTS).toEqual(["momus"])
    expect([...HECATEQ_FORBIDDEN_AGENT_SET]).toEqual(["momus"])
    expect(HECATEQ_MOMUS_GUARD_DESCRIPTION.length).toBeGreaterThan(0)
  })

  test("#given the critic explicitly passed to verifier-routing #then it is never selected", () => {
    // when — the critic is explicitly first in the preferred list
    const decision = resolveVerifierAgent({
      preferredAgents: ["momus", "qa-test-engineer"],
    })
    // then
    expect(decision.verifierAgent).not.toBe("momus")
    expect(decision.verifierAgent).toBe("qa-test-engineer")
    expect(decision.alternatives ?? []).not.toContain("momus")
  })

  test("#given the critic explicitly passed to planner-gate #then it is never recommended", () => {
    // when — a planner_required input with every escalation signal on
    const assessment = evaluatePlannerGate({
      taskSize: { files: 40, loc: 4000, taskCount: 6 },
      domainKnown: false,
      architectureKnown: false,
      hasMultipleWorkUnits: true,
      uncertainty: "high",
      risk: "high",
      architecturalImpact: true,
      crossSystemDependencies: true,
      migrationRisk: true,
      unclearRequirements: true,
    })
    // then
    expect(assessment.recommendedAgents).not.toContain("momus")
  })

  test("#given the critic explicitly passed to reviewer-routing #then it is never surfaced", () => {
    // when — the critic is enabled in the agent index, but the runtime
    // registry does not contain the reviewer so candidates are considered
    const result = resolveReviewerAgent(new Set(["atlas"]), {
      agents: [
        { name: "momus", enabled: true },
        { name: "reviewer", enabled: true },
      ],
    })
    // then
    expect(result.candidates ?? []).not.toContain("momus")
    expect(result.reviewer).not.toBe("momus")
  })
})
