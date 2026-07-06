# Bölüm 9: Dokümantasyon ve Proje Yapılandırması

> **Hecateq OpenAgent** — Bu rehber, proje yapısını, dizin hiyerarşisini, dokümantasyon düzenini, test konvansiyonlarını, mimari sabitleri ve geliştirme kurallarını detaylı şekilde açıklar.
>
> **Güncelleme:** 2026-05-20 | **Branch:** dev | **Sürüm:** v0.1.0-beta.8

---

## 9.1 Proje Yapılandırmasına Genel Bakış

Hecateq OpenAgent, ~2167 TypeScript dosyası (~313k LOC) içeren büyük bir monorepo'dur. Proje yapısı aşağıdaki ana bölümlerden oluşur:

```
oh-my-openagent-hecateq/
├── src/                  # Kaynak kodu (~1314 source + 730 test)
├── packages/             # 12 core paket + 1 web paketi
├── docs/                 # Kullanıcı dokümantasyonu
├── .opencode/            # Proje-scope skill'ler ve komutlar
├── .agents/              # Mirror/Aynalama hedefi (.opencode superset'i)
├── .omo/                 # AI agent çalışma alanı
├── .github/workflows/    # 9 CI/CD workflow'u
├── bin/                  # Binary shim'leri
├── script/               # Build/publish script'leri
├── assets/               # Schema + görsel varlıklar
├── signatures/           # CLA imza kaydı
└── rehber/               # Türkçe geliştirici rehberleri
```

### İstatistikler

| Metrik | Değer |
|--------|-------|
| TypeScript dosyası | ~2167 |
| Toplam LOC | ~313k |
| `src/` altı barrel `index.ts` | 120 |
| `src/` source dosya | ~1314 |
| `src/` test dosyası | ~730 |
| Core paket | 12 |
| Platform binary | 11 (15 varyant) |
| Built-in agent | 12 |
| Lifecycle hook | 54-61 |
| Tool | 20-39 |
| GitHub workflow | 9 |

---

## 9.2 Dizin Yapısı (Üst Düzey)

