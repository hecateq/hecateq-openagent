# Bölüm 6 — Ortak Yardımcılar, Config Sistemi ve Paketler

> **Kapsam:** `src/shared/` (297 dosya), `src/config/` (30 Zod schema), `packages/` (12 core + 1 web + 11 binary), `src/cli/`, `src/openclaw/`
> **Ortam:** Hecateq OpenAgent — oh-my-openagent fork'u
> **Güncelleme:** 2026-06-30

---

## 6.1 src/shared/ — Ortak Yardımcı Kütüphane

`src/shared/` dizini, plugin genelinde kullanılan **297 dosya** (179 non-test, 118 test) barındırır. Tüm yardımcılar `src/shared/index.ts` barrel export'u üzerinden dışa verilir.

Dosyalar 10-15 kategorik bucket'a ayrılmıştır:

### 6.1.1 Model Çözümleme (~22 dosya)

Model seçimi, fallback zincirleri ve provider yönetimi.

| Temsili Dosya | Açıklama |
|--------------|----------|
| `src/shared/model-resolver.ts` | Ana giriş noktası — override → category → fallback chain → default |
| `src/shared/model-resolution-pipeline.ts` | Çok aşamalı model çözümleme orkestrasyonu |
| `src/shared/model-requirements.ts` | Agent-bazlı fallback zincirleri (AGENT_MODEL_REQUIREMENTS) |
| `src/shared/model-availability.ts` | Fuzzy model adı eşleme + availability kontrolü |
| `src/shared/fallback-chain-from-models.ts` | Model listesinden fallback chain üretimi |

### 6.1.2 Bellek Sistemi (~30 dosya)

Memory bootstrap, manifest, pointer, continuation, resume ve curation.

| Temsili Dosya | Açıklama |
|--------------|----------|
| `src/shared/memory-bootstrap.ts` | İlk session'da dizin/şablon oluşturma |
| `src/shared/memory-manifest.ts` | JSON manifest v2, checksum, lock, placeholder detection |
| `src/shared/memory-continuation.ts` | Session özeti üretimi |
| `src/shared/memory-path-discovery.ts` | Memory dizini keşfi (multi-worktree) |
| `src/shared/memory-hydrator.ts` | Template hydration engine |
| `src/shared/memory-curator.ts` | Memory içeriği düzenleme/kırpma |
| `src/shared/memory-decision-writer.ts` | Karar logları yazma |
| `src/shared/memory-quality-gate.ts` | Quality gate sonuçlarını memory'e yazma |
| `src/shared/memory-lock.ts` | Memory lock mekanizması |
| `src/shared/memory-resume.ts` | Taşınabilir resume planı |

### 6.1.3 Agent Yönetimi (~8 dosya)

Agent tanımları, sıralama, kısıtlamalar ve varyantlar.

| Temsili Dosya | Açıklama |
|--------------|----------|
| `src/shared/agent-sort-shim.ts` | `Array.prototype.sort` patch — kanonik agent sırası |
| `src/shared/agent-display-names.ts` | Agent görünen adları |
| `src/shared/agent-variant.ts` | Model varyant seçimi |
| `src/shared/agent-tool-restrictions.ts` | Agent-tool kısıtlama kuralları |
| `src/shared/agent-ordering.ts` | Agent sıralama mantığı |

### 6.1.4 Session Yönetimi (~10 dosya)

Session cursor, route, model state, inject edilen yollar.

| Temsili Dosya | Açıklama |
|--------------|----------|
| `src/shared/session-cursor.ts` | Session imleci (mesaj konumu) |
| `src/shared/session-route.ts` | Session routing bilgisi |
| `src/shared/session-model-state.ts` | Session model durumu |
| `src/shared/session-injected-paths.ts` | Enjekte edilen dosya yolları takibi |
| `src/shared/session-directory-resolver.ts` | Session dizin çözümleme |

### 6.1.5 Prompt Async Gate (~8 dosya)

Güvenli internal prompt dispatch sistemi.

