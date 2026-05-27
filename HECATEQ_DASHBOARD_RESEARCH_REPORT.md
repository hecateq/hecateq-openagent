# HECATEQ DASHBOARD RESEARCH REPORT

## Kapsam / Scope

Bu rapor, **ayrı geliştirilecek Hecateq Dashboard plugin** için yapılan kapsamlı araştırmanın sonuçlarını belgeler.

**Ana soru:**
> Çok projeli bir OpenCode + Hecateq ortamında, proje/session/subagent/background-task ilişkilerini **doğru**, **kanıta dayalı** ve **ölçeklenebilir** biçimde nasıl modellemeliyiz?

**Bu rapor:**
- Kod yazmaz, dosya değiştirmez
- Implementation önerisini veri modeli ve karar dokümanı düzeyinde verir
- Her kritik konuda etiket kullanır:
  - `DOCS_CONFIRMED` — resmi OpenCode dokümantasyonunda doğrulandı
  - `CODE_CONFIRMED` — local plugin/runtime kodunda doğrulandı
  - `INFERRED` — doğrudan kanıt yok, güçlü çıkarım
  - `UNKNOWN` — henüz belirlenemedi
  - `NEEDS_RUNTIME_VERIFICATION` — runtime testi gerekiyor

---

## Kaynaklar / Sources Checked

### Resmi OpenCode Dokümanları
| Kaynak | Durum |
|--------|-------|
| `https://opencode.ai/docs/server/` | `DOCS_CONFIRMED` |
| `https://opencode.ai/docs/sdk/` | `DOCS_CONFIRMED` |
| `https://opencode.ai/docs/web/` | `DOCS_CONFIRMED` |
| `https://opencode.ai/docs/plugins/` | `DOCS_CONFIRMED` |
| `https://opencode.ai/docs/config/` | `DOCS_CONFIRMED` |
| `https://opencode.ai/docs/agents/` | `DOCS_CONFIRMED` |
| `https://opencode.ai/docs/commands/` | `DOCS_CONFIRMED` |
| `https://opencode.ai/docs/skills/` | `DOCS_CONFIRMED` |
| `https://opencode.ai/docs/troubleshooting/` | `DOCS_CONFIRMED` |
| `https://opencode.ai/docs/rules/` | `DOCS_CONFIRMED` |

### Resmi Type Surfaces (Raw SDK)
- `https://raw.githubusercontent.com/anomalyco/opencode/dev/packages/sdk/js/src/gen/types.gen.ts`
- `https://raw.githubusercontent.com/anomalyco/opencode/dev/packages/sdk/js/src/v2/gen/types.gen.ts`

### Local Plugin / Fork Kod Yolları
| Path | İçerik |
|------|--------|
| `src/tools/session-manager/*` | Session CRUD, storage, SDK/file adapters |
| `src/tools/delegate-task/*` | Subagent delegation, session create |
| `src/tools/background-task/*` | Background task lifecycle |
| `src/tools/call-omo-agent/*` | Agent invocation, child session |
| `src/features/background-agent/*` | Background agent manager, registry, history |
| `src/features/dashboard/*` | Mevcut dashboard kodu |
| `src/features/hecateq-orchestration/*` | Hecateq runtime state, OmoStateManager |
| `src/hooks/hecateq-memory-bootstrap/*` | Memory bootstrap hooks |
| `src/hooks/hecateq-project-context-injector/*` | Context injection |
| `src/shared/data-path.ts` | Data path resolution |
| `src/shared/opencode-storage-paths.ts` | OpenCode storage path detection |
| `src/shared/opencode-storage-detection.ts` | Backend tipi tespiti (SQLite/JSON) |
| `src/shared/opencode-provider-auth.ts` | Provider auth |
| `src/shared/opencode-server-auth.ts` | Server auth |
| `src/shared/memory-bootstrap.ts` | Memory manifest initialization |
| `src/shared/git-checkpoint.ts` | Git checkpoint |
| `src/cli/dashboard/dashboard.ts` | CLI dashboard komutu |
| `src/cli/doctor/checks/hecateq-workflow.ts` | Hecateq workflow health check |

### Local Runtime Filesystem Kanıtları
- `~/.local/share/opencode/`
- `~/.local/share/opencode/opencode.db`
- `~/.local/share/opencode/storage/*`
- Repo-local:
  - `.memory-manifest.json`
  - `.opencode/state/*`
  - `.opencode/state/hecateq/state.json`
  - `.opencode/contracts/`
  - `.opencode/task-graphs/`
  - `.opencode/background-tasks.json`
  - `.agents/background-tasks.json`
  - `.omo/run-continuation/*.json`
  - `.omo/hecateq/`
  - `.omo/notepads/`

---

## Executive Summary

### Net Karar

**Önerilen mimari: HYBRID**

| Katman | Kaynak | Rol |
|--------|--------|-----|
| **Primary** | OpenCode Server / SDK | Session, Project, Message, Todo, Diff — resmi API |
| **Secondary** | `.opencode/state/*` + legacy Hecateq artifact'leri | Runtime state, memory, DAG, routing |
| **Fallback** | Read-only disk scanner | Storage backend tespiti, diagnostics |
| **Runtime Enrichment** | Dashboard plugin hook/event capture | Subagent/background relation index |

### En Kritik Sonuç

**Çok projeli ayrım için tek başına path, slug, storage path veya session tool output yeterli değildir.**

En güvenilir ayrım kombinasyonu:
1. `Project.id` / `Session.projectID` — `DOCS_CONFIRMED`
2. `Project.worktree` — `DOCS_CONFIRMED`
3. `Session.directory` — `DOCS_CONFIRMED`
4. Varsa `workspaceID`, `path`, `vcs`, `vcsDir` — `CODE_CONFIRMED`

### En Kritik Risk

**OpenCode docs, raw SDK types, local plugin code ve gerçek local storage arasında belirgin DRIFT var:**
- Docs eski JSON storage dünyasını anlatıyor (`~/.local/share/opencode/project/...`)
- Runtime SQLite backend kullanabiliyor (`~/.local/share/opencode/opencode.db`)
- Local plugin fallback filesystem layout farklı (`~/.local/share/opencode/storage/*`)
- Hecateq artifact path'lerinde legacy + yeni path birlikte yaşıyor

