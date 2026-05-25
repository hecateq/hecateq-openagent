# Active Context

**Last Updated:** 2026-05-25
**Updated By:** Hecateq God
**Status:** DONE

## Current Session
Delivered the first additive slice of a portable cross-IDE memory system on top of the existing project-root markdown memory model. Added repo-root pointer discovery, manifest v2 foundational fields, bounded `continuation.json` support, compact-mode continuation hints, a file-based lock protocol, manifest refresh foundation, and an explicit low-token resume flow for other harnesses.

## Key Decisions
- **Canonical execution surface:** pending delegation consumption now flows through the shared `consumeDelegationsAtRuntime()` helper, used by both the orchestration pipeline and the production Hecateq hook.
- **Compatibility-first chain safety:** `HECATEQ_MAX_ROUTING_DEPTH = 3` remains as a fallback default, while live runtime guards accept config-driven overrides plus rate limiting, fan-out caps, and per-run iteration caps.
- **DAG behavior:** completed task signals can now trigger ready downstream static DAG nodes, bounded dynamic DAG nodes can be derived from live execution context, and structured planner mutations can add guarded nodes/edges on the same canonical runtime graph.
- **Dashboard architecture:** dashboard delivery is CLI/API-first. `src/features/dashboard/` provides the read-only HTTP surface, and `src/cli/dashboard/` consumes it without introducing a second state source.
- **Dashboard server lifecycle:** CLI now supports both ephemeral auto-start for one-shot commands and explicit persistent `dashboard serve` mode on the same API surface.
- **Three-plane memory model:** project markdown stays authoritative, `memory.json` is the cheap cross-IDE index, and `continuation.json` is the bounded resume payload.
- **Cross-IDE discovery:** repo-root `.memory-manifest.json` is now the portable pointer for non-OpenCode harnesses.
- **Token-efficiency path:** compact Hecateq context injection should stay manifest-first and continuation-summary-first before any large markdown reads.
- **Portable resume flow:** manifest-first discovery plus bounded continuation planning is now a first-class shared path for non-OpenCode harnesses.
- **Deferred hardening:** richer resume automation and broader harness integrations remain the next portability wave.
