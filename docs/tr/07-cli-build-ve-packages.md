# Bölüm 7: CLI Komutları, Build Pipeline ve Packages

> **Hecateq OpenAgent** — Bu rehber, projenin CLI komut yapısını, build pipeline'ını, platform binary üretimini ve packages/ dizinindeki tüm paketleri detaylı şekilde açıklar.
>
> **Güncelleme:** 2026-05-20 | **Branch:** dev | **Sürüm:** v0.1.0-beta.8

---

## 7.1 CLI Komutlarına Genel Bakış

Hecateq OpenAgent, üç farklı binary giriş noktası sunar. Hepsi aynı Commander.js programını çalıştırır:

| Binary | Kullanım Amacı |
|--------|----------------|
| `hecateq-openagent` | **Birincil Hecateq giriş noktası.** Tüm komutları içerir. |
| `oh-my-opencode` | Upstream (oh-my-openagent) uyumluluk alias'ı. |
| `oh-my-openagent` | Upstream (oh-my-openagent) uyumluluk alias'ı. |

Her üç binary de `bin/oh-my-opencode.js` shim'i üzerinden `src/cli/index.ts` → `src/cli/cli-program.ts` içindeki `runCli()` fonksiyonuna yönlendirilir.

```bash
# Kullanım şekillerinin tümü aynı sonucu verir
hecateq-openagent doctor
oh-my-opencode doctor
oh-my-openagent doctor
```

### CLI Kaynak Dosyaları

```
src/cli/
├── index.ts                          # Giriş noktası → runCli()
├── cli-program.ts                    # Commander.js program (tüm komutlar)
├── types.ts                          # CLI tip tanımları
├── install.ts                        # Kurulum yönlendirici (TUI/CLI)
├── cli-installer.ts                  # Non-interactive installer
├── tui-installer.ts                  # Interactive installer (@clack/prompts)
├── tui-install-prompts.ts            # TUI prompt tanımları
├── install-validators.ts             # Girdi validasyonları
├── model-fallback.ts                 # Model fallback konfigürasyonu
├── provider-availability.ts          # Provider tespiti
├── fallback-chain-resolution.ts      # Fallback zincir çözümleme
├── provider-model-id-transform.ts    # Model ID dönüşümleri
├── openai-only-model-catalog.ts      | OpenAI-only model kataloğu
├── minimum-opencode-version.ts       | Minimum OpenCode versiyonu
├── refresh-model-capabilities.ts     | Model yetenek cache yenileme
├── get-local-version/                | Versiyon karşılaştırma
├── config-manager/                   | 20 config yardımcısı
├── doctor/                           | 4 kategorili sağlık kontrolü
│   ├── runner.ts                     | Paralel check çalıştırıcı
│   ├── formatter.ts                  | Çıktı formatlayıcı
│   ├── checks/                       | 15 check dosyası, 4 kategoride
│   └── types.ts                      | Doctor tipleri
├── run/                              | Session başlatıcı
│   ├── runner.ts                     | Ana orkestrasyon
│   ├── agent-resolver.ts             | Ajan çözümleyici
│   ├── session-resolver.ts           | Session oluşturma/devam
│   ├── event-handlers.ts             | Event işleme
│   └── poll-for-completion.ts        | Tamamlanma bekleme
├── mcp-oauth/                        | OAuth token yönetimi
├── boulder/                          | Boulder state denetçisi
│   ├── boulder.ts                    | State okuma
│   ├── formatter.ts                  | Çıktı formatlama
│   └── types.ts                      | Boulder tipleri
├── dashboard/                        | Dashboard istemci + sunucu
│   ├── dashboard.ts                  | İstemci sorgulama
│   ├── serve.ts                      | Sunucu başlatma
│   ├── formatter.ts                  | Çıktı formatlama
│   └── types.ts                      | Dashboard tipleri
└── hecateq/                          | Hecateq özel komutları
    ├── plan.ts                       | hecateq plan
    ├── run.ts                        | hecateq run
    ├── resume.ts                     | hecateq resume
    ├── status.ts                     | hecateq status
    ├── doctor.ts                     | hecateq doctor
    ├── shared.ts                     | Paylaşılan yardımcılar
    └── runtime-adapter.ts            | OpenCode session adapter
```

---

## 7.2 Temel Komutlar (Inherited)

### `install`

Interaktif veya non-interaktif kurulum sihirbazı. Provider seçimi, config oluşturma ve plugin kaydını yönetir.