```
oh-my-openagent-hecateq/
├── src/                           # PLUGIN KAYNAK KODU
│   ├── index.ts                   # Plugin entry (18 satır, createPluginModule'e delegasyon)
│   ├── plugin-config.ts           # JSONC multi-level config (Zod v4)
│   ├── plugin-interface.ts        # 11 OpenCode hook handler
│   ├── create-managers.ts         # 4 manager (Tmux, Background, SkillMcp, ConfigHandler)
│   ├── create-tools.ts            # ToolRegistry kompozisyonu
│   ├── create-hooks.ts            # 5-tier hook kompozisyonu
│   ├── agents/                    # 12 ajan fabrikası (104 dosya, ~20k LOC)
│   ├── hooks/                     # ~52 lifecycle hook (596 dosya, ~78k LOC)
│   ├── tools/                     # 13 native tool (317 dosya, ~45k LOC)
│   ├── features/                  # 20 feature modülü (404 dosya, ~71k LOC)
│   ├── shared/                    # Cross-cutting yardımcılar (297 dosya, ~33k LOC)
│   ├── cli/                       # Commander.js CLI (158 dosya, ~18k LOC)
│   ├── plugin/                    # Hook handler'lar + kompozisyon (58 dosya, ~12k LOC)
│   ├── config/                    # 30 Zod v4 şema dosyası (41 dosya, ~2k LOC)
│   ├── plugin-handlers/           # 6-phase config loading (27 dosya, ~6k LOC)
│   ├── openclaw/                  # Bidirectional entegrasyon (26 dosya, ~3k LOC)
│   ├── mcp/                       # 5 built-in MCP (8 dosya, ~260 LOC)
│   └── testing/                   # Test yardımcıları (3 dosya, ~225 LOC)
│
├── packages/                      # BAĞIMSIZ PAKETLER
│   ├── hashline-core/             # Content-aware metin düzenleme (65+ dosya)
│   ├── comment-checker-core/      # AI yorum tespiti
│   ├── ast-grep-core/             # AST pattern eşleştirme
│   ├── ast-grep-mcp/              | AST MCP sunucusu
│   ├── lsp-tools-mcp/             | LSP MCP sunucusu (npm submodule)
│   ├── boulder-state/             | İş takip state makinesi
│   ├── agents-md-core/            | Agent doküman işleme
│   ├── utils/                     | Paylaşılan yardımcılar
│   ├── rules-engine/              | Kural keşfi + eşleştirme
│   ├── model-core/                | Model çözümleme pipeline'ı
│   └── web/                       | Next.js 15 + Cloudflare Workers (kendi bun.lock)
│
├── docs/                          # DOKÜMANTASYON
│   ├── guide/                     # Kullanıcı rehberleri (5 dosya)
│   ├── reference/                 | API/config/CLI referansları (7 dosya)
│   ├── hecateq/                   | Hecateq-özel dokümantasyon (17 dosya)
│   ├── examples/                  | Örnek JSONC config'leri (3 dosya)
│   ├── legal/                     | Gizlilik politikası + kullanım koşulları
│   ├── generated/                 | Runtime dokümantasyon (3 dosya)
│   ├── superpowers/               | İç tasarım dokümanları
│   └── manifesto.md               | Proje manifestosu
│
├── .opencode/                     # PROJE-SCOPE SKILL'LER
│   ├── AGENTS.md                  # Agent tanımları
│   ├── skills/                    # 5 skill (work-with-pr, github-triage, vb.)
│   ├── command/                   # 4 slash komut (/publish, /remove-deadcode, vb.)
│   ├── state/memory/              # Bellek dosyaları (17 dosya)
│   └── contracts/ + task-graphs/  # Task contract'ları ve graph'ları
│
├── .agents/                       # MİRAS HEDEFİ (.opencode superset)
│   ├── AGENTS.md
│   ├── skills/                    # 9 skill (.opencode'ün 5'i + 4 fazladan)
│   └── command/                   # 4 komut (.opencode ile aynı)
│
├── .omo/                          # AI ÇALIŞMA ALANI
│   ├── run-continuation/          # Session continuation state
│   ├── plans/                     # Plan dosyaları
│   ├── tasks/                     # Task dosyaları
│   ├── notepads/                  # Agent not defterleri
│   ├── rules/                     # Kural dosyaları (test-discipline.md)
│   ├── background-agent/          | Arka plan ajan state
│   ├── hecateq/                   | Hecateq state
│   └── evidence/                  | Kanıt/rapor dosyaları
│
├── .github/workflows/             # CI/CD WORKFLOW'LARI
│   ├── ci.yml                     # Test + typecheck + build
│   ├── publish.yml                # npm yayını
│   ├── publish-platform.yml       | Platform binary yayını
│   ├── web-ci.yml                 | Web paketi CI
│   ├── web-deploy.yml             | Cloudflare Workers deploy
│   └── ... (4 workflow daha)
│
├── bin/                           # BINARY SHIM'LERİ
│   ├── oh-my-opencode.js          # Ana binary shim
│   └── platform.js                | Platform tespiti
│
├── script/                        # BUILD/PUBLISH SCRIPT'LERİ
│   ├── build-binaries.ts          | Platform binary üretimi
│   ├── build-schema.ts            | Schema oluşturma
│   ├── build-model-capabilities.ts | Model cache yenileme
│   └── generate-changelog.ts      | Changelog üretimi
│
└── assets/                        # SCHEMA + GÖRSELLER
    ├── hecateq-openagent.schema.json
    ├── oh-my-opencode.schema.json
    └── (banner görselleri)
```

---

## 9.3 docs/ Yapısı

**Yol:** `/home/berkay/Masaüstü/Projeler/forks/oh-my-openagent-hecateq/docs/`

Dokümantasyon 7 alt dizin + 2 kök dosyadan oluşur.

### Dizin Hiyerarşisi

