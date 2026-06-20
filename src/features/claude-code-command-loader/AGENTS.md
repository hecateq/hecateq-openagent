# claude-code-command-loader

## Overview

Discovers and loads slash commands from Markdown files with YAML frontmatter across four scopes: user, project, opencode-global, and opencode-project. Commands are defined in `{scope}/commands/` directories (e.g., `.claude/commands/`, `.opencode/commands/`). Each `.md` file is parsed for YAML frontmatter (`description`, `agent`, `model`, `subtask`, `argument-hint`, `handoffs`) and the body is wrapped in `<command-instruction>` + `<user-request>` template with `$ARGUMENTS` placeholder. Supports directory nesting with prefix-based command names. Includes a caching layer keyed by resolved realpath, and deduplication by command name (closer scope wins).

## File Inventory

| File | Purpose | LOC |
|------|---------|-----|
| `index.ts` | Re-exports types and loader functions | 2 |
| `types.ts` | `CommandScope`, `CommandDefinition`, `CommandFrontmatter`, `HandoffDefinition`, `LoadedCommand` types | 46 |
| `loader-cache.ts` | In-memory `Map<string, Promise<Record<string, CommandDefinition>>>` with get/set/delete/clear | 37 |
| `loader.ts` | Recursive directory walker, frontmatter parser, scope-aware loader functions, deduplication | 195 |

## Key Exports

- `loadAllCommands(directory?)` -- Aggregates commands from all four scopes with caching; priority order: user > opencode-global > project > opencode-project
- `loadUserCommands()` -- Loads from `~/.claude/commands/` (actually `getClaudeConfigDir()`)
- `loadProjectCommands(directory?)` -- Loads from `<project>/.claude/commands/`
- `loadOpencodeGlobalCommands()` -- Loads from OpenCode global command dirs (`getOpenCodeCommandDirs`)
- `loadOpencodeProjectCommands(directory?)` -- Loads from OpenCode project command dirs (`findProjectOpencodeCommandDirs`)
- `clearCommandLoaderCache()` -- Clears the cache map

## Integration Points

8 consumers. Primary integration is `src/plugin-handlers/command-config-handler.ts` which calls `loadAllCommands()` to populate the OpenCode command registry. Also used by `src/tools/slashcommand/command-discovery.ts`, `src/hooks/auto-slash-command/`, and `src/shared/plugin-command-discovery.ts`. Test coverage includes `src/plugin-handlers/config-handler.test.ts` and `src/tools/slashcommand/execution-compatibility.test.ts`.

## Test Status

1 dedicated test file (7.5k) plus integration tests in consumer modules. Covers command loading from all four scopes, frontmatter parsing, `$ARGUMENTS` template wrapping, subdirectory nesting, cycle detection via visited-set, scope ordering, cache invalidation, and error handling for unreadable directories.

## Known Gaps

- Cache lives for the lifetime of the plugin; no invalidation on filesystem changes. `clearCommandLoaderCache()` is exported but not called automatically.
- `HandoffDefinition` type is defined but the handoff workflow integration is not implemented in the loader -- only stored in the `CommandDefinition` object.
- No validation that a command name does not conflict with built-in slash commands.
- Frontmatter `model` field is sanitized via `sanitizeModelField` with `isOpencodeSource` heuristic, but the distinction between OpenCode and Claude Code model names may drift.