**Dashboard:**
- Tek kaynağa kör bağlanmamalı
- Her veriyi source-of-truth seviyesiyle etiketlemeli
- İlişkileri **strong / secondary / weak** diye ayırmalı

---

## Critical Contradictions — Tespit Edilen Çelişkiler

### 1) OpenCode docs storage vs actual local/runtime storage

| Açı | Davranış |
|-----|----------|
| **Docs** | `~/.local/share/opencode/project/<slug>/storage/` — git repo; `./global/storage/` — non-git |
| **Local Runtime** | `~/.local/share/opencode/opencode.db` (SQLite) + `~/.local/share/opencode/storage/*` (fallback) |
| **Risk** | Docs'a göre yazılmış disk scanner SQLite kurulumlarda yanlış sonuç verir |
| **Karar** | `DOCS_CONFIRMED + CODE_CONFIRMED`. Disk storage **primary olamaz**. Önce backend tipi tespit edilmeli |

### 2) Public docs Session/Project shape vs richer raw SDK v2 shape

| Açı | Davranış |
|-----|----------|
| **Public Docs** | Sade `Project` (id, worktree, vcs, time), sade `Session` (id, projectID, title, time) |
| **Raw v2 Types** | Ek: `Session.slug`, `Session.workspaceID`, `Session.path`, `Session.agent`, `Session.model`, `Session.cost`, `Session.tokens`, `Project.sandboxes`, `/session` query: `workspace`, `scope`, `roots`, `search`, `limit` |
| **Karar** | `DOCS_CONFIRMED + CODE_CONFIRMED`. Stable contract = docs endpointleri; capability-detect ile zenginleştir |

### 3) Hecateq runtime state path drift

| Açı | Davranış |
|-----|----------|
| **Legacy** | `.omo/hecateq/state.json` (eski contract/test referansları) |
| **Canonical (Code)** | `.opencode/state/hecateq/state.json` (`OmoStateManager`, `src/features/hecateq-orchestration/omo-state-manager.ts`) |
| **Karar** | `CODE_CONFIRMED`. **Canonical path = `.opencode/state/hecateq/state.json`**. `.omo/hecateq/*` legacy/reference only |

### 4) Artifact path split: legacy + new

| Açı | Davranış |
|-----|----------|
| **Code canonical** | `.opencode/state/contracts/`, `.opencode/state/task-graphs/` |
| **Repo'da dolu** | `.opencode/contracts/`, `.opencode/task-graphs/` (legacy) |
| **Repo'da boş** | `.opencode/state/contracts/`, `.opencode/state/task-graphs/` (henüz yazılmamış) |
| **Karar** | `CODE_CONFIRMED`. Read stratejisi: (1) canonical new path'leri dene, (2) legacy populated path'leri de tara, (3) UI'da "legacy path detected" uyarısı göster |

### 5) Session tool description vs real behavior

| Açı | Davranış |
|-----|----------|
| **Tool description** | `session_list` "all sessions" gibi sunulur |
| **Local plugin** | `parentID` olan child/subagent sessionları **filtreliyor**; default `ctx.directory` ile tek project scope |
| **Karar** | `CODE_CONFIRMED`. **Session tools dashboard primary source değildir.** Agent-facing convenience araçlarıdır |

---

## Bölüm 1: OpenCode Proje ve Session Ayrımı

### Doğrulanan Bulgular

- `GET /project` ve `GET /project/current` resmi endpoint — `DOCS_CONFIRMED`
- `Project` public shape: `id`, `worktree`, `vcsDir?`, `vcs?`, `time` — `DOCS_CONFIRMED`
- `Project` v2 ek: `name?`, `icon?`, `commands?`, `sandboxes: string[]`, `time.updated` — `CODE_CONFIRMED`
- `Session` public shape: `id`, `projectID`, `directory`, `parentID?`, `summary?`, `share?`, `title`, `version`, `time`, `revert?` — `DOCS_CONFIRMED`
- `Session` v2 ek: `slug`, `workspaceID?`, `path?`, `cost?`, `tokens?`, `agent?`, `model?`, `permission?`, `time.archived?` — `CODE_CONFIRMED`

### Bilinmeyenler

- `Project.id` üretim algoritması tam doğrulanmadı (`UNKNOWN`)
- `Session.id` üretim algoritması doğrulanmadı (`UNKNOWN`)
- `project slug` SQLite döneminde primary kimlik mi, legacy migration izi mi net değil (`UNKNOWN`)

### Kanıt Tablosu

| Alan | Kaynak | Güvenilirlik | Dashboard Kullanımı | Risk |
|------|--------|:------------:|---------------------|:----:|
| `Project.id` | `/project`, raw SDK types | **High** | Primary project PK | Generation algorithm unknown |
| `Session.projectID` | Session type, local `SessionMetadata.projectID` | **High** | Session → project FK | Project entity yoksa display zayıf |
| `Project.worktree` | `/project`, raw SDK types | **High** | Worktree/branch ayrımı | Non-git/global projede sınırlı |
| `Session.directory` | Official session type + local session manager | **Medium-High** | Display path, filter, fallback grouping | Aynı project içinde farklı cwd olabilir |
| `Session.path` (v2) | Raw SDK v2 types | **Medium** | Worktree-relative context | Public docs'ta görünmüyor |
| `Project.vcs` / `vcsDir` | Public docs | **Medium** | Git/non-git ayrımı | Local plugin fallback path'te tüketilmiyor |
| Storage slug/path | Troubleshooting docs | **Low** | Legacy diagnostics only | SQLite drift |
| `~/.local/share/opencode/opencode.db` | Local FS + `opencode-storage-detection.ts` | **High** | Backend detection | Direct project identity değil |

### Önerilen Karar: Project Separation Rule

1. `Project.id` varsa onu kullan
2. `Project.worktree` ile güçlendir
3. Session-only durumda `Session.projectID` + `Session.directory` ile fallback group yap
4. Storage slug/path'i primary key **yapma**

---

## Bölüm 2: Session Veri Modeli

### Doğrulanan API Endpoint'leri