| Temsili Dosya | Açıklama |
|--------------|----------|
| `src/shared/prompt-async-gate.ts` | Ana gate — session.promptAsync sarmalayıcı |
| `src/shared/prompt-async-gate/queue.ts` | Prompt kuyruğu (FIFO, draining) |
| `src/shared/prompt-async-gate/reservations.ts` | Rezervasyon sistemi (dedupe) |
| `src/shared/prompt-async-gate/session-idle-dispatch.ts` | Idle session dispatch |
| `src/shared/prompt-async-gate/timing.ts` | Zamanlama sabitleri |

### 6.1.6 Git ve Worktree (~10 dosya)

Git checkpoint, diff toplama, worktree yönetimi.

| Temsili Dosya | Açıklama |
|--------------|----------|
| `src/shared/git-checkpoint.ts` | Pre-task git state checkpoint |
| `src/shared/git-worktree/` | Git worktree oluşturma/temizleme |
| `src/shared/file-reference-resolver.ts` | Dosya referans çözümleme |
| `src/shared/dependency-graph/` | Task dependency graph tipleri + validation |

### 6.1.7 Logger ve File I/O (~6 dosya)

Loglama, atomik yazma, shim'ler.

| Temsili Dosya | Açıklama |
|--------------|----------|
| `src/shared/logger.ts` | Ana logger (os.tmpdir, 50MB cap) |
| `src/shared/write-file-atomically.ts` | Atomik dosya yazma |
| `src/shared/bun-file-shim.ts` | `Bun.file` shim (non-Bun runtime) |
| `src/shared/bun-write-shim.ts` | `Bun.write` shim |
| `src/shared/tolerant-fsync.ts` | Hata toleranslı fsync |

### 6.1.8 JSON ve Veri İşleme (~6 dosya)

JSONC parse, deep merge, frontmatter, snake_case.

| Temsili Dosya | Açıklama |
|--------------|----------|
| `src/shared/jsonc-parser.ts` | JSONC (yorum satırlı JSON) parser |
| `src/shared/deep-merge.ts` | Prototype-pollution-safe deep merge |
| `src/shared/frontmatter.ts` | YAML frontmatter çıkarımı |
| `src/shared/snake-case.ts` | snake_case dönüşümü |
| `src/shared/json-file-cache-store.ts` | JSON dosya cache store |

### 6.1.9 Migration ve Config (~8 dosya)

Legacy config migration, workspace migration.

| Temsili Dosya | Açıklama |
|--------------|----------|
| `src/shared/migrate-legacy-config-file.ts` | Legacy config dönüşümü |
| `src/shared/legacy-workspace-migration.ts` | `.sisyphus/` → `.omo/` migration |
| `src/shared/migration.ts` | Migration orkestratörü |
| `src/shared/config-errors.ts` | Config hata tipleri |

### 6.1.10 OpenCode Entegrasyonu (~8 dosya)

OpenCode host ile iletişim, config dizinleri, auth.

| Temsili Dosya | Açıklama |
|--------------|----------|
| `src/shared/opencode-config-dir.ts` | OpenCode config dizin keşfi |
| `src/shared/opencode-server-auth.ts` | Server auth enjeksiyonu |
| `src/shared/opencode-storage-paths.ts` | Storage yol sabitleri |
| `src/shared/opencode-version.ts` | OpenCode versiyon kontrolü |
| `src/shared/external-plugin-detector.ts` | Harici plugin tespiti |

### 6.1.11 Diğer Yardımcılar (~15 dosya)

Kalan yardımcılar çeşitli kategorilere dağılmıştır.

| Temsili Dosya | Açıklama |
|--------------|----------|
| `src/shared/domain-vocabulary.ts` | Domain kelime dağarcığı |
| `src/shared/posthog.ts` | Telemetry (PostHog, varsayılan OFF) |
| `src/shared/ripgrep-cli.ts` | Ripgrep CLI wrapper |
| `src/shared/zip-extractor.ts` | ZIP çıkarıcı |
| `src/shared/binary-downloader.ts` | Platform binary indirici |
| `src/shared/notification-toast.ts` | OS bildirimleri |
| `src/shared/port-utils.ts` | Port bulma yardımcısı |
| `src/shared/runtime-trace.ts` | Runtime trace (debug) |

---

## 6.2 Logger Mekanizması

