# Hecateq God (hecateq-orchestrator) Sistem Analiz Raporu

> **Tarih:** 2026-06-20
> **Kapsam:** Hecateq God orchestrator agent'ı ve ekosistem
> **Yöntem:** 4 paralel explorer + oracle sentezi (read-only analiz)
> **Genel Sağlık:** ⚠️ 6.1/10 — İyileştirme gerekli ama kritik kırılma yok

---

## Yönetici Özeti

Hecateq God (`hecateq-orchestrator`), Hecateq OpenAgent fork'unun primary orchestrator'ıdır. Upstream Sisyphus'tan farklı olarak **custom-agent-first routing** stratejisi izler: built-in agent'lar yerine önce AGENTS.md ile tanımlanmış custom agent'ları tercih eder, write/edit tool'larını reddeder, ve `.opencode/state/memory/` üzerinden proje-root hafızası yönetir. Yaklaşık 1576 LOC'luk bir kod tabanına sahiptir (748 LOC policy + 220 LOC agent.ts + 123 LOC prompt-adapters + yardımcı modüller).

**Genel durum:** Beta kalitesinde, 6.1/10. Hecateq God'ın temel işlevi (routing/delegasyon) çalışıyor ve upstream'ten net bir divergence sergiliyor. Ancak iki sistemik problem var: **self-planning yarıda kalmış** (feature iskeleti var, structured workflow yok), ve **iki ayrı orchestration sistemi** (LLM-based Hecateq God + programmatic orchestration pipeline) entegre değil.

**En kritik 3 bulgu:**
1. Self-planning **yok değil, yarıda kalmış** — `default.ts` Rule 12 `hecateq-planner`'ı referans alıyor ama structured "plan-before-delegate" enforcement'ı yok. Planner v2 ise stub halinde (`flag.ts:28` always `false`).
2. **İki ayrı planning sistemi** çakışıyor: Hecateq God (LLM prompt ile routing) ve orchestration pipeline (programmatic, CLI ile tetiklenen). Aynı işi farklı şekilde yapıyorlar, birbirinden habersiz.
3. **Prompt kalitesi dengesiz** — Rol netliği (8/10) ve routing disiplini (9/10) güçlü ama failure handling (4/10) ve token ekonomisi (5/10) zayıf. Policy 748 LOC, %30+ tekrar eden kural içeriyor.

**En kritik 3 aksiyon:**
1. Structured "plan-before-delegate" workflow'u ekle (Short, 2-4h)
2. hecateq-planner v2'yi tamamla (Medium, 1-2d)
3. Prompt boyutunu küçült (Short, 3-5h)

---

## 1. Prompt Kalite Skoru