| Endpoint | Tip | Kaynak |
|----------|-----|--------|
| `GET /session` | List | `DOCS_CONFIRMED` |
| `GET /session/status` | Status | `DOCS_CONFIRMED` |
| `GET /session/:id` | Detail | `DOCS_CONFIRMED` |
| `GET /session/:id/children` | Child sessions | `DOCS_CONFIRMED` |
| `GET /session/:id/todo` | Todos | `DOCS_CONFIRMED` |
| `GET /session/:id/diff` | Diffs | `DOCS_CONFIRMED` |
| `GET /session/:id/message` | Messages | `DOCS_CONFIRMED` |
| `POST /session/:id/fork` | Fork | `DOCS_CONFIRMED` |
| `POST /session/:id/share` | Share | `DOCS_CONFIRMED` |
| `DELETE /session/:id/share` | Unshare | `DOCS_CONFIRMED` |
| `POST /session/:id/summarize` | Summarize | `DOCS_CONFIRMED` |
| `POST /session/:id/revert` | Revert | `DOCS_CONFIRMED` |
| `POST /session/:id/unrevert` | Unrevert | `DOCS_CONFIRMED` |
| `POST /session/:id/abort` | Abort | `DOCS_CONFIRMED` |

### Local SessionMetadata Shape

`CODE_CONFIRMED` (`src/tools/session-manager/types.ts`):
- `id`, `version?`, `projectID`, `directory`, `title?`, `parentID?`
- `time.created`, `time.updated`
- `summary.additions/deletions/files`

### Message Model

Raw types `CODE_CONFIRMED`:
- `UserMessage`: id, sessionID, agent, model, tools, system
- `AssistantMessage`: id, sessionID, parentID (message-level!), modelID, providerID, mode, path, cost, tokens, error
- `Part` types: `text`, `reasoning`, `file`, `tool`, `snapshot`, `patch`, `agent`, `retry`, `compaction`, `subtask`

### Tool Call Records

`Part.type === "tool"` → `ToolPart.callID/tool/state/metadata` — `CODE_CONFIRMED`

### Session Status

| Status | Kaynak |
|--------|--------|
| `idle`, `busy`, `retry` | `DOCS_CONFIRMED` (public) |
| `pending`, `running`, `completed`, `error`, `cancelled`, `interrupt` | `CODE_CONFIRMED` (plugin internal) |

### Kritik Uyarı

**`AssistantMessage.parentID` session parent ilişkisi değildir.** Bu, assistant mesajının parent **message** ID'sidir. Session parent-child için **`Session.parentID`** kullanılmalı. — `CODE_CONFIRMED`

### Önerilen Session Graph

```
Project
  └── Session
        ├── Messages
        │     └── Parts
        │           ├── Text
        │           ├── Reasoning
        │           ├── Tool Calls
        │           ├── Tool Results
        │           ├── Patch/Snapshot
        │           └── Subtask Parts
        ├── Diffs
        ├── Todos
        ├── Child Sessions
        ├── Background Tasks
        └── Plugin Artifacts
```

### Düğüm Tasarımı

| Düğüm | Veri Kaynağı | Primary Key | Foreign Key | Güncelleme | Risk | Fallback |
|-------|-------------|-------------|-------------|------------|:----:|----------|
| Project | `/project`, `/project/current`; `session.projectID` fallback | `project.id` | — | API poll / SSE | docs/type drift | derive from sessions |
| Session | `/session`, `/session/:id` | `session.id` | `projectID`, `parentID?` | API poll / events | v1/v2 field drift | local session metadata |
| Messages | `/session/:id/message` | `message.id` | `sessionID` | on-demand / events | high volume | local session read |
| Parts | Message parts | `part.id` | `messageID`, `sessionID` | on-demand / events | content size | local message/part files |
| Tool Calls | `Part.type=tool` | `callID + messageID` | `messageID` | event stream | metadata partial | tool metadata block parse |
| Diffs | `/session/:id/diff` | `sessionID + file` | `sessionID` | on-demand | large payloads | disk session_diff |
| Todos | `/session/:id/todo` | `todo.id` | `sessionID` | on-demand | `.claude` drift | local `.claude/todos` |
| Child Sessions | `/session/:id/children`, `Session.parentID` | `session.id` | `parentID` | API / event | tools hide them | local meta.parentID |
| Background Tasks | Plugin internal/hook-derived | `bg_*` | `parentSessionId`, `sessionId?` | hooks / polling | in-memory + late-bound | task metadata + markers |
| Plugin Artifacts | `.opencode/state/*`, legacy dirs | path | project root | file watch / refresh | legacy+new split | read both |

---

## Bölüm 3: Parent / Child / Subagent Session İlişkisi

### Doğrulanan Bulgular

- Official child session kavramı: `/session/:id/children`, `Session.parentID` — `DOCS_CONFIRMED`
- Local plugin sync delegation: `parentID: input.parentSessionID`, title: `${description} (@agent subagent)` — `CODE_CONFIRMED`
- Local plugin `call_omo_agent`: `parentID: toolContext.sessionID` — `CODE_CONFIRMED`
- Background task launch: ayrı `bg_*` task + late-bound `task.sessionId` — `CODE_CONFIRMED`

### İlişki Matrisi

| İlişki | Kanıt | Depolama | Dashboard Gösterimi | Belirsizlik |
|--------|-------|----------|--------------------|:-----------:|
| root → child subagent | `Session.parentID`, `/children`, create body `parentID` | Official session object | Normal session tree edge | Düşük |
| root → forked session | `/session/:id/fork`, title `fork #n` | Official session object | Child/fork badge ayrı | Orta |
| root → background task | `BackgroundTask.parentSessionId` | Plugin internal state | Session altında "Background Tasks" | Düşük |
| background task → child session | `BackgroundTask.sessionId` (late-bound) | Plugin internal + tool metadata | bg node → child session edge | Orta |
| child session → tool outputs | Message parts `type=tool` + `callID` | Session messages | Child session detail panel | Düşük |
| parent → wake/completion | `ParentWakeNotifier`, `.omo/run-continuation/*.json` | In-memory + marker files | Session badge / notification lane | Orta |
| tool result → background/session link | `<task_metadata>` block | Tool metadata / output text | Secondary evidence link | Orta |
| child → descendant bg tasks | `getAllDescendantTasks()` recursive | Plugin internal state | Recursive tree / graph | Orta |

### Dashboard Kuralı: UI Relation Strength Model

