# Hecateq OpenAgent — Troubleshooting

This document covers common issues and their resolutions.

---

## Installation Issues

### Plugin not loading

**Symptom:** OpenCode starts but Hecateq OpenAgent features are not available.

**Check:**
1. Verify plugin registration in `~/.config/opencode/opencode.json`:
   ```json
   { "plugins": ["@hecateq/openagent"] }
   ```
2. Run doctor to check plugin status:
   ```bash
   npx hecateq-openagent doctor
   ```
3. Check OpenCode version (>= 1.0.150 required):
   ```bash
   opencode --version
   ```

### "Platform binary not found"

**Symptom:** Error message about missing binary during startup.

**Solution:**
1. Run doctor to check binary detection:
   ```bash
   npx hecateq-openagent doctor --verbose
   ```
2. Reinstall the package:
   ```bash
   npm install -g @hecateq/openagent@beta
   ```

### Postinstall script errors

**Symptom:** npm/bun install completes with warnings about postinstall.

**Solution:**
- These are typically non-fatal. If the install succeeds, the plugin should still work.
- Check with `npx hecateq-openagent doctor`.

---

## Configuration Issues

### Config parsing errors

**Symptom:** OpenCode shows config-related errors at startup.

**Check:**
1. Validate JSONC syntax in your config files:
   ```bash
   npx hecateq-openagent doctor
   ```
2. Check for trailing commas (allowed in JSONC) vs strict JSON
3. Verify config file location:
   - User: `~/.config/opencode/oh-my-openagent.jsonc`
   - Project: `<root>/.opencode/oh-my-openagent.jsonc`

### Config migration issues

**Symptom:** Config warnings about legacy fields.

**Solution:**
- The migration system runs automatically and idempotently.
- Check `_migrations` array in config to see which migrations have run.
- Timestamped backups are created before any migration.
- See `src/shared/migration/` for supported migrations.

---

## Build Issues

### Type check failures

```bash
bun run typecheck
```

**Common fixes:**
- Run `bun install` to ensure all dependencies are installed
- Run `bun run clean && bun run build` to rebuild
- Check for TypeScript strict mode violations

### Build failures

```bash
bun run build
```

**Common fixes:**
- `bun run clean` to remove stale build artifacts
- Ensure Bun version >= 1.3.12
- Check for `@ast-grep/napi` and `zod` external dependencies

---

## Runtime Issues

### High-risk prompt blocked

**Symptom:** `hecateq run` exits with code 2 and plan-only output.

**Solution:**
- Review the plan output to understand the risk classification
- Use `--force` to override (only if you've reviewed and accept the risk):
  ```bash
  hecateq-openagent hecateq run --force "<prompt>"
  ```

### Session not found in `hecateq resume`

**Symptom:** "Session 'xxx' not found" when trying to resume.

**Check:**
1. List available sessions:
   ```bash
   hecateq-openagent hecateq resume
   ```
2. Verify the orchestration directory exists:
   ```bash
   ls .opencode/orchestration/
   ```

### Hecateq doctor shows failures

**Symptom:** `hecateq doctor` shows "fail" or "warn" categories.

**Common resolutions:**

| Category | Resolution |
|----------|------------|
| Agent Registration | Ensure Hecateq agents are registered in OpenCode config |
| Configuration | Validate hecateq config section syntax |
| Orchestration | Run `hecateq plan` or `hecateq run` to initialize |
| Safety Hooks | Enable required hooks (check `disabled_hooks`) |
| Handoff State | Handoff files may be missing — normal for new projects |
| Project Memory | Run a session to trigger memory bootstrap |
| Memory Manifest | Manifest may be stale — normal for inactive projects |
| Agent Index | Run a session or rebuild agent index |

---

## Telemetry Issues

### Telemetry errors in logs

**Symptom:** Log messages about PostHog errors.

**Cause:** Telemetry is trying to send but no PostHog key is configured.

**Solution:**
- This is harmless. Telemetry safely no-ops without a key.
- To silence: unset `HECATEQ_SEND_ANONYMOUS_TELEMETRY` or set a valid PostHog key.
- See [privacy-telemetry.md](./privacy-telemetry.md).

---

## Migration Issues

### Legacy `.omo/` directory not migrating

**Symptom:** Memory files expected in `.opencode/` but found in `.omo/`.

**Solution:**
- The migration from `.omo/` to `.opencode/` is automatic on first session start.
- If migration fails, manually copy:
  ```bash
  cp -r .omo/state .opencode/state
  ```
- See `src/features/hecateq-orchestration/omo-migration.ts`.

---

## Known Test Status

The inherited full test suite (`bun test`) is not fully green. This is due to:

1. Pre-existing upstream test failures inherited from oh-my-openagent
2. Fork-specific test infrastructure issues (platform binary detection in test environments)
3. Hecateq-specific features with incomplete test coverage

**Current approach:**
- CI runs tests as a non-blocking signal
- Release gates are: typecheck, build, npm pack --dry-run
- Targeted tests for changed code should pass

---

## Getting Help

If you encounter issues not covered here:

1. Run full diagnostics:
   ```bash
   npx hecateq-openagent doctor --verbose
   npx hecateq-openagent hecateq doctor --verbose
   ```
2. Check logs:
   - Plugin log: `/tmp/oh-my-opencode.log` (Linux) or `os.tmpdir()/oh-my-opencode.log`
3. Open an issue: https://github.com/hecateq/hecateq-openagent/issues
4. Review known issues: [docs/reference/known-issues.md](../reference/known-issues.md)
