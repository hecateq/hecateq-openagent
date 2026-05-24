import { mkdirSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { ROUTING_RUNTIME_PRECEDENCE, ROUTING_TRUTH_NOTE } from "../src/shared/routing"
import { ALLOWED_AGENTS } from "../src/tools/call-omo-agent/constants"

const ROOT = new URL("..", import.meta.url)
const GENERATED_DIR = new URL("../docs/generated", import.meta.url)

function toRootPath(...parts: string[]): string {
  return join(fileURLToPath(ROOT), ...parts)
}

async function writeGeneratedDoc(fileName: string, content: string): Promise<void> {
  const generatedDirPath = fileURLToPath(GENERATED_DIR)
  mkdirSync(generatedDirPath, { recursive: true })
  await Bun.write(join(generatedDirPath, fileName), `${content.trim()}\n`)
}

function buildRuntimeRoutingDoc(): string {
  return `# Runtime Routing

This file is generated from runtime constants.

## Resolution Precedence

${ROUTING_RUNTIME_PRECEDENCE.map((entry, index) => `${index + 1}. ${entry}`).join("\n")}

## Exact Resolution Statuses

- exact_agent_found
- exact_agent_disabled
- exact_agent_unknown
- category_fallback

## Agent Index Boundary

${ROUTING_TRUTH_NOTE}

## call_omo_agent Boundary

- Allowed agents: ${ALLOWED_AGENTS.join(", ")}
- Purpose: restricted evidence/search lane only
- Non-goal: general delegation, arbitrary built-in execution, custom-agent execution, or category routing
`
}

function buildDoctorChecksDoc(): string {
  const checksDir = toRootPath("src", "cli", "doctor", "checks")
  const files = readdirSync(checksDir)
    .filter((fileName) => fileName.endsWith(".ts") && !fileName.endsWith(".test.ts"))
    .sort((left, right) => left.localeCompare(right))

  return `# Doctor Checks

This file is generated from the check directory layout.

## Registered Check Modules

${files.map((fileName) => `- ${fileName}`).join("\n")}
`
}

function buildToolRegistryDoc(): string {
  const toolsDir = toRootPath("src", "tools")
  const entries = readdirSync(toolsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right))

  return `# Tool Registry Surface

This file is generated from the native tool directory layout.

## Tool Modules

${entries.map((entry) => `- ${entry}`).join("\n")}

## Routing-sensitive Modules

- delegate-task: exact subagent routing and explicit category fallback
- call-omo-agent: restricted evidence/search lane for ${ALLOWED_AGENTS.join(" and ")}
`
}

async function main(): Promise<void> {
  await writeGeneratedDoc("runtime-routing.md", buildRuntimeRoutingDoc())
  await writeGeneratedDoc("doctor-checks.md", buildDoctorChecksDoc())
  await writeGeneratedDoc("tool-registry.md", buildToolRegistryDoc())
}

await main()