| Seviye | Kriter | Örnek |
|--------|--------|-------|
| **Strong** | Official `parentID`, `/children`, direct `task.parentSessionId`, direct `task.sessionId` | parentID ile bağlı subagent |
| **Secondary** | Tool metadata, `<task_metadata>`, session title suffix | Tool çıktısında bg_* ID geçmesi |
| **Weak** | Timestamp/title/prompt similarity | Aynı anda başlamış iki session |

---

## Bölüm 4: Plugin Proje Tabanına Yazılan Dosyalar

### Yeni Canonical Path'ler (`CODE_CONFIRMED`)

| Path | İçerik | Dashboard |
|------|--------|-----------|
| `.memory-manifest.json` | Memory pointer | Evet |
| `.opencode/state/memory/*` | Memory summaries, hashes, token budget | Evet (summary-only) |
| `.opencode/state/contracts/` | Contracts (henüz boş) | Evet |
| `.opencode/state/task-graphs/` | Task graphs (henüz boş) | Evet |
| `.opencode/state/hecateq/state.json` | Hecateq runtime state | **Evet, primary** |

### Legacy / Hala Dolu Path'ler (`CODE_CONFIRMED`)

| Path | İçerik | Dashboard |
|------|--------|-----------|
| `.opencode/contracts/` | Contracts (dolu) | Evet, legacy read |
| `.opencode/task-graphs/` | Task graphs (dolu) | Evet, legacy read |
| `.opencode/memory/knowledge/context/*` | Legacy context files | Legacy read only |
| `.omo/run-continuation/*.json` | Session marker, active state | Evet, secondary |
| `.omo/notepads/` | Agent notes | Later maybe |
| `.omo/hecateq/state.json` | Legacy runtime state | Legacy detection only |

### Kapsamlı Path Matrisi

| Path | Sistem | Ne Zaman | İçerik | Dashboard? | Read-only? | Risk |
|------|--------|----------|--------|:----------:|:----------:|:----:|
| `.memory-manifest.json` | memory bootstrap | first bootstrap | memory pointer | Evet | Evet | Düşük |
| `.opencode/state/memory/memory.json` | memory manifest | bootstrap/update | summaries, hashes, project identity | Evet | Evet | Düşük |
| `.opencode/state/memory/*.md` | memory bootstrap + agents | runtime | project context | Summary-only | Evet | Medium |
| `.opencode/state/contracts/` | canonical artifact | bootstrap | contracts | Evet | Evet | Boş olabilir |
| `.opencode/state/task-graphs/` | canonical artifact | bootstrap | task graphs | Evet | Evet | Boş olabilir |
| `.opencode/state/hecateq/state.json` | OmoStateManager | runtime | Hecateq runtime state | **Evet, primary** | Evet | Düşük |
| `.opencode/contracts/` | Legacy/manual | existing | contracts | Legacy read | Evet | Path drift |
| `.opencode/task-graphs/` | Legacy/manual | existing | task graphs | Legacy read | Evet | Path drift |
| `.opencode/background-tasks.json` | Runtime transition | bg-task runtime | bg task records | Advisory only | Evet | Stale, secret risk |
| `.agents/background-tasks.json` | Migration mirror | same | bg task records | Advisory only | Evet | Stale duplicate |
| `.omo/run-continuation/*.json` | Run-continuation | active bg | session marker | Secondary | Evet | Partial data |
| `.omo/notepads/` | Agent workspace | agent work | notes | Later maybe | Evet | Unstructured |
| `.omo/hecateq/state.json` | Legacy/stale | older flows | old runtime state | Legacy detection | Evet | Misleading |
| `.opencode/memory/knowledge/context/*` | Legacy memory | older flows | old context | Legacy read only | Evet | Drift |
| `~/.local/share/opencode/opencode.db` | OpenCode runtime | SQLite backend | Canonical DB | **Do not read directly** | Evet | Backend-internal |
| `~/.local/share/opencode/storage/*` | Legacy storage | fallback | message/part/diff | Fallback only | Evet | Expensive |
| `~/.local/share/opencode/auth.json` | OpenCode runtime | auth/connect | secrets/tokens | **Hayır** | Evet | **Critical secret** |
| `~/.local/share/opencode/log/` | OpenCode runtime | runtime | logs | Avoid default | Evet | May leak |
| `os.tmpdir()/oh-my-opencode.log` | Plugin logger | runtime | plugin logs | Avoid default | Evet | May leak |
| `~/.claude/todos/`, `~/.claude/transcripts/` | Session-manager fallback | when available | todos/transcripts | Fallback only | Evet | User-global, sensitive |

### Dashboard İçin Güvenli Okunabilecek Dosyalar

**Read-only okunabilecek:**
- `.memory-manifest.json`
- `.opencode/state/memory/memory.json`
- `.opencode/state/hecateq/state.json`
- `.opencode/state/memory/*.md`
- `.opencode/state/contracts/*`
- `.opencode/state/task-graphs/*`
- `.opencode/contracts/*` (legacy)
- `.opencode/task-graphs/*` (legacy)
- `.omo/run-continuation/*.json`
- `~/.local/share/opencode/storage/session_diff/*.json` (on-demand only)

**Indexlenebilecek:**
- Memory manifest summaries
- Hecateq state summary
- Run-continuation marker counts
- Session metadata via SDK/API
- Project registry derived from API

**Cachelenebilecek:**
- Artifact summary cache
- Project/session metadata index
- Doctor snapshot cache
- Relation confidence cache

**Asla değiştirilmemesi gereken:**
- `opencode.db`
- `auth.json`
- Session/message/part fallback files
- `state.json` runtime files
- Memory/artifact files
- Run-continuation markers

**Secret/API key riski taşıyan:**
- `~/.local/share/opencode/auth.json`
- `~/.config/opencode/mcp-oauth.json`
- `~/.config/opencode/opencode.json[c]` (`env:` / `file:` blokları)
- Session messages / tool outputs / transcripts
- Logs
- Herhangi bir `.env` dosyası

---

## Bölüm 5: OpenCode'dan Ayrı Olarak Plugin Tarafından Alınabilecek Veriler

### Plugin Context Object

`DOCS_CONFIRMED` (`/docs/plugins#basic-structure`):
- `project`, `client`, `directory`, `worktree`, `$`

### Runtime Hook/Event Surfaces

`DOCS_CONFIRMED`:
- `session.created`, `session.updated`, `session.deleted`
- `session.diff`, `session.error`, `session.idle`, `session.status`
- `message.updated`, `message.part.updated`
- `todo.updated`
- `tool.execute.before`, `tool.execute.after`
- `command.executed`
- (ve diğerleri)