```
docs/
├── guide/                           # KULLANICI REHBERLERİ (5 dosya)
│   ├── overview.md                  # Projeye giriş
│   ├── installation.md              # Kurulum rehberi
│   ├── orchestration.md             # Ajan işbirliği rehberi
│   ├── agent-model-matching.md      # Model seçim rehberi
│   └── team-mode.md                 # Team Mode rehberi
│
├── reference/                       # API/CONFIG/CLI REFERANSLARI (10 dosya)
│   ├── cli.md                       # CLI komut referansı
│   ├── commands-and-cli.md          # Komut ve CLI detayları
│   ├── configuration.md             # Config alan referansı
│   ├── features.md                  # Feature-by-feature referans
│   ├── known-issues.md              | Bilinen sorunlar ve çözümleri
│   ├── release-process.md           | Yayın süreci
│   ├── prompt-async-gate-rfc.md     | Internal message gate RFC
│   ├── schema-json.md               | JSON Schema referansı
│   ├── rules-injection-cross-module-comparison.md  | Kural enjeksiyon karşılaştırması
│   └── runtime-handoff.md           | Runtime handoff dokümantasyonu
│
├── hecateq/                         # HECATEQ-ÖZEL DOKÜMANTASYON (17 dosya)
│   ├── overview.md                  # Hecateq mimari derinlemesine
│   ├── features.md                  | Feature sınıflandırma tablosu
│   ├── configuration.md             | Tam config şema referansı
│   ├── cli-commands.md              | CLI komutları (hecateq alt komutları dahil)
│   ├── orchestration.md             | Orchestration pipeline
│   ├── memory-system.md             | Bellek bootstrap, manifest, pointer
│   ├── mcp-skills.md                | MCP tier'ları ve Skill sistemi
│   ├── hooks-tools.md               | Hook ve tool kataloğu
│   ├── routing.md                   | Routing ve delegasyon sistemi
│   ├── team-mode.md                 | Team Mode dokümantasyonu
│   ├── privacy-telemetry.md         | Telemetri ve gizlilik
│   ├── troubleshooting.md           | Sorun giderme rehberi
│   ├── source-map.md                | Kaynak ağacı ve dosya haritası
│   ├── handoff-protocol-signals.md  | Handoff protokol sinyalleri
│   ├── hecateq-angel-architecture.md | Hecateq Angel mimarisi
│   ├── memory-bank-quality-audit-improvements.md | Bellek kalite denetimi
│   └── memory-bank-runtime-consistency-phase-2-report.md | Bellek tutarlılık raporu
│
├── examples/                        # ÖRNEK CONFIG'LER (3 dosya)
│   ├── default.jsonc                # Varsayılan config
│   ├── coding-focused.jsonc         | Kodlama odaklı config
│   └── planning-focused.jsonc       | Planlama odaklı config
│
├── legal/                           # YASAL BELGELER
│   ├── privacy-policy.md            # Gizlilik politikası
│   └── terms-of-service.md          # Kullanım koşulları
│
├── generated/                       # RUNTIME DOKÜMANTASYON (3 dosya)
│   ├── doctor-checks.md             # Doctor check'leri
│   ├── runtime-routing.md           | Runtime routing
│   └── tool-registry.md             | Tool registry
│
├── superpowers/                     # İÇ TASARIM DOKÜMANLARI
│   ├── plans/                       # Planlama dokümanları
│   └── specs/                       # Teknik spesifikasyonlar
│
├── troubleshooting/                 # SORUN GİDERME
│   └── ollama.md                    # Ollama sorun giderme
│
├── manifesto.md                     # Proje manifestosu
├── model-capabilities-maintenance.md # Model cache bakımı
├── hecateq-agent-index.md           | Agent index dokümantasyonu
├── call-omo-agent-vs-task.md        | call_omo_agent vs task karşılaştırması
├── routing-truth.md                 | Routing truth kaynağı
└── release.md                       | Yayın süreci
```

### Dokümantasyon Konvansiyonları