```bash
# Interaktif kurulum
hecateq-openagent install

# Non-interaktif kurulum
hecateq-openagent install --non-interactive

# Uyumluluk alias'ı
hecateq-openagent setup
```

**Yaptıkları:**
1. Provider tespiti (Claude, OpenAI, Gemini vb.)
2. Model fallback zincirleri oluşturma
3. Plugin config dosyası yazma (`~/.config/opencode/oh-my-openagent.jsonc`)
4. OpenCode plugin kaydı
5. Platform binary doğrulama

### `run <message>`

Non-interaktif session başlatıcı. Verilen prompt'u çalıştırır ve todo'lar tamamlanıp arka plan görevi kalmadığında otomatik tamamlar.

```bash
# Basit kullanım
hecateq-openagent run "refactor the user service"

# Ajan ve model override ile
hecateq-openagent run --agent sisyphus --model claude-sonnet-4 "implement auth"

# Önceki session'a devam et
hecateq-openagent run --resume
```

**Seçenekler:**
| Seçenek | Tip | Varsayılan | Açıklama |
|---------|-----|------------|----------|
| `--agent <name>` | string | config | Varsayılan ajanı override et |
| `--resume` | boolean | false | Önceki session'a devam et |
| `--model <id>` | string | config | Model ID override et |

**Ajan çözümleme sırası:** flag → env (`OPENCODE_DEFAULT_AGENT`) → config (`default_run_agent`) → Sisyphus

### `doctor`

4 kategorili sağlık teşhisi.

```bash
# Standart kontrol
hecateq-openagent doctor

# Detaylı çıktı
hecateq-openagent doctor --verbose
```

**Kategoriler:**
| Kategori | Doğruladıkları |
|----------|----------------|
| **System** | Binary bulundu mu, OpenCode >= 1.0.150, plugin kayıtlı mı, versiyon eşleşiyor mu |
| **Config** | JSONC geçerliliği, Zod şeması, model override sözdizimi |
| **Tools** | AST-Grep, comment-checker, LSP sunucuları, GH CLI, MCP sunucuları |
| **Models** | Cache var mı, model çözümleme, agent/category override, provider kullanılabilirliği |

### `version`

Plugin versiyonunu yazdırır.

```bash
hecateq-openagent version
# Çıktı: 0.1.0-beta.8
```

### `get-local-version`

Yüklü versiyon ile npm'deki en son versiyonu karşılaştırır.

```bash
hecateq-openagent get-local-version
# Çıktı: Installed: 0.1.0-beta.8 | Latest: 0.1.0-beta.8
```

---

## 7.3 MCP OAuth Komutları

MCP OAuth 2.0 token yönetimi. PKCE (Proof Key for Code Exchange) ve DCR (Dynamic Client Registration) destekler.

```bash
# OAuth login
hecateq-openagent mcp-oauth login <server-url>

# OAuth logout
hecateq-openagent mcp-oauth logout

# Token durumu sorgula
hecateq-openagent mcp-oauth status
```

**Arka Plan:**
- `mcp-oauth login`: PKCE flow başlatır → kullanıcıyı browser'da yetkilendirme sayfasına yönlendirir → callback alır → token'ı kaydeder
- `mcp-oauth logout`: Kayıtlı token'ı temizler
- `mcp-oauth status`: Token geçerliliğini, expire bilgisini ve scope'ları gösterir