| Özellik | Detay |
|---------|-------|
| **Dosya** | `src/shared/logger.ts` |
| **Log dosyası** | `oh-my-opencode.log` (`os.tmpdir()` içinde) |
| **Linux yolu** | `/tmp/oh-my-opencode.log` |
| **macOS yolu** | `/var/folders/.../T/oh-my-opencode.log` |
| **Windows yolu** | `%TEMP%\oh-my-opencode.log` |
| **Max boyut** | 50 MB (`DEFAULT_MAX_LOG_FILE_SIZE_BYTES = 50 * 1024 * 1024`) |
| **Backup sayısı** | 2 (`.1`, `.2`) |
| **Rotation** | Boyut aşılınca: `.2` silinir → `.1` → `.2`, birincil → `.1` |
| **Buffer** | 500ms flush interval, 50 satır buffer limiti |
| **Hata toleransı** | Rotation hataları sessizce yutulur (logger asla throw etmez) |

```typescript
import { log } from "./shared/logger"
log.info("Plugin initialized")
log.error("Failed to load config", { error: err.message })
```

---

## 6.3 prompt-async-gate Kuralı

| Özellik | Detay |
|---------|-------|
| **Dosya** | `src/shared/prompt-async-gate.ts` + `src/shared/prompt-async-gate/` (6 alt dosya) |
| **Durum** | **Kritik güvenlik katmanı** |

### Neden Tehlikeli?

OpenCode'un tasarımında, plugin'ler `session.prompt` / `session.promptAsync` API'leri aracılığıyla ana session'a mesaj enjekte edebilir. Bu API'ler:

1. Prompt gönderildikten hemen sonra return eder (kalıcı kabul beklenmez)
2. Geç hatalar `session.error` olarak dönebilir
3. Birden fazla hook/tool aynı idle/error/complete edge'ini gözlemleyip aynı mesajı birden fazla kez enjekte edebilir

Sonuç: **Duplicate internal message injection** — aynı mesajın session'a birden fazla kez gitmesi.

### Gerekli Gate Semantiği

`prompt-async-gate.ts` aşağıdaki semantikleri zorlar:

1. **Rezervasyon:** Dispatch öncesi session başına rezervasyon alınır (`reservations.ts`)
2. **Aktif session kontrolü:** Session hala aktif mi kontrol edilir
3. **Post-dispatch hold:** Kısa bir süre (varsayılan) başka dispatch engellenir
4. **Intentional abort/recovery:** Sadece bilinçli abort/kurtarma yollarında rezervasyon temizlenir
5. **Optimistic state restore:** Dispatch skip edilir veya geç başarısız olursa task/loop state geri yüklenir

### Yasaklı Pattern'ler

```typescript
// ❌ YASAK — raw promptAsync kullanımı
session.promptAsync("continue working")

// ❌ YASAK — postDispatchHoldMs: 0
dispatchInternalPrompt({ mode: "async", postDispatchHoldMs: 0 })

// ❌ YASAK — session yokken raw prompt'a düşme
if (!session) session.promptAsync("...")

// ✅ DOĞRU — gate üzerinden
dispatchInternalPrompt({ mode: "async", ... })
```

### Test Zorunluluğu

`src/shared/prompt-async-route-audit.test.ts` — tüm kod tabanını TS compiler API ile tarar ve raw `session.promptAsync` çağrılarını tespit eder. Herhangi bir ihlal durumunda test suite'i başarısız olur.

---

## 6.4 Config Sistemi — src/config/ (30 Zod Schema)

`src/config/schema/` altında **30 Zod v4 schema dosyası** bulunur.

### Schema Kategorileri

| Kategori | Schema Dosyası | Açıklama |
|----------|---------------|----------|
| **Agent Config** | `agent-definitions.ts`, `agent-overrides.ts`, `agent-names.ts` | Agent tanımları, override kuralları, isim haritalama |
| **Tool Config** | `tmux.ts`, `browser-automation.ts`, `skills.ts`, `commands.ts` | Tool etkinleştirme, timeout, binary yolları |
| **MCP Config** | `claude-code.ts`, `mcp-oauth.ts` | MCP server URL'leri, env allowlist |
| **Hook Config** | `hooks.ts`, `keyword-detector.ts`, `ralph-loop.ts` | Hook etkinleştirme, keyword listesi |
| **Model Config** | `fallback-models.ts`, `model-capabilities.ts` | Model fallback zincirleri, capability cache |
| **Hecateq Config** | `hecateq.ts` (488 satır) | 9 sub-config (aşağıda detaylı) |
| **Team Config** | `team-mode.ts` | Team mode ayarları (11 alan) |
| **Background** | `background-task.ts` | Concurrency limitleri |
| **Runtime** | `runtime-fallback.ts`, `experimental.ts` | Runtime davranış, özellik flag'leri |
| **UI/i18n** | `i18n.ts`, `notification.ts` | Dil, bildirim ayarları |
| **CLI** | `git-master.ts`, `start-work.ts` | CLI davranışı |
| **Core** | `oh-my-opencode-config.ts`, `default-mode.ts`, `categories.ts` | Root schema, varsayılanlar, kategori tanımları |
| **Internal** | `internal/` | Dahili schema'lar (agent-eligibility, vs.) |