| Kural | Açıklama |
|-------|----------|
| **Dil** | `guide/` ve `reference/` sadece kullanıcı dili. `OmO` jargonu açıklamasız kullanılmaz. |
| **superpowers/** | İç doküman. Dış okuyucuların anlaması beklenmez. |
| **Linkler** | `file://` şeması kullanılır (OpenCode TUI'de render için) |
| **HTML yasak** | Sadece Markdown. `<details>`/`<summary>` yok (terminal sorunları) |
| **Code block** | Dil fence'leri kullanılır. Config için `jsonc` tercih edilir. |
| **Web CI** | `docs/` ve `packages/web/` değişiklikleri web CI'ı tetikler |

---

## 9.4 `.opencode/` + `.agents/` — Proje-Scope Skill'ler ve Komutlar

### `.opencode/` Yapısı

**Yol:** `/home/berkay/Masaüstü/Projeler/forks/oh-my-openagent-hecateq/.opencode/`

```
.opencode/
├── AGENTS.md                 # Agent tanımları ve skill/command konvansiyonları
├── skills/                   # PROJE-SCOPE SKILL'LER (5 adet)
│   ├── work-with-pr/         # Tam PR lifecycle skill
│   ├── work-with-pr-workspace/ # work-with-pr için iterasyon çalışma alanı
│   ├── github-triage/        # Read-only GitHub triage
│   ├── hyperplan/            # Adversarial multi-agent planning
│   └── pre-publish-review/   # 16-agent pre-publish release gate
├── command/                  # SLASH KOMUTLAR (4 adet)
│   ├── get-unpublished-changes.md  # npm versiyon karşılaştırma
│   ├── omomomo.md            # Easter egg komutu
│   ├── publish.md            # GitHub Actions ile npm yayını
│   └── remove-deadcode.md    # LSP-güvenli dead code temizleme
├── state/memory/             # BELLEK DOSYALARI (17 dosya)
│   ├── memory.json           # Manifest (schema v2)
│   ├── active-context.md     # Aktif session context
│   ├── progress.md           # Milestone takibi
│   ├── tasks.md              # Task listesi
│   ├── decisions.md          # Mimari kararlar
│   ├── file-map.md           # Önemli dosya yolları
│   ├── agent-routing.md      # Ajan routing kuralları
│   ├── quality-history.md    # Kalite gate sonuçları
│   ├── risk-profile.md       # Bilinen riskler
│   ├── conventions.md        # Proje konvansiyonları
│   ├── environment.md        # Ortam değişkenleri
│   ├── glossary.md           # Terimler sözlüğü
│   ├── incidents.md          # Olay kaydı
│   ├── open-questions.md     | Açık sorular
│   └── ... (diğer dosyalar)
├── contracts/                # Task contract'ları
├── task-graphs/              # Bağımlılık graph'ları
└── background-tasks.json     # Arka plan görev durumu
```

### `.agents/` Yapısı (Superset)

**Yol:** `/home/berkay/Masaüstü/Projeler/forks/oh-my-openagent-hecateq/.agents/`

```
.agents/
├── AGENTS.md                 # Agent tanımları
├── skills/                   # SUPERSET — 9 skill
│   ├── (5 .opencode skill'i) # work-with-pr, github-triage, hyperplan, pre-publish-review
│   ├── work-with-pr-workspace/
│   ├── get-unpublished-changes/  # Fazladan
│   ├── omomomo/              # Fazladan
│   ├── publish/              # Fazladan
│   └── remove-deadcode/      # Fazladan
└── command/                  # 4 komut (.opencode ile aynı)
    ├── get-unpublished-changes.md
    ├── omomomo.md
    ├── publish.md
    └── remove-deadcode.md
```

**İlişki:** `.agents/`, renovasyon sırasında `.opencode/`'ün migration hedefidir. Superset'tir (tüm skill'leri + fazladan 4 skill içerir). Geçiş süresince her iki dizin de yüklenir.

### AGENTS.md Konvansiyonları

Her iki dizinde de bulunan `AGENTS.md` dosyaları:

```markdown
# .opencode/ — Project-Scope Skills & Commands

## SKILLS (5)
| Skill | Purpose |
|-------|---------|
| `work-with-pr/` | Full PR lifecycle |
| ... |

## COMMANDS (4)
| Command | Purpose |
|---------|---------|
| `/publish` | Publish via GitHub Actions |
| ... |

## CONVENTIONS
- Skill YAML frontmatter is mandatory (name + description)
- Project-scope > user-scope
- Trigger words in description determine loading
```

---

## 9.5 `.omo/` Workspace (AI Agent Çalışma Alanı)

**Yol:** `/home/berkay/Masaüstü/Projeler/forks/oh-my-openagent-hecateq/.omo/`

```
.omo/
├── run-continuation/         # SESSION CONTINUATION STATE
│   ├── ses_*.json            # Her session için state dosyası (100+ dosya)
│   └── package-layering-refactor/  # Özel continuation
├── plans/                    # PLAN DOSYALARI (boş)
├── tasks/                    # TASK DOSYALARI (boş)
├── notepads/                 # AGENT NOT DEFTERLERİ (boş)
├── rules/                    # KURAL DOSYALARI
│   └── test-discipline.md    # Test disiplini kuralları
├── background-agent/         # ARKA PLAN AJAN STATE
├── hecateq/                  # HECATEQ STATE
└── evidence/                 # KANIT/RAPOR DOSYALARI
```

**Run-continuation** — Her session ayrı bir JSON dosyası olarak kaydedilir. Dosya adı formatı: `ses_<id>.json`.

**Rules** — `rules-injector` hook'u tarafından otomatik enjekte edilir. Şu anda sadece `test-discipline.md` ship edilmiştir.

---

## 9.6 Test Konvansiyonları

### Runtime

```bash
# Sadece Bun desteklenir
bun test           # Tüm test suite (tek process)
bun test <path>    # Belirli test dosyası
```

### Test Yapısı

| Özellik | Kural |
|---------|-------|
| **Framework** | `bun:test` (Bun built-in) |
| **Konum** | Co-located (`*.test.ts`, kaynak kodun yanında) |
| **Stil** | `given/when/then` (prefix veya inline comment) |
| **Preload** | `test-setup.ts` → `bunfig.toml` ile preload edilir |
| **Mock** | `mock.module()` + `mock.restore()` |
| **Yasak** | `setTimeout(resolve, N)` / `await sleep(N)` (zaman SUT değilse) |

### given/when/then Stili

```typescript
// İzin verilen — nested describe + prefix
describe("#given_valid_input", () => {
  describe("#when_process_called", () => {
    it("#then_returns_correct_result", () => {
      // ...
    })
  })
})

// İzin verilen — inline comment
describe("process", () => {
  it("should validate input", () => {
    // given
    const input = { email: "test@example.com" }
    
    // when
    const result = validate(input)
    
    // then
    expect(result.valid).toBe(true)
  })
})

// YASAK — Arrange-Act-Assert
it("test", () => {
  // Arrange       ← YASAK
  // Act           ← YASAK
  // Assert        ← YASAK
})
```

### Test Setup

```typescript
// test-setup.ts (bunfig.toml ile preload)
// Her testten önce:
// 1. Session state reset
// 2. Cache state reset
// 3. Mock module lifecycle yönetimi
```

### ZAUC Mocks Pattern

Özel bir sort-order hack. 9 dizin `zauc-mocks-*` adıyla başlar (alfabetik sıralamada öne geçmek için):

```
src/hooks/zauc-mocks-*      # 5 dizin
src/tools/zauc-mocks-*      # 2 dizin
src/mcp/zauc-mocks-*        # 1 dizin
src/shared/zauc-mocks-*     # 1 dizin
```

Bu dizinlerdeki `mock.module()` kurulumları, testlerin tükettiği modüllerden **alfabetik olarak önce** yüklenmelidir. `zauc-` prefix'i bunu garanti eder.

---

## 9.7 Test Meta-Auditleri

Bu audit dosyaları, tüm codebase'i TypeScript Compiler API ile parse eder ve mimari invariant ihlallerinde test suite'ini **FAIL** ettirir.

### `mock-module-lifecycle-audit.test.ts`

**Yol:** `src/shared/mock-module-lifecycle-audit.test.ts`

**Kontrol ettiği invariant:**
- Her `mock.module()` çağrısının karşılığında `mock.restore()` var mı?
- Mock'lar test sonunda temizleniyor mu?

### `prompt-async-route-audit.test.ts`

**Yol:** `src/shared/prompt-async-route-audit.test.ts`

**Kontrol ettiği invariant:**
- `session.promptAsync` çağrıları sadece `src/shared/prompt-async-gate.ts` içinde mi?
- Ham `session.promptAsync` dışarıda kullanılmış mı?
- Tüm internal mesaj rotaları gate üzerinden geçiyor mu?

```typescript
// ZORUNLU — sadece gate üzerinden
dispatchInternalPrompt({ mode: "async", sessionId, prompt })

// YASAK — ham çağrı
session.promptAsync("...")  // ← Bu audit testi FAIL eder
```

---

## 9.8 Mimari Sabitler (Architecture Invariants)

| # | İnvariant | Açıklama |
|---|-----------|----------|
| 1 | **Canonical Agent Order** | `hecateq-orchestrator → Sisyphus → Hephaestus → Prometheus → Atlas`. `installAgentSortShim()` ile `Array.prototype.sort` patch'lenmiştir. |
| 2 | **Hashline Read/Edit Pairing** | Her `Read` çıktısı `LINE#ID` hash'leri içerir; `hashline_edit` hash'i doğrulamadan değişiklik yapmaz. |
| 3 | **5-Tier Hook Composition** | Session (24) + ToolGuard (16-17) + Transform (5-7) + Continuation (7) + Skill (2) = 54-61 hook. |
| 4 | **Per-Session MCP Isolation** | Tier-3 MCP client'lar `${sessionID}:${skillName}:${serverName}` ile key'lenir. Aynı skill farklı session'larda state paylaşmaz. |
| 5 | **Two Independent Fallback Systems** | `model-fallback` (proactive, chat.params) ve `runtime-fallback` (reactive, session.error) bağımsız çalışır, entegre değildir. |
| 6 | **OpenClaw Bidirectional** | Outbound (HTTP/shell) ve inbound (Discord/Telegram → tmux) ayrı kanallardan çalışır. |
| 7 | **Internal Message Injection Gate** | `session.promptAsync` sadece `prompt-async-gate.ts` üzerinden. Ham çağrı yasak. |
| 8 | **Plugin-Interface Isolation** | Sadece `plugin-interface.ts` OpenCode Plugin API'siyle konuşur. Diğer tüm dosyalar onun üzerinden geçer. |
| 9 | **120 Barrel index.ts** | Modül sınırlarını belirler. Her modül kendi `index.ts`'sinden dışa aktarım yapar. |
| 10 | **Config Merge Hierarchy** | Defaults → User (`~/.config/opencode/`) → Walked Project (`.opencode/`). Closer wins. |

---

## 9.9 Konvansiyonlar

### Kod Konvansiyonları

| Kural | Açıklama |
|-------|----------|
| **Runtime** | Sadece Bun (1.3.12). npm/yarn/pnpm yasak. |
| **TypeScript** | strict mode, ESNext, bundler moduleResolution, `bun-types` (`@types/node` yasak) |
| **Dosya adlandırma** | kebab-case (dosya ve dizinler) |
| **Modül yapısı** | barrel `index.ts`. **Catch-all dosyaları yasak** (`utils.ts`, `helpers.ts`, `service.ts`) |
| **Import** | Modül içinde relative, modüller arası barrel. **Path alias yasak** (`@/`) |
| **Config formatı** | JSONC (yorum + trailing comma), Zod v4, snake_case |
| **Factory pattern** | `createXXX()` tüm tool'lar, hook'lar, agent'lar için |
| **Dosya limiti** | ~200 LOC soft limit |
| **Yorumlar** | AI slop kalıpları `comment-checker` ile bloklanır. `// @allow` ile bypass |

### Factory Pattern Örnekleri

```typescript
// Her tool, hook, agent bir factory fonksiyonuyla oluşturulur
export function createSessionHooks(): SessionHooks { /* ... */ }
export function createSisyphusAgent(): AgentDefinition { /* ... */ }
export function createGrepTool(): ToolDefinition { /* ... */ }
```

### Config Konvansiyonları

```jsonc
// JSONC — yorum ve trailing comma desteklenir
{
  "$schema": "https://raw.githubusercontent.com/hecateq/hecateq-openagent/main/assets/hecateq-openagent.schema.json",
  "hecateq": {              // ← snake_case
    "context_injection": {  // ← snake_case
      "enabled": true,
    },
  },
  "disabled_agents": [      // ← Set union ile birleştirilir
    "some-agent"
  ],
}
```

---

## 9.10 Anti-Patterns (Blocking)

| Anti-Pattern | Neden Yasak |
|-------------|-------------|
| `as any` | Tip güvenliğini ihlal eder |
| `@ts-ignore`, `@ts-expect-error` | Tip hatalarını gizler |
| Emoji eklemek (kod/yorum) | İstenmedikçe profesyonel değil |
| `package.json` `version`'ı elle değiştirmek | Publish workflow'u yönetir |
| Read yapmadan dosyaya yazmak | `writeExistingFileGuard` tarafından bloklanır |
| Test silip build'i yeşil yapmak | Kodu düzelt, testi değil |
| Em dash / en dash (`—`, `–`) | AI filler karakterleri |
| `utils.ts`, `helpers.ts`, `service.ts` | Catch-all dosyaları, modülerliği bozar |
| Boş catch bloğu (`catch(e) {}`) | Hataları sessizce yutar |
| AAA yorumları (Arrange/Act/Assert) | given/when/then kullan |
| `index.ts`'e iş mantığı koymak | Sadece barrel export |
| Prometheus'un non-`.md` dosyası düzenlemesi | `prometheusMdOnly` hook'u engeller |
| `background_cancel(all=true)` | Task ID ile tek tek iptal et |
| `session.promptAsync` ham çağrısı | `prompt-async-gate` üzerinden git |
| Catch-all dosya oluşturmak | Modüler dosya yapısını koru |
| `setTimeout(resolve, N)` testlerde | Zaman SUT değilse yasak |

---

## 9.11 PR Merge Policy

> **KRİTİK:** Bu projede PR'lar sadece **merge commit** ile birleştirilir.

```bash
# DOĞRU — merge commit
gh pr merge <number> --merge --delete-branch