Bu komutlar, **Tier-3 MCP sistemi** (skill-embedded MCP'ler) için OAuth yetkilendirmesini yönetir.

---

## 7.4 Model Komutları

### `refresh-model-capabilities`

Model yetenek cache'ini models.dev API'sinden yeniler.

```bash
hecateq-openagent refresh-model-capabilities
```

**Ne yapar:**
1. `models.dev` API'sine sorgu gönderir
2. Yanıtı `src/shared/model-capabilities.generated.json` dosyasına yazar
3. Provider bazında model listesini, context window limitlerini ve capability flag'lerini günceller

**Otomatik yenileme:** Haftalık cron ile `.github/workflows/refresh-model-capabilities.yml` üzerinden çalışır.

---

## 7.5 Boulder Komutu

Boulder state inspector — `.omo/boulder-state/` dizinindeki iş takip state'ini formatlar ve gösterir.

```bash
# Boulder state görüntüle
hecateq-openagent boulder

# JSON formatında çıktı
hecateq-openagent boulder --json
```

**Boulder Sistemi:**
- **Amaç:** Session'lar arası kalıcı iş takibi
- **Depolama:** `.omo/boulder-state/` dizininde `work-state` ve `tasks` dosyaları
- **Bileşenler:**
  - `session.ts` — Session state yönetimi
  - `task.ts` — Task state yönetimi
  - `shared.ts` — Paylaşılan yardımcılar
  - `read-state.ts` — State okuma
  - `write-state.ts` — State yazma
- **Entegrasyon:** `todoContinuationEnforcer` hook'u ile boulder state session compaction sırasında korunur

---

## 7.6 Dashboard Komutu

Hecateq orchestration dashboard istemcisi ve kalıcı sunucusu.

```bash
# Kalıcı sunucu başlat
hecateq-openagent dashboard serve --port 3245

# Çalışan sunucuyu sorgula (başka terminalden)
hecateq-openagent dashboard
hecateq-openagent dashboard --json
hecateq-openagent dashboard --view dag --compact
```

**Görünümler:**
| Görünüm | Açıklama |
|---------|----------|
| `summary` (varsayılan) | Genel durum özeti |
| `dag` | Dependency graph görselleştirmesi |
| `spawn` | Auto-spawn durumu |
| `signal` | Event/sinyal akışı |

**Not:** Dashboard'un test kapsamı bu fork'ta tam yeşil değildir — beta olarak kabul edin.

### Dashboard Kaynak Dosyaları

```
src/cli/dashboard/
├── index.ts          # Dışa aktarımlar
├── dashboard.ts      # İstemci mantığı
├── serve.ts          # Express/Fastify sunucu
├── formatter.ts      # Çıktı formatlama
├── types.ts          # Tip tanımları
└── dashboard.test.ts # Testler
```

---

## 7.7 Hecateq Komutları (Experimental)

Bu komutlar `hecateq` alt komut isim alanı altında toplanmıştır ve Hecateq orchestration workflow'unu uygular. Kaynak kod: `src/cli/hecateq/`.

**Durum:** Experimental — API'ler değişebilir.

### `hecateq plan <prompt>`

Pre-execution pipeline'ının tamamını çalıştırır ama hiçbir şeyi **execute etmez**. Yapısal bir plan raporu üretir.

```bash
# Standart plan
hecateq-openagent hecateq plan "add email validation to user registration"

# JSON çıktı
hecateq-openagent hecateq plan --json "refactor database layer"
```

**Pipeline aşamaları:**
1. **Prompt Intake** — Intent sınıflandırma, risk seviyesi, görev boyutu, domain'ler
2. **Task Decomposition** — Prompt'u atomik task node'larına bölme
3. **Sensitive Task Blocking** — `.env`, secret'lar, key'ler hedefleyen task'ları bloklama
4. **Dependency Plan** — DAG oluşturma, cycle detection, batch planlama
5. **Agent Selection** — Task'ları yerel AGENTS.md registry'sinden ajanlarla eşleştirme
6. **Execution Plan** — Batch sıralama, yüksek-riskli task'lara contract/plan/verification stage'leri ekleme

**Seçenekler:**
| Seçenek | Tip | Varsayılan | Açıklama |
|---------|-----|------------|----------|
| `--json` | boolean | false | JSON çıktı |
| `--config` | string | — | Config override (JSON string) |
| `--agents-dir` | string | `~/.config/opencode/agents` | Yerel ajan registry |
| `--disabled-agents` | string[] | — | Devre dışı bırakılan ajanlar |
| `--project-dir` | string | `cwd` | Proje dizini |

**Çıkış kodları:**
- `0`: Plan tamam, her şey temiz
- `1`: Plan tamam ama sorunlar var (sensitive task bloklanmış, cycle tespit edilmiş)
- `2`: Yüksek riskli prompt tespit edildi, `--force` gerekli

**Kaynak:** `src/cli/hecateq/plan.ts` — `hecateqPlan()` fonksiyonu.

```typescript
// Kullanılan ana fonksiyonlar
import { analyzePrompt } from "../../features/hecateq-orchestration/prompt-intake"
import { decomposePrompt } from "../../features/hecateq-orchestration/task-decomposer"
import { buildDependencyPlan } from "../../features/hecateq-orchestration/dependency-planner"
import { buildExecutionPlan } from "../../features/hecateq-orchestration/execution-planner"
import { selectAgents } from "../../features/hecateq-orchestration/agent-selector"
```

### `hecateq run <prompt>`

Düşük riskli prompt'ları otomatik çalıştırır. Güvenlik-ilkeli: yüksek riskli veya destructive prompt'lar plan-only çıktı üretir.

```bash
# Düşük riskli — otomatik çalışır
hecateq-openagent hecateq run "fix typo in README"

# Yüksek riskli — plan-only, exit code 2
hecateq-openagent hecateq run "modify production database schema"

# Force ile yüksek riskli çalıştırma
hecateq-openagent hecateq run --force "modify production database schema"

# Dry run (plan + simülasyon)
hecateq-openagent hecateq run --dry-run "implement user service"
```

**Davranış:**
- `intake.riskLevel` analiz edilir
- `high` veya `destructive` ise ve `--force` yoksa → plan-only + exit code 2
- Düşük riskli ise → `runOrchestrationPipeline()` çağrılır
- Kalite gate'leri çalıştırılır (typecheck, lint, test, build, doctor)
- Sonuç raporu üretilir

**Seçenekler:**
| Seçenek | Tip | Varsayılan | Açıklama |
|---------|-----|------------|----------|
| `--force` | boolean | false | Yüksek riskli bloğu aş |
| `--dry-run` | boolean | false | Plan + simulate, gerçek çalıştırma yok |
| `--json` | boolean | false | JSON çıktı |
| `--config` | string | — | Config override |
| `--session-id` | string | — | Varolan session'a bağlan |
| `--port` | number | — | OpenCode port'u |
| `--attach` | string | — | Attach modu |
| `--agents-dir` | string | `~/.config/opencode/agents` | Agent registry |
| `--disabled-agents` | string[] | — | Devre dışı ajanlar |
| `--project-dir` | string | `cwd` | Proje dizini |

**Kaynak:** `src/cli/hecateq/run.ts` — `hecateqRun()` fonksiyonu.

### `hecateq resume [--session-id <id>]`

Tamamlanmamış orchestration session'larını kurtarır.

```bash
# Kullanılabilir session'ları listele
hecateq-openagent hecateq resume

# Belirli bir session'ı kurtar
hecateq-openagent hecateq resume --session-id ses_abc123

# Dry-run resume (ne olacağını göster)
hecateq-openagent hecateq resume --session-id ses_abc123 --dry-run
```

**Kurtarma davranışı:**
1. `.opencode/orchestration/` dizinini tarar
2. Session ID verilmemişse → tüm session'ları listeler
3. `in_progress` task'ları `failed` olarak işaretler (kesinti durumunda)
4. Bağımlılığı failed olan `pending` task'ları `blocked` yapar
5. Eğer bekleyen task varsa, çalıştırmaya devam eder

**Çıktı:**
```
=== Hecateq Resume: Session ses_abc123 ===
Phase: execution
Tasks: 12 total
  3 in_progress → paused (marked failed)
  2 pending with failed deps → blocked
  5 total recovered
Can continue: Yes
```

**Kaynak:** `src/cli/hecateq/resume.ts` — `hecateqResume()` fonksiyonu.

### `hecateq status`

Geçerli proje dizini için orchestration durumunu özetler.

```bash
hecateq-openagent hecateq status
hecateq-openagent hecateq status --json
```

**Çıktı bölümleri:**
- **Orchestration** — Session sayısı, son session'lar (phase/prompt/status)
- **Memory** — Initialize edilmiş mi, dosya sayısı, dosya isimleri
- **Contracts** — Dizin var mı, dosya sayısı
- **Task Graphs** — Dizin var mı, dosya sayısı

**Örnek çıktı:**
```
=== Hecateq Status ===

Orchestration:
  Sessions: 5
  Recent sessions:
    ses_abc123: [completed] implement user auth
    ses_def456: [execution] fix race condition

Memory:
  Initialized: Yes
  Files: 8
    active-context.md, progress.md, tasks.md, decisions.md, ...

Contracts:
  Directory: Yes
  Files: 3

Task Graphs:
  Directory: Yes
  Files: 2
```

**Kaynak:** `src/cli/hecateq/status.ts` — `hecateqStatus()` fonksiyonu.

### `hecateq doctor`

11 kategoride Hecateq-specific workflow teşhisi çalıştırır.

```bash
# Standart teşhis
hecateq-openagent hecateq doctor

# Detaylı çıktı
hecateq-openagent hecateq doctor --verbose

# JSON formatında
hecateq-openagent hecateq doctor --json
```

---

## 7.8 Hecateq Doctor — 11 Kategori

| # | Kategori | Doğruladıkları |
|---|----------|----------------|
| 1 | **Agent Registration** | OpenCode agent config'inde Hecateq agent kayıtları |
| 2 | **Configuration** | Hecateq config bloğu geçerliliği |
| 3 | **Orchestration** | `.opencode/orchestration/` dizini ve session dosyaları |
| 4 | **Safety Hooks** | Zorunlu hook'ların varlığı (`hecateq-memory-bootstrap`, `hecateq-project-context-injector`) |
| 5 | **Handoff State** | Handoff dosyalarının varlığı ve parse edilebilirliği |
| 6 | **Role Policy** | Handoff rol politikası tutarlılığı |
| 7 | **Project Memory** | Memory dizini, manifest, dosya kalitesi (boş dosya kontrolü) |
| 8 | **Memory Manifest** | Manifest versiyon güncelliği, pointer geçerliliği |
| 9 | **Custom Agents** | `.opencode/agents/` içindeki özel ajan tanımları |
| 10 | **Agent Index** | Agent index'in güncelliği (stale olmaması) |
| 11 | **Artifacts** | Artifact dizin yapısı |

**Detaylı kategori açıklamaları:**

**1. Agent Registration (`collectHecateqRegistrationIssues`)**
- Hecateq agent'larının OpenCode agent config'inde kayıtlı olup olmadığı
- Agent isim çakışmaları
- Geçersiz agent mode'ları

**2. Configuration (`collectHecateqConfigIssues`)**
- `hecateq` config bloğu JSON geçerliliği
- Zorunlu alanların varlığı
- Config sürüm uyumluluğu

**3. Orchestration (`collectOrchestrationIssues`)**
- `.opencode/orchestration/` dizini kontrolü
- Session dosyalarının bütünlüğü
- Task graph dosyalarının geçerliliği

**4. Safety Hooks (`collectSafetyHookIssues`)**
- `hecateq-memory-bootstrap` hook'u kayıtlı mı?
- `hecateq-project-context-injector` hook'u kayıtlı mı?
- Hook'ların doğru tier'da olduğu kontrolü

**5. Handoff State (`collectHandoffStateIssues`)**
- `.omo/handoff/` veya `.opencode/state/handoff/` dosya kontrolü
- Handoff dosyaları parse edilebiliyor mu?
- Stale handoff dosyaları

**6. Role Policy (`collectHandoffRolePolicyIssues`)**
- Agent rol tanımları tutarlı mı?
- İzin verilmeyen rol geçişleri var mı?
- Handoff formatı geçerli mi?

**7. Project Memory (`collectProjectRootMemoryIssues` + `collectMemoryQualityIssues`)**
- Memory dizini `.opencode/state/memory/` var mı?
- Zorunlu dosyalar mevcut mu (active-context.md, progress.md, decisions.md vb.)
- Boş veya placeholders dosyalar var mı?

**8. Memory Manifest (`collectMemoryManifestIssues` + `collectMemoryPointerIssues` + `collectContinuationFreshnessIssues`)**
- `.memory-manifest.json` var mı ve geçerli mi?
- Pointer doğru memory dizinini işaret ediyor mu?
- Continuation özetleri güncel mi?

**9. Custom Agents (`collectCustomAgentIssues`)**
- `.opencode/agents/` veya `.agents/` dizininde geçerli AGENTS.md dosyaları
- Agent isimleri geçerli mi?
- Yinelenen agent tanımları

**10. Agent Index (`collectAgentIndexIssues`)**
- Agent index dosyası var mı?
- Index güncel mi (stale değil)?
- Runtime agent'lar index'te mevcut mu?

**11. Artifacts (`collectProjectArtifactIssues`)**
- Artifact dizinleri mevcut mu?
- Dizin yapısı beklendiği gibi mi?
- Gereksiz/yetimsiz dosyalar var mı?

**Kaynak:** `src/cli/hecateq/doctor.ts` — `hecateqDoctor()` fonksiyonu.

---

## 7.9 Build Pipeline

Hecateq OpenAgent, `bun` tabanlı bir build pipeline kullanır. Tüm build script'leri `package.json` altında tanımlanmıştır.

### Build Script'leri

| Script | Komut | Amaç | Çıktı |
|--------|-------|------|-------|
| `build` | `bun run build` | Ana build — ESM bundle + declaration + schema | `dist/index.js`, `dist/index.d.ts`, `dist/oh-my-opencode.schema.json` |
| `build:lsp-tools-mcp` | `bun run build:lsp-tools-mcp` | LSP MCP alt modülünü build et | `packages/lsp-tools-mcp/dist/` |
| `build:ast-grep-mcp` | `bun run build:ast-grep-mcp` | AST-grep MCP paketini build et | `packages/ast-grep-mcp/dist/` |
| `build:node-require-shim` | `bun run build:node-require-shim` | Node.js require shim'i oluştur | (patch) |
| `build:all` | `bun run build:all` | Build + 11 platform binary | Her şey |
| `build:binaries` | `bun run build:binaries` | Platform binary'leri üret | `bin/` altında platform dosyaları |
| `build:schema` | `bun run build:schema` | JSON Schema yeniden oluştur | `assets/hecateq-openagent.schema.json` |
| `build:model-capabilities` | `bun run build:model-capabilities` | Model cache yenile | `src/generated/model-capabilities.generated.json` |
| `generate:runtime-docs` | `bun run generate:runtime-docs` | Runtime dokümantasyon oluştur | `docs/generated/` |
| `check:runtime-docs` | `bun run check:runtime-docs` | Runtime dok. güncel mi kontrol et | Git diff exit code |
| `clean` | `bun run clean` | Build artifacts temizle | `rm -rf dist` |
| `typecheck` | `bun run typecheck` | TypeScript type kontrolü | tsgo --noEmit |
| `typecheck:packages` | `bun run typecheck:packages` | Tüm packages/ type kontrolü | 9 paket ayrı ayrı |
| `test` | `bun test` | Test suite | Tüm testler |
| `prepublishOnly` | `bun run prepublishOnly` | Yayın öncesi hazırlık | clean + build:lsp-tools-mcp + build |

### Build Detayları

```bash
# Ana build pipeline (bun build + tsc --emitDeclarationOnly)
bun run build

# Adım adım:
# 1. build:ast-grep-mcp — AST-grep MCP'yi build et
# 2. bun build src/index.ts --outdir dist --target bun --format esm --external @ast-grep/napi --external zod
# 3. build:node-require-shim
# 4. tsc --emitDeclarationOnly (sadece .d.ts üretir)
# 5. bun build src/cli/index.ts --outdir dist/cli (CLI bundle)
# 6. build:schema

# External paketler:
# - @ast-grep/napi (native bağımlılık)
# - zod (peerDependency)
```

---

## 7.10 Platform Binary Üretimi

### Binary Listesi (11 adet)

| Binary | Platform | Mimari | Varyant |
|--------|----------|--------|---------|
| `hecateq-openagent-linux-x64` | Linux | x86_64 | AVX2 |
| `hecateq-openagent-linux-x64-baseline` | Linux | x86_64 | Baseline |
| `hecateq-openagent-windows-x64` | Windows | x86_64 | AVX2 |
| `hecateq-openagent-windows-x64-baseline` | Windows | x86_64 | Baseline |
| `oh-my-opencode-darwin-arm64` | macOS (Apple Silicon) | arm64 | — |
| `oh-my-opencode-darwin-x64` | macOS (Intel) | x86_64 | AVX2 |
| `oh-my-opencode-darwin-x64-baseline` | macOS (Intel) | x86_64 | Baseline |
| `oh-my-opencode-linux-arm64` | Linux | arm64 | — |
| `oh-my-opencode-linux-arm64-musl` | Linux (musl) | arm64 | — |
| `oh-my-opencode-linux-x64` | Linux | x86_64 | AVX2 |
| `oh-my-opencode-linux-x64-baseline` | Linux | x86_64 | Baseline |
| `oh-my-opencode-linux-x64-musl` | Linux (musl) | x86_64 | AVX2 |
| `oh-my-opencode-linux-x64-musl-baseline` | Linux (musl) | x86_64 | Baseline |
| `oh-my-opencode-windows-x64` | Windows | x86_64 | AVX2 |
| `oh-my-opencode-windows-x64-baseline` | Windows | x86_64 | Baseline |

### Binary Üretim Detayları

```bash
# Tüm binary'leri üret
bun run build:binaries

# Script: script/build-binaries.ts
# Metot: bun compile (Bun'ın native derleyicisi)
```

**Önemli notlar:**
- **AVX2 tespiti:** Runtime'da CPU'nun AVX2 destekleyip desteklemediği `detect-libc` ile kontrol edilir. AVX2 yoksa baseline varyantına fallback yapılır.
- **libc tespiti:** Linux'ta glibc vs musl ayrımı runtime'da tespit edilir.
- **Windows:** `windows-latest` runner'da build edilir (Bun cross-compile segfault'larını önlemek için). Cross-compile değil, native build.
- **macOS (darwin):** Hem Apple Silicon (arm64) hem Intel (x64) binary'leri üretilir.
- **Linux musl:** Alpine Linux gibi musl-based sistemler için ayrı binary'ler.

