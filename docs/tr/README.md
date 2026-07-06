# Hecateq OpenAgent — Geliştirici Rehberi (Türkçe)

> **Bu rehber, Hecateq OpenAgent projesinin kaynak kod yapısını, mimarisini ve geliştirme süreçlerini anlatan 9 dosyalık bir serinin ana indeksidir.**
>
> Son güncelleme: 2026-06-30 | Fork: Hecateq | Temel: oh-my-openagent v4.2.0

---

## İçindekiler

1. [Proje Özeti](#1-proje-özeti)
2. [Repository İstatistikleri](#2-repository-i̇statistikleri)
3. [Hecateq vs oh-my-openagent](#3-hecateq-vs-oh-my-openagent)
4. [Dizin Yapısı (Kısa)](#4-dizin-yapısı-kısa)
5. [Rehber Dosyaları Navigasyonu](#5-rehber-dosyaları-navigasyonu)
6. [Okuma Sırası Önerisi](#6-okuma-sırası-önerisi)
7. [Temel Kavramlar Sözlüğü](#7-temel-kavramlar-sözlüğü)
8. [Mimari Sabitler Özeti](#8-mimari-sabitler-özeti)
9. [Hecateq CLI Komutları](#9-hecateq-cli-komutları)
10. [Konvansiyonlar ve Anti-Patterns](#10-konvansiyonlar-ve-anti-patterns)
11. [Katılım](#11-katılım)
12. [Bu Rehberin Sınırları](#12-bu-rehberin-sınırları)

---

## 1. Proje Özeti

**Hecateq OpenAgent**, [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) projesinin Hecateq iş akışı motoru için özelleştirilmiş bir **fork**'udur. OpenCode IDE/terminal ortamına takılan bir plugin olarak çalışır ve 12 uzman AI ajanı, 52+ yaşam döngüsü hook'u, LSP/AST araçları ve paralel takım orkestrasyonu sağlar.

**Hecateq özel katkıları:**
- **11 upstream ajana ek olarak** `hecateq-orchestrator` (Hecateq God) — custom-agent-first orkestrasyon
- **Hecateq pipeline**: prompt intake → task decomposition → dependency graph → agent selection → execution → quality gates → repair → report
- **Dosya tabanlı memory sistemi**: `memory.json`, `active-context.md`, `progress.md`, `tasks.md`, `decisions.md`
- **Yapılandırılmış handoff sistemi**: `STATUS`/`SIGNALS_EMITTED`/`HANDOFF` blokları
- **9 alt-config'li `hecateq` konfigürasyon bloğu**
- **Custom-agent-first routing**
- **5 Hecateq CLI komutu**: `plan`, `run`, `resume`, `status`, `doctor`
- **Çift katmanlı orkestrasyon**: Hecateq God + Sisyphus
- **Telemetri varsayılan kapalı**, Hecateq dağıtım kanalı

---

## 2. Repository İstatistikleri

| Metrik | Değer | Kaynak |
|--------|-------|--------|
| Toplam TypeScript dosyası | ~2167 | [01](./01-mimari-genel-bakis.md) |
| Toplam LOC | ~313k | [01](./01-mimari-genel-bakis.md) |
| Barrel `index.ts` dosyası | 120 adet | [09](./09-dokumantasyon-ve-proje-yapilandirmasi.md) |
| `src/` source dosyası | ~1314 | [01](./01-mimari-genel-bakis.md) |
| `src/` test dosyası | ~730 | [09](./09-dokumantasyon-ve-proje-yapilandirmasi.md) |
| Built-in ajan sayısı | 12 (11 upstream + 1 Hecateq God) | [02](./02-ajanlar-sistemi.md) |
| Lifecycle hook (base) | 54 | [03](./03-hooks-sistemi.md) |
| Lifecycle hook (team-mode) | 61 | [03](./03-hooks-sistemi.md) |
| Her-zaman-açık tool | 20 | [04](./04-tools-ve-mcp.md) |
| Koşullu tool | 19 | [04](./04-tools-ve-mcp.md) |
| Maksimum tool sayısı | 39 | [04](./04-tools-ve-mcp.md) |
| MCP katmanı | 3 (Built-in + Claude Code + Skill-Embedded) | [04](./04-tools-ve-mcp.md) |
| Built-in MCP sunucusu | 5 (3 remote HTTP + 2 local stdio) | [04](./04-tools-ve-mcp.md) |
| Feature modülü | 21 aktif (17 inherited + 4 Hecateq) | [05](./05-ozellikler-modulleri.md) |
| Zod v4 schema dosyası | 30 | [06](./06-ortak-yardimcilar-ve-config.md) |
| `src/shared/` dosyası | 297 (179 non-test + 118 test) | [06](./06-ortak-yardimcilar-ve-config.md) |
| `src/hooks/` dosyası/LOC | 596 dosya / ~78k LOC | [01](./01-mimari-genel-bakis.md) |
| `src/features/` dosyası/LOC | 404 dosya / ~71k LOC | [01](./01-mimari-genel-bakis.md) |
| `src/tools/` dosyası/LOC | 317 dosya / ~45k LOC | [01](./01-mimari-genel-bakis.md) |
| `src/agents/` dosyası/LOC | 104 dosya / ~20k LOC | [01](./01-mimari-genel-bakis.md) |
| Core paket (packages/) | 12 | [07](./07-cli-build-ve-packages.md) |
| Platform binary varyantı | 11 (15 varyant) | [07](./07-cli-build-ve-packages.md) |
| CLI dosyası | 158 | [01](./01-mimari-genel-bakis.md) |
| Config pipeline aşaması | 6 | [01](./01-mimari-genel-bakis.md) |
| Manager sayısı | 4 (Tmux, Background, SkillMcp, ConfigHandler) | [01](./01-mimari-genel-bakis.md) |
| GitHub workflow | 9 | [08](./08-harici-entegrasyonlar.md) |
| Hecateq doctor kategori | 11 | [07](./07-cli-build-ve-packages.md) |

### Kaynak Dağılımı (src/ altı)

| Dizin | Dosya | LOC | Açıklama |
|-------|-------|-----|----------|
| `agents/` | 104 | ~20k | 12 ajan fabrikası + dynamic prompt builder |
| `hooks/` | 596 | ~78k | 52+ lifecycle hook (57 dizin) |
| `tools/` | 317 | ~45k | 13 native tool dizini |
| `features/` | 404 | ~71k | 21 feature modülü |
| `shared/` | 297 | ~33k | Cross-cutting yardımcılar |
| `cli/` | 158 | ~18k | Commander.js CLI |
| `plugin/` | 58 | ~12k | Hook handler'lar + kompozisyon |
| `config/` | 41 | ~2k | 30 Zod v4 şema dosyası |
| `plugin-handlers/` | 27 | ~6k | 6 aşamalı config pipeline'ı |
| `openclaw/` | 26 | ~3k | Discord/Telegram/HTTP entegrasyonu |
| `mcp/` | 8 | ~260 | 5 built-in MCP |
| `testing/` | 3 | ~225 | Test yardımcıları |

---

## 3. Hecateq vs oh-my-openagent

| Özellik | oh-my-openagent (upstream) | Hecateq OpenAgent (fork) |
|----------|---------------------------|-------------------------|
| **Ajan sayısı** | 11 | 12 (`hecateq-orchestrator` eklendi) |
| **Orkestrasyon** | Sisyphus merkezli | Hecateq God + Sisyphus çift katmanlı |
| **Routing** | Varsayılan ajan sıralaması | Custom-agent-first (özel ajanlar öncelikli) |
| **Hafıza sistemi** | Yok | Dosya tabanlı memory (`memory.json`) |
| **Config bloğu** | Standart alanlar | `hecateq` bloğu (9 alt-config) |
| **CLI komutları** | `install`, `run`, `doctor` | + `hecateq plan`, `hecateq run`, `hecateq resume`, `hecateq status`, `hecateq doctor` |
| **Handoff sistemi** | Yok | Yapılandırılmış handoff blokları + rol politikası |
| **Bağımlılık grafiği** | Yok | Task DAG + cycle detection |
| **Quality gate** | Yok | typecheck/lint/test/build/doctor pipeline'ı |
| **Tamir döngüsü** | Yok | Otomatik hata düzeltme (max 2 deneme) |
| **Git checkpoint** | Yok | Pre-task git state yönetimi |
| **Otomatik spawn** | Yok | Yapılandırılabilir subagent spawning |
| **Paket ismi** | `oh-my-opencode` / `oh-my-openagent` | `@hecateq/hecateq-openagent` |
| **Telemetry** | Varsayılan açık | Varsayılan kapalı |
| **Auto-update** | Upstream kanalı | Hecateq dağıtım kanalı (beta tag) |
| **Zorunlu hook'lar** | Standart set | + `hecateq-memory-bootstrap`, `hecateq-project-context-injector` |
| **Dashboard** | Yok | Hermes dashboard (serve + query) |

---

## 4. Dizin Yapısı (Kısa)

```
oh-my-opencode-hecateq/
├── src/                           # Ana kaynak kodu (~1314 source + 730 test)
│   ├── index.ts                   # Plugin giriş noktası (18 satır)
│   ├── agents/                    # 12 ajan + dynamic prompt builder
│   ├── hooks/                     # 54-61 lifecycle hook (57 dizin)
│   ├── tools/                     # 13 native tool dizini
│   ├── features/                  # 21 feature modülü
│   ├── shared/                    # 297 cross-cutting yardımcı
│   ├── cli/                       # 158 CLI dosyası (Commander.js)
│   ├── config/                    # 30 Zod v4 schema
│   ├── plugin/                    # 5-tier hook kompozisyonu
│   ├── plugin-handlers/           # 6 aşamalı config pipeline
│   ├── openclaw/                  # Discord/Telegram/HTTP entegrasyonu
│   ├── mcp/                       # 5 built-in MCP
│   └── testing/                   # Test yardımcıları
├── packages/                      # 12 core + 1 web + 11 binary
├── docs/                          # Kullanıcı dokümantasyonu (7 alt dizin)
├── .opencode/                     # Proje-scope skill/command/memory
├── .agents/                       # .opencode superset (migration hedefi)
├── .omo/                          # AI agent workspace
├── .github/workflows/             # 9 CI/CD workflow
├── bin/                           # 3 binary shim
├── script/                        # Build/publish script'leri
├── assets/                        # JSON Schema + görseller
├── signatures/                    # CLA imza kaydı
└── rehber/                        # Bu rehber serisi (9 dosya)
```

Detaylı dizin yapısı için: [01-mimari-genel-bakis.md](./01-mimari-genel-bakis.md#dizin-yapısı)

---

## 5. Rehber Dosyaları Navigasyonu

| # | Dosya | Amaç | Hedef Kitle | Yaklaşık Boyut |
|---|-------|------|-------------|---------------|
| 01 | [Mimari Genel Bakış](./01-mimari-genel-bakis.md) | Proje tanıtımı, teknoloji stack, başlatma akışı, config pipeline, 4 manager, kanonik ajan sıralaması, mimari sabitler | Herkes (ilk okuma) | 640 satır |
| 02 | [Ajanlar Sistemi](./02-ajanlar-sistemi.md) | 12 ajan detayı, 3 ajan modu, Hecateq God vs Sisyphus, team-mode eligibility, prompt mimarisi, override alanları, iletişim kalıpları, model gereksinimleri | Backend geliştiriciler, mimarlar | 635 satır |
| 03 | [Hook Sistemi](./03-hooks-sistemi.md) | 5 katmanlı hook kompozisyonu, 24 session + 16-17 tool guard + 5-7 transform + 7 continuation + 2 skill hook, team-mode delta, kayıt mekanizması, hook kategorileri | Plugin geliştiricileri, katkıcılar | 832 satır |
| 04 | [Tools ve MCP Sistemi](./04-tools-ve-mcp.md) | 20 her-zaman-açık + 19 koşullu tool, 3 katmanlı MCP, ToolRegistry kompozisyonu, MCP merge pipeline, per-session izolasyon, config-gating, tool priority/trimming | Sistem mimarları, plugin geliştiricileri | 945 satır |
| 05 | [Özellikler ve Modüller](./05-ozellikler-modulleri.md) | 21 feature modülü kataloğu, 8 aşamalı orchestration pipeline, team mode, background agent, memory sistemi, handoff sistemi, IntentGate, miras/Hecateq ayrımı | Tüm geliştiriciler | 509 satır |
| 06 | [Ortak Yardımcılar ve Config](./06-ortak-yardimcilar-ve-config.md) | 297 shared/ dosyası (11 kategori), 30 Zod schema, çok seviyeli config, Hecateq 9 sub-config, logger, prompt-async-gate, paket yapısı, OpenClaw, CI/CD | Backend geliştiriciler, DevOps | 662 satır |
| 07 | [CLI, Build ve Packages](./07-cli-build-ve-packages.md) | Tüm CLI komutları, 11 Hecateq doctor kategorisi, build pipeline (13 script), 11 platform binary, 12 core paket detayı, schema generation | DevOps, CLI kullanıcıları | 829 satır |
| 08 | [Harici Entegrasyonlar](./08-harici-entegrasyonlar.md) | OpenClaw bidirectional, 9 GitHub workflow, model/provider davranışı (2 fallback), güvenlik, telemetri, auto-update, lisans (SUL-1.0) | DevOps, güvenlik mühendisleri | 594 satır |
| 09 | [Dokümantasyon ve Proje Yapılandırması](./09-dokumantasyon-ve-proje-yapilandirmasi.md) | Dizin hiyerarşisi, docs/ yapısı, .opencode/.agents/.omo, test konvansiyonları, 10 mimari sabit, anti-patterns, PR policy, release süreci, Hecateq konvansiyonları | Tüm geliştiriciler (referans) | 716 satır |

---

## 6. Okuma Sırası Önerisi

### 🆕 Yeni Geliştirici (Projeye İlk Kez Bakan)

| Sıra | Dosya | Süre | Neden |
|------|-------|------|-------|
| 1 | [01-mimari-genel-bakis.md](./01-mimari-genel-bakis.md) | 20 dk | Proje ne işe yarar, teknoloji stack, genel mimari |
| 2 | [02-ajanlar-sistemi.md](./02-ajanlar-sistemi.md) | 20 dk | 12 ajanın ne iş yaptığı, nasıl iletişim kurduğu |
| 3 | [05-ozellikler-modulleri.md](./05-ozellikler-modulleri.md) | 15 dk | Feature modülleri ve Hecateq pipeline |
| 4 | [09-dokumantasyon-ve-proje-yapilandirmasi.md](./09-dokumantasyon-ve-proje-yapilandirmasi.md) | 15 dk | Dizin yapısı, konvansiyonlar, anti-patterns |
| **Toplam** | | **~70 dk** | |

### 🔧 Katkıda Bulunan (Hook/Tool/Feature Ekleyecek)

| Sıra | Dosya | Süre | Neden |
|------|-------|------|-------|
| 1 | [01-mimari-genel-bakis.md](./01-mimari-genel-bakis.md) | 15 dk | Başlatma akışı, 13 hook handler, config pipeline |
| 2 | [03-hooks-sistemi.md](./03-hooks-sistemi.md) | 30 dk | 5 katmanlı hook kompozisyonu, kayıt mekanizması |
| 3 | [04-tools-ve-mcp.md](./04-tools-ve-mcp.md) | 25 dk | ToolRegistry, 3 katmanlı MCP, config-gating |
| 4 | [06-ortak-yardimcilar-ve-config.md](./06-ortak-yardimcilar-ve-config.md) | 20 dk | prompt-async-gate, config merge, 9 sub-config |
| 5 | [09-dokumantasyon-ve-proje-yapilandirmasi.md](./09-dokumantasyon-ve-proje-yapilandirmasi.md) | 15 dk | Test konvansiyonları, factory pattern, anti-patterns |
| **Toplam** | | **~105 dk** | |

### 🏗️ Mimari Analist (Sistem Tasarımını Anlayacak)

| Sıra | Dosya | Süre | Neden |
|------|-------|------|-------|
| 1 | [01-mimari-genel-bakis.md](./01-mimari-genel-bakis.md) | 25 dk | Tam mimari — başlatma, config, manager, invariants |
| 2 | [05-ozellikler-modulleri.md](./05-ozellikler-modulleri.md) | 25 dk | 8 aşamalı pipeline, memory sistemi, handoff, IntentGate |
| 3 | [03-hooks-sistemi.md](./03-hooks-sistemi.md) | 20 dk | 5-tier hook, team-mode delta, hook kategorileri |
| 4 | [04-tools-ve-mcp.md](./04-tools-ve-mcp.md) | 20 dk | MCP merge pipeline, per-session izolasyon, tool trimming |
| 5 | [08-harici-entegrasyonlar.md](./08-harici-entegrasyonlar.md) | 15 dk | OpenClaw, GitHub workflows, 2 fallback sistemi, güvenlik |
| 6 | [02-ajanlar-sistemi.md](./02-ajanlar-sistemi.md) | 15 dk | Hecateq God vs Sisyphus, model çözümleme pipeline'ı |
| **Toplam** | | **~120 dk** | |

---

## 7. Temel Kavramlar Sözlüğü

| Kavram | Açıklama | İlk Geçtiği Yer |
|--------|----------|----------------|
| **Hecateq God** (hecateq-orchestrator) | Custom-agent-first orkestratör, kanonik sıralamada 1., write/edit red | [02](./02-ajanlar-sistemi.md#hecateq-god-hecateq-orchestrator) |
| **Custom-Agent-First Routing** | Özel ajanları built-in ajanlardan önce dener, deterministic fallback | [01](./01-mimari-genel-bakis.md#hecateq-openagent-ve-oh-my-openagent-arasındaki-farklar) |
| **IntentGate** (keyword-detector) | Kullanıcı mesajından intent tespiti: ultrawork/search/analyze/team | [03](./03-hooks-sistemi.md#intentgate--keyworddetector) |
| **Hashline Edit** (LINE#ID) | Read çıktısına content hash'i ekler, edit öncesi doğrulama | [01](./01-mimari-genel-bakis.md#2-hashline-readedit-i̇kilemesi) |
| **5-Tier Hook Kompozisyonu** | Session + ToolGuard + Transform + Continuation + Skill = 54-61 hook | [03](./03-hooks-sistemi.md#5-katlı-hook-kompozisyonu) |
| **3 Katmanlı MCP** | Tier 1: Built-in (5), Tier 2: Claude Code (.mcp.json), Tier 3: Skill-Embedded | [04](./04-tools-ve-mcp.md#3-katlı-mcp-sistemi) |
| **Per-Session MCP İzolasyonu** | Tier-3 MCP client'ları `${sessionID}:${skillName}:${serverName}` ile key'lenir | [04](./04-tools-ve-mcp.md#per-session-mcp-i̇zolasyonu) |
| **prompt-async-gate** | `session.promptAsync` çağrılarını merkezi olarak yöneten güvenlik katmanı | [06](./06-ortak-yardimcilar-ve-config.md#63-prompt-async-gate-kuralı) |
| **Handoff Blok** | Agent'lar arası yapılandırılmış devir teslim formatı (STATUS/SIGNALS/HANDOFF) | [02](./02-ajanlar-sistemi.md#3-handoff--yapılandırılmış-devir-teslim) |
| **Boulder State** | Session'lar arası kalıcı iş takip state machine | [05](./05-ozellikler-modulleri.md#56-memory-sistemi) |
| **Canonical Agent Order** | Hecateq-orchestrator → Sisyphus → Hephaestus → Prometheus → Atlas | [01](./01-mimari-genel-bakis.md#kanonik-ajan-sıralaması) |
| **6-Phase Config Pipeline** | provider → plugin-components → agents → tools → MCPs → commands | [01](./01-mimari-genel-bakis.md#6-aşamalı-config-pipeline) |
| **7-Step Init Flow** | sortShim → configContext → detectPlugin → injectAuth → loadConfig → initOpenClaw → createManagers | [01](./01-mimari-genel-bakis.md#7-adımlı-başlatma-akışı) |
| **8-Stage Orchestration** | Intake → Decompose → Dependency Graph → Agent Selection → Execution Plan → Quality Gates → Repair Loop → Final Report | [05](./05-ozellikler-modulleri.md#53-hecateq-orchestration-pipeline-8-aşama) |
| **Hecateq Config (9 sub-config)** | context_injection, agent_index, memory_bootstrap, doctor, git_checkpoint, dependency_graph, orchestration, auto_spawn, delegation_chain | [06](./06-ortak-yardimcilar-ve-config.md#66-hecateq-config-section-9-sub-config) |
| **zauc-mocks pattern** | Alfabetik sıralama hack'i — 9 test mock dizini `zauc-` prefix'i ile | [03](./03-hooks-sistemi.md#zauc-mocks-pattern) |
| **AGENT_ELIGIBILITY_REGISTRY** | Team-mode ajan uygunluğu: eligible/conditional/hard-reject | [02](./02-ajanlar-sistemi.md#agent_eligibility_registry-team-mode) |
| **Dual Package** | `oh-my-opencode` + `oh-my-openagent` eşzamanlı npm publish (geçiş dönemi) | [01](./01-mimari-genel-bakis.md#teknoloji-stack) |

---

## 8. Mimari Sabitler Özeti

| # | Sabit | Açıklama |
|---|-------|----------|
| 1 | **Canonical Agent Order** | `hecateq-orchestrator → Sisyphus → Hephaestus → Prometheus → Atlas`. `installAgentSortShim()` ile `Array.prototype.sort` patch'lenmiştir. |
| 2 | **Hashline Read/Edit Pairing** | Her `Read` çıktısı `LINE#ID` hash'leri ile etiketlenir (karakter seti: `ZPMQVRWSNKTXJBYH`). `hashline_edit` hash doğrulamadan edit reddeder. |
| 3 | **5-Tier Hook Composition** | Session (24) + ToolGuard (16-17) + Transform (5-7) + Continuation (7) + Skill (2) = 54 base, 61 team-mode. Her katmanın sorumluluk alanı ayrıdır. |
| 4 | **Per-Session MCP Isolation** | Tier-3 MCP client'ları `${sessionID}:${skillName}:${serverName}` ile key'lenir. Aynı skill farklı session'larda state paylaşmaz. |
| 5 | **Two Independent Fallback Systems** | `model-fallback` (proactive, chat.params, hardcoded per-agent) ve `runtime-fallback` (reactive, session.error, configurable per-category) **bağımsız çalışır, entegre değildir.** |
| 6 | **OpenClaw Bidirectional** | Outbound (session event → HTTP/shell), inbound (Discord/Telegram → tmux send-keys) ayrı kanallardan bağımsız çalışır. |
| 7 | **Internal Message Injection Gate** | `session.promptAsync` çağrıları **yalnızca** `src/shared/prompt-async-gate.ts` içinde yapılabilir. Ham çağrı meta-audit testi tarafından engellenir. |
| 8 | **Plugin-Interface Isolation** | Sadece `src/plugin-interface.ts` OpenCode Plugin API'siyle konuşur. Diğer tüm bileşenler onun üzerinden geçer. |
| 9 | **120 Barrel index.ts** | Her modül kendi `index.ts` barrel export'una sahiptir. Modül sınırlarını belirler. |
| 10 | **Config Merge Hierarchy** | Defaults (Zod safeParse) → User (`~/.config/opencode/`) → Walked Project (`.opencode/`). Closer wins. `mcp_env_allowlist` **user-only**. |
| 11 | **Two Compaction Handlers** | `experimental.session.compacting` + `experimental.compaction.autocontinue` bağımsız eklenir (plugin-interface.ts dışında). |
| 12 | **Dual CLI Binary** | Tüm 3 binary (`hecateq-openagent`, `oh-my-opencode`, `oh-my-openagent`) aynı `runCli()`'ye yönlenir. |

---

## 9. Hecateq CLI Komutları

### Base Komutlar (Inherited)

| Komut | Açıklama | Detay |
|-------|----------|-------|
| `install` | Interaktif/non-interaktif kurulum sihirbazı | [07](./07-cli-build-ve-packages.md#install) |
| `run <message>` | Non-interaktif session başlatıcı | [07](./07-cli-build-ve-packages.md#run-message) |
| `doctor` | 4 kategorili sağlık teşhisi (System, Config, Tools, Models) | [07](./07-cli-build-ve-packages.md#doctor) |
| `version` | Plugin versiyonunu yazdırır | [07](./07-cli-build-ve-packages.md#version) |
| `get-local-version` | Yüklü vs npm latest karşılaştırması | [07](./07-cli-build-ve-packages.md#get-local-version) |
| `mcp-oauth login/logout/status` | MCP OAuth 2.0 token yönetimi | [07](./07-cli-build-ve-packages.md#73-mcp-oauth-komutları) |
| `refresh-model-capabilities` | Model yetenek cache yenileme | [07](./07-cli-build-ve-packages.md#74-model-komutları) |
| `boulder` | Boulder state inspector | [07](./07-cli-build-ve-packages.md#75-boulder-komutu) |
| `dashboard / dashboard serve` | Hermes monitoring | [07](./07-cli-build-ve-packages.md#76-dashboard-komutu) |

### Hecateq Komutlar (Experimental)

| Komut | Açıklama | Kaynak Detay |
|-------|----------|-------------|
| `hecateq plan <prompt>` | Pre-execution pipeline (plan-only, execution yok) | [07](./07-cli-build-ve-packages.md#hecateq-plan-prompt) |
| `hecateq run <prompt>` | Auto-run low-risk, plan-only high-risk | [07](./07-cli-build-ve-packages.md#hecateq-run-prompt) |
| `hecateq resume [--session-id]` | Tamamlanmamış session kurtarma | [07](./07-cli-build-ve-packages.md#hecateq-resume---session-id-id) |
| `hecateq status` | Orchestration durum özeti | [07](./07-cli-build-ve-packages.md#hecateq-status) |
| `hecateq doctor` | 11 kategorili workflow teşhisi | [07](./07-cli-build-ve-packages.md#78-hecateq-doctor--11-kategori) |

### Hecateq Doctor — 11 Kategori

| # | Kategori | Doğruladıkları |
|---|----------|----------------|
| 1 | **Agent Registration** | Hecateq agent'larının OpenCode agent config'inde kaydı |
| 2 | **Configuration** | `hecateq` config bloğu geçerliliği |
| 3 | **Orchestration** | `.opencode/orchestration/` dizini ve session dosyaları |
| 4 | **Safety Hooks** | `hecateq-memory-bootstrap`, `hecateq-project-context-injector` varlığı |
| 5 | **Handoff State** | Handoff dosyalarının varlığı ve parse edilebilirliği |
| 6 | **Role Policy** | Handoff rol politikası tutarlılığı |
| 7 | **Project Memory** | Memory dizini, dosya kalitesi, placeholder kontrolü |
| 8 | **Memory Manifest** | Manifest versiyon güncelliği, pointer geçerliliği |
| 9 | **Custom Agents** | `.opencode/agents/` içindeki özel ajan tanımları |
| 10 | **Agent Index** | Agent index güncelliği (stale kontrolü) |
| 11 | **Artifacts** | Artifact dizin yapısı |

---

## 10. Konvansiyonlar ve Anti-Patterns

### Kod Konvansiyonları

| Kural | Değer |
|-------|-------|
| **Runtime** | Yalnızca Bun 1.3.12. npm/yarn/pnpm yasak. |
| **TypeScript** | strict mode, ESNext, bundler moduleResolution, `bun-types` (`@types/node` yasak) |
| **Test framework** | `bun:test`, co-located `*.test.ts`, given/when/then stili |
| **Test stili** | given/when/then (prefix veya inline comment). Arrange-Act-Assert yasak. |
| **Factory pattern** | `createXXX()` tüm tool, hook, agent için |
| **Dosya adlandırma** | kebab-case (dosya ve dizinler) |
| **Modül yapısı** | barrel `index.ts`. Catch-all dosyaları yasak (`utils.ts`, `helpers.ts`, `service.ts`) |
| **Import** | Modül içinde relative, modüller arası barrel. Path alias yasak (`@/` — sadece `packages/web/` için geçerli) |
| **Config formatı** | JSONC (yorum + trailing comma), Zod v4, snake_case |
| **Dosya boyutu** | ~200 LOC soft limit |
| **Yorumlar** | AI slop kalıpları `comment-checker` ile bloklanır. `// @allow` ile bypass. |
| **PR merge** | Sadece merge commit. Squash/rebase yasak. Tüm PR'lar `dev` branch'ine. |

### Anti-Patterns (Blocking)

| Anti-Pattern | Neden Yasak |
|-------------|-------------|
| `as any`, `@ts-ignore`, `@ts-expect-error` | Tip güvenliğini ihlal eder |
| Emoji kod/yorum (istenmedikçe) | Profesyonel değil |
| `package.json` `version` elle değiştirmek | Publish workflow'u yönetir |
| Read yapmadan dosyaya yazmak | `writeExistingFileGuard` bloklar |
| Test silip build'i yeşil yapmak | Kodu düzelt, testi değil |
| Em dash / en dash (`—`, `–`) | AI filler karakterleri |
| `utils.ts`, `helpers.ts`, `service.ts` | Catch-all, modülerliği bozar |
| Boş catch bloğu `catch(e) {}` | Hataları sessizce yutar |
| AAA yorumları (Arrange/Act/Assert) | given/when/then kullan |
| `index.ts`'e iş mantığı koymak | Sadece barrel export |
| Prometheus non-`.md` düzenlemesi | `prometheusMdOnly` hook'u engeller |
| `background_cancel(all=true)` | Task ID ile tek tek iptal et |
| `session.promptAsync` ham çağrısı | `prompt-async-gate` üzerinden git |
| `setTimeout(resolve, N)` testlerde | Zaman SUT değilse yasak |

---

## 11. Katılım

| Konu | Detay |
|------|-------|
| **CONTRIBUTING.md** | Kök dizinde — katkı kuralları, kod stili, PR süreci |
| **PR Merge Policy** | Sadece `dev` branch'ine PR. Merge commit zorunlu (`--squash`/`--rebase` yasak). CI + review-work + Cubic pass gerekli. |
| **CLA** | `signatures/cla.json` — katkıda bulunan lisans sözleşmesi. `cla.yml` workflow'u ile yönetilir. |
| **Lisans** | SUL-1.0 (Sustainable Use License v1.0) — `LICENSE.md` |
| **Atıf** | `NOTICE.md` — oh-my-openagent (YeonGyu Kim) atıf ve lisans bildirimi |
| **Güvenlik** | `SECURITY.md` — güvenlik politikası |
| **Geliştirme komutları** | `bun test`, `bun run typecheck`, `bun run build`, `bun run build:all` — detay: [09](./09-dokumantasyon-ve-proje-yapilandirmasi.md#912-geliştirme-komutları) |

---

## 12. Bu Rehberin Sınırları

Bu rehber serisi (`rehber/`), Hecateq OpenAgent projesinin **kaynak kod yapısını, mimarisini ve iç işleyişini** anlatır. Aşağıdaki konuları **kapsamaz**:

| Konu | Başvurulacak Kaynak |
|------|-------------------|
| Kullanıcı rehberleri (kurulum, yapılandırma) | `docs/guide/` |
| API/CLI referansı | `docs/reference/cli.md`, `docs/reference/configuration.md` |
| Hecateq-özel derinlemesine dokümantasyon | `docs/hecateq/` (17 dosya) |
| Feature sınıflandırması ve durumları | `docs/hecateq/features.md` |
| Hook ve tool kataloğu | `docs/hecateq/hooks-tools.md` |
| Memory sistemi | `docs/hecateq/memory-system.md` |
| Orchestration pipeline | `docs/hecateq/orchestration.md` |
| Routing ve delegasyon | `docs/hecateq/routing.md` |
| Team mode | `docs/guide/team-mode.md`, `docs/hecateq/team-mode.md` |
| Sorun giderme | `docs/hecateq/troubleshooting.md` |
| Geliştirici referansı (kök) | `AGENTS.md` (kök dizin) |
| Kaynak kod haritası | `docs/hecateq/source-map.md` |
| Örnek config'ler | `docs/examples/` |
| Proje manifestosu | `docs/manifesto.md` |
| Yasal belgeler | `docs/legal/` |
| Hooks ve tools kodu | `src/hooks/`, `src/tools/` |
| Agent fabrikaları | `src/agents/` |
| Feature implementasyonları | `src/features/` |
| Yayın süreci | `docs/reference/release-process.md`, `docs/release.md` |

---

> Bu rehber, Hecateq OpenAgent v0.1.0-beta.8 (dev branch, commit 39aadbf9f) için hazırlanmıştır.
> Güncelleme önerileri için PR açınız veya `rehber/` dizininde issue oluşturunuz.
