# Active Context

**Last Updated:** 2026-05-22
**Updated By:** nodejs-backend-developer
**Status:** DONE

## Current Session
Implemented the hecateq-memory-bootstrap runtime hook: a safe, idempotent, session.created-triggered hook that bootstraps <project-root>/.opencode/memory/knowledge/context/ with template files.

## Key Decisions
- **Trigger:** `session.created` with `fired` guard (same proven pattern as legacy-plugin-toast) — fires once per process, skips subagent sessions
- **Shared Constants:** Extracted `PROJECT_MEMORY_DIR`, `PROJECT_MEMORY_FILES`, and `bootstrapMemoryFiles` to `src/shared/memory-bootstrap.ts` — shared between hook and doctor check
- **Project root detection:** `.opencode` > `.git` > manifest files (`package.json`/`pubspec.yaml`/`Cargo.toml`/`go.mod`/`pyproject.toml`), upward walk; null = no write
- **No config schema change:** No new top-level config field needed; uses existing `disabled_hooks: ["hecateq-memory-bootstrap"]`
