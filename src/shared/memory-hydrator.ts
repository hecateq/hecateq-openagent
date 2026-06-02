import { basename } from "node:path"

import { detectPlaceholderContent } from "./memory-manifest"

export type MemoryHydrationInput = {
  projectRoot: string
  fileName: string
  existingContent: string
  timestamp?: string
}

const TODAY = (): string => {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd}`
}

function projectName(input: MemoryHydrationInput): string {
  return basename(input.projectRoot) || "project"
}

function dateline(input: MemoryHydrationInput): string {
  return input.timestamp ?? TODAY()
}

const HYDRATED_TEMPLATES: Record<string, (input: MemoryHydrationInput) => string> = {
  "active-context.md": (i) =>
    `# Active Context

Last updated: ${dateline(i)}

## Current Goal
- Initial setup of ${projectName(i)} project memory

## Current State
- Memory files bootstrapped and hydrated

## Constraints
- None recorded yet

## Known Risks
- None recorded yet
`,

  "progress.md": (i) =>
    `# Progress

Last updated: ${dateline(i)}

## Completed
- Memory bootstrap completed

## In Progress
- Populating project context

## Remaining
- Fill in domain-specific details
`,

  "tasks.md": (i) =>
    `# Tasks

Last updated: ${dateline(i)}

## Pending
- Populate project-specific context in memory files

## Blocked
- None

## Done
- Memory system initialized
`,

  "file-map.md": (i) =>
    `# File Map

Last updated: ${dateline(i)}

## Important Paths
- .opencode/state/memory — project memory files

## Entry Points
- package.json (or project manifest)

## Do Not Scan Blindly
- node_modules, .git, dist
`,

  "decisions.md": (i) =>
    `# Decisions

Last updated: ${dateline(i)}

## Accepted Decisions
- Using Hecateq memory system for project state tracking

## Rejected Approaches
- None yet

## Notes
- Populate as architectural decisions are made
`,

  "agent-routing.md": (i) =>
    `# Agent Routing

Last updated: ${dateline(i)}

## Preferred Agents by Domain
- implementation: hephaestus
- planning: sisyphus, oracle
- research: librarian, explore

## Agent Assignment Rules
- None configured yet

## Disabled / Restricted Agents
- None

## Custom Agent Paths
- None configured yet
`,

  "quality-history.md": (i) =>
    `# Quality History

Last updated: ${dateline(i)}

## Quality Gate Results
- No gates executed yet

## Known Test Failures
- None recorded

## Linting / Typecheck Notes
- No issues recorded

## Regression History
- None
`,

  "risk-profile.md": (i) =>
    `# Risk Profile

Last updated: ${dateline(i)}

## Sensitive Paths
- .env, secrets/, keys/

## Destructive Operations
- None identified yet

## Security Constraints
- None configured yet

## Rollback Plans
- None
`,

  "open-questions.md": (i) =>
    `# Open Questions

Last updated: ${dateline(i)}

## Active Questions
- None yet

## Waiting For
- None yet

## Unresolved Tradeoffs
- None yet

## Resolved Questions
- None yet
`,

  "conventions.md": (i) =>
    `# Conventions

Last updated: ${dateline(i)}

## Coding Style
- Project conventions not yet recorded

## Naming Conventions
- Follow project-specific naming patterns

## Folder Structure
- Standard project layout

## Framework Patterns
- Use framework conventions for this project

## Generated Files
- Generated files are not scanned

## Test Conventions
- Add tests alongside implementation
`,

  "environment.md": (i) =>
    `# Environment

Last updated: ${dateline(i)}

## Runtime
- Package manager: project-default
- Runtime version: project-required

## Commands
- Dev: Project-specific dev command
- Build: Project-specific build command
- Test: Project-specific test command
- Lint: Project-specific lint command
- Typecheck: Project-specific typecheck command

## Ports
- Port configuration not yet recorded

## Environment Variables (names only — no values)
- None recorded yet

## Services
- No services configured yet

## Deployment
- No deployment targets configured yet

## Secrets Policy
- Secret values are NEVER written to this file.
- Use env var names only.
`,
}

export function hydrateMemoryFile(input: MemoryHydrationInput): string | null {
  if (!detectPlaceholderContent(input.existingContent)) {
    return null
  }

  const factory = HYDRATED_TEMPLATES[input.fileName]
  if (!factory) {
    return null
  }

  const content = factory(input)

  // Safety: hydrated content must not itself be detected as placeholder
  if (detectPlaceholderContent(content)) {
    return null
  }

  return content
}