### Kaynak Karşılaştırma Matrisi

| Veri | OpenCode API | Plugin Hook | Disk | En Doğru Kaynak | Neden |
|------|:-----------:|:-----------:|:----:|:---------------:|-------|
| Project list | Evet | Hayır | Hayır/güvensiz | **API** | Official source |
| Current project | Evet | context `project` | Hayır | **API/context** | Runtime authoritative |
| Session list | Evet | Event stream (incremental) | Fallback | **API** | Complete + status |
| Root-only sessions | v2 `roots`/client-side | Event-assisted | Fallback | **API** | Official parent fields |
| Child sessions | `/session/:id/children` | `session.created parentID` | Fallback meta | **API + Hook cross-check** | Strongest mapping |
| Session status | `/session/status` | `session.status/error/idle` | Hayır | **API + Events** | Live |
| Messages | `/session/:id/message` | `message.updated/part.updated` | Fallback | **API** | Authoritative content |
| Todos | `/session/:id/todo` | `todo.updated` | `.claude/todos` | **API** | Official |
| Diffs | `/session/:id/diff` | `session.diff` | `storage/session_diff` | **API** | Official |
| Tool calls | Message parts `tool` | `message.part.updated`, `tool.execute.after` | Fallback parse | **API + Hook** | Hook gives live correlation |
| bg task → child session | **Public API'de YOK** | Evet | Weak/advisory | **Hook/plugin internal** | Strongest evidence only here |
| bg task lifecycle | **Public API'de YOK** | Evet | Advisory/stale files | **Hook/plugin internal** | In-memory runtime truth |
| Hecateq DAG/routing/signal | **Public API'de YOK** | Partly | Evet | **`.opencode/state/hecateq/state.json`** | Canonical local plugin state |
| Memory/artifacts | **YOK** | Partly | Evet | **Disk** | File-based system |
| Doctor/agent index | **YOK** | YOK | Evet | **Disk + explicit doctor run** | Plugin-owned data |

### Önerilen Karar

- **API/SDK** = Session/project/message/diff/todo truth
- **Hooks/events** = Live correlation truth (bg/subagent mapping)
- **Disk** = Hecateq artifact truth + fallback recovery

---

## Bölüm 6: Dashboard İçin Veri Toplama Stratejisi

### Strateji Karşılaştırması

| Strateji | Güvenilirlik | Kapsam | Bakım Riski | Performans | Tavsiye |
|----------|:-----------:|:------:|:-----------:|:----------:|:-------:|
| **A** — Sadece OpenCode Server/SDK | **High** | Medium-High | Medium | Good | Tek başına yetmez |
| **B** — Sadece Disk Storage | **Low-Medium** | Medium | **High** | Poor-Variable | **Önerilmez** |
| **C — Hybrid** | **High** | **High** | Medium | **Best overall** | **ÖNERİLEN** |

### Strateji A — Sadece API/SDK

**Artı:**
- Resmi surface, en güvenilir
- Current session/project/status/todo/diff için en iyisi
- SQLite geçişini dashboard'a yansıtmaz

**Eksi:**
- bg task mapping public API'de yok
- Plugin artifact state yok
- Docs vs raw v2 drift var

### Strateji B — Sadece Disk

**Artı:**
- Offline/read-only çalışabilir
- Artifact ve legacy data görülebilir

**Eksi:**
- Backend drift (SQLite vs JSON layout)
- Stale files, secret risk
- Performans kötü

### Strateji C — Hybrid (Önerilen)

**Mimari:**
1. **Primary:** OpenCode Server/SDK
2. **Secondary:** `.opencode/state/*` + legacy artifact dirs
3. **Optional fallback:** Read-only storage scanner
4. **Runtime enrichment:** Dashboard plugin hooks + SSE

**Dashboard kuralları:**
- Root/session tree ve project list → **API**
- bg/subagent relation → **Hook/event enrichment**
- Hecateq DAG/memory/artifact → **Disk**
- Fallback disk scanner → **Sadece diagnostics/recovery**

---

## Bölüm 7: Çok Projeli Dashboard Modeli

### WorkspaceIndex Mimarisi

```
WorkspaceIndex
  ├── ProjectIndex[]
  │     ├── Project identity
  │     ├── Git/VCS identity
  │     ├── OpenCode storage identity
  │     ├── Plugin artifact identity
  │     └── SessionIndex[]
  └── GlobalSettingsIndex
```

### ProjectIndex Alanları

| Alan | Kaynak | Durum |
|------|--------|-------|
| `project_id` | `/project` veya `session.projectID` | Direct |
| `display_name` | `project.name` else basename(worktree) | `INFERRED` |
| `root_path` | `project.worktree`, fallback `session.directory` | Direct |
| `git_root` | `worktree`/`vcsDir` | Direct |
| `worktree` | `/project` | Direct |
| `storage_slug/path` | Legacy/advisory only | Legacy |
| `last_active_time` | Max(session.updated) | Derived |
| `session_count` | Session list | Derived |
| `active_session_count` | `/session/status` | Derived |
| `subagent_session_count` | `parentID` filter | Derived |
| `background_task_count` | Hook/runtime index | Direct only if indexed |
| `total_tool_call_count` | On-demand/cached | Derived |
| `total_diff_count` | On-demand | Derived |
| `plugin_artifact_status` | Disk | Direct |
| `memory_status` | Disk | Direct |
| `doctor_status` | Cached snapshot | Optional |
| `agent_index_status` | Disk/index file | Direct |

### SessionIndex Alanları

| Alan | Durum |
|------|-------|
| `session_id` | **Direct** |
| `parent_id` | **Direct** |
| `title` | **Direct** |
| `project_id` | **Direct** |
| `agent` | v2 direct; else derived from latest assistant message |
| `model/provider` | v2 direct; else derived |
| `created_at` | **Direct** |
| `updated_at` | **Direct** |
| `status` | **Direct** from `/session/status` |
| `is_root_session` | Derived: `!parentID` |
| `is_child_session` | Derived: `!!parentID` |
| `is_subagent_session` | **Inferred**: child + subagent evidence |
| `is_background_task_session` | **Inferred/direct** if `task.sessionId` mapping exists |
| `child_count` | Direct via `/children` or derived |
| `todo_count` | Direct |
| `diff_count` | Derived/on-demand |
| `tool_call_count` | Derived |
| `summary_available` | Direct-ish via `summary?` |
| `share_status` | Direct via `share?.url` |
| `errors` | Event/history derived |
| `related_plugin_artifacts` | Derived |