# YASAK
gh pr merge <number> --squash     # ← YASAK
gh pr merge <number> --rebase     # ← YASAK
```

**Kurallar:**
1. Tüm PR'lar `dev` branch'ini hedeflemelidir. `master`'a PR açmak engellenmiştir (CI'da `block-master-pr` job'ı).
2. PR merge'ı için: CI geçmeli, review-work onaylamalı, Cubic pass tamamlanmalı.
3. Squash merge veya rebase merge **kesinlikle yasaktır**. Bu repo seviyesinde bir kuraldır.

---

## 9.12 Geliştirme Komutları

```bash
# Test
bun test                          # Root test suite (tek process)
bun test <path>                   # Belirli test

# Type check
bun run typecheck                 # tsgo --noEmit
bun run typecheck:packages        # Tüm packages/ type check
bun run typecheck:script          # Script tooling type check

# Build
bun run build                     # ESM + .d.ts + CLI + schema
bun run build:all                 # Build + 11 platform binary
bun run build:schema              # Sadece schema
bun run build:model-capabilities  # Model cache yenile

# Clean
bun run clean                     # rm -rf dist

# Dokümantasyon
bun run generate:runtime-docs     # Runtime dokümantasyon oluştur
bun run check:runtime-docs        # Dokümantasyon güncel mi kontrol et