### npm Platform Package Dağıtımı

```jsonc
// package.json — optionalDependencies
{
  "optionalDependencies": {
    "@hecateq/hecateq-openagent-linux-x64": "0.1.0-beta.8",
    "@hecateq/hecateq-openagent-linux-x64-baseline": "0.1.0-beta.8",
    "@hecateq/hecateq-openagent-windows-x64": "0.1.0-beta.8",
    "@hecateq/hecateq-openagent-windows-x64-baseline": "0.1.0-beta.8"
  }
}
```

Platform binary'leri `optionalDependencies` olarak dağıtılır. Kullanıcının sistemine uygun olanı npm otomatik seçer. Ayrı upstream binary'leri de var (`oh-my-opencode-*`).

---

## 7.11 Packages/ Detaylı

Proje 12 core paket + 1 web paketi içerir. Tüm paketler `packages/` dizininde yer alır.

### Core Paketler (12)

| # | Paket | Yol | Amaç | Önemli Dosyalar |
|---|-------|-----|------|-----------------|
| 1 | **hashline-core** | `packages/hashline-core/` | Content-aware metin düzenleme (65+ dosya) | `hash-computation.ts`, `edit-operations.ts`, `diff-utils.ts`, `autocorrect-replacement-lines.ts`, `file-text-canonicalization.ts` |
| 2 | **comment-checker-core** | `packages/comment-checker-core/` | AI yorumu tespiti | binary runner, parser |
| 3 | **ast-grep-core** | `packages/ast-grep-core/` | AST pattern eşleştirme | `types.ts`, `pattern-hints.ts`, `runner-core.ts` |
| 4 | **ast-grep-mcp** | `packages/ast-grep-mcp/` | AST MCP sunucusu | MCP server implementation |
| 5 | **lsp-tools-mcp** | `packages/lsp-tools-mcp/` | LSP implementasyonu (npm submodule) | Biome LSP entegrasyonu |
| 6 | **boulder-state** | `packages/boulder-state/` | İş takip state makinesi | `session.ts`, `task.ts`, `shared.ts`, `read-state.ts`, `write-state.ts` |
| 7 | **agents-md-core** | `packages/agents-md-core/` | Agent doküman işleme | `injector.ts`, `formatter.ts`, `finder.ts`, `types.ts` |
| 8 | **utils** | `packages/utils/` | Paylaşılan yardımcılar | `deep-merge.ts`, `snake-case.ts`, `frontmatter.ts`, `file-utils.ts` |
| 9 | **rules-engine** | `packages/rules-engine/` | Kural keşfi + eşleştirme | `rule-discovery.ts`, `rule-matching.ts` |
| 10 | **model-core** | `packages/model-core/` | Model çözümleme pipeline'ı | `model-resolution.ts`, `provider-cache.ts` |
| 11 | **hashline-core** | `packages/hashline-core/` | LINE#ID hash sistemi | (yukarıda) |
| 12 | **lsp-tools-mcp** | `packages/lsp-tools-mcp/` | LSP araçları | |

