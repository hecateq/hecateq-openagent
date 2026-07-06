# 02 — Ajanlar Sistemi

> **Hecateq OpenAgent — 12 AI Ajanı Detaylı Referans**
> Son güncelleme: 2026-06-30 | Fork: Hecateq | Temel: oh-my-openagent v4.2.0

---

## İçindekiler

1. [12 Ajan Tablosu](#12-ajan-tablosu)
2. [3 Ajan Modu](#3-ajan-modu)
3. [Hecateq Özel Ajanları](#hecateq-özel-ajanları)
4. [Hecateq God vs Sisyphus](#hecateq-god-vs-sisyphus)
5. [AGENT_ELIGIBILITY_REGISTRY (Team-Mode)](#agent_eligibility_registry-team-mode)
6. [Ajan Sistem Prompt Mimarisi](#ajan-sistem-prompt-mimarisi)
7. [Ajan Override Alanları](#ajan-override-alanları)
8. [Ajan İletişim Kalıpları](#ajan-i̇letişim-kalıpları)
9. [Model Gereksinimleri](#model-gereksinimleri)

---

## 12 Ajan Tablosu

Hecateq OpenAgent, 12 built-in AI ajanı ile gelir. 11'i upstream oh-my-openagent'tan devralınmış, `hecateq-orchestrator` (Hecateq God) fork'ta eklenmiştir.

| # | Ajan Adı | Fabrika Fonksiyonu | Mod | Varsayılan Model | Sıcaklık | Yetki | Team Uygunluğu | Kaynak (Dosya:Satır) | Amaç |
|---|----------|-------------------|-----|------------------|----------|-------|---------------|---------------------|------|
| 1 | **Hecateq God** (hecateq-orchestrator) | `createHecateqOrchestratorAgent()` | all | Config'den çözülür | Model default | write/edit red, frontend disabled | eligible | `src/agents/hecateq-orchestrator/agent.ts:180-225` | Custom-agent-first orkestratör, Hecateq pipeline yöneticisi |
| 2 | **Sisyphus** | `createSisyphusAgent()` | primary | claude-opus-4-7 | Model default | call_omo_agent red | eligible | `src/agents/sisyphus.ts:520-696` | Ana orkestratör, planlama + delegasyon |
| 3 | **Hephaestus** | `createHephaestusAgent()` | primary | gpt-5.5 medium | Model default | Provider gating gerekli | conditional | `src/agents/hephaestus/agent.ts:123-342` | Implementasyon ajanı, kod yazma + hata ayıklama |
| 4 | **Atlas** | `createAtlasAgent()` | primary | claude-sonnet-4-6 | 0.1 | task/call_omo_agent red | eligible | `src/agents/atlas/agent.ts:113-280` | Todo list orkestratörü, background session yöneticisi |
| 5 | **Prometheus** | Özel builder (`buildPrometheusAgentConfig`) | primary | claude-opus-4-7 | Override-only | MD-only yazma | hard-reject | `src/agents/prometheus/agent.ts` | Stratejik planlayıcı, interview mod |
| 6 | **Oracle** | `createOracleAgent()` | subagent | gpt-5.5 high | 0.1 | Read-only araçlar | hard-reject | `src/agents/oracle.ts:541-591` | Read-only danışman, mimari inceleme |
| 7 | **Librarian** | `createLibrarianAgent()` | subagent | gpt-5.4-mini-fast | 0.1 | Read-only araçlar | hard-reject | `src/agents/librarian.ts:541-590` | Dış dokümantasyon arama, kod örneği bulma |
| 8 | **Explore** | `createExploreAgent()` | subagent | gpt-5.4-mini-fast | 0.1 | Read-only araçlar | hard-reject | `src/agents/explore.ts:71-147` | Kod tabanı keşfi, grep/glob |
| 9 | **Metis** | `createMetisAgent()` | subagent | claude-sonnet-4-6 | **0.3** | Read-only araçlar | hard-reject | `src/agents/metis.ts:123-345` | Ön-planlama danışmanı, güvenlik uyumluluğu |
| 10 | **Momus** | `createMomusAgent()` | subagent | gpt-5.5 xhigh | 0.1 | write/edit/task red | hard-reject | `src/agents/momus.ts:283-596` | Plan incelemecisi, varsayım kırıcı |
| 11 | **Multimodal-Looker** | `createMultimodalLookerAgent()` | subagent | gpt-5.5 medium | 0.1 | Read-only araçlar | hard-reject | `src/agents/multimodal-looker/agent.ts` | Görsel/PDF/diyagram analizi |
| 12 | **Sisyphus-Junior** | `createSisyphusJuniorAgent()` | subagent | claude-sonnet-4-6 | 0.1 | Frontend execution | eligible | `src/agents/sisyphus-junior/agent.ts:123-287` | Hafif executor, category-routed subagent |

### Ajan Fabrika Pattern'i

Tüm ajanlar aynı fabrika pattern'ini kullanır:

```typescript
// Örnek: Oracle ajan fabrikası
const createOracleAgent: AgentFactory = (model: string) => ({
  instructions: `Sen bir yazılım mimarisi danışmanısın...`,
  model,
  temperature: 0.1,
  permission: {
    write: false,
    edit: false,
    task: false,
    call_omo_agent: false,
  },
  // ...
})

createOracleAgent.mode = "subagent"  // Statik mod property'si
```

### Ajan Kaydı

Ajanlar `src/agents/builtin-agents.ts` içindeki `agentSources` record'unda kayıtlıdır:

```typescript
// src/agents/builtin-agents.ts (özet)
export const agentSources: Record<string, () => AgentFactory> = {
  sisyphus: () => createSisyphusAgent,
  hephaestus: () => createHephaestusAgent,
  oracle: () => createOracleAgent,
  // ... 10 ajan daha
}
```

**Not:** Prometheus bu kayıtta yer almaz. Onun config'i `src/plugin-handlers/prometheus-agent-config-builder.ts` içinde `agent-config-handler` Phase 3 sırasında doğrudan oluşturulur.

---

## 3 Ajan Modu

Her ajan bir `AgentMode` ile etiketlenir. Bu mod, UI model seçim davranışını belirler:

```typescript
// src/agents/types.ts:1-9
export type AgentMode = "primary" | "subagent" | "all";
```

### `primary` — Kullanıcı UI Model Seçimine Saygı Duyar

- Kullanıcının UI üzerinden seçtiği modeli kullanır
- Sisyphus, Hephaestus, Atlas, Prometheus bu moddadır
- Kullanıcı model değiştirdiğinde bu ajanların modeli de değişir

```typescript
// primary mod örneği — Sisyphus
createSisyphusAgent.mode = "primary"
// Kullanıcının seçtiği model ne ise onu kullanır
```

### `subagent` — Kendi Fallback Chain'ini Kullanır

- UI model seçimini **dikkate almaz**
- Kendi fallback chain'ini takip eder (model-requirements.ts içinde tanımlıdır)
- Oracle, Librarian, Explore, Multimodal-Looker, Metis, Momus, Sisyphus-Junior bu moddadır
- Background task'lerde ve delegasyonlarda kullanılır

```typescript
// subagent mod örneği — Oracle
createOracleAgent.mode = "subagent"
// UI'da hangi model seçili olursa olsun, Oracle gpt-5.5 high kullanır
```

### `all` — Her İki Bağlamda da Kullanılabilir

- Hem primary hem subagent bağlamında çalışabilir
- Hecateq God (hecateq-orchestrator) bu moddadır
- OpenCode uyumluluğu için eklenmiştir

```typescript
// all mod örneği — Hecateq God
const MODE: AgentMode = "all"
// Hem ana ajan hem subagent olarak kullanılabilir
```

---

## Hecateq Özel Ajanları

Hecateq fork'u, upstream'te olmayan 2 özel ajan ekler:

### 1. Hecateq God (hecateq-orchestrator)

Hecateq God, custom-agent-first iş akışının ana orkestratörüdür. Kanonik sıralamada ilk sıradadır (Sisyphus'tan önce).

**Temel Özellikler:**
- **Mod:** `all` (hem primary hem subagent bağlamında)
- **Renk:** `#7C3AED` (mor)
- **Reasoning Effort:** `high` (`thinking: { type: "enabled", budgetTokens: 32000 }`)
- **Dosya:** `src/agents/hecateq-orchestrator/agent.ts` (185 satır)
- **Varsayılan model:** Config'den çözülür (runtime'da belirlenir)

**Prompt Bileşenleri:**

```
buildDynamicPrompt(ctx)
  ├── categorizeTools(availableToolNames)          # Araçları domaine göre sınıflandır
  ├── buildCustomAgentRegistrySection(summaries)  # Özel ajan XML registry'si oluştur
  ├── buildAgentIdentitySection("Hecateq God")    # Kimlik başlığı
  └── buildHecateqPromptPack({...})               # Tam prompt'u oluştur
       ├── HECATEQ_ORCHESTRATOR_POLICY            # Çekirdek politika (677 LOC)
       ├── customAgentRegistrySection             # <custom-agent-registry> XML bloğu
       ├── taskToolNote                           # task() kullanım kılavuzu
       ├── memoryPolicySection                    # Memory politikası (opsiyonel)
       ├── model adapter block                    # Model-specific adapter
       ├── runtime truth reinforcement            # Strict runtime truth (opsiyonel)
       └── delegation bias block                  # Delegasyon eğilimi (opsiyonel)
```

**Custom Agent Registry XML Çıktısı:**

```xml
<custom-agent-registry>
<custom_agent name="backend-developer">
  <description>Implements REST APIs with Express and Prisma</description>
  <domain>backend</domain>
  <use-when>routing_signal == "api_implementation"</use-when>
  <avoid-when>routing_signal == "frontend_work"</avoid-when>
  <priority>high</priority>
  <skills>nodejs-backend-developer</skills>
</custom_agent>
</custom-agent-registry>
```

**Kısıtlanmış Araçlar:**
- `write` — red (orkestratör doğrudan dosya oluşturamaz)
- `edit` — red (kod değişikliği delegate ajanlara bırakılır)
- `call_omo_agent` — red (`task(subagent_type="...")` kullanılmalıdır)

**Tiny Safe Bridging Fix:** Hecateq God, çok dar istisnalarda doğrudan edit yapabilir. Şu koşulların TÜMÜ sağlanmalıdır:

| Koşul | Açıklama |
|-------|----------|
| 1. Localized | Tek dosya, tek küçük değişiklik |
| 2. Low risk | Mimari, domain mantığı veya cross-module davranış değişmez |
| 3. Obvious verification | Sonuç bariz ve ucuz doğrulanabilir |
| 4. No specialist needed | Uzman ajan gereksinimi yok |
| 5. Overhead exceeds value | Delegasyon maliyeti değerden fazla |

### 2. Hecateq Planner (hecateq-planner)

Hecateq Planner, `hecateq plan` CLI komutu için kullanılan yardımcı ajan.

| Özellik | Değer |
|---------|-------|
| **Mod** | `subagent` |
| **Renk** | `#8B5CF6` (açık mor) |
| **Sıcaklık** | 0.3 |
| **Dosya** | `src/agents/hecateq-planner/` |
| **Amaç** | Prompt analizi, task decomposition, plan oluşturma (execution yok) |

---

## Hecateq God vs Sisyphus

Hecateq God ve Sisyphus, her ikisi de orkestratör ajanlardır ancak önemli farkları vardır:

| Özellik | Hecateq God (hecateq-orchestrator) | Sisyphus |
|---------|-------------------------------------|----------|
| **Köken** | Hecateq fork eklentisi | Upstream'ten devralma |
| **Sıralama** | 1. sırada | 2. sırada |
| **Routing** | Custom-agent-first (özel ajanlar öncelikli) | Built-in ajan öncelikli |
| **Determinizm** | Deterministic routing, explicit fallback | Sıralı deneme, silent category fallback |
| **Category routing** | Kalıcı olarak devre dışı (`disable_category_routing: true`) | Aktif |
| **Memory** | Proje-kök memory (`.opencode/state/memory/`) | Yok |
| **Handoff** | Yapılandırılmış handoff blokları üretir | Ham metin |
| **Dependency graph** | Cycle detection + task DAG yönetimi | Yok |
| **Orchestration entegrasyonu** | Tam (pipeline: plan → run → resume → status) | Kısmi |
| **Quality gates** | typecheck/lint/test/build pipeline | Yok |
| **Repair loop** | Otomatik hata düzeltme (max 2 deneme) | Yok |
| **write/edit tool** | Red (orchestrator-only) | İzinli |
| **Custom agent registry** | XML `<custom-agent-registry>` bloğu | Yok |
| **Model adapters** | 7 model-specific adapter (GPT/Claude/Gemini/Qwen/DeepSeek/small/generic) | Model-specific prompt variants |
| **Delegation bias** | Yapılandırılabilir (conservative/expanded/balanced) | Hardcoded |
| **Kullanım senaryosu** | Hecateq pipeline aktifken, custom agent'lar varken | Standalone orkestrasyon |

### Ne Zaman Hangisi?

```typescript
// Hecateq God kullan:
// - Custom agent registry doluysa
// - Hecateq orchestration pipeline aktifse
// - Task dependency yönetimi gerekiyorsa
// - Multi-domain, contract-first işlerde

// Sisyphus kullan:
// - Standalone OpenCode kullanımında
// - Built-in ajanlar yeterliyse
// - Category routing gerekiyorsa
// - Hecateq pipeline devre dışıysa
```

---

## AGENT_ELIGIBILITY_REGISTRY (Team-Mode)

Team Mode, paralel multi-agent koordinasyon için ajanların uygunluğunu `AGENT_ELIGIBILITY_REGISTRY` ile belirler:

```typescript
// src/features/team-mode/types.ts:181-229 (özet)
export const AGENT_ELIGIBILITY_REGISTRY = {
  sisyphus: { verdict: "eligible" },
  hecateq-orchestrator: { verdict: "eligible" },
  atlas: { verdict: "eligible" },
  sisyphus-junior: { verdict: "eligible" },
  hephaestus: { verdict: "conditional", note: "teammate: allow gerekli" },
  oracle: { verdict: "hard-reject", message: "Read-only ajanlar takıma eklenemez" },
  librarian: { verdict: "hard-reject", message: "Read-only ajanlar takıma eklenemez" },
  explore: { verdict: "hard-reject", message: "Read-only ajanlar takıma eklenemez" },
  multimodal-looker: { verdict: "hard-reject", message: "Read-only ajanlar takıma eklenemez" },
  metis: { verdict: "hard-reject", message: "Read-only ajanlar takıma eklenemez" },
  momus: { verdict: "hard-reject", message: "Yalnızca plan inceler" },
  prometheus: { verdict: "hard-reject", message: "Yalnızca plan yazar" },
}
```

| Kategori | Ajanlar | Açıklama |
|----------|---------|----------|
| **eligible** | sisyphus, hecateq-orchestrator, atlas, sisyphus-junior | Team-mode'da direkt kullanılabilir |
| **conditional** | hephaestus | `teammate: "allow"` permission'ı gerektirir (D-36 / `tool-config-handler.ts`). Alternatif: `subagent_type: "sisyphus"` kullan |
| **hard-reject** | oracle, librarian, explore, multimodal-looker, metis, momus, prometheus | Team-mode'a eklenemez. `task()` ile delegasyon yapılmalıdır |

### Team-Mode Depolama Yapısı

```
~/.omo/teams/{name}/
├── config.json        # Takım spesifikasyonu
├── state.json         # Runtime state
├── mailbox/           # Mesaj kutusu
├── tasklist.jsonl     # Görev listesi
└── worktrees/         # Per-member git worktrees
```

### Takım Konfigürasyonu

```jsonc
{
  "team_mode": {
    "enabled": true,
    "max_parallel_members": 4,
    "max_members": 8,
    "max_messages_per_run": 10000,
    "max_wall_clock_minutes": 120,
    "max_member_turns": 500,
    "message_payload_max_bytes": 32768,
    "recipient_unread_max_bytes": 262144,
    "mailbox_poll_interval_ms": 3000
  }
}
```

Üyeler `kind: "subagent_type"` (direkt ajan) veya `kind: "category"` (Sisyphus-Junior üzerinden yönlendirilir) olarak tanımlanır.

---

## Ajan Sistem Prompt Mimarisi

Her ajanın sistem prompt'u `dynamic-agent-prompt-builder.ts` tarafından runtime'da dinamik olarak oluşturulur.

### 5 Bileşenli Prompt Yapısı

```typescript
// src/agents/dynamic-agent-prompt-builder.ts (özet)
export function buildDynamicPrompt(config: {
  agentName: string
  mode: AgentMode
  category?: AgentCategory
  skills?: string[]
  tools?: ToolDefinition[]
  availableAgents?: AgentInfo[]
  availableCategories?: CategoryInfo[]
}): string {
  const sections = [
    buildIdentitySection(config),                           // Bileşen 1: Kimlik
    buildToolTable(config.tools),                           // Bileşen 2: Araç tablosu
    buildDelegationTable(config.availableAgents),           // Bileşen 3: Delegasyon tablosu
    ...buildCoreSections(config),                           // Bileşen 4: Çekirdek bölümler
    ...buildPolicySections(config),                         // Bileşen 5: Politika bölümleri
  ]
  return sections.filter(Boolean).join("\n\n")
}
```

| Bileşen | Kaynak | Açıklama |
|---------|--------|----------|
| **1. Identity** | `dynamic-agent-core-sections.ts` | Ajan kimliği, yetki alanı, kısıtlamalar |
| **2. Tool Table** | `dynamic-agent-tool-categorization.ts` | Hangi aracın hangi domain'de kullanılacağı |
| **3. Delegation Table** | `dynamic-agent-core-sections.ts` | Hangi durumda hangi ajana delegasyon yapılacağı |
| **4. Core Sections** | `dynamic-agent-core-sections.ts` | Çalışma modu, iletişim kuralları |
| **5. Policy Sections** | `dynamic-agent-policy-sections.ts` | Citation politikası, anti-pattern'ler, güvenlik |

### Category-Skills Guide

`dynamic-agent-category-skills-guide.ts`, her category için hangi skill'lerin yükleneceğini belirler:

```typescript
// Örnek category-skill eşlemesi
{
  category: "quick",
  skills: ["git-master", "context7-mcp"],
}
{
  category: "ultrabrain",
  skills: ["typescript-programmer"],
}
```

---

## Ajan Override Alanları

Her ajan, `agents.<agent_name>` config anahtarı ile özelleştirilebilir. Toplam 20+ override alanı vardır:

### Model ve Parametreler

| Alan | Tip | Açıklama | Örnek |
|------|-----|----------|-------|
| `model` | `string` | Model ID override | `"anthropic/claude-sonnet-4-6"` |
| `variant` | `string` | Model variant | `"high"`, `"medium"`, `"low"` |
| `temperature` | `number` | Sampling sıcaklığı (0-1) | `0.1` |
| `top_p` | `number` | Nucleus sampling | `0.95` |
| `maxTokens` | `number` | Maksimum çıktı token'ı | `8192` |
| `reasoningEffort` | `"low" | "medium" | "high"` | Reasoning çabası | `"high"` |
| `thinking` | `object` | Extended thinking yapılandırması | `{ type: "enabled", budgetTokens: 32000 }` |
| `fallback_models` | `string | array` | Fallback model chain | `["gpt-5.5-medium", "claude-haiku"]` |

### Prompt ve Davranış

| Alan | Tip | Açıklama |
|------|-----|----------|
| `prompt` | `string` | Sistem prompt'unu tamamen değiştirir |
| `prompt_append` | `string` | Mevcut prompt'un sonuna eklenir |
| `description` | `string` | Ajan açıklaması |
| `skills` | `string[]` | Ajan için yüklenecek skill'ler |
| `textVerbosity` | `number` | Yanıt ayrıntı düzeyi |

### İzinler

| Alan | Tip | Açıklama |
|------|-----|----------|
| `permission.write` | `"allow" | "deny"` | Dosya yazma izni |
| `permission.edit` | `"allow" | "deny"` | Dosya düzenleme izni |
| `permission.question` | `"allow" | "deny"` | Soru sorma izni |
| `permission.call_omo_agent` | `"allow" | "deny"` | Subagent spawn izni |
| `tools` | `Record<string, boolean>` | Tool bazında izin/red |

### Yapılandırma

| Alan | Tip | Açıklama |
|------|-----|----------|
| `category` | `string` | Category ataması |
| `mode` | `"primary" | "subagent" | "all"` | Ajan modu |
| `color` | `string` | UI'da gösterim rengi |
| `disable` | `boolean` | Ajanı tamamen devre dışı bırakır |
| `providerOptions` | `object` | Provider-specific seçenekler |
| `ultrawork` | `boolean` | Ultrawork mod override |

### Örnek Konfigürasyon

```jsonc
{
  "agents": {
    "sisyphus": {
      "model": "anthropic/claude-opus-4-7",
      "reasoningEffort": "high",
      "temperature": 0.2,
      "permission": {
        "call_omo_agent": "allow"
      },
      "skills": ["git-master", "context7-mcp"],
      "color": "#10b981"
    },
    "oracle": {
      "model": "openai/gpt-5.5-high",
      "temperature": 0.1,
      "fallback_models": [
        "anthropic/claude-opus-4-7",
        "google/gemini-3.1-pro-high"
      ]
    },
    "hecateq-orchestrator": {
      "model": "anthropic/claude-opus-4-7",
      "color": "#7C3AED",
      "reasoningEffort": "high"
    }
  }
}
```

---

## Ajan İletişim Kalıpları

Ajanlar arası iletişim üç temel pattern ile sağlanır:

### 1. `call_omo_agent` — Direkt Subagent Spawn

```typescript
// Kod içinden direkt subagent çağrısı
const result = await call_omo_agent({
  subagent_type: "explore",
  prompt: "src/controllers/ dizinindeki dosyaları analiz et",
  run_in_background: true,
})
```

**Kısıtlama:** Ajan tool restriction listesine göre `call_omo_agent` izni kontrol edilir. Read-only ajanlarda (Oracle, Librarian, Explore) bu araç reddedilir.

### 2. `task()` — Category/Agent Üzerinden Delegasyon

```typescript
// Category üzerinden delegasyon
task(category="quick", load_skills=["git-master"], run_in_background=true)

// Direkt ajan üzerinden delegasyon
task(subagent_type="oracle", load_skills=[], run_in_background=false)
```

| Parametre | Açıklama |
|-----------|----------|
| `category` | Model ve kaynak önceliğini belirler (`quick`, `deep`, `ultrabrain`, vs.) |
| `subagent_type` | Direkt ajan adı (`oracle`, `explore`, `librarian`, vs.) |
| `load_skills` | Subagent için yüklenecek skill'ler |
| `run_in_background` | `true` ise arka planda çalışır, `false` ise sonucu bekle |
| `session_id` | Devam eden bir session'ı sürdürmek için |

### 3. Handoff — Yapılandırılmış Devir Teslim

Hecateq God ve Hecatege pipeline'ı tarafından kullanılan yapılandırılmış iletişim formatı:

```
STATUS: [DONE | IN_PROGRESS | BLOCKED]
SIGNALS_EMITTED: [{"signal":"backend_ready","payload":{"files":["src/api/users.ts"]}}]
HANDOFF: return_to_caller
```

**Handoff Alanları:**

| Alan | Açıklama |
|------|----------|
| `STATUS` | Mevcut durum: `DONE`, `IN_PROGRESS`, `BLOCKED` |
| `SIGNALS_EMITTED` | DAG sinyalleri (ajanlar arası koordinasyon için) |
| `HANDOFF` | Sonraki adım: `return_to_caller`, `return_to_parent_for_routing`, veya `<agent-id>` |

**Desteklenen Sinyaller:**

| Sinyal | Yayan Ajan |
|--------|-----------|
| `schema_ready` | `database-specialist` |
| `backend_ready` | `nodejs-backend-developer` |
| `ui_specs_ready` | `design-translator` |
| `auth_audit_passed` | `security-architect` |
| `infra_provisioned` | `coolify-devops-specialist` |
| `pipeline_secured` | `devsecops-pipeline-architect` |
| `tests_passed` | `qa-test-engineer` |
| `performance_verified` | `performance-specialist` |
| `compliance_signed` | `compliance-specialist` |
| `github_ops_completed` | `github-specialist` |
| `analysis_completed` | `ai-council` |

---

## Model Gereksinimleri

Her ajan için varsayılan model ve fallback chain'leri `src/shared/model-requirements.ts` içinde tanımlıdır:

| Ajan | Birincil Model | Fallback Zinciri |
|------|---------------|------------------|
| **Sisyphus** | claude-opus-4-7 | kimi-k2.6 → k2p5 → kimi-k2.5 → gpt-5.5 medium → glm-5 → big-pickle |
| **Hephaestus** | gpt-5.5 medium | (single-entry chain — `requiresProvider`: openai \| github-copilot \| venice \| opencode \| vercel) |
| **Oracle** | gpt-5.5 high | gemini-3.1-pro high → claude-opus-4-7 max → glm-5.1 |
| **Librarian** | gpt-5.4-mini-fast | qwen3.5-plus → minimax-m2.7-highspeed → minimax-m2.7 → claude-haiku-4-5 → gpt-5.4-nano |
| **Explore** | gpt-5.4-mini-fast | qwen3.5-plus → minimax-m2.7-highspeed → minimax-m2.7 → claude-haiku-4-5 → gpt-5.4-nano |
| **Multimodal-Looker** | gpt-5.5 medium | kimi-k2.6 → glm-4.6v → gpt-5-nano |
| **Metis** | claude-sonnet-4-6 | claude-opus-4-7 max → gpt-5.5 high → glm-5.1 → k2p5 |
| **Momus** | gpt-5.5 xhigh | claude-opus-4-7 max → gemini-3.1-pro high → glm-5.1 |
| **Atlas** | claude-sonnet-4-6 | kimi-k2.6 → gpt-5.5 medium → minimax-m2.7 |
| **Prometheus** | claude-opus-4-7 | gpt-5.5 high → glm-5.1 → gemini-3.1-pro |
| **Sisyphus-Junior** | claude-sonnet-4-6 | kimi-k2.6 → gpt-5.5 medium → minimax-m2.7 → big-pickle |
| **Hecateq God** | Config'den çözülür | Per-config fallback |

### Model Çözümleme Pipeline'ı

```
4-step pipeline:
1. Agent override (agents.<name>.model)
2. Category default (categories.<name>.model)
3. Provider fallback (model-fallback-requirements.ts)
4. System default (hardcoded in factory)
```

### Category-Model Eşlemesi

`task()` tool ile delegasyon yapılırken kullanılan category'lerin model öncelikleri:

| Category | Model Profili | Kullanım |
|----------|--------------|----------|
| `quick` | Claude/GPT-mini | Hızlı, düşük maliyetli task'ler |
| `default` | Claude/GPT | Dengeli task'ler |
| `deep` | Claude-thinking/GPT-o3 | Karmaşık akıl yürütme |
| `ultrabrain` | Claude/GPT-o3 | Maksimum zeka |
| `unspecified-low` | Gemini/Claude-haiku | Bütçe task'leri |
| `unspecified-high` | Claude-thinking/GPT-o3 | Yüksek çaba gerektiren task'ler |
| `artistry` | Claude/GPT-o3 | Yaratıcı/tasarım işleri |
| `oracle` | Claude-thinking/GPT-o3 | Mimari danışmanlık/inceleme |

---

## Ajan Tool Restriction'ları

Her ajanın kullanabileceği araçlar `src/shared/agent-tool-restrictions.ts` içinde tanımlıdır:

| Ajan | Reddedilen Araçlar |
|------|-------------------|
| **Oracle** | write, edit, task, call_omo_agent |
| **Librarian** | write, edit, task, call_omo_agent |
| **Explore** | write, edit, task, call_omo_agent |
| **Multimodal-Looker** | TÜM araçlar (read-only) |
| **Atlas** | task, call_omo_agent |
| **Momus** | write, edit, task |
| **Prometheus** | `.md` dışındaki dosyalara yazma (`prometheus-md-only` hook ile) |
| **Hecateq God** | write, edit, call_omo_agent |

### Restriction Kısıtlama Mekanizması

Tool restriction'ları iki seviyede uygulanır:

1. **Config level:** `tool-config-handler.ts` ajan-specific tool grant/denial'ları uygular
2. **Runtime level:** `tool.execute.before` hook'ları çalışma zamanında ek kontroller yapar (ör: `prometheusMdOnly`)
3. **Prompt level:** Ajan sistem prompt'u hangi araçların kullanılamayacağını açıkça belirtir

---

## Ajan Prompt Örneği (Oracle)

```typescript
// src/agents/oracle.ts (özet)
export function createOracleAgent(model: string): AgentConfig {
  return {
    description: "Read-only architectural consultant",
    instructions:
      `Sen bir yazılım mimarisi danışmanısın.

Görevin:
- Kodu analiz etmek, incelemek ve iyileştirme önerileri sunmak
- Tasarım kararlarını değerlendirmek
- Potansiyel sorunları tespit etmek

Kısıtlamalar:
- ASLA dosya oluşturma veya düzenleme (write/edit red)
- ASLA task delegasyonu yapma
- ASLA subagent spawn etme
- Yalnızca read-only araçlar kullan (grep, glob, lsp_*, session_*, etc.)

Yanıt formatı:
- Somut, ölçülebilir öneriler
- Dosya yolları ve satır numaraları ile referanslar
- "Belki", "olabilir" gibi muğlak ifadelerden kaçın`,
    model,
    temperature: 0.1,
    permission: {
      write: false,
      edit: false,
      task: false,
      call_omo_agent: false,
    },
  }
}
createOracleAgent.mode = "subagent"
```

---

## Daha Fazla Bilgi

| Konu | Dosya |
|------|-------|
| Genel mimari | [01-mimari-genel-bakis.md](./01-mimari-genel-bakis.md) |
| Hecateq God detayı | `src/agents/hecateq-orchestrator/AGENTS.md` |
| Ajan fabrika pattern'i | `src/agents/AGENTS.md` |
| Team mode belgeleri | `docs/guide/team-mode.md` |
| Tool restriction'lar | `src/shared/agent-tool-restrictions.ts` |
| Model gereksinimleri | `src/shared/model-requirements.ts` |
| Routing ve delegasyon | `docs/hecateq/routing.md` |
