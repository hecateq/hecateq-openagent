# Hecateq OpenAgent — Telemetry & Privacy

This document describes the telemetry and privacy behavior of Hecateq OpenAgent.

---

## Telemetry Status

Anonymous telemetry is **disabled by default** in Hecateq builds.

This is a modification from upstream oh-my-openagent, which has telemetry enabled by default.

---

## Enabling Telemetry

To enable anonymous telemetry:

```bash
export HECATEQ_SEND_ANONYMOUS_TELEMETRY=1
export HECATEQ_POSTHOG_KEY=your_posthog_project_key
```

If `HECATEQ_POSTHOG_KEY` is not set or is empty, telemetry safely no-ops regardless of the `SEND_ANONYMOUS_TELEMETRY` flag.

---

## What Telemetry Collects

Telemetry uses PostHog for anonymous usage data collection. When enabled, it may collect:

- Session start/end events
- Doctor feature usage event (`omo_doctor_run`) with Hecateq feature flag summary (config booleans and mode strings)
- Plugin version
- OpenCode version
- Operating system platform
- Error events (anonymized)

Telemetry does **not** collect:
- Personal identifying information
- File contents or project data
- API keys or tokens
- Environment variables or config values
- IP addresses (anonymized)

---

## Telemetry Implementation

**Files:**
- `src/shared/posthog.ts` — PostHog client setup
- `src/shared/posthog-activity-state.ts` — Activity state tracking
- `src/shared/plugin-identity.ts` — Plugin identity detection

The telemetry system is initialized during plugin module creation in `createPluginModule()` and disposed on plugin unload via `plugin-dispose.ts`.

---

## Upstream vs Hecateq Behavior

| Aspect | Upstream oh-my-openagent | Hecateq OpenAgent |
|--------|--------------------------|-------------------|
| Telemetry default | Enabled | Disabled |
| Env var to enable | `OH_MY_OPENCODE_SEND_ANONYMOUS_TELEMETRY` | `HECATEQ_SEND_ANONYMOUS_TELEMETRY` |
| PostHog key env var | `OH_MY_OPENCODE_POSTHOG_KEY` | `HECATEQ_POSTHOG_KEY` |
| Crash/no-op behavior | No-op without key | No-op without key |

---

## Privacy Policy

See [docs/legal/privacy-policy.md](../legal/privacy-policy.md) for the full privacy policy.

---

## Terms of Service

See [docs/legal/terms-of-service.md](../legal/terms-of-service.md) for the terms of service.