### Paket Detayları

#### `packages/hashline-core/`

Content-aware metin düzenleme sistemi. Her `Read` çıktısına `LINE#ID` content hash'leri ekler ve `hashline_edit` aracı hash uyuşmazlığında değişikliği reddeder.

```typescript
// hash-computation.ts — Her satır için hash hesaplama
// Karakter seti: ZPMQVRWSNKTXJBYH (16 karakter)
// edit-operations.ts — Hash doğrulamalı düzenleme
// diff-utils.ts — Diff hesaplama ve uygulama
```

#### `packages/comment-checker-core/`

AI-generated kod yorumlarını tespit eder. `@code-yeongyu/comment-checker` binary'sini çalıştırır.

#### `packages/ast-grep-core/`

AST-grep pattern eşleştirme için tip tanımları, pattern hints ve runner core içerir. Injectable spawn desteği ile test edilebilir.

#### `packages/ast-grep-mcp/`

AST-grep fonksiyonelliğini MCP (Model Context Protocol) sunucusu olarak sunar. `ast_grep_search` ve `ast_grep_replace` tool'ları bu MCP üzerinden sağlanır.

#### `packages/lsp-tools-mcp/`

LSP (Language Server Protocol) araçlarını MCP sunucusu olarak sunar. Biome LSP ile entegredir. npm submodule olarak build edilir (`npm ci && npm run build`).

