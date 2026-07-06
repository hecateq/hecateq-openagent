# 01 — Mimari Genel Bakış

> **Hecateq OpenAgent — OpenCode Plugin Mimarisi**
> Son güncelleme: 2026-06-30 | Fork: Hecateq | Temel: oh-my-openagent v4.2.0

---

## İçindekiler

1. [Proje Tanıtımı](#proje-tanıtımı)
2. [Teknoloji Stack](#teknoloji-stack)
3. [Repository İstatistikleri](#repository-i̇statistikleri)
4. [Dizin Yapısı](#dizin-yapısı)
5. [Plugin Giriş Noktası](#plugin-giriş-noktası)
6. [7 Adımlı Başlatma Akışı](#7-adımlı-başlatma-akışı)
7. [13 OpenCode Hook Handler](#13-opencode-hook-handler)
8. [6 Aşamalı Config Pipeline](#6-aşamalı-config-pipeline)
9. [4 Manager](#4-manager)
10. [Kanonik Ajan Sıralaması](#kanonik-ajan-sıralaması)
11. [Mimari Sabitler](#mimari-sabitler)

---

## Proje Tanıtımı

**Hecateq OpenAgent**, [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) projesinin Hecateq iş akışı motoru için özelleştirilmiş bir **fork**'udur. OpenCode IDE/terminal ortamına takılan bir plugin olarak çalışır ve 12 uzman AI ajanı, 52+ yaşam döngüsü hook'u, LSP/AST araçları ve paralel takım orkestrasyonu sağlar.

### Hecateq OpenAgent ve oh-my-openagent Arasındaki Farklar

| Özellik | oh-my-openagent (upstream) | Hecateq OpenAgent (fork) |
|----------|---------------------------|-------------------------|
| **Ajan sayısı** | 11 | 12 (`hecateq-orchestrator` eklendi) |
| **Orkestrasyon** | Sisyphus merkezli | Hecateq God + Sisyphus çift katmanlı |
| **Routing** | Varsayılan ajan sıralaması | Custom-agent-first (özel ajanlar öncelikli) |
| **Hafıza sistemi** | Yok | Dosya tabanlı memory (`memory.json`) |
| **Config bloğu** | Standart alanlar | `hecateq` bloğu (9 alt-config) |
| **CLI komutları** | `install`, `run`, `doctor` | `hecateq plan`, `hecateq run`, `hecateq resume`, `hecateq status`, `hecateq doctor` |
| **Handoff sistemi** | Yok | Yapılandırılmış handoff blokları + rol politikası |
| **Bağımlılık grafiği** | Yok | Task DAG + cycle detection |
| **Quality gate** | Yok | typecheck/lint/test/build/doctor pipeline'ı |
| **Tamir döngüsü** | Yok | Otomatik hata düzeltme (max 2 deneme) |
| **Git checkpoint** | Yok | Pre-task git state yönetimi |
| **Otomatik spawn** | Yok | Yapılandırılabilir subagent spawning |
| **Paket ismi** | `oh-my-opencode` / `oh-my-openagent` | `@hecateq/hecateq-openagent` |
| **Telemetry** | Varsayılan açık | Varsayılan kapalı |
| **Auto-update** | Upstream kanalı | Hecateq dağıtım kanalı |

### Ne İşe Yarar?

Hecateq OpenAgent, OpenCode'a aşağıdaki yetenekleri ekler:

- **12 uzman AI ajanı**: planlama, implementasyon, araştırma, kod inceleme ve orkestrasyon için
- **52+ yaşam döngüsü hook'u**: Session, ToolGuard, Transform, Continuation ve Skill katmanlarında
- **20-39 yapılandırılabilir araç**: LSP, AST-grep, grep/glob, background task, session yönetimi
- **3 katmanlı MCP sistemi**: Built-in MCP'ler, Claude Code `.mcp.json` ve skill-embedded MCP'ler
- **Takım Modu**: Paralel multi-agent koordinasyon (varsayılan kapalı)
- **Hecateq Pipeline**: prompt intake → task decomposition → dependency graph → agent selection → execution → quality gates → repair → report

---

## Teknoloji Stack

| Bileşen | Değer |
|---------|-------|
| **Runtime** | Bun 1.3.12 (yalnızca Bun — npm/yarn/pnpm yasak) |
| **Dil** | TypeScript strict mode, ESNext |
| **ModuleResolution** | bundler |
| **Type definitions** | `bun-types` (`@types/node` kullanılmaz) |
| **Schema doğrulama** | Zod v4 |
| **Config formatı** | JSONC (yorum satırları + trailing comma destekler) |
| **Test framework** | Bun test (`bun:test`), co-located `*.test.ts` |
| **Test stili** | given/when/then (Arrange-Act-Assert yasak) |
| **Build** | `bun build` (ESM bundle) + `tsc --emitDeclarationOnly` |
| **Type checker** | `tsgo --noEmit` (`tsc` kullanılmaz) |
| **Linter** | Yok (TypeScript strict mode yeterli) |
| **Dual package** | `oh-my-opencode` + `oh-my-openagent` eş zamanlı publish |
| **CI** | GitHub Actions (ci.yml, publish.yml, web-ci.yml) |
| **Web** | packages/web: Next.js 15 + Cloudflare Workers |

### Import Kuralları

```typescript
// DOĞRU — modül içinde relative import
import { log } from "./shared"

// DOĞRU — modüller arası barrel import
import { createLogger } from "../../shared"

// YANLIŞ — path alias kullanımı (src/ içinde yasak)
import { log } from "@/shared"  // SADECE packages/web/ için geçerli
```

---

## Repository İstatistikleri

| Metrik | Değer |
|--------|-------|
| **Toplam TypeScript dosyası** | ~2167 |
| **Toplam LOC** | ~313k |
| **Barrel index.ts dosyası** | 120 adet |
| **src/ içindeki dosyalar** | ~1314 (kaynak) + 730 (test) |
| **Agent sayısı** | 12 |
| **Hook sayısı** | 54 (base) / 61 (team-mode ile) |
| **Tool sayısı** | 20 (always-on) / 39 (full) |
| **Feature modülü** | 20 adet |
| **MCP sunucusu** | 5 built-in (3 remote + 2 local stdio) |
| **Schema dosyası** | 30 adet (Zod v4) |
| **Utility dosyası** | 297 (179 non-test) |
| **CLI dosyası** | 158 |
| **Platform binary** | 11 (darwin/linux/windows) |

### Kaynak Dağılımı (src/ altı)

| Dizin | Dosya sayısı | LOC | Açıklama |
|-------|-------------|-----|----------|
| `agents/` | 104 | ~20k | 12 ajan fabrikası + dynamic prompt builder |
| `hooks/` | 596 | ~78k | 52+ lifecycle hook (57 dizin) |
| `tools/` | 317 | ~45k | 13 native tool dizini |
| `features/` | 404 | ~71k | 20 feature modülü |
| `shared/` | 297 | ~33k | Cross-cutting yardımcılar |
| `cli/` | 158 | ~18k | Commander.js CLI |
| `plugin/` | 58 | ~12k | Hook handler'lar + kompozisyon |
| `config/` | 41 | ~2k | 30 Zod v4 şema dosyası |
| `plugin-handlers/` | 27 | ~6k | 6 aşamalı config pipeline'ı |
| `openclaw/` | 26 | ~3k | Discord/Telegram/HTTP entegrasyonu |
| `mcp/` | 8 | ~260 | 5 built-in MCP |
| `testing/` | 3 | ~225 | Test yardımcıları |

---

## Dizin Yapısı

```
oh-my-opencode/
├── src/                           # Ana kaynak kodu
│   ├── index.ts                   # Plugin giriş noktası (18 satır)
│   ├── plugin-config.ts           # JSONC multi-level config (Zod v4)
│   ├── plugin-interface.ts        # 11 OpenCode hook handler'ı
│   ├── create-managers.ts         # 4 manager fabrikası
│   ├── create-tools.ts            # ToolRegistry kompozisyonu
│   ├── create-hooks.ts            # 5-tier hook kompozisyonu
│   ├── agents/                    # 12 ajan tanımı
│   │   ├── hecateq-orchestrator/  # Hecateq God (fork eklentisi)
│   │   ├── sisyphus.ts            # Ana orkestratör
│   │   ├── hephaestus/            # Implementasyon ajanı
│   │   ├── oracle.ts              # Read-only danışman
│   │   ├── librarian.ts           # Dış kaynak araştırmacı
│   │   ├── explore.ts             # Kod tabanı keşifçisi
│   │   ├── atlas/                 # Todo orkestratörü
│   │   ├── prometheus/            # Stratejik planlayıcı
│   │   ├── metis.ts               # Ön-planlama danışmanı
│   │   ├── momus.ts               # Plan incelemecisi
│   │   ├── multimodal-looker.ts   # Görsel/PDF analizi
│   │   └── sisyphus-junior/       # Hafif executor
│   ├── hooks/                     # ~52 lifecycle hook
│   ├── tools/                     # 13 native tool dizini
│   ├── features/                  # 20 feature modülü
│   ├── shared/                    # Cross-cutting yardımcılar
│   ├── config/                    # 30 Zod v4 şema dosyası
│   ├── cli/                       # Commander.js CLI
│   ├── mcp/                       # 5 built-in MCP
│   ├── plugin/                    # Hook handler'lar + kompozisyon
│   ├── plugin-handlers/           # 6 aşamalı config pipeline'ı
│   ├── openclaw/                  # Discord/Telegram/HTTP entegrasyonu
│   ├── generated/                 # model-capabilities.generated.json
│   └── testing/                   # Test yardımcıları
├── packages/                      # 11 platform binary + 2 MCP + 7 Core + web
│   ├── utils/                     # Paylaşılan yardımcılar
│   ├── model-core/                # Model resolution pipeline
│   ├── rules-engine/              # Rule discovery + matching
│   ├── agents-md-core/            # AGENTS.md walk-up discovery
│   ├── ast-grep-core/             # AST-grep types + runner
│   ├── comment-checker-core/      # apply-patch parser
│   ├── boulder-state/             # Work tracking state machine
│   └── web/                       # Marketing sitesi (Next.js 15)
├── bin/                           # Platform-detection JS shim
├── script/                        # Build/publish otomasyonu
├── docs/                          # Kullanıcı dokümantasyonu
├── assets/                        # JSON Schema (Zod'dan otomatik)
├── signatures/                    # CLA imza kaydı
├── postinstall.mjs                # Platform binary + OpenCode doğrulama
├── test-setup.ts                  # Bun test preload
├── .opencode/                     # Proje-scope skill + command
├── .agents/                       # Mirror (migrasyon hedefi)
├── .omo/                          # AI agent workspace
└── .local-ignore/                 # Dev-only test fixture + PR worktree
```

---

## Plugin Giriş Noktası

Plugin, OpenCode tarafından yüklendiğinde `src/index.ts` üzerinden başlatılır. Bu dosya yalnızca 18 satırlık bir wrapper'dır:

```typescript
// src/index.ts (özet)
import { createPluginModule } from "./testing/create-plugin-module"
export default createPluginModule()
```

`createPluginModule()` (`src/testing/create-plugin-module.ts:81-189`, 190 satır) 7 adımlı başlatma akışını yürütür ve şu yapıyı döndürür:

```typescript
{
  id: "oh-my-openagent",
  server: async (input, options) => Hooks
}
```

Bu `server` fonksiyonu, OpenCode'un plugin lifecycle'ı boyunca çağırdığı 13 hook handler'ını içeren `PluginInterface` nesnesini döndürür.

---

## 7 Adımlı Başlatma Akışı

Plugin, OpenCode host tarafından yüklendiğinde sırasıyla şu adımları izler:

| Adım | Fonksiyon | Dosya:Satır | Amaç |
|------|-----------|-------------|------|
| **1** | `installAgentSortShim()` | `src/testing/create-plugin-module.ts:84` → `src/shared/agent-sort-shim.ts:96` | `Array.prototype.{toSorted,sort}` yaması ile kanonik ajan sıralamasını garanti altına alır |
| **2** | `initConfigContext()` | `src/testing/create-plugin-module.ts:85` → `src/cli/config-manager/config-context.ts` | opencode-vs-openagent config layout tespiti |
| **3** | `detectExternalSkillPlugin()` | `src/testing/create-plugin-module.ts:92-95` | Çakışan plugin varsa uyarır |
| **4** | `injectServerAuthIntoClient()` | `src/testing/create-plugin-module.ts:97` → `src/shared/opencode-server-auth.ts` | Auth header'larını shared SDK client'ına enjekte eder |
| **5** | `loadPluginConfig()` | `src/testing/create-plugin-module.ts:99-101` | Proje + kullanıcı JSONC dosyalarını gezer → Zod `safeParse` → migrate eder, ajan sıralamasını ayarlar, i18n başlatır |
| **6a** | `initializeOpenClaw()` | `src/testing/create-plugin-module.ts:103-105` | OpenClaw config varsa reply-listener daemon başlatır (Discord/Telegram/HTTP) |
| **6b** | `checkTeamModeDependencies()` | `src/testing/create-plugin-module.ts:106-121` | `team_mode.enabled` ise git ve tmux varlığını doğrular, `~/.omo/teams/` dizinlerini oluşturur |
| **7** | `createManagers()` | `src/testing/create-plugin-module.ts:137-173` | 4 manager başlatır → tool registry derler → 5-tier hook oluşturur → PluginInterface assemble eder |

### Adım 7 Detayı — Bileşen Fabrikaları

`createManagers()` → `createTools()` → `createHooks()` → `createPluginInterface()`

Bu dört fabrika sırasıyla:

```typescript
// src/testing/create-plugin-module.ts:137-173 (özet)
const managers = createManagers(ctx, pluginConfig)
const tools = createTools(ctx, pluginConfig, managers)
const hooks = createHooks(ctx, managers, tools, pluginConfig)
const pluginInterface = createPluginInterface({
  ctx,
  pluginConfig,
  firstMessageVariantGate,
  managers,
  hooks,
  tools,
})
```

Ardından 2 compaction handler'ı eklenir (satır 175-181):

```typescript
pluginInterface["experimental.session.compacting"] = ...
pluginInterface["experimental.compaction.autocontinue"] = ...
```

---

## 13 OpenCode Hook Handler

Plugin, OpenCode'un plugin API'sine 13 hook handler'ı kaydeder. 11'i `src/plugin-interface.ts:36-91` içinde, 2'si `src/testing/create-plugin-module.ts:175-181` içinde bağlanır.

| Handler | OpenCode Hook Adı | Dosya | Amaç |
|---------|-------------------|-------|------|
| `config` | `config` | `src/plugin-interface.ts:68` | 6 aşamalı config pipeline'ı: provider → plugin-components → agents → tools → MCPs → commands |
| `tool` | `tool` | `src/plugin-interface.ts:36` | 20-39 config-gated tool tanımı |
| `chat.message` | `chat.message` | `src/plugin-interface.ts:52-57` | İlk mesaj varyantı, session kurulumu, keyword/agent tespiti |
| `chat.params` | `chat.params` | `src/plugin-interface.ts:38-44` | Anthropic effort, think mode, runtime fallback model override |
| `chat.headers` | `chat.headers` | `src/plugin-interface.ts:46` | Copilot `x-initiator` header enjeksiyonu |
| `command.execute.before` | `command.execute.before` | `src/plugin-interface.ts:48-50` | Pre-command guard'lar (slash-command intercept) |
| `event` | `event` | `src/plugin-interface.ts:70-76` | Session lifecycle (created/deleted/idle/error), openclaw dispatch, runtime fallback, 4 team event handler'ı |
| `tool.definition` | `tool.definition` | `src/plugin-interface.ts:78-80` | Pre-tool-definition hook enjeksiyonu |
| `tool.execute.before` | `tool.execute.before` | `src/plugin-interface.ts:82-85` | Pre-tool guard'lar (write-existing-guard, label-truncator, rules-injector, vs.) |
| `tool.execute.after` | `tool.execute.after` | `src/plugin-interface.ts:87-90` | Post-tool hook'lar (output truncator, comment-checker, hashline read-enhancer, vs.) |
| `experimental.chat.messages.transform` | `experimental.chat.messages.transform` | `src/testing/create-plugin-module.ts` (bağlantı) | Context injection, thinking-block validation, tool-pair validation, keyword detection |
| `experimental.chat.system.transform` | `experimental.chat.system.transform` | `src/testing/create-plugin-module.ts` (bağlantı) | System-message-level transform'lar |
| `experimental.session.compacting` | `experimental.session.compacting` | `src/plugin/session-compacting.ts:59-89` | Context + todo koruma (compaction sırasında) |
| `experimental.compaction.autocontinue` | `experimental.compaction.autocontinue` | `src/plugin/session-compacting.ts:91-116` | Compaction sonrası auto-resume |

### Hook Handler'larının Çağrılma Sırası

Her OpenCode olayı, ilgili hook handler'ını tetikler. Örneğin bir `tool.execute.before` olayı şu sırayla çalışır:

1. `writeExistingFileGuard` — varolan dosyaya yazmadan önce okunmasını zorunlu kılar
2. `bashFileReadGuard` — bash ile dosya okuma komutlarını kontrol eder
3. `rulesInjector` — proje kurallarını context'e enjekte eder
4. `prometheusMdOnly` — Prometheus ajanının yalnızca `.md` dosyalarını düzenlemesini sağlar
5. Diğer guard'lar

---

## 6 Aşamalı Config Pipeline

Config handler'ı (`config` hook) tetiklendiğinde 6 aşamalı bir pipeline çalışır. Her aşama kaynak dosyasını yükler, bağımsız hata yönetimine sahiptir ve bir önceki aşamanın çıktısını kullanır.

```typescript
// src/plugin-handlers/config-handler.ts:23-67 (özet)
async function configHandler(input, output) {
  await applyProviderConfig(input, output)      // Phase 1
  await loadPluginComponents(input, output)      // Phase 2
  await applyAgentConfig(input, output)          // Phase 3
  await applyToolConfig(input, output)           // Phase 4
  await applyMcpConfig(input, output)            // Phase 5
  await applyCommandConfig(input, output)        // Phase 6
}
```

| Aşama | Handler | Dosya:Satır | Amaç |
|-------|---------|-------------|------|
| **1** | `applyProviderConfig` | `src/plugin-handlers/provider-config-handler.ts:29-73` | Model context limitlerini cache'ler, anthropic-beta header'larını tespit eder, vision modellerini indeksler |
| **2** | `loadPluginComponents` | `src/plugin-handlers/plugin-components-loader.ts:26-71` | Claude Code plugin'lerini keşfeder (10s timeout, error-isolated) |
| **3** | `applyAgentConfig` | `src/plugin-handlers/agent-config-handler.ts` | Ajanları 5 kaynaktan yükler (builtin, custom, plugin, skill, AGENTS.md) |
| **4** | `applyToolConfig` | `src/plugin-handlers/tool-config-handler.ts` | Agent-specific tool grant/denial'ları uygular |
| **5** | `applyMcpConfig` | `src/plugin-handlers/mcp-config-handler.ts` | Built-in + Claude Code + plugin MCP sunucularını birleştirir |
| **6** | `applyCommandConfig` | `src/plugin-handlers/command-config-handler.ts` | 9 paralel kaynaktan command/skill'leri birleştirir |

### Config Katmanları (Override Hiyerarşisi)

```
Yürünen config (closer wins): <pwd>/.opencode/oh-my-openagent.jsonc
                            ↓ merged onto
Kullanıcı config:           ~/.config/opencode/oh-my-openagent.jsonc
                            ↓ falls back to
Varsayılanlar               (Zod safeParse doldurur)
```

| Alan | Merge Stratejisi |
|------|------------------|
| `agents`, `categories`, `claude_code` | Deep merge (recursive, prototype-pollution safe) |
| `disabled_*` dizileri | Set union (concatenate + deduplicate) |
| Diğer tüm alanlar | Override (yeni değer eskiyi tamamen değiştirir) |
| `mcp_env_allowlist` | **Yalnızca kullanıcı config'i** (güvenlik) |

---

## 4 Manager

Plugin başlatılırken `src/create-managers.ts:53-172` içinde 4 manager oluşturulur:

```typescript
// src/create-managers.ts (özet)
export function createManagers(ctx, config) {
  return {
    tmuxSessionManager: new TmuxSessionManager(ctx),
    backgroundManager: new BackgroundManager(ctx),
    skillMcpManager: new SkillMcpManager(ctx),
    configHandler: createConfigHandler(ctx),
  }
}
```

| Manager | Sınıf/Dosya | Görev |
|---------|-------------|-------|
| **TmuxSessionManager** | `src/features/tmux-subagent/` | Tmux pane oluşturma, `interactive_bash` yönetimi, cleanup |
| **BackgroundManager** | `src/features/background-agent/` | 5 eşzamanlı task/provider/model key, FIFO kuyruk, parent-wake |
| **SkillMcpManager** | `src/features/skill-mcp-manager/` | Per-session tier-3 MCP yönetimi, OAuth 2.0 + PKCE + DCR |
| **ConfigHandler** | `src/plugin-handlers/config-handler.ts` | 6 aşamalı config pipeline'ı |

### BackgroundManager Detayı

BackgroundManager, arka plan görevlerini yönetir:

```typescript
// Varsayılan yapılandırma
{
  background_task: {
    modelConcurrency: 5,      // model başına max eşzamanlı task
    providerConcurrency: 5,   // provider başına max eşzamanlı task
  }
}
```

Kuyruk FIFO prensibiyle çalışır. Her görev `${providerID}/${modelID}` anahtarına göre gruplanır. Slotlar dolduğunda yeni görevler sıraya alınır.

### SkillMcpManager Detayı

Skill-embedded MCP'ler, SKILL.md dosyasının YAML frontmatter'ından okunur. Her MCP client'ı `{sessionID}:{skillName}:{serverName}` formatında anahtarlanır. Bu sayede aynı skill farklı session'larda izole çalışır.

---

## Kanonik Ajan Sıralaması

OpenCode 1.4.x, ajanları isme göre sıralar (`Remeda sortBy` string compare) ve `order` alanını dikkate almaz. Bu sorunu çözmek için `installAgentSortShim()` devreye girer.

```typescript
// src/shared/agent-sort-shim.ts:96-137 (özet)
export function installAgentSortShim(): void {
  Object.defineProperty(Array.prototype, "toSorted", {
    value: function (comparator) {
      const patchedComparator = isAgentArray(this)
        ? agentComparator(comparator)
        : comparator
      return /* ... */ 
    }
  })
  // .sort için de benzer yama
}
```

### Sıralama

```
Hecateq-orchestrator (Hecateq God) → Sisyphus → Hephaestus → Prometheus → Atlas
```

Bu sıralama bir `agentRank` map'i ile tanımlanır:

| Ajan | Rank |
|------|------|
| `hecateq-orchestrator` | 1 |
| `sisyphus` | 2 |
| `hephaestus` | 3 |
| `prometheus` | 4 |
| `atlas` | 5 |
| Diğer ajanlar | Alfabetik |

**Koruma mekanizması:** `isAgentArray()` guard'ı yalnızca dizi en az 2 eleman içerdiğinde ve tüm elemanlar `.name` property'sine sahip olduğunda yamayı aktifleştirir. Bu sayede rastgele diziler etkilenmez.

---

## 5-Tier Hook Kompozisyonu

Hook'lar 5 ana katmanda organize edilmiştir:

```
createHooks()
  ├── createCoreHooks()
  │   ├── createSessionHooks()      # 24 hook
  │   ├── createToolGuardHooks()    # 16-17 hook (team-mode +1)
  │   └── createTransformHooks()    # 5-7 hook (team-mode +2)
  ├── createContinuationHooks()     # 7 hook
  └── createSkillHooks()            # 2 hook
```

| Katman | Sayı | Team-Mode Ek | Tetikleyici |
|--------|------|--------------|-------------|
| Session | 24 | — | `session.created`, `session.idle`, `session.error`, `chat.message`, `chat.params` |
| Tool Guard | 16 | +1 (team-tool-gating) | `tool.execute.before`, `tool.execute.after` |
| Transform | 5 | +2 (team-mode-status-injector, team-mailbox-injector) | `experimental.chat.messages.transform` |
| Continuation | 7 | — | `session.idle`, `session.compacted`, `event` |
| Skill | 2 | — | `chat.message` |
| Direkt event handler | — | +4 (team-session-events) | Session events |

**Toplam:** 54 base, 61 team-mode ile.

### Kritik Hook Örnekleri

| Hook Adı | Katman | Açıklama |
|----------|--------|----------|
| `contextWindowMonitor` | Session | Context penceresi dolduğunda compaction tetikler |
| `thinkMode` | Session | Anthropic extended thinking modunu yönetir |
| `writeExistingFileGuard` | ToolGuard | Varolan dosyaya yazmadan önce okunmasını zorunlu kılar |
| `commentChecker` | ToolGuard | AI-slop comment kalıplarını tespit eder |
| `keywordDetector` | Transform | IntentGate: ultrawork/search/analyze/team modlarını tespit eder |
| `rulesInjector` | ToolGuard | `.omo/rules/` kurallarını context'e enjekte eder |
| `hashlineReadEnhancer` | ToolGuard | Read çıktısına LINE#ID hash'leri ekler |
| `todoContinuationEnforcer` | Continuation | Boulder state üzerinden todo continuations yönetir |
| `runtimeFallback` | Session | API hatası durumunda provider değiştirir |

---

## Tool Kataloğu

Plugin, yapılandırmaya bağlı olarak 20-39 arası araç sağlar.

### Her Zaman Açık (20)

| Tool | Açıklama |
|------|----------|
| `lsp_goto_definition` | Tanıma git (MCP üzerinden) |
| `lsp_find_references` | Referansları bul (MCP üzerinden) |
| `lsp_symbols` | Sembolleri listele (MCP üzerinden) |
| `lsp_diagnostics` | Diagnostik al (MCP üzerinden) |
| `lsp_prepare_rename` | Yeniden adlandırmaya hazırlan (MCP üzerinden) |
| `lsp_rename` | Sembol yeniden adlandır (MCP üzerinden) |
| `grep` | Dosya içeriği ara |
| `glob` | Dosya yolu ara |
| `ast_grep_search` | AST pattern ara (MCP üzerinden) |
| `ast_grep_replace` | AST pattern değiştir (MCP üzerinden) |
| `session_list` | Session'ları listele |
| `session_read` | Session mesajlarını oku |
| `session_search` | Session'larda ara |
| `session_info` | Session metadata |
| `background_output` | Background task output al |
| `background_cancel` | Background task iptal et |
| `call_omo_agent` | Subagent spawn et |
| `task` | Category'ye task delege et |
| `skill` | Skill yükle |
| `skill_mcp` | Skill-embedded MCP çağır |

### Koşullu Araçlar

| Tool | Koşul |
|------|-------|
| `look_at` | `multimodal-looker` disabled değilse |
| `interactive_bash` | `tmux` binary PATH'te varsa |
| `edit` | `hashline_edit: true` ise |
| `task_create/get/list/update` | `experimental.task_system: true` ise |
| `team_create/delete/shutdown_request/...` (12 tool) | `team_mode.enabled: true` ise |

---

## 3 Katmanlı MCP Sistemi

Plugin, üç katmanlı bir Model Context Protocol (MCP) sistemi kullanır:

| Katman | Kaynak | Yükleyici | Mekanizma |
|--------|--------|-----------|-----------|
| **1. Built-in** | `src/mcp/` | `createBuiltinMcps()` | 3 remote HTTP + 2 local stdio MCP |
| **2. Claude Code** | `.mcp.json` (proje + kullanıcı) | `claude-code-mcp-loader` | `${VAR}` env expansion (allowlist kontrollü) |
| **3. Skill-embedded** | SKILL.md YAML frontmatter | `SkillMcpManager` (per-session) | stdio + HTTP, OAuth 2.0 + PKCE + DCR |

### Built-in MCP Sunucuları

- **Websearch MCP** — Web araması (remote HTTP)
- **grep-app MCP** — GitHub code search (remote HTTP)
- **Context7 MCP** — Library dokümantasyonu (remote HTTP)
- **LSP MCP** — Language Server Protocol (local stdio)
- **AST-grep MCP** — AST pattern search/replace (local stdio)

---

## Mimari Sabitler

Bu projenin mimarisini tanımlayan değişmez kurallar:

### 1. Kanonik Ajan Sıralaması

```
Hecateq-orchestrator → Sisyphus → Hephaestus → Prometheus → Atlas
```

`installAgentSortShim()` ile `Array.prototype.sort`/`toSorted` yaması yapılarak korunur. Dizi en az 2 kanonik ajan içerdiğinde aktifleşir.

### 2. Hashline Read/Edit İkilemesi

Her `Read` tool çıktısı, `LINE#ID` içerik hash'leri ile etiketlenir (karakter seti: `ZPMQVRWSNKTXJBYH`). `hashline_edit` aracı, hash'i doğrulamadan edit'i reddeder. Eski hash → reject.

### 3. 5-Tier Hook Kompozisyonu

54 base hook, team-mode ile 61'e yükselir. Her katmanın kendi sorumluluk alanı vardır ve birbirlerine karışmazlar.

### 4. Per-Session MCP İzolasyonu

Tier-3 MCP client'ları `${sessionID}:${skillName}:${serverName}` formatında anahtarlanır. Aynı skill iki farklı session'da kullanıldığında state paylaşılmaz.

### 5. İki Farklı Fallback Sistemi

| Özellik | Model Fallback | Runtime Fallback |
|---------|----------------|-----------------|
| Zamanlama | Proaktif (chat.params) | Reaktif (session.error) |
| Konfigürasyon | `model_fallback: true` | `runtime_fallback: {}` |
| Tetikleyici | API çağrısı öncesi | API hatası sonrası |
| Chain | Ajan başına hardcoded | Category başına yapılandırılabilir |
| Hata kodları | — | 429, 500, 502, 503, 504 |

### 6. OpenClaw Çift Yönlü İletişim

- **Outbound**: Session olaylarında HTTP/shell dispatcher'ları tetiklenir
- **Inbound**: Discord/Telegram inbound daemon'ı, `send-keys` ile tmux pane'ine yanıt gönderir

### 7. İç Mesaj Enjeksiyonu Tehlikesi

OpenCode'un `session.prompt` / `session.promptAsync` API'si, plugin'lerin ana session'a mesaj enjekte etmesine izin verir. Bu, yanlış kullanıldığında session state'ini bozabilir.

**Kritik kural:** `session.promptAsync` çağrıları yalnızca `src/shared/prompt-async-gate.ts` içinde yapılabilir. Diğer tüm yollar `dispatchInternalPrompt()` kullanmalıdır.

```typescript
// DOĞRU — shared gate üzerinden
dispatchInternalPrompt({ mode: "async", session, message })

// YANLIŞ — direkt çağrı (meta-audit testi tarafından engellenir)
session.promptAsync({ text: "..." })
```

**Yasak pattern'ler:**
- Ham `promptAsync` çağrıları (gate dışında)
- `postDispatchHoldMs: 0`
- Session yoksa ham prompt'a düşmek
- Yinelenen enjeksiyon regression testi olmayan yeni iç mesaj yolları

**Test zorunluluğu:** `src/shared/prompt-async-route-audit.test.ts` dosyası, TS compiler API ile tüm kod tabanını tarar ve gate dışındaki ham `session.promptAsync` çağrılarını tespit ederek test suite'ini başarısız yapar.

---

## Config Örneği (Tam)

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/hecateq/hecateq-openagent/main/assets/hecateq-openagent.schema.json",

  "hecateq": {
    "enabled": true,
    "context_injection": {
      "enabled": true,
      "mode": "compact",
      "hecateq_only": false
    },
    "memory_bootstrap": {
      "enabled": true,
      "create_memory_files": true
    },
    "orchestration": {
      "enabled": false,
      "auto_decompose": true,
      "max_repair_attempts": 2,
      "quality_gates": {
        "typecheck": true,
        "lint": true,
        "test": true,
        "build": true
      }
    }
  },

  "team_mode": {
    "enabled": false,
    "max_parallel_members": 4
  },

  "hashline_edit": false,
  "model_fallback": false,
  "auto_update": true
}
```

---

## Daha Fazla Bilgi

| Konu | Dosya |
|------|-------|
| Ajan sistemi detayı | [02-ajanlar-sistemi.md](./02-ajanlar-sistemi.md) |
| Hook ve tool kataloğu | `docs/hecateq/hooks-tools.md` |
| Orkestrasyon pipeline'ı | `docs/hecateq/orchestration.md` |
| Memory sistemi | `docs/hecateq/memory-system.md` |
| MCP ve skill sistemi | `docs/hecateq/mcp-skills.md` |
| Routing ve delegasyon | `docs/hecateq/routing.md` |
| Geliştirici referansı | `AGENTS.md` (kök dizin) |
