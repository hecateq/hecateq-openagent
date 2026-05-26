# Hecateq OpenAgent — MCP & Skill System

This document describes the 3-tier Model Context Protocol (MCP) system and skill system.

---

## MCP System

The plugin implements a 3-tier MCP system:

| Tier | Name | Source | Loader |
|------|------|--------|--------|
| 1 | Built-in | `src/mcp/` | `createBuiltinMcps()` |
| 2 | Claude Code | `.mcp.json` (project + user) | `claude-code-mcp-loader` |
| 3 | Skill-embedded | SKILL.md YAML frontmatter | `SkillMcpManager` (per-session) |

### Tier 1: Built-in MCPs

| MCP | Type | Namespace | Description |
|-----|------|-----------|-------------|
| Websearch | Remote HTTP | `websearch` | Web search (Exa/Tavily) |
| grep-app | Remote HTTP | `grep_app` | GitHub code search |
| Context7 | Remote HTTP | `context7` | Library documentation |
| LSP | Local stdio | `lsp` | LSP protocol tools |
| AST-grep | Local stdio | `ast_grep` | AST pattern tools |

### Tier 2: Claude Code MCPs

Loaded from `.mcp.json` files in project root and user config directories.

Features:
- `${VAR}` environment variable expansion
- Expansion allowlist via `mcp_env_allowlist` config (user-only for security)
- Both `stdio` and `http` transport support

### Tier 3: Skill-Embedded MCPs

Loaded from SKILL.md YAML frontmatter:

```yaml
---
mcp_servers:
  - name: my-server
    transport: stdio
    command: npx
    args: ["-y", "@my/mcp-server"]
  - name: api-server
    transport: http
    url: http://localhost:3000/mcp
---
```

Features:
- Per-session isolation (keyed by `${sessionID}:${skillName}:${serverName}`)
- OAuth 2.0 + PKCE + DCR support
- stdio and HTTP transport
- OAuth step-up authentication

---

## Skill System

### Skill Discovery

Skills are loaded from `.md` files with YAML frontmatter across 4 scopes:

| Scope | Directory | Priority |
|-------|-----------|----------|
| Project | `<project>/.opencode/skills/` | Highest |
| OpenCode | `<project>/.opencode/skills/` | High |
| User | `~/.config/opencode/skills/` | Medium |
| Global | Built-in | Lowest |

Higher-priority skills override lower-priority ones with the same name.

### Skill Format

```markdown
---
name: my-skill
description: Does something useful
triggers: keyword1, keyword2
mcp_servers:
  - name: helper
    transport: stdio
    command: npx
    args: ["helper"]
---

# My Skill

Detailed instructions for the skill here.
```

### Built-in Skills (10)

| Skill | File | Description |
|-------|------|-------------|
| `git-master` | Built-in | Atomic commits, rebase, history search |
| `playwright` | Built-in | Browser automation via MCP |
| `playwright-cli` | Built-in | Browser automation via CLI |
| `dev-browser` | Built-in | Persistent page state browser |
| `review-work` | Built-in | 5-agent post-implementation review |
| `ai-slop-remover` | Built-in | Remove AI code patterns |
| `frontend-ui-ux` | Built-in | Design-first UI development |
| `team-mode` | Built-in | Team Mode (loaded when enabled) |
| `work-with-pr` | Built-in | Full PR lifecycle |
| `hyperplan` | Built-in | Adversarial multi-agent planning |

### Browser Automation

Configurable via `browser_automation_engine`:

| Provider | Description |
|----------|-------------|
| `playwright` (default) | Browser automation via @playwright/mcp |
| `playwright-cli` | Browser automation via CLI |
| `agent-browser` | Browser automation via agent-browser |

### Skill MCP Manager

**File:** `src/features/skill-mcp-manager/`

Manages the lifecycle of skill-embedded MCP servers:

- Server startup on session begin
- Per-session isolation (same skill in two sessions = two independent servers)
- Health checking and restart
- Server shutdown on session end
- OAuth token refresh
