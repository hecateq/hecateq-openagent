# Hecateq OpenAgent — Team Mode

This document describes Team Mode for parallel multi-agent coordination. **Status: Beta.**

---

## Overview

Team Mode enables parallel multi-agent coordination, modeled after Claude Code Agent Teams. It is **OFF by default**.

---

## Enabling Team Mode

Set `team_mode.enabled: true` in your config and restart OpenCode:

```jsonc
{
  "team_mode": {
    "enabled": true,
    "max_parallel_members": 4,
    "max_members": 8,
    "tmux_visualization": false
  }
}
```

---

## Team Storage

Teams live as directories under:

- **User scope:** `~/.omo/teams/{name}/`
- **Project scope:** `<project>/.omo/teams/{name}/` (project beats user on collision)

### Team Directory Structure

```
~/.omo/teams/{name}/
├── config.json      # Team specification
├── state.json       # Runtime state (active members, etc.)
├── mailbox/         # Async message queue (member-to-member)
├── tasklist.jsonl   # Shared task list
└── worktrees/       # Git worktrees per member
```

---

## Member Eligibility

From `AGENT_ELIGIBILITY_REGISTRY`:

| Agent | Eligibility | Notes |
|-------|-------------|-------|
| Sisyphus | Eligible | Full team participation |
| Atlas | Eligible | Full team participation |
| Sisyphus-Junior | Eligible | Full team participation |
| Hephaestus | Conditional | Lacks `teammate: "allow"` by default (apply D-36 in `tool-config-handler.ts`) |
| Oracle | Hard-reject | Use `task`/delegate instead |
| Librarian | Hard-reject | Use `task`/delegate instead |
| Explore | Hard-reject | Use `task`/delegate instead |
| Multimodal-Looker | Hard-reject | Use `task`/delegate instead |
| Metis | Hard-reject | Use `task`/delegate instead |
| Momus | Hard-reject | Use `task`/delegate instead |
| Prometheus | Hard-reject | Use `task`/delegate instead |

---

## Team Configuration (`config.json`)

```json
{
  "name": "my-team",
  "members": [
    {
      "name": "sisyphus",
      "kind": "subagent_type",
      "role": "lead"
    },
    {
      "name": "security-review",
      "kind": "category",
      "role": "member",
      "category": "oracle"
    }
  ],
  "max_parallel_members": 4,
  "max_messages_per_run": 10000,
  "max_wall_clock_minutes": 120
}
```

Member kinds:
- `subagent_type` — Direct agent assignment (Sisyphus, Atlas, etc.)
- `category` — Routed through Sisyphus-Junior to a category

---

## Team Communication

### Mailbox System

Async messaging via files in `mailbox/`:

- Messages are written to recipient mailbox files
- Polled by members every `mailbox_poll_interval_ms` (default: 3000ms)
- Max unread bytes per recipient: `recipient_unread_max_bytes` (default: 262144)
- Max message payload size: `message_payload_max_bytes` (default: 32768)

### Tools

| Tool | Description |
|------|-------------|
| `team_send_message` | Send message to team member |
| `team_status` | Get team and member status |
| `team_list` | List available teams |

---

## Team Tasks

Shared task list via `tasklist.jsonl`:

| Tool | Description |
|------|-------------|
| `team_task_create` | Create a shared task |
| `team_task_get` | Get task details |
| `team_task_list` | List shared tasks |
| `team_task_update` | Update task status |
| `team_task_claim` | Claim a task for execution |

Tasks support atomic claiming to prevent duplicate execution.

---

## Git Worktrees

Each team member gets an isolated git worktree:

- Worktrees in `worktrees/{member-name}/`
- Allows parallel file modifications without conflicts
- Changes merged back to main workspace on completion

---

## Team Lifecycle

| Tool | Description |
|------|-------------|
| `team_create` | Create a new team |
| `team_delete` | Delete a team |
| `team_shutdown_request` | Request team shutdown |
| `team_approve_shutdown` | Approve pending shutdown |
| `team_reject_shutdown` | Reject pending shutdown |

---

## Conditional Hooks (with team-mode enabled)

When `team_mode.enabled`:

| Hook | Tier | Purpose |
|------|------|---------|
| `team-tool-gating` | Tool Guard | Restrict team tools by member role |
| `team-mode-status-injector` | Transform | Inject team status block into messages |
| `team-mailbox-injector` | Transform | Pull pending mailbox messages into context |

Plus 4 direct event handlers in `src/plugin/event.ts`:
- `team-idle-wake-hint`
- `team-lead-orphan-handler`
- `team-member-error-handler`
- `team-member-status-handler`

---

## Team Mode Config

Full schema in `src/config/schema/team-mode.ts`:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | false | Master gate for all team features |
| `tmux_visualization` | boolean | false | Render tmux pane layout |
| `max_parallel_members` | number | 4 | Active members at once (1-8) |
| `max_members` | number | 8 | Hard cap on team size (1-8) |
| `max_messages_per_run` | number | 10000 | Messages per team run |
| `max_wall_clock_minutes` | number | 120 | Max team duration |
| `max_member_turns` | number | 500 | Turns per member |
| `base_dir` | string | null | Override team storage dir |
| `message_payload_max_bytes` | number | 32768 | Max message size (≥1024) |
| `recipient_unread_max_bytes` | number | 262144 | Max unread per member (≥1024) |
| `mailbox_poll_interval_ms` | number | 3000 | Mailbox poll interval (≥500) |

---

## See Also

- [docs/guide/team-mode.md](../guide/team-mode.md) — User-facing team mode guide
- `src/features/team-mode/` — Implementation source
- `src/features/team-mode/AGENTS.md` — Implementation details