### BackgroundTaskIndex Alanları

| Alan | Durum |
|------|-------|
| `task_id` (`bg_*`) | **Direct** |
| `parent_session_id` | **Direct** |
| `child_session_id` | Direct but **late-bound** |
| `status` | **Direct** |
| `created_at` | `queuedAt/startedAt` direct |
| `updated_at` | `completedAt/progress.lastUpdate` direct |
| `model/provider` | Direct plugin internal |
| `subagent/category` | **Direct** |
| `prompt_summary` | Use `description`; raw prompt **gösterme** |
| `output_status` | Direct |
| `cancel_availability` | Derived from status |
| `parent_wake_status` | Plugin runtime only; else **UNKNOWN** |
| `stale/ghost_risk` | Derived |

---

## Bölüm 8: Subagent Session İlişkilendirme Algoritması

### Sinyal Matrisi

| Sinyal | Kesinlik | Veri Kaynağı | Yalancı Pozitif Riski | Kullanım |
|--------|:--------:|-------------|:---------------------:|----------|
| `Session.parentID` | **High** | API / SDK / disk meta | Düşük | **Primary** |
| `/session/:id/children` | **High** | API | Düşük | Primary doğrulama |
| `BackgroundTask.parentSessionId` | **High** | Plugin internal | Düşük | bg parent edge |
| `BackgroundTask.sessionId` | **High** (after bind) / Medium (while pending) | Plugin internal | Düşük | bg child edge |
| `rootSessionId` | **High** | Plugin internal | Düşük | Descendant family |
| Tool metadata `sessionId/backgroundTaskId` | **Medium-High** | Tool metadata | Orta | Secondary correlation |
| `<task_metadata>` block | **Medium** | Output text | Orta | Fallback correlation |
| `Part.type=subtask` | **Medium** | Message parts | Orta | Visual hint only |
| Title suffix `(@agent subagent)` | **Medium** | Created session title | Orta | Badge/hint |
| `.omo/run-continuation/*.json` | **Medium-Low** | Marker files | Orta | Parent active bg count only |
| `.opencode/background-tasks.json` | **Low** | Transition file | **Yüksek** | Advisory only |
| Timestamp proximity | **Low** | Derived | **Yüksek** | Weak inference only |
| Prompt/title similarity | **Low** | Derived | **Yüksek** | Weak inference only |

### Önerilen Karar Ağacı

1. **`Session.parentID` varsa → kullan** (en güvenilir)
2. **`/session/:id/children` varsa → doğrula**
3. **Background task registry / live hook index varsa → `bg_* → child session` eşle**
4. **Tool metadata / `<task_metadata>` varsa → secondary evidence olarak ekle**
5. **Title/timestamp/prompt similarity → sadece weak inference**
6. **Emin değilse → UI'da "possible relation" olarak göster**

---

## Bölüm 9: Dashboard'a Özel Ek Metadata Önerileri

### Önerilen Cache/Index Formatı

**Primary cache/index formatı → SQLite**
**Append-only event stream → JSONL**

### Metadata Tablosu

| Metadata | Gerekli? | Format | Scope | Retention | Risk |
|----------|:--------:|--------|:-----:|:---------:|:----:|
| Project index cache | **Evet** | SQLite | Global | 30 gün | Düşük |
| Session index cache | **Evet** | SQLite | Global | 30 gün | Düşük |
| Background task relation index | **Evet** | SQLite | Global | 7-30 gün | Orta |
| Subagent relation map | **Evet** | SQLite | Global | 30 gün | Orta |
| Artifact summary cache | **Evet** | SQLite/JSON | Per-project | 7 gün | Düşük |
| Doctor snapshot cache | Opsiyonel | JSON | Per-project | 24 saat | Düşük |
| Event log snapshot | Opsiyonel | JSONL | Global | 7 gün capped | Orta (redact first) |
| Tool call summary | **Evet** | SQLite | Global | 30 gün | Orta (counts only) |
| Session health status | Opsiyonel | SQLite | Global | 7 gün | Düşük |
| Stale task detection status | **Evet** | SQLite | Global | 7 gün | Düşük |

### Cache Invalidation Stratejisi
- Session create/update/delete/status event → invalidate
- `todo.updated` → invalidate
- `message.part.updated` → invalidate
- bg task lifecycle event → invalidate
- Artifact mtime/hash change → invalidate
- Manual refresh → invalidate

### Secret Handling
- Raw prompt/message/tool output **cacheleme**
- Hash/summary/count cachele
- Session excerpt gerekiyorsa redacted snippet sakla
- Auth/token/config secret alanlarını **exclude et**

---

## Bölüm 10: OpenCode Web / Server / SDK ile Dashboard İlişkisi

### OpenCode Web'in Gösterdiği (`DOCS_CONFIRMED`)
- Sessions homepage
- Active sessions
- New session
- Server list/status
- Attach TUI

### Hecateq Dashboard'un Ekstra Göstermesi Gereken
- Çok-projeli grouping
- Root/child/subagent tree
- Background task graph
- Strong vs possible relation labels
- Source-of-truth badges (`API`, `HOOK`, `DISK`, `INFERRED`)
- Hecateq memory/artifacts
- Hecateq runtime state / doctor / agent index health
- Project-level analytics

### Gereksiz Tekrar Edilmemesi Gerekenler
- Normal chat UI
- Basit "start new session"
- Basit "server picker"
- Genel model/provider chooser

### Riskli / Auth Gerektiren Alanlar
- Current server basic auth
- Session content
- Tool outputs
- Logs
- Auth/config internals

### Serve vs Existing Server Kararı

**Karar:** Mevcut server'a bağlanmak daha doğru.
- Tek source of truth
- Duplicate instance açmaz
- Aynı sessions/state

`createOpencodeClient(baseUrl)` > `createOpencode()` (izole değilse) — `DOCS_CONFIRMED`

### SSE Kullanımı
- `/global/event` → Workspace/global aggregator
- `/event` → Project/workspace scoped live feed
- v2 types `directory` + `workspace` query param gösteriyor — `CODE_CONFIRMED`