### Root Schema (OhMyOpenCodeConfigSchema)

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/hecateq/hecateq-openagent/main/assets/hecateq-openagent.schema.json",
  
  // Hecateq-specific
  "hecateq": { /* 9 sub-config, aşağıya bak */ },
  
  // Agent configuration
  "agent_order": ["hecateq-orchestrator", "sisyphus", "hephaestus", "prometheus", "atlas"],
  "agent_definitions": { /* external agent .md/.json paths */ },
  "agents": { /* per-agent overrides */ },
  "disabled_agents": [],
  "disabled_categories": [],
  "disabled_skills": [],
  "disabled_hooks": [],
  "disabled_commands": [],
  "disabled_tools": [],
  "disabled_mcps": [],
  "disabled_providers": [],
  
  // Feature flags
  "experimental": {},
  "team_mode": {},
  "background_task": {},
  "runtime_fallback": {},
  "model_fallback": false,
  "hashline_edit": false,
  "new_task_system_enabled": false,
  "dynamic_context_pruning": {},
  
  // MCP
  "mcp_env_allowlist": [],
  "claude_code": {},
  
  // Tools
  "openclaw": {},
  "websearch": {},
  "browser_automation_engine": {},
  "tmux": {},
  
  // Behavior
  "keyword_detector": {},
  "ralph_loop": {},
  "sisyphus": {},
  "sisyphus_agent": {},
  "comment_checker": {},
  "babysitting": {},
  "git_master": {},
  "start_work": {},
  "default_mode": {},
  "auto_update": true,
  "default_run_agent": "sisyphus",
  
  // Other
  "model_capabilities": {},
  "skills": {},
  "categories": {},
  "i18n": {},
  "notification": {},
  
  "defaults": { /* auto-fill by Zod safeParse */ }
}
```

---

## 6.5 Çok Seviyeli Config Sistemi

### Walk Algoritması

```
1. Defaults — Zod safeParse ile tüm omitted alanlar doldurulur
2. User config — ~/.config/opencode/oh-my-openagent.jsonc (veya legacy oh-my-opencode.jsonc)
3. Walked configs — <pwd> yukarı $HOME'a kadar her .opencode/ dizininde oh-my-openagent.jsonc
                         (closer wins — proje kökü en yakın)