**Tool'lar:**
- `lsp_goto_definition`
- `lsp_find_references`
- `lsp_symbols`
- `lsp_diagnostics`
- `lsp_prepare_rename`
- `lsp_rename`

#### `packages/boulder-state/`

Session'lar arası kalıcı iş takibi. Split storage mimarisi kullanır.

```
boulder-state/
├── src/
│   ├── session.ts       # Session state yönetimi
│   ├── task.ts          # Task state yönetimi
│   ├── shared.ts        # Paylaşılan yardımcılar
│   ├── read-state.ts    # State okuma
│   └── write-state.ts   # State yazma
├── package.json
└── tsconfig.json
```

#### `packages/agents-md-core/`

AGENTS.md dosyalarının işlenmesi, inject edilmesi, formatlanması ve bulunması.

```
agents-md-core/
├── src/
│   ├── injector.ts      # AGENTS.md inject etme
│   ├── formatter.ts     # Formatlama
│   ├── finder.ts        # Dosya bulma
│   └── types.ts         # Tip tanımları
├── package.json
└── tsconfig.json
```

#### `packages/utils/`

Proje genelinde paylaşılan utility fonksiyonları:

```typescript
// Öne çıkanlar
deep-merge.ts     // Derin nesne birleştirme (prototype-pollution safe)
snake-case.ts     // snake_case dönüşümü
frontmatter.ts    // YAML frontmatter parse
file-utils.ts     // Dosya işlemleri
```