### `/doc` OpenAPI Spec
- OpenAPI source-of-truth başlangıç noktası olarak değerli
- Docs/public spec ile richer v2 type surface arasında drift olabilir
- Type generation için server-version-matched SDK tercih edilmeli

---

## Bölüm 11: Security / Privacy / Secret Risk Analizi

### Risk Matrisi

| Risk | Kaynak | Etki | Önlem | Dashboard Kararı |
|------|--------|:----:|-------|:----------------:|
| Provider API keys / OAuth tokens | `~/.local/share/opencode/auth.json` | **Kritik** | Hiç okuma | **Hard deny** |
| MCP OAuth secrets | `~/.config/opencode/mcp-oauth.json` | **Kritik** | Hiç okuma | **Hard deny** |
| Basic auth password | `OPENCODE_SERVER_PASSWORD` | **Kritik** | Value'yu asla loglama/UI'a basma | Boolean only |
| Session messages | `/session/:id/message`, session_read | **Yüksek** | Redact/snippet only | Gated/on-demand |
| Tool outputs | Tool parts, background full session | **Yüksek** | Redact/truncate/on-demand | Gated/on-demand |
| Logs | OpenCode log + plugin tmp log | **Yüksek** | Default ingest etme | Off by default |
| `.env` contents | Repo files/tool outputs | **Kritik** | Never auto-read | **Hard deny** |
| Dashboard cache secret leak | Own cache | **Yüksek** | Counts/summaries only | No raw cache |
| Broad CORS | Dashboard HTTP | **Yüksek** | Explicit localhost only | Strict |
| Local-only vs network dashboard | Listen address | **Yüksek** | `127.0.0.1` only | Default |
| bg-task metadata stale duplicate | `.opencode/background-tasks.json` | **Orta** | Advisory only | Not canonical |

### Security Kararları

**Asla okunmamalı / UI'a basılmamalı:**
- `auth.json`
- `mcp-oauth.json`
- Raw `.env`

**Redaction olmadan gösterilmemeli:**
- Session messages
- Tool outputs
- Logs