# CLI (kaynaktan)
bun run src/cli/index.ts doctor   # Doctor çalıştır

# Packaging
npm pack --dry-run                # Paket doğrulama
```

---

## 9.13 Release Süreci

### Yayın Akışı

```
1. Geliştirme dev branch'inde
2. CI geçer (test, typecheck, build)
3. Manual dispatch publish.yml
4. Platform binary'ler npm'e yayınlanır
5. Ana paket npm'e yayınlanır (@hecateq/hecateq-openagent@beta)
6. GitHub release oluşturulur
7. master branch'ine merge edilir
```

### Versiyon Yönetimi

```bash
# Versiyon formatı
0.1.0-beta.8            # Hecateq beta

# package.json
{
  "version": "0.1.0-beta.8",     # Elle değiştirilmez — CI yönetir
  "publishConfig": {
    "tag": "beta"                 # beta tag
  }
}
```

**Kural:** `package.json` `version` alanı asla elle değiştirilmez. Publish workflow'u yönetir.

---

## 9.14 Hecateq-Specific Konvansiyonlar

### Hecateq CLI Komutları

```bash
# Tüm hecateq komutları `hecateq` alt komut isim alanında
hecateq-openagent hecateq plan <prompt>
hecateq-openagent hecateq run <prompt>
hecateq-openagent hecateq resume [--session-id <id>]
hecateq-openagent hecateq status
hecateq-openagent hecateq doctor
```

### Hecateq Config Şeması

Hecateq config bloğu, root config içinde `hecateq` anahtarı altında yer alır:

```jsonc
{
  "hecateq": {
    "enabled": true,
    "context_injection": { /* 11 alt alan */ },
    "agent_index": { /* 6 alt alan */ },
    "memory_bootstrap": { /* 3 alt alan */ },
    "doctor": { /* 5 alt alan */ },
    "git_checkpoint": { /* 10 alt alan */ },
    "dependency_graph": { /* 6 alt alan */ },
    "orchestration": { /* 12 alt alan */ },
    "auto_spawn": { /* 11 alt alan */ },
    "delegation_chain": { /* 3 alt alan */ }
  }
}
```

### Custom-Agent-First Routing

Hecateq God, upstream Sisyphus orchestrator'ından farklı olarak:
1. **Önce custom agent'ları** dener (`.opencode/agents/`, `.agents/`)
2. Built-in agent'lara **ancak custom eşleşme yoksa** düşer
3. **Deterministic routing** — açık fallback davranışı
4. **Memory-backed** — `.opencode/state/memory/` kullanır

### Handoff Formatı

Her agent, görev tamamlandığında yapılandırılmış handoff bloğu üretir:

```
STATUS: [DONE | IN_PROGRESS | BLOCKED]
SIGNALS_EMITTED: [{"signal":"<name>","payload":{}}]
HANDOFF: [return_to_caller | <agent-id>]
```

### Hecateq Doctor Check Kategorileri (11)

| # | Kategori | Açıklama |
|---|----------|----------|
| 1 | Agent Registration | Hecateq agent varlığı |
| 2 | Configuration | Config bloğu geçerliliği |
| 3 | Orchestration | Session state bütünlüğü |
| 4 | Safety Hooks | Zorunlu hook'ların varlığı |
| 5 | Handoff State | Handoff dosya bütünlüğü |
| 6 | Role Policy | Rol tutarlılığı |
| 7 | Project Memory | Bellek dosyası kalitesi |
| 8 | Memory Manifest | Manifest güncelliği |
| 9 | Custom Agents | Özel ajan yapılandırması |
| 10 | Agent Index | Index güncelliği |
| 11 | Artifacts | Artifact dizin yapısı |

---

## 9.15 Özet

| Bileşen | Yol | Önemli |
|---------|-----|--------|
| Kaynak kodu | `src/` | 1314 source + 730 test, 120 barrel index.ts |
| Core paketler | `packages/` | 12 paket (hashline-core, boulder-state, vb.) |
| Dokümantasyon | `docs/` | 7 alt dizin, 40+ dosya |
| Proje skill'leri | `.opencode/skills/` | 5 skill (PR, triage, hyperplan, vb.) |
| Slash komutlar | `.opencode/command/` | 4 komut (publish, remove-deadcode, vb.) |
| Bellek | `.opencode/state/memory/` | 17 dosya |
| Agent mirror | `.agents/` | `.opencode` superset (9 skill) |
| AI workspace | `.omo/` | Continuation, plans, tasks, notepads |
| CI/CD | `.github/workflows/` | 9 workflow |
| Binary | `bin/` | 3 entry point (hecateq-openagent, 2 alias) |
| Build | `script/` | Build, schema, model-capabilities |
| Schema | `assets/` | JSON Schema (Hecateq + upstream) |
| Rehberler | `rehber/` | Türkçe geliştirici dokümantasyonu |
