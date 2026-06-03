# Hecateq OpenAgent — Oturum Çalışma Özeti

**Tarih:** 2026-06-03
**Raporlayan:** technical-writer-documentarian
**Branch:** `dev` (dirty — çalışma commit edilmemiştir, ilgisiz değişiklikler korunmuştur)

---

## İçindekiler

1. [Hermes Agentic OS — Plugin State Export Sistemi](#1-hermes-agentic-os--plugin-state-export-sistemi)
2. [Schema JSON Dokümantasyonu](#2-schema-json-dokümantasyonu)
3. [Değiştirilen/Yeni Dosya Listesi](#3-değiştirilenyeni-dosya-listesi)
4. [Kapsam Dışı Kalanlar](#4-kapsam-dışı-kalanlar)
5. [Test ve Derleme Sonuçları](#5-test-ve-derleme-sonuçları)

---

## 1. Hermes Agentic OS — Plugin State Export Sistemi

### 1.1. Amaç

**Hermes State Export**, Hecateq OpenAgent plugininin iç durumunu harici bir "Agentic OS" katmanına (Hermes) **salt-okunur (read-only)** olarak aktaran bir altyapıdır. Hermes'in plugin içinde neler olup bittiğini gözlemlemesini sağlar — ancak plugin içinde **herhangi bir değişiklik yapmasına, prompt/session/shell enjekte etmesine veya runtime'ı mutasyona uğratmasına izin vermez.**

Tasarım prensipleri:

- **Best-effort yazma:** Tüm disk yazmaları hata karşısında sessizce başarısız olur (`false` döner), asla throw etmez. Hermes eksik/kayıp dosyalara toleranslı olmalıdır.
- **Atomik yazma:** Tüm dosyalar `tmp + rename` deseniyle yazılır, yarı-yazılmış dosya kalmaz.
- **Sanitizasyon:** Secret benzeri alanlar (`token`, `password`, `api_key`, JWT, vb.) dışa aktarım sırasında `[redacted]` ile değiştirilir.
- **Akış (append-only) olay kaydı:** JSONL formatında günlük dosyalara yazılır, eski kayıtlar korunur.
- **No HTTP, no UI, no mutating endpoint.**

### 1.2. Feature Modülü: `src/features/hermes-state/`

9 dosyadan oluşan bağımsız feature modülü:

| Dosya | Tür | Açıklama |
|-------|-----|----------|
| `index.ts` | Barrel export | Tüm sınıfları dışa aktarır |
| `hermes-state-writer.ts` | Çekirdek (208 LOC) | Atomik dosya yazma, JSONL append, sanitizasyon yardımcıları |
| `hermes-state-writer.test.ts` | Test (162 LOC) | 8 test: state dizini, atomik yazma, JSONL, sekret tespiti, truncate, toISO, hata toleransı |
| `hermes-background-state.ts` | Background state (186 LOC) | BackgroundManager task'larını izler, JSON state dosyasına yazar, JSONL event fırlatır |
| `hermes-background-state.test.ts` | Test (137 LOC) | 5 test: task state yazma, lifecycle geçişleri, error/cancelled kaydı, JSONL event emisyonu |
| `hermes-event-log.ts` | Event log (57 LOC) | Session lifecycle olaylarını (created/idle/error/deleted) JSONL'e kaydeder |
| `hermes-event-log.test.ts` | Test (102 LOC) | 6 test: session.created/idle/error/deleted, sanitizasyon, multi-event append |
| `hermes-config-snapshot.ts` | Config snapshot (97 LOC) | Plugin konfigürasyonunun allowlistelenmiş anlık görüntüsünü alır |
| `hermes-config-snapshot.test.ts` | Test (156 LOC) | 8 test: config snapshot, team-mode hook count, provider, MCP varlığı |

#### 1.2.1. `HermesStateWriter` (Çekirdek Sınıf)

Tüm I/O işlemlerinin merkezidir:

- **Dizin yönetimi:** `<projectRoot>/.opencode/state/` ve altındaki `events/` dizinini oluşturur.
- **Atomik yazma:** `writeAtomically(filename, content)` — önce `.tmp` dosyasına yazar, sonra rename eder. Hiç throw etmez, `boolean` döner.
- **JSONL append:** `appendJSONL(relPath, obj)` — günlük `events/events-YYYY-MM-DD.jsonl` dosyalarına satır ekler. Dizin yoksa oluşturur.
- **Sanitizasyon:**
  - `isSecretKey(key)`: 11 regex deseni ile secret alan adlarını tespit eder (`secret`, `token`, `password`, `api_key`, `auth`, `credential`, `private_key`, `access_key`, `signing_key`, `encryption_key`)
  - `isSecretValue(value)`: 9 regex deseni ile değer bazında secret tespiti (sk-, pk-, ghp_, gho_, ghu_, ghs_, ghr_, xox*- Slack, JWT-like, base64-like)
  - `sanitizeForExport(obj)`: Rekürsif olarak tüm nesneyi dolaşır, secret anahtarları `[redacted]` yapar, secret değerleri `[redacted]` yapar. 10 seviye derinlik sınırı.
- **Truncate:** `truncateDescription()` — açıklama metinlerini 200 karakter (varsayılan) ile sınırlar.
- **ISO format:** `toISO()` — Date nesnesini ISO-8601 string'ine çevirir, null/undefined için null döner.

#### 1.2.2. `HermesBackgroundState` — BackgroundManager Disk State

`BackgroundManager` ile entegre çalışarak task lifecycle'ını `background-tasks.json` dosyasına yansıtır:

- **Schema:** `{ schema_version, updated_at, active: HermesTaskEntry[], history: HermesTaskEntry[], concurrency_limits }`
- **Active/history ayrımı:** Tamamlanmamış task'ler `active[]`, bitenler `history[]` içinde. History 500 entry ile sınırlıdır.
- **Debounce:** 500ms debounce ile gereksiz disk yazmalarını önler. `flush()` ile anında yazma zorlanabilir.
- **Task lifecycle event'leri:** JSONL formatında günlük olay dosyasına şu olay türlerini yazar:
  - `task.queued` — task kuyruğa alındığında
  - `task.started` — task çalışmaya başladığında
  - `task.completed` — task başarıyla tamamlandığında (duration_ms ile)
  - `task.error` — task hata verdiğinde (error mesajı ile)
  - `task.cancelled` — task iptal edildiğinde
- **Status mapping:** `pending` → `queued`, `running` → `running`, `completed` → `completed`, `error` → `error`, `cancelled`/`interrupt` → `cancelled`

#### 1.2.3. `HermesEventLog` — Session Event JSONL Forwarding

Session lifecycle olaylarını JSONL formatında dosyaya yönlendirir:

- `logSessionCreated(sessionId, agent, parentSessionId)`
- `logSessionIdle(sessionId, lastActive, messageCount)`
- `logSessionError(sessionId, error, agent)` — error 300 karakter ile sınırlanır
- `logSessionDeleted(sessionId)`
- `logEvent(type, sessionId, data)` — generic event, sanitizasyon otomatik uygulanır

#### 1.2.4. `HermesConfigSnapshot` — Plugin Config Snapshot

Plugin konfigürasyonunun allowlistelenmiş bir anlık görüntüsünü `plugin-config-snapshot.json` dosyasına yazar:

| Alan | Kaynak |
|------|--------|
| `plugin_version` | Parametre |
| `hecateq.enabled` | `config.hecateq?.enabled` |
| `hecateq.orchestration_enabled` | `config.hecateq?.orchestration?.enabled` |
| `hecateq.context_injection_enabled` | `config.hecateq?.context_injection?.enabled` |
| `hecateq.memory_bootstrap_enabled` | `config.hecateq?.memory_bootstrap?.enabled` |
| `features.team_mode_enabled` | `config.team_mode?.enabled` |
| `features.task_system_enabled` | `config.experimental?.task_system` |
| `features.telemetry_enabled` | Her zaman `false` (Hecateq default-off) |
| `features.auto_update_enabled` | `config.auto_update` |
| `counts.agents_total` | Hardcoded: 11 |
| `counts.agents_disabled` | `config.disabled_agents?.length` |
| `counts.hooks_total` | 54 veya 61 (team_mode'a göre) |
| `counts.hooks_disabled` | `config.disabled_hooks?.length` |
| `counts.tools_total` | Hardcoded: 20 |
| `counts.tools_disabled` | `config.disabled_tools?.length` |
| `providers` | Bağlı provider'lar (lowercased, sorted) |
| `has_mcp_config` | `.mcp.json` dosyası varlığı veya `disabled_mcps` boş değilse |

**Önemli:** Hiçbir provider key'i, token, şifre veya hassas yapılandırma alanı snapshot'a dahil edilmez.

### 1.3. Entegrasyon Noktaları

Hermes state sistemi, var olan 4 dosyaya minimum dokunuşla entegre edilmiştir:

| Dosya | Değişiklik |
|-------|----------|
| `src/create-managers.ts` | `HermesBackgroundState` ve `HermesEventLog` instance'ları oluşturulur, `Managers` tipine eklenir, `BackgroundManager`'a `hermesBgState` enjekte edilir |
| `src/features/background-agent/manager.ts` | 6 lifecycle noktasında `hermesBgState?.trackTask()` / `updateTask()` / `emitTaskEvent()` çağrıları: task kuyruklama, başlatma, hata, iptal, tamamlama |
| `src/plugin/event.ts` | Session lifecycle olaylarında `hermesEventLog` çağrıları: session.created, session.idle, session.error, session.deleted |
| `src/testing/create-plugin-module.ts` | Plugin başlatılırken `HermesConfigSnapshot.writeSnapshot()` çağrısı |

### 1.4. Sanitizasyon Güvenceleri (Safeguards)

Dışa aktarılan tüm verilerde aşağıdaki güvenceler uygulanır:

| Güvence | Mekanizma | Kapsam |
|----------|-----------|--------|
| Secret alan adı filtreleme | `isSecretKey()` — 11 regex | Tüm `logEvent()` çağrıları ve `sanitizeForExport()` |
| Secret değer filtreleme | `isSecretValue()` — 9 regex | String değerler `sanitizeForExport()` içinde |
| Betimleme kısaltma | `truncateDescription(desc, 200)` | Task description, error mesajı |
| Config allowlist | `HermesConfigSnapshot` manuel alan seçimi | Provider key'leri, token'lar, şifreler asla snapshot'a yazılmaz |
| Best-effort yazma | Try-catch ile tüm I/O | Disk doluluğu/yetki hatasında sessiz başarısızlık |
| Atomik yazma | `writeFileSync(tmp)` + `renameSync()` | Yarı-yazılmış dosya riski yok |

### 1.5. Bilinen Sınırlamalar / Enstrümantasyon Boşlukları

- **Per-session state dosyası yok.** Hermes, bireysel session'ların prompt geçmişine veya mesaj içeriğine bu modül üzerinden erişemez. Session olayları yalnızca `session.created`, `session.idle`, `session.error`, `session.deleted` düzeyindedir.
- **Tool execution log'u yok.** Hangi aracın hangi parametrelerle çağrıldığı kaydedilmez.
- **Agent prompt içeriği loglanmaz.** Sadece task description (truncated) dışa aktarılır.
- **Config snapshot yalnızca plugin başlatılırken alınır.** Runtime sırasında config değişirse snapshot güncellenmez.
- **Telemetry alanı her zaman `false`.** Hermes'in telemetry state'ini görmesi için bu değerin dinamik hale getirilmesi gerekebilir.
- **JSONL dosya rotasyonu yok.** Olay dosyaları günlük bazında ayrılır ancak eski dosyalar temizlenmez. Uzun süreli çalışmalarda disk kullanımı artabilir.
- **Background task'lerin per-session state aynası yok.** Örneğin her task'ın hangi session'da çalıştığı `sessionId` alanıyla JSONL'de kaydedilir, ancak session'daki mesaj içeriği loglanmaz.
- `HermesConfigSnapshot`'daki `agents_total` (11) ve `tools_total` (20) değerleri hardcoded'dır. Yeni agent/tool eklendiğinde güncellenmelidir.

---

## 2. Schema JSON Dokümantasyonu

`docs/reference/schema-json.md` dosyası oluşturulmuştur. Bu doküman, `assets/oh-my-opencode.schema.json` ve `assets/hecateq-openagent.schema.json` dosyalarının ne olduğunu, nasıl üretildiğini ve nasıl kullanılacağını açıklar.

### 2.1. İçerik Özeti

- **Nedir:** Zod v4 konfigürasyon şemasından `z.toJSONSchema()` API'si ile otomatik üretilen JSON Schema (draft-07) dosyası.
- **Kullanım amacı:** IDE'lerde otomatik tamamlama (autocomplete), doğrulama (validation) ve dökümantasyon ipuçları sağlamak.
- **Hangi config dosyalarını hedefler:** `.opencode/oh-my-openagent.jsonc` ve `~/.config/opencode/oh-my-openagent.jsonc`
- **Nasıl üretilir:** `bun run build:schema` (Zod → `createOhMyOpenCodeJsonSchema()` → `assets/` + `dist/`)
- **İki çıktı:** `oh-my-opencode.schema.json` (upstream `$id`) ve `hecateq-openagent.schema.json` (Hecateq fork `$id`)
- **43 üst düzey konfigürasyon alanı** tanımlanmıştır (hecateq, agents, categories, team_mode, experimental, disabled_*, model_fallback, hashline_edit, etc.)

### 2.2. Geliştirici Uyarıları

Dokümanda 7 kritik uyarı notu yer alır:

1. Schema elle düzenlenmez — Zod şeması (`src/config/schema/`) değiştirilip `bun run build:schema` çalıştırılmalıdır.
2. Config anahtarları `snake_case` kullanır.
3. İki çıktı dosyası da vardır; her ikisi de `build:schema` ile güncellenir.
4. Hecateq alias schema'sı, upstream schema'nın `$id`, `title`, `description` alanları değiştirilerek otomatik üretilir.
5. Zod v4 `z.toJSONSchema()` tüm tipleri çeviremeyebilir — `unrepresentable: "any"` parametresi bunu yönetir.
6. CI'da (`ci.yml`) master branch'ine push sırasında schema değişiklikleri otomatik commit edilir.
7. Schema npm paketine dahildir (`package.json` → `"files"` → `assets/`).

---

## 3. Değiştirilen/Yeni Dosya Listesi

### 3.1. Yeni Dosyalar — Hermes State Feature (9 dosya)

```
src/features/hermes-state/
├── index.ts                          # Barrel export
├── hermes-state-writer.ts            # Çekirdek I/O sınıfı (208 LOC)
├── hermes-state-writer.test.ts       # 8 test (162 LOC)
├── hermes-background-state.ts        # Background task state (186 LOC)
├── hermes-background-state.test.ts   # 5 test (137 LOC)
├── hermes-event-log.ts               # Session event log (57 LOC)
├── hermes-event-log.test.ts          # 6 test (102 LOC)
├── hermes-config-snapshot.ts         # Config snapshot (97 LOC)
└── hermes-config-snapshot.test.ts    # 8 test (156 LOC)
```

### 3.2. Yeni Dosya — Schema JSON Dokümantasyonu (1 dosya)

```
docs/reference/schema-json.md         # JSON Schema referansı (82 satır)
```

### 3.3. Değiştirilen Dosyalar — Entegrasyon (4 dosya)

```
src/create-managers.ts                # HermesBgState + HermesEventLog instance'ları eklendi
src/features/background-agent/manager.ts  # 6 noktada task lifecycle kancası
src/plugin/event.ts                   # 4 noktada session event kancası
src/testing/create-plugin-module.ts   # Plugin başlatılırken config snapshot yazımı
```

### 3.4. Schema JSON Dosyaları (otomatik yeniden üretilmiş)

```
assets/oh-my-opencode.schema.json     # Zod → JSON Schema, upstream $id ile
assets/hecateq-openagent.schema.json  # Zod → JSON Schema, Hecateq fork $id ile
```

---

## 4. Kapsam Dışı Kalanlar

Bu oturumda aşağıdakiler **kesinlikle eklenmemiştir:**

| Özellik | Durum |
|---------|-------|
| Hermes için dashboard UI | Eklenmedi |
| HTTP API endpoint (REST/GraphQL) | Eklenmedi |
| Plugin içinde mutasyona uğratan endpoint | Eklenmedi |
| `session.prompt` / `session.promptAsync` çağrısı | Eklenmedi |
| Shell komutu çalıştırma | Eklenmedi |
| Per-session state dosyası (state per session) | Eklenmedi |
| Tool execution log'u | Eklenmedi |
| Prompt/session içeriği loglama | Eklenmedi |
| JSONL rotasyonu / eski dosya temizliği | Eklenmedi |

Tüm Hermes state export sistemi **salt-okunur** gözlem içindir. Hermes'in plugin içinde herhangi bir eylem gerçekleştirmesine izin vermez.

---

## 5. Test ve Derleme Sonuçları

| Test | Komut | Sonuç |
|------|-------|-------|
| Hermes State test suite | `bun test src/features/hermes-state/` | **PASS 29/29** (95 expect) — 130ms |
| TypeScript tip denetimi | `bun run typecheck` | **PASS** |
| Production build | `bun run build` | **PASS** |

### 5.1. Test Detayı

| Test Dosyası | Test Sayısı | Kapsam |
|-------------|------------|--------|
| `hermes-state-writer.test.ts` | 8 | state dizini, atomik yazma, JSONL append, sekret tespiti, truncate, toISO, hata toleransı |
| `hermes-background-state.test.ts` | 5 | task state yazma, lifecycle (pending→running→completed), error/cancelled, JSONL event emisyonu |
| `hermes-event-log.test.ts` | 6 | session.created/idle/error/deleted, sanitizasyon, multi-event append |
| `hermes-config-snapshot.test.ts` | 8 | config snapshot, team-mode hook count, provider listesi, MCP varlığı |

### 5.2. Manuel QA Notları

- Her test, geçici bir dizinde (`os.tmpdir()`) çalışır ve `afterEach` ile temizlenir — yan etki yoktur.
- Tüm I/O işlemleri best-effort'tur; hata durumunda `false` döner, throw etmez.
- Sanitizasyon testlerinde secret pattern'lerin doğru redakte edildiği, normal alanların korunduğu doğrulanmıştır.
- Background state debounce mekanizması `flush()` ile test edilebilir; 500ms bekleme olmadan anında yazma sağlanır.