**Güvenli metadata (UI'da gösterilebilir):**
- ID'ler, count'lar, timestamp'ler
- Agent/model/provider isimleri (value değil)
- Status'ler
- Diff count'ları, todo count'ları

---

## Bölüm 12: Performans ve Ölçek

### Senaryo: 100 Proje / 5.000 Session / 100.000 Mesaj

### Önerilen Indexing Stratejisi

**Eager (her zaman index'te):**
- Project/session registry
- First/last activity
- Root/child flags
- bg task relation map
- Artifact status

**Lazy (on-demand):**
- Full messages
- Diffs
- Search index
- Tool output details

### Önerilen Cache Stratejisi
- Global SQLite index
- 1s TTL Hecateq state read
- 5s throttle SDK session polling
- Event-driven invalidation
- JSONL only for optional redacted event history

### Önerilen UI Veri Yükleme Stratejisi
1. Project list first
2. Session list per selected project
3. Child tree on expand
4. Full messages on click
5. Diff on click
6. bg output on click
7. Search per project first, global later

### Riskli Anti-Pattern'ler
- Tüm session'ları her refresh'te diskten recursive scan etmek
- `session_info` için tüm mesajları her seferinde yüklemek
- Global search'i raw messages üzerinde çalıştırmak
- Raw log/session/tool output cachelemek
- Session tools'a "all sessions truth" gibi güvenmek

---

## Bölüm 13: Dashboard Bilgi Mimarisi

### Section Planı

| Section | Veri | Kaynak | MVP | Later | Not |
|---------|------|--------|:---:|:-----:|-----|
| **Projects** | Project groups, counts, last active | API + cache | **Evet** | — | Core |
| **Sessions** | Root sessions list | API + cache | **Evet** | — | Core |
| **Session Tree** | Parent/child/subagent tree | API + relation index | **Evet** | — | Core |
| **Background Tasks** | bg list + mapping | Hooks/runtime index | **Evet** | — | Core |
| **Artifacts** | Memory/contracts/task-graphs/state | Disk | **Evet** | — | Core for Hecateq |
| **Memory** | Manifest + summaries | Disk | **Evet** | — | Useful |
| **Agent Index** | Index freshness/coverage | Disk | — | **Evet** | Not core MVP |
| **Doctor / Health** | Hecateq doctor/cache | Disk/CLI | — | **Evet** | Useful but optional |
| **Events** | SSE live stream | `/event`, `/global/event` | — | **Evet** | After stable MVP |
| **Diffs** | Per-session diffs | API on-demand | — | **Evet** | Expensive |
| **Todos** | Per-session todos | API on-demand | — | **Evet** | Secondary |
| **Settings / Sources** | Source-of-truth badges, backend mode, path drift | Derived | **Evet** | — | Important |

---

## Bölüm 14: MVP / Phase Plan

### Phase 0 — Research Verification
| | |
|---|---|
| **Hedef** | Runtime/backend drift doğrulama |
| **Veri kaynağı** | Docs + SDK types + local FS |
| **Risk** | Docs vs runtime mismatch |
| **Doğrulama** | Sample runtime capture |
| **Yapılmaması gereken** | UI'ya başlamak |

### Phase 1 — Read-only Project & Session Index
| | |
|---|---|
| **Hedef** | Projects + sessions + root/child tree |
| **Veri kaynağı** | API/SDK primary |
| **Risk** | v1/v2 drift |
| **Doğrulama** | Many-project fixture |
| **Yapılmaması gereken** | Disk-only scanner |

### Phase 2 — Background/Subagent Relation Map
| | |
|---|---|
| **Hedef** | bg_* ↔ session ↔ parent relation |
| **Veri kaynağı** | Dashboard plugin hooks + tool metadata + API cross-check |
| **Risk** | In-memory only gaps |
| **Doğrulama** | Launch/completion scenarios |
| **Yapılmaması gereken** | Title similarity'ye fazla güvenmek |

### Phase 3 — Hecateq Artifacts
| | |
|---|---|
| **Hedef** | Memory/contracts/task-graphs/hecateq state |
| **Veri kaynağı** | `.opencode/state/*` + legacy read |
| **Risk** | Legacy/new split |
| **Doğrulama** | Path drift warnings |
| **Yapılmaması gereken** | Artifact yazmak |

### Phase 4 — Live Events
| | |
|---|---|
| **Hedef** | SSE-driven refresh |
| **Veri kaynağı** | `/global/event`, `/event` |
| **Risk** | Event volume, auth/CORS |
| **Doğrulama** | Live session churn |
| **Yapılmaması gereken** | Uncontrolled browser exposure |

### Phase 5 — Search & Analytics
| | |
|---|---|
| **Hedef** | Session search, tool analytics, error trends |
| **Veri kaynağı** | Cache/index + on-demand API |
| **Risk** | Huge cost if raw search |
| **Doğrulama** | 100k message fixtures |
| **Yapılmaması gereken** | Raw fulltext over live filesystem |

---

## Bölüm 15: Sonuç — Dashboard İçin Net Karar Dokümanı

### Primary Data Source Decision

| Katman | Kaynak |
|--------|--------|
| **Primary** | OpenCode Server / SDK |
| **Secondary** | `.opencode/state/*` + legacy Hecateq artifacts |
| **Fallback** | Read-only disk scanner |
| **Enrichment** | Dashboard plugin hooks/events + SSE |

### Project Identity Decision

Birlikte kullan (sırayla):
1. `Project.id` / `Session.projectID`
2. `Project.worktree`
3. `Session.directory`
4. Varsa `workspaceID`, `path`, `vcs`, `vcsDir`

### Session Identity Decision

| Alan | Kullanım |
|------|----------|
| `session.id` | **Primary key** |
| `session.projectID` | **Project foreign key** |
| `session.parentID` | **Parent foreign key** |
| Session tool outputs | **Secondary only** |

### Parent/Child Decision

- Official `session.parentID` + `/session/:id/children` → **primary**
- `AssistantMessage.parentID` → **kullanma** (message-level ID'dir)
- Child/subagent badge inference ayrı tut

### Background Task Decision

| Alan | Kullanım |
|------|----------|
| `bg_*` task ID | **Primary key** |
| `parentSessionId` | **Parent session link** |
| `sessionId` | **Child session link** (late-bound) |
| Relation confidence | **UI'da göster** (strong/secondary/weak) |

### Plugin Artifact Decision

**Canonical read:**
- `.opencode/state/hecateq/state.json`
- `.opencode/state/memory/*`

**Legacy read-only support:**
- `.opencode/contracts/`
- `.opencode/task-graphs/`
- `.opencode/memory/knowledge/context/`
- `.omo/run-continuation/`

### Cache Decision

**Evet, dashboard kendi cache/index dosyasını tutmalı.**

Ancak:
- Raw secret/message cacheleme **yok**
- Summary/count/index **only**
- Tercihen **SQLite**
- Retention: 7-30 gün

### Security Decision

**Asla okuma/UI'a basma:**
- `auth.json`
- `mcp-oauth.json`
- Raw `.env`

**Redaction olmadan gösterme:**
- Session messages
- Tool outputs
- Transcripts

### MVP Decision

İlk sürümde kesin göster:
- Project list
- Session list (root + child tree)
- bg task relations
- Relation confidence badges (strong/secondary/weak)
- Source-of-truth badges (`API`, `HOOK`, `DISK`, `INFERRED`)
- Hecateq artifact status
- Backend mode drift warning (SQLite vs JSON)

---

## Açık Sorular / Open Questions

| # | Soru | Durum |
|:-:|------|:-----:|
| 1 | `Project.id` cross-machine stable mi, yoksa machine/path dependent mi? | `UNKNOWN` |
| 2 | v2 query params (`workspace`, `roots`, `scope`, `search`) runtime sürümünde aktif mi? | `NEEDS_RUNTIME_VERIFICATION` |
| 3 | bg task public persistence dışında hook capture olmadan yeterli fidelity alınabilir mi? | `UNKNOWN` |
| 4 | Legacy `.opencode/contracts` ve `.opencode/task-graphs` ne kadar daha yaşayacak? | `UNKNOWN` |
| 5 | Dashboard plugin aynı process içinde mi çalışacak, yoksa ayrı consumer/server mı olacak? | `NEEDS_RUNTIME_VERIFICATION` |
| 6 | `Session.id` üretim algoritması nedir? | `UNKNOWN` |
| 7 | `project slug` güncel SQLite dönemi için primary kimlik mi, legacy migration izi mi? | `UNKNOWN` |

---

## Tamamlama Kontrol Listesi

- [x] Kod yazılmadı
- [x] Dosya değiştirilmedi (mevcut kod tabanına dokunulmadı)
- [x] Resmi OpenCode docs incelendi
- [x] Local plugin kodu incelendi
- [x] Runtime/storage backend drift doğrulandı
- [x] Project/session ayrımı açıklandı
- [x] Parent/child/subagent ilişkisi açıklandı
- [x] Background task/session ilişkisi açıklandı
- [x] Plugin artifact dosyaları listelendi
- [x] Dashboard veri kaynakları karşılaştırıldı
- [x] Security riskleri yazıldı
- [x] Ölçek/performans analizi yapıldı
- [x] MVP fazları önerildi
- [x] Bilinmeyen yerler `UNKNOWN`/`NEEDS_RUNTIME_VERIFICATION` olarak işaretlendi
- [x] Her önemli karar kanıtla desteklendi
- [x] Hybrid veri toplama stratejisi önerildi
- [x] Çok-projeli dashboard modeli tasarlandı
- [x] İlişkilendirme algoritması (karar ağacı) belirlendi
- [x] Cache/index metadata formatı önerildi
- [x] OpenCode Web / Hecateq Dashboard ayrımı yapıldı

---

## Final Not

**En kritik öncelik:** Çok projeli ortamda session/subagent/background-task ilişkilerini doğru ayırmak.

**Net sonuç:**
> Dashboard, tek başına storage path veya `session_list` benzeri yardımcı tool'lara güvenmemelidir.
>
> - **Project/session için:** API/SDK (primary source)
> - **Subagent/background relation için:** Hook/runtime enrichment
> - **Hecateq-specific state için:** `.opencode/state/*` (disk)

---

*Rapor Tarihi: 2026-05-28*
*Son Güncelleme: 2026-05-28*
*Kapsam: Hecateq Dashboard Ayrı Plugin Araştırması*