#### `packages/rules-engine/`

Proje kurallarının keşfi ve eşleştirilmesi. `rules-injector` hook'u tarafından kullanılır.

#### `packages/model-core/`

Model çözümleme pipeline'ı. `ProviderCache` dependency injection ile model sağlayıcılarını yönetir.

---

## 7.12 Web Package

**Yol:** `packages/web/`

**Teknoloji:** Next.js 15 + Cloudflare Workers (OpenNext.js)

**Bağımlılık:** Kendi `bun.lock` dosyası var (monorepo'dan bağımsız).

**Build adımları:**

```bash
# CI'da çalıştırılan adımlar
bun run format-check
bun run lint
bun run type-check
bun run next build        # Next.js build
bun run opennextjs-cloudflare build  # Cloudflare Workers build
```

**CI/CD:**
- `web-ci.yml` — push/PR'de format/lint/type-check/build
- `web-deploy.yml` — Cloudflare Workers deploy (master/dev push'ta)
  - Gereksinimler: `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` secret'ları
  - `cloudflare/wrangler-action@v3` kullanır

**Not:** `docs/` ve `packages/web/` değişiklikleri web CI'ı tetikler.

---

## 7.13 Schema Generation

JSON Schema, Zod v4 şema tanımlarından otomatik oluşturulur.

```bash
# Schema oluştur
bun run build:schema
# Çalıştırılan: bun run script/build-schema.ts

# Çıktı:
# - assets/hecateq-openagent.schema.json (Hecateq fork)
# - assets/oh-my-opencode.schema.json (upstream)
```

**Schema URL'leri:**

```jsonc
// Kullanıcı config dosyasında
{
  "$schema": "https://raw.githubusercontent.com/hecateq/hecateq-openagent/main/assets/hecateq-openagent.schema.json"
}
```

**Export:** `package.json` içinde:

```jsonc
{
  "exports": {
    "./schema.json": "./dist/oh-my-opencode.schema.json",
    "./hecateq-schema.json": "./dist/hecateq-openagent.schema.json"
  }
}
```

**CI entegrasyonu:** CI workflow'u master branch'e push'ta schema değişikliklerini otomatik commit eder (`ci.yml` → auto-commit schema changes).

---

## 7.14 Özet Tablo

| Bileşen | Konum | Amaç |
|---------|-------|------|
| CLI Komutları | `src/cli/` | Commander.js CLI (3 binary entry) |
| Base Komutlar | `src/cli/cli-program.ts` | install, run, doctor, version |
| Hecateq Komutlar | `src/cli/hecateq/` | plan, run, resume, status, doctor |
| Build Pipeline | `package.json` scripts | build, build:all, build:schema, vb. |
| Platform Binary | `script/build-binaries.ts` | 11 platform binary (bun compile) |
| Core Packages | `packages/*/` | 12 ayrı npm paketi |
| Web Package | `packages/web/` | Next.js 15 + Cloudflare Workers |
| Schema | `assets/hecateq-openagent.schema.json` | Zod v4 → JSON Schema |