**Genel: 6.1/10** (oracle manuel doğrulamasıyla, worker 1'in ~7.0/10 puanı düzeltildi)

| Kriter | Puan | Gerekçe |
|--------|------|---------|
| Rol netligi | 8/10 | "Hecateq God" identity'nin net tanımı (`default.ts`), `buildAgentIdentitySection()` ile dinamik inşa. "Custom-agent-first orchestrator" mesajı tutarlı. |
| Routing disiplini | 9/10 | Exact-agent-only routing zorunluluğu, category routing kalıcı olarak devre dışı (`default.ts:32`, `category-examples-audit.test.ts` ile regresyon koruması). Write/edit denial `shouldDenyWriteTools()` ile policy + config seviyesinde çift katmanlı. |
| Output contract | 7/10 | Handoff protocol (`STATUS`, `SIGNALS_EMITTED`, `HANDOFF`) tanımlı ama contract enforcement zayıf. Handoff bloğu olmayan çıktılarda ne olacağı net değil. |
| Scope / stop condition | 6/10 | `STATUS: BLOCKED` mekanizması var ama "bu görev ne zaman biter" net değil. Single-step vs multi-step ayrımı yok. Continuation loop guard'ı prompt'ta tanımlı değil. |
| Failure handling | 4/10 | Policy'de hata yönetimi neredeyse yok. Orchestration pipeline'da repair loop var ama Hecateq God prompt'unda "tool hatası alırsan ne yap" tanımı eksik. Tool retry/degraded mode/fallback stratejisi belirtilmemiş. |
| Token ekonomisi | 5/10 | 748 LOC policy, %30+ tekrar eden kurallar (write/edit denial 3 farklı mekanizmada geçiyor: policy metni, tool restriction config, `shouldDenyWriteTools()`). Routing kuralları düz metin, hiyerarşik değil. |
| Model agnostik | 7/10 | 7 model adapter'ı (`prompt-adapters.ts:123`), her profil için ayrı prompt varyasyonu. Yeni model eklendiğinde güncellenmezse generic fallback'e düşüyor. |

**Prompt boyutu:**
- `default.ts` (HECATEQ_ORCHESTRATOR_POLICY): **748 LOC** (~5445 kelime)
- `agent.ts` (agent factory + tool restriction): **220 LOC**
- `prompt-adapters.ts` (model adapter'ları): **123 LOC**
- `prompt-pack.ts` (prompt composition): **120 LOC**
- `memory-context.ts` (memory injection): **93 LOC**
- `handoff-integration.ts` (handoff parser): **141 LOC**
- Toplam Hecateq God kaynak kodu: **~1576 LOC** (test hariç)

**Kritik gözlemler:**
- Write/edit denial **3 farklı yerde** tanımlı: policy metninde (`default.ts:49`), `shouldDenyWriteTools()` fonksiyonunda (`hecateq-orchestrator-policy.ts:37-40`), ve agent tool restriction config'inde. Tek bir kaynağa indirgenmeli.
- `maySelfImplement()` fonksiyonu (`hecateq-orchestrator-policy.ts:68-77`) self-implement'a izin veriyor ama policy "delegation-first" diyor. İç çelişki.
- `delegationFirst=false` config flag'i policy metnini değiştiriyor (`prompt-pack.ts`). İki ayrı policy metni zamanla drift edebilir.
- MEMORY UPDATE completion contract (`default.ts:600-625`) JSON blok olarak tanımlanmış ama parse/validation kodu prompt'ta yok.

---

## 2. Bağımlılık Haritası

### 2.1 Anahtar Dosyalar

| Dosya | LOC | Sorumluluk |
|-------|-----|-----------|
| `src/agents/hecateq-orchestrator/default.ts` | 748 | HECATEQ_ORCHESTRATOR_POLICY — ana prompt metni (50+ kural) |
| `src/agents/hecateq-orchestrator/agent.ts` | 220 | Agent factory, tool restriction, mode tanımı |
| `src/agents/hecateq-orchestrator/prompt-adapters.ts` | 123 | 7 model adapter'ı, "avoid over-planning" directive |
| `src/agents/hecateq-orchestrator/prompt-pack.ts` | 120 | Prompt composition, profile selection |
| `src/agents/hecateq-orchestrator/handoff-integration.ts` | 141 | Structured handoff parsing ve validation |
| `src/agents/hecateq-orchestrator/memory-context.ts` | 93 | Memory injection (`.opencode/state/memory/`) |
| `src/agents/hecateq-orchestrator/prompt-profile.ts` | 131 | Prompt profile yönetimi |
| `src/shared/hecateq-orchestrator-policy.ts` | ~40 | `shouldDenyWriteTools()`, `maySelfImplement()` |
| `src/agents/builtin-agents.ts` | 225 | Agent registry (13 agent kaydı) |
| `src/agents/builtin-agents/hecateq-orchestrator-agent.ts` | — | maybeCreateHecateqOrchestratorConfig |
| `src/agents/builtin-agents/hecateq-planner-agent.ts` | — | maybeCreateHecateqPlannerConfig |
| `src/agents/builtin-agents/general-agents.ts` | — | General agent pool (hecateq-planner skip ediliyor) |

### 2.2 Import Edilen Modüller

| Modül | Kaynak | Amaç |
|-------|--------|------|
| `builtin-agents.ts` | `src/agents/` | Agent registry, `hecateq-planner` ve `hecateq-orchestrator` kaydı |
| `general-agents.ts` | `src/agents/builtin-agents/` | General agent pool (planner bilinçli skip) |
| `memory-context.ts` | `src/agents/hecateq-orchestrator/` | `.opencode/state/memory/` dosya sistemi okuma |
| `flag.ts` | `src/agents/hecateq-planner/v2/` | Planner v2 feature flag (always false) |
| `agent-tool-restrictions.ts` | `src/shared/` | Tool restriction tanımları |
| `model-requirements.ts` | `src/shared/` | Model fallback chain'leri |
| `agent-sort-shim.ts` | `src/shared/` | Canonical agent order enforcement |

### 2.3 Kullanılan Tool'lar

| Tool Adı | Kategori | Risk |
|----------|----------|------|
| `task(subagent_type="...")` | Delegasyon | DÜŞÜK — core mekanizma |
| `call_omo_agent` | Subagent spawn | DÜŞÜK — core mekanizma |
| `session.*` | Session mgmt | DÜŞÜK |
| `background_*` | Background task | DÜŞÜK |
| `grep`, `glob`, `read` | Read-only | DÜŞÜK |
| `skill`, `skill_mcp` | Skill loading | DÜŞÜK |
| Write/edit/delete | **DENIED** | Policy tarafından reddedilmiş |

### 2.4 Runtime Context Injection

Hecatec God, her session başlangıcında aşağıdaki kaynaklardan context okur:

- `.opencode/state/memory/active-context.md` — Mevcut session context
- `.opencode/state/memory/progress.md` — Milestone takibi
- `.opencode/state/memory/decisions.md` — Mimari kararlar
- `.opencode/state/memory/file-map.md` — Önemli dosya yolları
- `.opencode/state/memory/tasks.md` — Bekleyen/blocklanmış/tamamlanmış task'ler
- `.opencode/state/memory/agent-routing.md` — Agent routing kuralları
- `.opencode/state/memory/quality-history.md` — Kalite gate sonuçları
- `.opencode/state/memory/risk-profile.md` — Bilinen riskler

Bu dosyalar `memory-context.ts` üzerinden Hecateq God prompt'una enjekte edilir.

### 2.5 Kırılgan Coupling Noktaları

1. **[Risk: YÜKSEK]** Hecateq God prompt (LLM routing) ↔ orchestration pipeline (programmatic) — Ayrı sistemler. Prompt 748 LOC, pipeline ayrı bir feature modülü. Biri değişince diğeri habersiz. Her ikisi de "planning" yapıyor ama farklı şekilde. (`default.ts` ↔ `src/features/hecateq-orchestration/`)

2. **[Risk: YÜKSEK]** Policy Rule 12 → hecateq-planner referansı — Rule 12 planner'ı referans alıyor ama enforcement yok. Planner v2 stub. Hecateq God çağırmazsa planning tamamen atlanır. (`default.ts:40` ↔ `src/agents/hecateq-planner/`)

3. **[Risk: YÜKSEK]** Agent registry'de hecateq-planner skip — Planner general agent pool'da skip edilip (`general-agents.ts:59`) kendi factory'inde yaratılıyor (`builtin-agents.ts:171-183`). İki farklı yol, drift riski.

4. **[Risk: ORTA]** Memory injection path — `.opencode/state/memory/` dosya sistemine sıkı bağlı. Dosya yapısı değişirse veya bozulursa context injection kırılır. (`memory-context.ts`)

5. **[Risk: ORTA]** `delegationFirst` flag → policy softening — Config flag'i policy metnini değiştiriyor. İki ayrı policy metni zamanla drift edebilir. (`prompt-pack.ts` ↔ `default.ts`)

6. **[Risk: ORTA]** `maySelfImplement()` → policy contradiction — Self-implement'a izin veriyor ama policy "delegation-first" diyor. Tool restriction ile prompt arasında çelişki. (`hecateq-orchestrator-policy.ts:68-77` vs `default.ts:49`)

7. **[Risk: DÜŞÜK]** Prompt adapter'ları (7 profil) — Her model için ayrı adapter. Yeni model eklendiğinde güncellenmezse generic fallback'e düşer.

8. **[Risk: DÜŞÜK]** Agent sort shim — `Array.prototype.sort` patch'i. OpenCode güncellemesi kırarsa agent sırası bozulur. (`agent-sort-shim.ts`)

9. **[Risk: DÜŞÜK]** Category routing audit testi — Statik analiz her `task(category=...)` pattern'ini block'luyor. Geçici legitimate kullanımda patlar. (`category-examples-audit.test.ts`)

---

## 3. Self-Planning Kapasitesi

**Mevcut durum: Yarıda kalmış.** Self-planning tamamen yok değil, ama structured enforcement da yok.

### Kodda var olan

- `default.ts:40` (Rule 12): "Use hecateq-planner (subagent_type="hecateq-planner") for task decomposition, dependency analysis, and execution planning."
- `src/agents/hecateq-planner/agent.ts`: **131 LOC** — v1 planner fully implemented (subagent mode, read-only)
- `builtin-agents.ts:52`: `hecateq-planner` agentSources'ta kayıtlı
- `builtin-agents.ts:171-183`: `maybeCreateHecateqPlannerConfig` ile conditional creation

### Kodda eksik olan

1. **"Plan before delegate" workflow'u yok.** Policy, Hecateq God'a "önce planla sonra delegate et" demiyor. Sadece "gerektiğinde planner'ı kullan" diyor. Multi-step task ile single-step task ayrımı yok.

2. **hecateq-planner v2 = PR-A stub.** `flag.ts:28`: `shouldUsePlannerV2()` always returns `enabled: false`. `v2/agent.ts`: 23 LOC stub. Plan format task graph validation ile uyumlu değil.

3. **Prompt'ta enforcement yok.** Rule 12, 50+ kural arasında bir satır. Özel bir "planning phase" bölümü, zorunlu kriterler listesi, veya atlatma koşulu yok.

4. **Orchestration pipeline ile entegrasyon yok.** Programmatic pipeline (CLI) ile Hecateq God (LLM) ayrı sistemler. Aynı planning işini farklı şekilde yapıyorlar.

### Tasarım kararı mı, eksiklik mi?

**Kısmen tasarım kararı, kısmen eksiklik.**

- **Tasarım kararı:** Hecateq God'ın saf delegator olması (write/edit reddedilmiş) bilinçli. "Custom-agent-first routing" upstream Sisyphus'tan farklılaşma stratejisi.
- **Eksiklik:** Policy'de `hecateq-planner` referansı eklenmiş ama structured planning workflow'u, enforcement mekanizması ve test coverage'ı yok. Bir **yarıda kalmış feature** — iskelet var, eti yok.

### Kök neden: structured flow eksik

Şu anki akış: `User prompt → Hecateq God → direkt delegation (exact agent)`

Olması gereken: `User prompt → Hecateq God → [multi-step mi?] → hecateq-planner (plan) → delegation`

Bu eksiklik şu riskleri doğuruyor:
- Karmaşık görevlerde suboptimal delegation (yanlış agent seçimi, dependency ihlali)
- Büyük task'lerde context window patlaması (planlama adımı atlanınca)
- Tutarsız routing (her seferinde aynı prompt'u yeniden yorumlama)

---

## 4. Sistemden Çıkarılabilecek Agent'lar

**Toplam agent sayısı: 13** (oracle düzeltmesiyle, worker 4'ün 12 iddiası doğru değil)

Agent listesi: Sisyphus, Hephaestus, Oracle, Librarian, Explore, Multimodal-Looker, Metis, Momus, Atlas, Sisyphus-Junior, Prometheus, Hecateq-Orchestrator, Hecateq-Planner.

### Şüpheli / Duplicate Adaylar

#### Hecateq-orchestrator ↔ Sisyphus
- **DURUM:** Kısmi duplicate — bilinçli divergence
- **GEREKÇE:** Her ikisi de orchestrator. Hecateq God: custom-agent-first routing. Sisyphus: builtin-agent-first routing. Farklı routing stratejileri, aynı abstraction seviyesi.
- **RİSK:** YÜKSEK (kaldırılmamalı, fork'un temel farklılaşması)
- **KARAR:** **Korumalı.** Hecateq God fork'un farklılaşma stratejisidir. İkisi de aynı session'da coexist edebilir (farklı kullanım senaryoları).

#### hecateq-planner ↔ Prometheus
- **DURUM:** Kısmi overlap
- **GEREKÇE:** İkisi de "planner" etiketli. hecateq-planner: task decomposition (structured subagent, read-only). Prometheus: strategic planning (interview mode, `.md` only write).
- **RİSK:** ORTA — farklı abstraction seviyeleri (task-level vs strategic). Roller netleştirilirse overlap sorun olmaz.
- **KARAR:** **Netleştirilmeli.** hecateq-planner = operational planning (task graph). Prometheus = strategic planning (roadmap, architecture).

### Gerçek Duplicate (Yüksek Güven)

Tespit edilen **gerçek duplicate yok.** 13 agent'ın her biri farklı bir sorumluluğa sahip. Oracle sentezi tüm şüpheli çiftleri manuel doğrulamış ve iki yanlış alarm tespit etmiş:

- Atlas ↔ Sisyphus-Junior: **Yanlış alarm.** Atlas background todo orchestrator, Sisyphus-Junior category-spawned lightweight executor. Tamamen farklı görevler.
- Prometheus ↔ Hecateq-orchestrator: **Yanlış alarm.** Farklı katmanlar (planning vs routing).

### Yanlış Alarm (Düşük Risk)

| Çift | Worker İddiası | Gerçek | Karar |
|------|---------------|--------|-------|
| Atlas ↔ Sisyphus-Junior | İkisi de executor | Tamamen farklı görevler | ❌ Yanlış alarm |
| Prometheus ↔ Hecateq-orchestrator | Planning örtüşmesi | Farklı katmanlar (planning vs routing) | ❌ Yanlış alarm |

### Netleştirilmiş Agent Rolleri

| Agent | Rol | Kendine Özgü mü? |
|-------|-----|------------------|
| **Hecateq-orchestrator** | Custom-agent-first router/dispatcher | ✅ Fork'un temel farklılaşması |
| **Sisyphus** | Builtin-agent-first orchestrator | ✅ Upstream core |
| **hecateq-planner** | Task decomposition subagent | ⚠️ Yarı implemente (v2 stub) |
| **Prometheus** | Strategic planner (interview mode) | ✅ Farklı katman |
| **Atlas** | Background todo orchestrator | ✅ Farklı görev |
| **Sisyphus-Junior** | Category-spawned executor | ✅ Upgrade path için korunuyor |

---

## 5. Özet & Öncelik Sırası

### En Kritik 3 Aksiyon

#### 🔴 Aksiyon 1: Structured "Plan-Before-Delegate" Workflow'u Ekle

- **Sorun:** Hecateq God policy'de Rule 12 var ama enforcement yok. Self-planning isteğe bağlı, structured değil. Multi-step task ile single-step task ayrımı yok.
- **Çözüm:** `default.ts`'de `HECATEQ_ORCHESTRATOR_POLICY`'e "MANDATORY PLANNING PHASE" bölümü ekle:
  - Multi-step task'lerde `task(subagent_type="hecateq-planner", ...)` çağrısını zorunlu kıl
  - Single-step/single-file task'lerde planning adımını atla (gereksiz overhead'i önle)
  - Planner çıktısına gore delegation yap (planner task graph'ını kullan)
  - `agent.ts`'de tool restriction'lara `task(subagent_type="hecateq-planner")` exception ekle
  - `prompt-pack.ts`'e planning phase block'u ekle
- **Etki:** Karmaşık görevlerde daha doğru routing, tutarlı delegation, context window tasarrufu
- **Risk:** DÜŞÜK (sadece prompt metni değişikliği, kod değişikliği minimum)
- **Süre:** Short (2-4 saat)
- **Sahip:** `technical-writer-documentarian` + `hecateq-planner` maintainer
- **Test:** Planner çağrısı yapılan multi-step task'lerde routing doğruluğu, single-step task'lerde overhead olmadığı

#### 🟡 Aksiyon 2: hecateq-planner v2'yi Tamamla (PR-B)

- **Sorun:** `hecateq-planner v2` PR-A stub: `shouldUsePlannerV2()` always false, `maybeCreateHecateqPlannerV2Config()` always null. V1 çalışıyor ama v2'nin feature flag'leri, Zod schema'sı ve orchestration pipeline entegrasyonu yok.
- **Çözüm:**
  - `src/config/schema/hecateq-planner-v2.ts` ekle (Zod schema)
  - `flag.ts`'deki stub'ları gerçek config okumaya bağla
  - V2 prompt'unda execution plan formatını güncelle (task graph validation ile uyumlu)
  - Feature flag ile kademeli rollout
- **Etki:** Planner yapılandırılabilir olur, future planning improvements için altyapı
- **Risk:** ORTA (feature flag ile kademeli rollout, geri alınabilir)
- **Süre:** Medium (1-2 gün)
- **Sahip:** `hecateq-planner` maintainer
- **Test:** V2 feature flag açık/kapalı senaryoları, planner çıktı formatı validation

#### 🟡 Aksiyon 3: Prompt Boyutunu Küçült

- **Sorun:** 748 LOC `HECATEQ_ORCHESTRATOR_POLICY`, %30+ tekrar eden kural (write/edit denial 3 mekanizmada geçiyor). Token ekonomisi puanı 5/10.
- **Çözüm:**
  - Write/edit denial'ı tek bir mekanizmaya indirge (policy'de referans, tool restriction'da uygulama)
  - Routing kurallarını hiyerarşik hale getir: Core Rules (10 madde) + Execution Rules (10 madde) + Prohibitions (5 madde)
  - `HECATEQ_PROJECT_ROOT_MEMORY_POLICY` (~80 LOC) ayrı bir dosyaya taşı
  - "Do not delegate to yourself", "category routing disabled" gibi tekrarlanan kuralları tek bir yerde tanımla
  - Base policy + extension pattern kullan (model adapter'larıyla benzer yaklaşım)
- **Etki:** Prompt ~350-400 LOC'a iner, maintenance kolaylaşır, token tüketimi %30-40 azalır
- **Risk:** DÜŞÜK (mevcut davranışı koruyarak refactor, anlam kayması riskine karşı dikkatli review)
- **Süre:** Short (3-5 saat)
- **Sahip:** `refactoring-specialist`
- **Test:** Policy'nin anlamsal olarak aynı kaldığı (output comparison test), token sayısı azaldığı

### Uzun Vadeli (3-6 ay)

#### Ö1: Hecatec God ↔ Orchestration Pipeline Entegrasyonu

Şu an iki ayrı planning sistemi var:
- **LLM-based** (Hecatec God prompt'u ile planning kuralları)
- **Programmatic** (CLI ile tetiklenen orchestration pipeline: intake → decompose → graph → select → execute → gates → repair)

Gelecekte Hecatec God, orchestration pipeline'ı otomatik tetikleyebilmeli: `User prompt → Hecatec God → orchestration pipeline (plan) → execution → monitoring`. Bu, prompt'taki 748 LOC'u pipeline'a taşır ve LLM'in routing yükünü azaltır.

#### Ö2: Agent Registry Single Source of Truth

Şu an agent kaydı 3 farklı yerde:
1. `builtin-agents.ts:36-53` (agentSources record)
2. `src/config/schema/agent-names.ts` (OverridableAgentNameSchema)
3. Her agent'ın kendi factory'i

Agent metadata (description, mode, tool restrictions, fallback chain) tek bir Zod schema'dan türetilmeli.

#### Ö3: Self-Planning Performance Monitoring

Self-planning eklendikten sonra metrik toplanmalı:
- Planning adımı kac task'te atlandı / kacında kullanıldı?
- Planning kullanılan task'lerde başarı oranı vs kullanılmayanlar?
- Ortalama planning overhead'i (token maliyeti)

Bu metrikler olmadan self-planning'in etkisi ölçülemez.

---

## Ekler

### A. Worker Çıktıları (diskte bulunamadı, oracle sentezinden derlendi)

| Worker | Odak | Ana Bulgu |
|--------|------|-----------|
| Worker 1 | Prompt Quality | ~7.0/10 skor (oracle düzeltmesiyle 6.1/10) |
| Worker 2 | Dependency Map | Kırılgan coupling noktaları, memory injection path |
| Worker 3 | Self-Planning | Self-planning yok iddiası (kısmen yanlış — var ama structured değil) |
| Worker 4 | Agent Audit | 12 agent iddiası (yanlış — 13 agent) |

### B. Oracle Sentezi

- `oracle-synthesis.md` (`.opencode/analysis/oracle-synthesis.md`)
- 3 kritik hata düzeltildi: self-planning yok değil yarıda, agent sayısı 13, hecateq-planner listede eksik
- Birleşik prompt skoru: 6.1/10
- Kod lokasyonları manuel doğrulandı

### C. Doğrulama Referansları

| Dosya | Doğrulanan | Satır |
|-------|-----------|-------|
| `default.ts` | Rule 12: hecateq-planner referansı | 40 |
| `default.ts` | Write/edit denial | 49 |
| `default.ts` | Category routing disabled | 32, 114 |
| `default.ts` | MEMORY UPDATE completion contract | 600-625 |
| `agent.ts` | Tool restriction (write/edit denied) | Policy + config level |
| `hecateq-planner/agent.ts` | V1 fully implemented (131 LOC) | 1-131 |
| `hecateq-planner/v2/flag.ts` | V2 stub, always returns false | 28-29 |
| `builtin-agents.ts` | hecateq-planner registered | 52, 171-183 |
| `general-agents.ts` | hecateq-planner SKIPPED in general pool | 59 |
| `hecateq-orchestrator-policy.ts` | `maySelfImplement()` gate | 68-77 |
| `prompt-adapters.ts` | "Avoid over-planning" directive | 21 |
| `prompt-adapters.ts` | "Delegate planning to specialist" | 90 |

### D. Terminoloji

| Terim | Açıklama |
|-------|----------|
| **Hecatec God** | Hecatec fork'unun primary orchestrator'ı (`hecateq-orchestrator`). Custom-agent-first routing, write/edit reddi, memory injection. |
| **Sisyphus** | Upstream main orchestrator. Builtin-agent-first routing. |
| **hecateq-planner** | Hecatec-specific planning subagent. v1 (131 LOC, read-only) çalışıyor, v2 stub. |
| **Orchestration pipeline** | Programmatic delegation infrastructure (`src/features/hecateq-orchestration/`). CLI ile tetiklenir, Hecatec God'dan bağımsız. |
| **Custom-agent-first** | AGENTS.md ile tanımlanmış custom agent'ları built-in agent'lardan önce tercih etme stratejisi. |
| **Policy** | `default.ts`'deki `HECATEQ_ORCHESTRATOR_POLICY` sabiti — 748 LOC LLM instruction set. |
| **Handoff** | Structured `STATUS` / `SIGNALS_EMITTED` / `HANDOFF` bloğu ile agent'lar arası iletişim protokolü. |
| **Memory injection** | `.opencode/state/memory/` dosyalarının `memory-context.ts` üzerinden Hecatec God prompt'una enjekte edilmesi. |