```

### Merge Semantics

| Alan Türü | Merge Kuralı | Güvenlik |
|-----------|-------------|----------|
| `agents`, `categories`, `claude_code` | **Deep merge** — recursive, prototype-pollution safe | `deep-merge.ts` kontrolü |
| `disabled_*` arrays | **Set union** — concat + deduplicate | Her iki listeden gelenler birleşir |
| `mcp_env_allowlist` | **User-only** — walked configs genişletemez | Güvenlik kısıtı |
| Diğer tüm alanlar | **Override** — closer wins | Yakın olan kazanır |

```typescript
// Merge sırası (koddan)
function mergeConfigs(user: Config, walked: Config): Config {
  return {
    ...defaults,
    ...walked,
    ...user,
    agents: deepMerge(defaults.agents, walked.agents, user.agents),
    categories: deepMerge(defaults.categories, walked.categories, user.categories),
    claude_code: deepMerge(defaults.claude_code, walked.claude_code, user.claude_code),
    disabled_agents: [...new Set([...defaults.disabled_agents, ...walked.disabled_agents, ...user.disabled_agents])],
    // ...
  }
}
```

---

## 6.6 Hecateq Config Section (9 Sub-Config)

**Dosya:** `src/config/schema/hecateq.ts` (488 satır, 9 sub-config)

```jsonc
{
  "hecateq": {
    "enabled": true,                          // Master switch
    "context_injection": { /* 14 field */ },  // 6.6.1
    "agent_index": { /* 6 field */ },         // 6.6.2
    "memory_bootstrap": { /* 3 field */ },    // 6.6.3
    "doctor": { /* 5 field */ },              // 6.6.4
    "git_checkpoint": { /* 8 field */ },      // 6.6.5
    "dependency_graph": { /* 5 field */ },    // 6.6.6
    "orchestration": { /* 12 field */ },      // 6.6.7
    "auto_spawn": { /* 10 field */ },         // 6.6.8
    "delegation_chain": { /* 3 field */ }     // 6.6.9
  }
}
```

### 6.6.1 context_injection

| Alan | Varsayılan | Açıklama |
|------|-----------|----------|
| `enabled` | `true` | Context enjeksiyonunu açar/kapatır |
| `mode` | `"compact"` | `"compact"` \| `"expanded"` \| `"off"` |
| `manifest_first` | `true` | Manifest'i ilk sırada enjekte et |
| `max_memory_file_chars` | `500` | Her memory dosyasından max karakter |
| `max_total_chars` | `2500` | Toplam context karakter limiti |
| `max_artifact_files` | `5` | En fazla bu kadar artifact dosyası |
| `include_contracts` | `true` | Contract dosyalarını dahil et |
| `include_task_graphs` | `true` | Task graph'ları dahil et |
| `include_agent_index` | `true` | Agent index'i dahil et |
| `max_agent_domains` | `8` | En fazla bu kadar domain |
| `max_agents_per_domain` | `5` | Domain başına max agent |
| `inject_on_subagents` | `true` | Subagent'lara da enjekte et |
| `hecateq_only` | `false` | Sadece Hecateq agent'larına enjekte et |

### 6.6.2 agent_index

| Alan | Varsayılan | Açıklama |
|------|-----------|----------|
| `enabled` | `true` | Agent index'i açar/kapatır |
| `enrich_runtime_agents` | `true` | Runtime agent'ları zenginleştir |
| `use_for_suggestions` | `true` | Önerilerde kullan |
| `require_fresh` | `false` | Her zaman taze index iste |
| `fallback_to_runtime_only` | `true` | Index yoksa runtime'a düş |
| `max_suggestions` | `10` | Max öneri sayısı |

### 6.6.3 memory_bootstrap

| Alan | Varsayılan | Açıklama |
|------|-----------|----------|
| `enabled` | `true` | Bootstrap açar/kapatır |
| `create_memory_files` | `true` | Memory şablon dosyalarını oluştur |
| `create_artifact_dirs` | `true` | Artifact dizinlerini oluştur |

### 6.6.4 doctor (Hecateq Doctor)

| Alan | Varsayılan | Açıklama |
|------|-----------|----------|
| `check_memory` | `true` | Memory dosyası varlığı/kalitesi |
| `check_artifacts` | `true` | Artifact dizin yapısı |
| `check_custom_agents` | `true` | Custom agent konfigürasyonu |
| `check_secrets` | `true` | Sır/credential sızıntısı |
| `check_safety_hooks` | `true` | Gerekli güvenlik hook'ları |

### 6.6.5 git_checkpoint

| Alan | Varsayılan | Açıklama |
|------|-----------|----------|
| `enabled` | `true` | Git checkpoint açar/kapatır |
| `mode` | `"suggest"` | `"suggest"` \| `"auto_clean_only"` \| `"off"` |
| `auto_checkpoint_clean_repo` | `false` | Temiz repoda otomatik checkpoint |
| `checkpoint_message` | `"chore: checkpoint before hecateq task"` | Commit mesajı |
| `include_status_in_context` | `true` | Git status'u context'e ekle |
| `include_dirty_file_list` | `false` | Kirli dosya listesini ekle |
| `include_dirty_file_count` | `true` | Kirli dosya sayısını ekle |
| `max_dirty_files` | `10` | Raporda gösterilecek max dosya |
| `block_destructive_git` | `true` | Destructive git işlemlerini engelle |

### 6.6.6 dependency_graph

| Alan | Varsayılan | Açıklama |
|------|-----------|----------|
| `mode` | `"off"` | `"off"` \| `"warn"` \| `"enforce"` |
| `auto_create` | `true` | Otomatik graph oluşturma |
| `block_on_cycle` | `true` | Cycle'da task'i blokla |
| `block_on_sensitive` | `true` | Sensitive path'te blokla |
| `require_contract_for` | `[]` | Contract zorunlu domain'ler |

### 6.6.7 orchestration

| Alan | Varsayılan | Açıklama |
|------|-----------|----------|
| `enabled` | `false` | Pipeline açar/kapatır |
| `auto_decompose` | `true` | Otomatik task decomposition |
| `auto_execute_low_risk` | `true` | Düşük riskli task'leri otomatik çalıştır |
| `require_plan_for_high_risk` | `true` | Yüksek risk için plan zorunlu |
| `max_repair_attempts` | `2` | Task başına max onarım denemesi |
| `default_task_timeout_ms` | `300000` | Task timeout (5 dk) |
| `allow_parallel_readonly_tasks` | `true` | Read-only task'lerde paralel çalışmaya izin ver |
| `allow_parallel_write_tasks` | `false` | Write task'lerde paralel çalışmayı engelle |
| `quality_gates.typecheck` | `true` | Typecheck gate |
| `quality_gates.lint` | `true` | Lint gate |
| `quality_gates.test` | `true` | Test gate |
| `quality_gates.build` | `true` | Build gate |
| `quality_gates.doctor` | `false` | Doctor gate (opsiyonel) |

### 6.6.8 auto_spawn

| Alan | Varsayılan | Açıklama |
|------|-----------|----------|
| `enabled` | `false` | Otonom spawn açar/kapatır |
| `max_concurrent_spawns` | `5` | Eşzamanlı spawn limiti |
| `spawn_timeout_ms` | `300000` | Spawn timeout (5 dk) |
| `auto_retry_on_failure` | `true` | Başarısız spawn'ı otomatik dene |
| `max_failures_before_pause` | `3` | Duraklama öncesi max hata |
| `pause_duration_ms` | `60000` | Duraklama süresi (1 dk) |
| `allow_background_spawn` | `true` | Background spawn'a izin ver |
| `max_spawn_depth` | `3` | İç içe spawn derinliği |
| `rate_limit_enabled` | `true` | Rate limiting açar/kapatır |
| `max_spawns_per_window` | `20` | Pencere başına max spawn |
| `spawn_window_ms` | `60000` | Rate limit penceresi (1 dk) |

### 6.6.9 delegation_chain

| Alan | Varsayılan | Açıklama |
|------|-----------|----------|
| `max_depth` | `3` | Delegasyon zinciri max derinlik |
| `max_fan_out` | `10` | Paralel delegasyon max sayı |
| `max_iterations_per_run` | `10` | Run başına max iterasyon |

---

## 6.7 mcp_env_allowlist Güvenliği

| Kural | Detay |
|-------|-------|
| **Kapsam** | `.mcp.json` (Tier-2 MCP) içinde `${VAR}` env expansion |
| **Kısıt** | Sadece **user config** (`~/.config/opencode/`), walked configs genişletemez |
| **Neden** | Kötü niyetli bir proje `.opencode/oh-my-openagent.jsonc` içinden hassas env değişkenlerini MCP server'a sızdıramaz |

```jsonc
{
  // SADECE user config'de çalışır
  "mcp_env_allowlist": ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "DATABASE_URL"]
}
```

Proje seviyesindeki config'de `mcp_env_allowlist` belirtilmesi sessizce yok sayılır.

---

## 6.8 Config Migration

| Özellik | Detay |
|---------|-------|
| **Dosya** | `src/shared/migrate-legacy-config-file.ts` |
| **Yöntem** | Idempotent — `_migrations` tracking |
| **Backup** | Timestamp'li atomic yazma |

### migrateConfigFile() İşlemleri

1. Config dosyasını oku
2. `_migrations` array'ini kontrol et (daha önce migrate edilmiş mi?)
3. Gerekli dönüşümleri uygula:
   - Legacy anahtar isimlerini yenile
   - Eski model ID'lerini güncelle
   - Eski agent isimlerini güncelle (örn. `junior` → `sisyphus-junior`)
   - Yeni schema alanlarını ekle
4. Timestamp'li backup oluştur (`oh-my-openagent.jsonc.2026-06-30T12-00-00.bak`)
5. Atomic write ile config'i yaz
6. `_migrations` array'ine migration kaydını ekle

```typescript
// Migration tracking örneği
{
  "_migrations": [
    { "name": "rename-junior-to-sisyphus-junior", "date": "2026-05-15T10:30:00Z" },
    { "name": "update-model-ids-v2", "date": "2026-06-01T08:00:00Z" }
  ]
}
```

---

## 6.9 Paket Yapısı — packages/

`packages/` dizini 12 core paket, 1 web paketi ve 11 platform binary'si içerir:

### Core Paketler

| # | Paket | Açıklama | Anahtar Dosyalar |
|---|-------|----------|-----------------|
| 1 | **hashline-core** | Content-aware text editing (65+ dosya) | `hash-computation.ts`, `edit-operations.ts`, `diff-utils.ts`, `autocorrect-replacement-lines.ts`, `file-text-canonicalization.ts` |
| 2 | **comment-checker-core** | AI yorum algılama | `runner.ts`, `apply-patch-edits.ts`, `types.ts` |
| 3 | **ast-grep-core** | AST pattern eşleme | `runner.ts`, `language-support.ts`, `pattern-hints.ts`, `result-formatter.ts` |
| 4 | **ast-grep-mcp** | AST MCP sunucusu | `cli.ts`, `mcp.ts`, `pattern-hints.ts` |
| 5 | **lsp-tools-mcp** | LSP implementasyonu | `tools.ts`, `config-loader.ts`, `client.ts` |
| 6 | **boulder-state** | İş takibi state machine | `session.ts`, `task.ts`, `shared.ts`, `read-state.ts`, `write-state.ts` |
| 7 | **agents-md-core** | AGENTS.md işleme | `injector.ts`, `formatter.ts`, `finder.ts`, `types.ts` |
| 8 | **utils** | Paylaşılan yardımcılar | deep-merge, snake-case, frontmatter, file-utils |
| 9 | **rules-engine** | Kural keşfi + eşleme | Rule discovery, matching |
| 10 | **model-core** | Model çözümleme pipeline | ProviderCache DI, model resolution |
| 11 | **model-capabilities cache** | (`src/generated/`) Model yetenek cache | Auto-generated from models.dev API |
| 12 | **web** | Next.js 15 + Cloudflare Workers sitesi | Kendi `bun.lock`, `@/*` path aliases |

### Platform Binary'leri (11 adet)

Hedef: `bun build --compile --target` ile üretilir. CI'da `publish-platform.yml` tarafından build edilir.

| Binary | Platform | Mimari | Not |
|--------|----------|--------|-----|
| `hecateq-openagent-linux-x64` | Linux | x86_64 | AVX2 |
| `hecateq-openagent-linux-x64-baseline` | Linux | x86_64 | No AVX2 |
| `hecateq-openagent-windows-x64` | Windows | x86_64 | AVX2 |
| `hecateq-openagent-windows-x64-baseline` | Windows | x86_64 | No AVX2 |
| `oh-my-opencode-darwin-arm64` | macOS | ARM64 | Apple Silicon |
| `oh-my-opencode-darwin-x64` | macOS | x86_64 | Intel + AVX2 |
| `oh-my-opencode-darwin-x64-baseline` | macOS | x86_64 | Intel no AVX2 |
| `oh-my-opencode-linux-arm64` | Linux | ARM64 | — |
| `oh-my-opencode-linux-arm64-musl` | Linux | ARM64 | musl libc |
| `oh-my-opencode-linux-x64` | Linux | x86_64 | AVX2 |
| `oh-my-opencode-linux-x64-baseline` | Linux | x86_64 | No AVX2 |
| `oh-my-opencode-linux-x64-musl` | Linux | x86_64 | musl + AVX2 |
| `oh-my-opencode-linux-x64-musl-baseline` | Linux | x86_64 | musl no AVX2 |
| `oh-my-opencode-windows-x64` | Windows | x86_64 | AVX2 |
| `oh-my-opencode-windows-x64-baseline` | Windows | x86_64 | No AVX2 |

> **Not:** Hecateq binary'leri (`hecateq-openagent-*`) Hecateq fork'una özgüdür; `oh-my-opencode-*` binary'leri upstream uyumluluğu için korunur. Her iki set de aynı kaynaktan derlenir.

---

## 6.10 CLI Komutları — src/cli/

| Dosya/Dizin | Açıklama |
|------------|----------|
| `src/cli/cli-program.ts` | Commander.js ana program |
| `src/cli/install.ts` | `install` / `setup` — interaktif kurulum sihirbazı |
| `src/cli/run/` | `run <message>` — non-interactive session |
| `src/cli/doctor/` | `doctor` — 4 kategorili sağlık teşhisi (System, Config, Tools, Models) |
| `src/cli/hecateq/` | **Hecateq CLI** — `plan`, `run`, `resume`, `status`, `doctor` (Experimental) |
| `src/cli/dashboard/` | `dashboard / dashboard serve` — Hermes monitoring |
| `src/cli/mcp-oauth/` | `mcp-oauth login/logout/status` — OAuth yönetimi |
| `src/cli/boulder/` | `boulder` — State inspector |
| `src/cli/config-manager/` | Config yönetimi |
| `src/cli/get-local-version/` | Versiyon kontrolü |

---

## 6.11 OpenClaw — src/openclaw/

| Özellik | Detay |
|---------|-------|
| **Durum** | **Beta** (miras, operasyonel risk) |
| **Yön** | **Bidirectional** — hem dışarıya hem içeriye |

### Outbound (Dışarıya)

Session event'leri → HTTP/shell dispatcher'ları. Session oluşturma, silme, idle, error gibi olaylar dış sistemlere iletilir.

- `src/openclaw/dispatcher.ts` — Event dispatch mantığı
- `src/openclaw/runtime-dispatch.ts` — Runtime dispatch
- `src/openclaw/tmux.ts` — Tmux üzerinden dispatch

### Inbound (İçeriye)

Discord/Telegram daemon → tmux send-keys. Dışarıdan gelen mesajlar OpenCode session'ına tmux üzerinden iletilir.

- `src/openclaw/reply-listener-discord.ts` — Discord dinleyici
- `src/openclaw/reply-listener-telegram.ts` — Telegram dinleyici
- `src/openclaw/reply-listener.ts` — Ana reply listener
- `src/openclaw/session-registry.ts` — Session kayıtları

---

## 6.12 CI/CD İş Akışları — .github/workflows/

| Workflow | Trigger | Amaç |
|----------|---------|------|
| `ci.yml` | push/PR → master/dev | Test, typecheck, build, schema auto-commit, draft release |
| `publish.yml` | manual dispatch | Dual npm publish, platform binary'leri, GitHub release |
| `publish-platform.yml` | `publish.yml` tarafından çağrılır | 11 platform binary `bun compile` |
| `sisyphus-agent.yml` | @mention / manual | AI agent issue/PR yönetimi |
| `refresh-model-capabilities.yml` | weekly cron / dispatch | Model yetenek cache güncelleme |
| `cla.yml` | issue_comment / PR | CLA asistanı |
| `lint-workflows.yml` | push/PR → `.github/workflows/**` | actionlint |
| `web-ci.yml` | push/PR → `packages/web/**`, `docs/**` | Next.js format/lint/type-check/build |
| `web-deploy.yml` | push → master/dev | Cloudflare Workers deploy |

---

## 6.13 Özet

| Bileşen | Dosya Sayısı | Anahtar Rol |
|---------|-------------|-------------|
| `src/shared/` | 297 (179 non-test) | Cross-cutting utilities, memory sistemi, gate'ler |
| `src/config/` | 41 (30 schema) | Zod v4 validasyon, multi-level merge |
| `packages/core` | 12 paket | Hashline, LSP, AST, boulder, model, rules |
| `packages/web` | 1 (Next.js 15) | Marketing sitesi |
| `platform binaries` | 11 | Her OS/arch için compile edilmiş binary |
| `src/cli/` | ~158 | Commander.js CLI |
| `src/openclaw/` | ~26 | Bi-directional entegrasyon |
| `.github/workflows/` | 9 | CI/CD pipeline |

<!-- TODO: Config schema sayısı ve shared dosya kategorizasyonu güncellenmeli -->
