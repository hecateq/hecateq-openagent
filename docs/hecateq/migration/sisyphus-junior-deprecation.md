# Hecateq OpenAgent — Sisyphus-Junior Deprecation

Sisyphus-Junior is being deprecated. The agent remains fully functional in v4.3.0+ but will be removed in v5.0.0.

---

## What changed

- **Deprecation warning:** A warning is now emitted to logs when `sisyphus-junior` is instantiated.
- **Hook renamed:** `sisyphus-junior-notepad` has been renamed to `subagent-orchestrator-notepad`. The old name is removed.

## How to suppress the warning

Add an empty deprecation allowlist in your Hecateq config:

```jsonc
{
  "hecateq": {
    "deprecations": {
      "warn_on_agents": []
    }
  }
}
```

This suppresses the log warning for all deprecated agents.

## How to migrate (when v5.0.0 ships)

- Replace `sisyphus-junior` references with explicit subagent types: `sisyphus`, `hephaestus`, `atlas`, etc.
- For **team-mode** member declarations, switch from `kind: "subagent_type"` with `sisyphus-junior` to `sisyphus` or `atlas`.
- For **category routing**, a dedicated `category-executor` agent is planned as a replacement.

## What breaks now

**Nothing.** This is a soft deprecation. All existing configurations, skills, and team-mode definitions that use `sisyphus-junior` continue to work.

## What breaks in v5.0.0 (planned)

- The `sisyphus-junior` agent definition will be removed entirely from the built-in agent registry.
- The `sisyphus-junior-notepad` hook name is already removed in v4.3.0. If you reference it by name in any configuration or script, update to `subagent-orchestrator-notepad`.
