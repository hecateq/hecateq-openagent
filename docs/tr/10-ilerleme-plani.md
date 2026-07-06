# 10 — İlerleme Planı ve Stratejik Yol Haritası

> **Hecateq OpenAgent — Mevcut Durum, Öncelikler ve Gelecek Rotası**
>
> Son güncelleme: 2026-07-05 | Fork: Hecateq | Temel: oh-my-openagent v4.2.0

---

## İçindekiler

1. [Yönetici Özeti](#1-yönetici-özeti)
2. [Mevcut Durum Analizi](#2-mevcut-durum-analizi)
3. [Öncelikli İlerleme Alanları](#3-öncelikli-i̇lerleme-alanları)
   - 3a [Test Kararlılığı](#3a-test-kararlılığı-high)
   - 3b [Memory Curator (Phase 4)](#3b-memory-curator-phase-4-medium)
   - 3c [Orchestration E2E Coverage](#3c-orchestration-e2e-coverage-medium)
   - 3d [Dokümantasyon Genişletme](#3d-dokümantasyon-genişletme-low-medium)
   - 3e [Custom Agent Index Auto-Regeneration](#3e-custom-agent-index-auto-regeneration-low)
   - 3f [OpenClaw Hardening](#3f-openclaw-hardening-low)
   - 3g [Performance & Caching](#3g-performance--caching-low)
   - 3h [Telemetry Compliance](#3h-telemetry-compliance-low)
4. [Önerilen Yol Haritası](#4-önerilen-yol-haritası)
5. [Risk Matrisi](#5-risk-matrisi)
6. [Başarı Metrikleri (KPI)](#6-başarı-metrikleri-kpi)
7. [Eylem Planı: Hemen Yarın (3-7 Gün)](#7-eylem-planı-hemen-yarın-3-7-gün)
8. [Eylem Planı: Bu Ay (30 Gün)](#8-eylem-planı-bu-ay-30-gün)
9. [Eylem Planı: Bu Çeyrek (90 Gün)](#9-eylem-planı-bu-çeyrek-90-gün)
10. [İzleme ve Raporlama](#10-i̇zleme-ve-raporlama)
11. [Sorumluluk Matrisi (RACI)](#11-sorumluluk-matrisi-raci)
12. [Sonuç ve Çağrı](#12-sonuç-ve-çağrı)

---

## 1. Yönetici Özeti

Hecateq OpenAgent, ~2167 TypeScript dosyası, 313k LOC ve 12 AI ajanı ile **Beta** olgunluğundadır. Dört büyük PR başarıyla merge edilmiştir (PR1: context injection, PR2a/b/c: category routing removal, PR4: sisyphus-junior fallback cleanup). Memory sistemi, doktor kontrolleri ve handoff altyapısı stabildir. Ancak **test kararlılığı kritik bir zafiyettir**: `installAgentSortShim()` `Array.prototype.sort`'u patch'leyerek cross-test contamination'a yol açmakta, `agent-priority-order.test.ts` güncel olmayan beklentiler içermekte, `src/shared` ve `src/tools/delegate-task` gibi alanlarda pre-existing failure'lar bulunmaktadır. Memory curator (Phase 4) henüz implemente edilmemiş, risk-profile.md ve decisions.md kirlenmiştir. Bu belge, test kararlılığından başlayarak 3 fazlı bir yol haritası sunar: **Faz 1 — Acil (test stabilizasyonu + memory curator MVP)**, **Faz 2 — Olgunlaşma (E2E coverage + dokümantasyon sync + OpenClaw hardening)**, **Faz 3 — Ölçek (performans, telemetri, ekosistem)**.

---

## 2. Mevcut Durum Analizi

### 2.1 Tamamlanan Milestone'lar

| PR | Tarih | Kapsam | Durum | Test Sayısı |
|----|-------|--------|-------|-------------|
| **PR1** | 2026-06-15 | `fix(hecateq): auto-inject project context into subagent sessions` | ✅ Merge | 316 pass |
| **PR2a+2b** | 2026-06-15 | `feat(hecateq): add disable_category_routing feature flag` | ✅ Merge | 263 pass |
| **PR2c** | 2026-06-15 | `refactor(hecateq): remove category routing code paths` (48 files, +251/-760) | ✅ Merge | 252/252 pass |
| **PR4** | 2026-06-28 | `refactor(hecateq): remove sisyphus-junior hardcoded fallbacks` (11 files) | ✅ Merge | 966 pass |
| **PR3** | (PR2c aslında PR#3) | Category routing removal — GitHub PR #3 | ✅ Merge | — |

### 2.2 Stabil Olan Bileşenler

| Bileşen | Durum | Detay |
|---------|-------|-------|
| **Memory bootstrap** | ✅ Stabil | Append-only, single-init, template hydration engine |
| **Memory manifest** (v2) | ✅ Stabil | Checksums, lock state, placeholder detection |
| **MEMORY_UPDATE sinyal parsing** | ✅ Stabil | Block extraction + path filtering + validation |
| **Decision log** (decisions.jsonl) | ✅ Stabil | Append + auto-render to decisions.md |
| **Task state** (tasks.jsonl) | ✅ Stabil | Append + auto-render to tasks.md |
| **Quality history writer** | ✅ Stabil | Best-effort prepend + retention enforcement |
| **Risk writer** | ✅ Stabil | Evidence-based + detection rules |
| **Writer ownership matrix** | ✅ Stabil | Her writer belirli dosyalara yetkili |
| **Doctor checks** (25+ kategori) | ✅ Stabil | Hecateq workflow, memory, config, agents, retention |
| **Hermes config snapshot** | ✅ Stabil | JSON snapshot at plugin-config-snapshot.json |
| **Context injector hook** | ✅ Stabil | PR1 ile doğrulanmış, 30s TTL snapshot memoization |
| **Agent indexer** | ✅ Stabil | Runtime agent discovery + suggestions + summaries |
| **Handoff sistemi** | ✅ Stabil | Parsing + role policy + boulder state projection |
| **Dependency graph** | ✅ Stabil | Cycle detection + duplicate node + missing dependency |

### 2.3 Eksik / Risk Altındaki Alanlar

| Alan | Durum | Risk Seviyesi | Detay |
|------|-------|---------------|-------|
| **Test kararlılığı** | ❌ Kritik | Yüksek | Cross-test contamination, pre-existing failures, stale test assertions |
| **Memory curator** (Phase 4) | ❌ Eksik | Orta | Normalizasyon/compaction implemente edilmemiş |
| **Orchestration E2E coverage** | ❌ Eksik | Yüksek | Tam runtime adapter test kapsamı yok |
| **Context injector tests** | ⚠️ Kırılgan | Orta | Environment-sensitive boundary conditions |
| **file-map.md Change Impact Map** | ⚠️ Kirlenmiş | Düşük | Ham entry'ler, semantik gruplama yok |
| **risk-profile.md** | ⚠️ Kirlenmiş | Düşük | Duplicate "destructive_op" / "migration_risk" entry'leri |
| **decisions.md** | ⚠️ Kirlenmiş | Düşük | "Using go/Next.js/svelte/bootstrap" gibi duplicate stack kararları |
| **OpenClaw** | ⚠️ Beta | Orta | Rate limiting, error isolation, test kapsamı eksik |
| **Snapshot cache** | ⚠️ Advisory | Düşük | Cache key mode-agnostic, unbounded cache potansiyeli |
| **Custom agent index auto-regen** | ⚠️ Yeni | Düşük | Background regen schedule doğrulanmamış |

### 2.4 Test Sağlık Durumu

| Metrik | Değer | Trend |
|--------|-------|-------|
| **Son full suite** | 104 passed / 0 failed (auto-detected) | 🟢 |
| **PR4 targeted tests** | 966 passed | 🟢 |
| **Bilinen pre-existing failures** | agent-priority-order (stale), runtime-trace flush (path mismatch) | 🔴 |
| **Cross-test contamination** | installAgentSortShim → Array.prototype.sort bleed | 🔴 |
| **Environment-sensitive tests** | Context injector boundary conditions | 🟡 |
| **Typecheck** | `bun run typecheck` → clean | 🟢 |
| **Build** | `bun run build` → clean | 🟢 |

---

## 3. Öncelikli İlerleme Alanları

### 3a. Test Kararlılığı (HIGH)

**Problemler:**

1. **installAgentSortShim cross-test contamination**
   - `src/plugin-handlers/install-agent-sort-shim.ts`, `Array.prototype.sort`'u patch'ler
   - Bu patch, aynı process'te çalışan diğer testlere sızar
   - Non-deterministik test başarısızlıklarına yol açar
   - **Etki:** Yeni PR'lerde "acaba bu test benim değişikliğimden mi kırıldı" sorusu yaratır

2. **agent-priority-order.test.ts stale assertion**
   - Eski 4-agent kanonik sırasını bekler (`sisyphus`, `hephaestus`, `prometheus`, `atlas`)
   - Güncel sıra: `hecateq-orchestrator → sisyphus → hephaestus → prometheus → atlas`
   - PR1/PR2/PR4 ile ilgisiz nedenlerle fail olur

3. **src/shared ve src/tools/delegate-task pre-existing failures**
   - Analiz edilmemiş, root cause bilinmiyor
   - Her PR'de "known pre-existing" olarak geçiştiriliyor
   - Zamanla normalize olmuş teknik borç

4. **Runtime-trace flush test — path mismatch**
   - `snapshot/flush` beklenen çıktı formatı ile uyuşmazlık
   - Pre-existing olarak işaretlenmiş, temizlenmemiş

5. **Context injector environment-sensitive tests**
   - Farklı boundary condition'larda kırılıyor
   - `TMPDIR`, `HOME`, `CWD` gibi env değişkenlerine bağımlı

**Önerilen Çözümler:**

| Problem | Çözüm | Tahmini Efor | Öncelik |
|---------|-------|-------------|---------|
| Cross-test contamination | `installAgentSortShim`'i isolated scope'a taşı, `beforeAll`/`afterAll` ile restore et | 2-3 gün | 🔴 Kritik |
| Stale agent order test | Test assertion'unu güncelle, 5-agent sırasını bekle | 0.5 gün | 🔴 Kritik |
| Pre-existing failures | Root cause analizi yap, fix veya skip + ticket | 3-5 gün | 🟡 Yüksek |
| Runtime-trace path mismatch | Snapshot yeniden kaydet, output formatını doğrula | 1 gün | 🟡 Yüksek |
| Environment sensitivity | Environment isolation (`mockFs`, `mockEnv`), her test kendi sandbox'ında | 2-3 gün | 🟡 Yüksek |

**Somut PR: PR5 — "Test stabilization suite"**

```typescript
// Örnek: installAgentSortShim isolated scope fix
// src/plugin-handlers/install-agent-sort-shim.ts

let originalSort: typeof Array.prototype.sort;
let shimInstalled = false;

export function installAgentSortShim(): void {
  if (shimInstalled) return;
  originalSort = Array.prototype.sort;
  Array.prototype.sort = function <T>(compareFn?: (a: T, b: T) => number): T[] {
    // Yalnızca canonical core agent dizileri için patch uygula
    if (isCanonicalAgentArray(this)) {
      return applyCanonicalOrder(this as unknown as T[], compareFn);
    }
    return originalSort.call(this, compareFn);
  };
  shimInstalled = true;
}

export function restoreAgentSortShim(): void {
  if (!shimInstalled) return;
  Array.prototype.sort = originalSort;
  shimInstalled = false;
}
```

```typescript
// Örnek: Test reset hook
// src/plugin-handlers/install-agent-sort-shim.test.ts

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { installAgentSortShim, restoreAgentSortShim } from "./install-agent-sort-shim";

describe("#installAgentSortShim", () => {
  beforeEach(() => {
    restoreAgentSortShim(); // her test öncesi temiz state
  });
  afterEach(() => {
    restoreAgentSortShim(); // her test sonrası temiz state
  });

  it("should patch Array.prototype.sort for canonical arrays", () => {
    installAgentSortShim();
    const agents = ["prometheus", "sisyphus", "hecateq-orchestrator"];
    const sorted = agents.sort();
    expect(sorted[0]).toBe("hecateq-orchestrator");
  });

  it("should NOT patch non-canonical arrays", () => {
    installAgentSortShim();
    const numbers = [3, 1, 2];
    const sorted = numbers.sort((a, b) => a - b);
    expect(sorted).toEqual([1, 2, 3]);
  });
});
```

### 3b. Memory Curator (Phase 4) (MEDIUM)

**Problemler:**

1. **Normalizasyon/compaction implemente edilmemiş**
   - Planlandı (Phase 4) ama hayata geçirilmedi
   - Memory dosyaları append-only büyür, hiçbir zaman compact olmaz

2. **file-map.md Change Impact Map kirlenmiş**
   - Ham entry'ler birikir, semantik gruplama yok
   - "file changed" + "reason" çiftleri organize değil

3. **risk-profile.md duplicate entry'ler**
   - 20+ "migration_risk" entry'si (her schema değişikliği için ayrı)
   - "destructive_op" entry'leri tekrarlı
   - Zaman içinde noise/signal oranı düşer

4. **decisions.md duplicate stack kararları**
   - "Using go", "Using Next.js", "Using svelte" her session'da tekrarlanmış
   - 1600+ satırın önemli kısmı duplicate

**Önerilen Çözüm:**

```typescript
// Örnek: Memory curator ana modülü — önerilen tasarım
// src/features/memory-curator/index.ts

export interface CuratorConfig {
  schedule: "manual" | "hourly" | "daily";
  targetFiles: Array<"risk-profile" | "file-map" | "decisions" | "quality-history">;
  dedupeWindow: number; // ms içinde duplicate entry'leri birleştir
  maxFileSize: number; // byte, aşınca compact tetiklenir
  retentionDays: number;
}

export async function compactRiskProfile(): Promise<CompactResult> {
  // 1. Tüm entry'leri oku
  // 2. "migration_risk" → schema değişikliği path'ine göre grupla
  // 3. Aynı path + aynı severity → son entry'i koru
  // 4. "destructive_op" → gerçekten destructive olanları işaretle
  // 5. 30 günden eski "low" entry'leri temizle
  // 6. Yeni dosyayı yaz, eski dosyayı .bak olarak sakla
}

export async function compactChangeImpactMap(): Promise<CompactResult> {
  // 1. Tüm change entry'lerini oku
  // 2. Aynı dosya path'ine sahip entry'leri grupla
  // 3. Her grup için: ilk eklenme tarihi + son eklenme tarihi
  // 4. Her grup için: change count + benzersiz reason listesi
  // 5. Gruplanmış versiyonu yaz
}

export async function dedupeDecisions(): Promise<CompactResult> {
  // 1. Tüm decision'ları oku
  // 2. Aynı decision text'e sahip olanları teke indir (en sonuncuyu koru)
  // 3. "Using X" stack kararlarını ayrı bir "Stack Decisions" bölümünde topla
  // 4. Dedupe edilmiş versiyonu yaz
}
```

**Tahmini efor:** 5-7 gün
**Somut PR: PR7 — "Memory curator: normalize + compact"**

### 3c. Orchestration E2E Coverage (MEDIUM)

**Problem:**

Orchestration pipeline'ının 8 aşaması (Intake → Decompose → Dependency Graph → Agent Selection → Execution Plan → Quality Gates → Repair Loop → Final Report) için **tam entegrasyon testi yoktur**. Her aşama unit test edilmiş olabilir ancak:

- Runtime adapter ile entegrasyon test edilmemiştir
- Aşamalar arası state geçişleri doğrulanmamıştır
- Hata senaryoları (stage fail → repair loop → fallback) test edilmemiştir
- Quality gate'lerin birbirini tetiklemesi test edilmemiştir

**Önerilen Çözüm:**

```typescript
// Örnek: Orchestration E2E test harness — önerilen tasarım
// src/features/hecateq-orchestration/e2e/__tests__/orchestration-e2e.test.ts

import { describe, it, expect } from "bun:test";
import { createMockRuntimeAdapter } from "./mock-runtime-adapter";
import { createOrchestrationPipeline } from "../orchestration-controller";

describe("Orchestration E2E", () => {
  it("should complete full 8-stage pipeline for a simple task", async () => {
    const adapter = createMockRuntimeAdapter();
    const pipeline = createOrchestrationPipeline(adapter);

    const result = await pipeline.execute("fix typo in README");

    expect(result.stages.completed).toBe(8);
    expect(result.report.changedFiles).toHaveLength(1);
    expect(result.qualityGates.allPassed).toBe(true);
  });

  it("should trigger repair loop on stage 5 failure", async () => {
    const adapter = createMockRuntimeAdapter({ failAtStage: 5 });
    const pipeline = createOrchestrationPipeline(adapter);

    const result = await pipeline.execute("add validation");

    expect(result.repairLoop.triggered).toBe(true);
    expect(result.repairLoop.attempts).toBeLessThanOrEqual(2);
    expect(result.stages.completed).toBe(8); // repair sonrası tamamlanmalı
  });

  it("should reject destructive tasks without --force", async () => {
    const adapter = createMockRuntimeAdapter();
    const pipeline = createOrchestrationPipeline(adapter);

    await expect(
      pipeline.execute("drop production database")
    ).rejects.toThrow("HIGH_RISK_TASK_REQUIRES_FORCE");
  });
});
```

**Tahmini efor:** 3-5 gün
**Somut PR: PR8 — "Orchestration E2E test harness"**

### 3d. Dokümantasyon Genişletme (LOW-MEDIUM)

**Problemler:**

- `rehber/` serisi (9 dosya + README) oluşturuldu ama kök `AGENTS.md` güncel değil
- `CONTRIBUTING.md` Hecateq-özel süreçleri yansıtmıyor
- Dokümantasyon ile kod arasında drift riski var

**Önerilen Çözümler:**

| Eylem | Efor |
|-------|------|
| `rehber/README.md`'den kök `AGENTS.md`'ye link/navigasyon ekle | 0.5 gün |
| `CONTRIBUTING.md`'yi Hecateq workflow'u ile güncelle | 1 gün |
| Her `rehber/*.md` dosyasının sonuna "İlgili AGENTS.md bölümü" bağlantısı ekle | 1 gün |
| Dokümantasyon-kod drift kontrolü için GitHub workflow (aylık) | 1 gün |
| `docs/hecateq/` dosyaları ile `rehber/` arasında cross-reference doğrulama | 1 gün |

### 3e. Custom Agent Index Auto-Regeneration (LOW)

PR3 sonrası custom agent index'in background'da otomatik yenilenmesi eklendi (`778467ccd`). Ancak:

- Staleness threshold doğrulanmamış
- Auto-regen schedule test edilmemiş
- `max_custom_agent_lines` yapılandırılabilir hale getirildi (`507778db8`) ama varsayılan değer uygun mu?

**Öneri:** PR3 sonrası auto-regen mekanizmasının dokümantasyonu + threshold değerlerinin test edilmesi için küçük bir PR.

### 3f. OpenClaw Hardening (LOW — Beta status)

OpenClaw Discord/Telegram reply-listener daemon'u Beta statüsünde.

**Eksikler:**
- Reply-listener test kapsamı (inbound mesaj işleme)
- Rate limiting implementasyonu
- Error isolation (bir kanaldaki hata diğerini etkilememeli)
- Daemon crash recovery

**Öneri:** OpenClaw hardening için ayrı bir PR planla — ancak test kararlılığı ve memory curator'dan sonra.

### 3g. Performance & Caching (LOW)

PR1'de snapshot memoization (30s TTL) eklendi. İki advisory notu var:

1. **Cache key mode-agnostic:** Farklı modlar (`compact` vs `expanded`) aynı cache key'i kullanıyor
2. **Unbounded cache:** Cache boyutu sınırlandırılmamış, uzun session'larda memory leak potansiyeli

**Önerilen Çözüm:**

```typescript
// Örnek: Snapshot cache iyileştirmesi
// src/hooks/hecateq-project-context-injector/index.ts

interface CacheEntry {
  data: string;
  expiresAt: number;
  mode: "compact" | "expanded"; // cache key'e mode'u da ekle
}

const snapshotCache = new Map<string, CacheEntry>();
const MAX_CACHE_SIZE = 50; // max 50 entry

function getCachedSnapshot(key: string, mode: string): string | null {
  const entry = snapshotCache.get(`${key}:${mode}`);
  if (entry && Date.now() < entry.expiresAt) {
    return entry.data;
  }
  return null;
}

function setCachedSnapshot(key: string, mode: string, data: string, ttlMs = 30000): void {
  // Cache boyut kontrolü
  if (snapshotCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = snapshotCache.keys().next().value;
    snapshotCache.delete(oldestKey);
  }
  snapshotCache.set(`${key}:${mode}`, {
    data,
    expiresAt: Date.now() + ttlMs,
    mode: mode as "compact" | "expanded",
  });
}
```

**Somut öneri:** PR9 — "Snapshot cache hardening (mode-aware + size-bound)"

### 3h. Telemetry Compliance (LOW)

Hecateq telemetrisi varsayılan kapalı ancak:

- KVKK/GDPR opt-in mekanizması kontrol edilmeli
- Retention policy dokümante edilmeli (ne kadar süre, nerede saklanır)
- Scrubber (API key'leri, token'lar, environment variable'ları temizleme) test edilmeli
- PostHog key'i olmadan safe no-op davranışı doğrulanmalı

---

## 4. Önerilen Yol Haritası

```mermaid
gantt
    title Hecateq OpenAgent Yol Haritası
    dateFormat  YYYY-MM-DD
    axisFormat  %Y Q%q

    section Faz 1 — Acil (Q1 2026)
    PR5: Test stabilization suite           :2026-07-07, 14d
    PR6: Agent sort shim scope isolation    :2026-07-10, 5d
    PR7: Memory curator MVP                 :2026-07-14, 10d
    Agent index auto-regen docs             :2026-07-18, 3d
    rehber/ + AGENTS.md sync               :2026-07-21, 3d

    section Faz 2 — Olgunlaşma (Q2 2026)
    PR8: Orchestration E2E coverage        :2026-08-01, 10d
    PR9: Snapshot cache hardening          :2026-08-05, 3d
    OpenClaw hardening                     :2026-08-15, 10d
    Dokümantasyon drift kontrol workflow    :2026-08-20, 5d
    CONTRIBUTING.md güncelleme              :2026-08-25, 3d
    Hecateq API freeze doc                 :2026-09-01, 5d

    section Faz 3 — Ölçek (Q3 2026)
    Performance baseline + regression      :2026-09-15, 10d
    Telemetry compliance audit             :2026-10-01, 5d
    Upstream rebase plan                   :2026-10-10, 10d
    Custom agent registry (ecosystem)      :2026-10-20, 15d
    Beta → RC geçiş planı                  :2026-11-01, 10d
```

### Faz 1 (Q1 2026 — Acil): Test Kararlılığı + Memory Curator MVP

| PR | İçerik | Süre | Bağımlılık |
|----|--------|------|-----------|
| **PR5** | Test stabilization suite: cross-test contamination fix, stale assertion update, pre-existing failure audit | 14 gün | Yok |
| **PR6** | Agent sort shim scope isolation: shim'i isolated scope'a taşı, test reset hook'u güçlendir | 5 gün | PR5'in parçası olabilir |
| **PR7** | Memory curator MVP: risk-profile dedupe, file-map compaction, decisions dedupe, scheduled run | 10 gün | Yok |
| — | Agent index auto-regen dokümantasyonu | 3 gün | Yok |
| — | rehber/ + AGENTS.md sync (link ekleme, cross-reference) | 3 gün | Yok |

**Toplam Faz 1: ~35 gün** (paralel yürütülebilir işlerle ~20 takvim günü)

### Faz 2 (Q2 2026 — Olgunlaşma): E2E Coverage + Dokümantasyon Sync + OpenClaw Hardening

| PR | İçerik | Süre |
|----|--------|------|
| **PR8** | Orchestration E2E test harness: mock runtime adapter, 8-stage pipeline test, repair loop scenarios | 10 gün |
| **PR9** | Snapshot cache hardening (mode-aware + size-bound) | 3 gün |
| — | OpenClaw hardening: rate limiting, error isolation, test kapsamı | 10 gün |
| — | Dokümantasyon drift kontrolü için GitHub workflow | 5 gün |
| — | CONTRIBUTING.md güncelleme | 3 gün |
| — | Hecateq API freeze/deprecation policy dokümanı | 5 gün |

**Toplam Faz 2: ~36 gün**

### Faz 3 (Q3 2026 — Ölçek): Performans + Telemetri + Ekosistem

| İçerik | Süre |
|--------|------|
| Performance baseline + regression test suite | 10 gün |
| Telemetry compliance audit (KVKK/GDPR) | 5 gün |
| Upstream rebase plan + sustainability | 10 gün |
| Custom agent registry / ecosystem başlangıcı | 15 gün |
| Beta → RC geçiş planı (checklist + release criteria) | 10 gün |

**Toplam Faz 3: ~50 gün**

---

## 5. Risk Matrisi

| # | Risk | Olasılık | Etki | Risk Skoru | Mitigation | Owner Önerisi |
|---|------|----------|------|-----------|------------|---------------|
| 1 | **Test instability** — cross-test contamination yeni PR'lerde false positive/negative yaratır | Yüksek | Yüksek | 🔴 **Kritik** | PR5 ile shim'i isolated scope'a taşı, her test öncesi restore et | Sisyphus (implementation) + QA (test) |
| 2 | **Upstream ile drift** — oh-my-openagent gelişmeye devam ediyor, rebase giderek zorlaşır | Yüksek | Yüksek | 🔴 **Kritik** | Düzenli upstream takibi (2 haftada bir), rebase planı Faz 3'te | Hecateq Orchestrator (planning) |
| 3 | **Orchestration E2E eksikliği** — pipeline değişiklikleri regression riski taşır, release blocker | Orta | Yüksek | 🟡 **Yüksek** | PR8 ile E2E test harness ekle, her orchestration değişikliğinde koş | QA (test execution) + Sisyphus |
| 4 | **Memory curator ertelenmesi** — risk-profile.md noise/signal oranı düşer, faydalı bilgi kaybolur | Orta | Orta | 🟡 **Orta** | PR7'yi Faz 1'e al, minimum viable curator ile başla | Sisyphus (implementation) |
| 5 | **Hecateq-özgü API'ler stabil değil** — Experimental statüsü kullanıcı güvenini azaltır | Orta | Yüksek | 🟡 **Yüksek** | API freeze dokümanı Faz 2'de, deprecation policy + migration guide | Oracle (code review) + Tech writer |
| 6 | **Dokümantasyon-kod drift** — rehber/ güncel kalmaz, yeni geliştiriciler yanlış yönlenir | Orta | Orta | 🟡 **Orta** | Aylık drift kontrol workflow'u, rehber/ güncelleme PR checklist'i | Tech writer (owner) |
| 7 | **Beta → Stable dönüşüm gereksinimleri** — tanımlı değil, ne zaman "stable" denileceği belli değil | Orta | Orta | 🟡 **Orta** | Faz 3'te release criteria dokümanı, test pass rate + API stability gate'leri | Release manager |
| 8 | **OpenClaw daemon crash** — reply-listener sessizce ölür, kullanıcı fark etmez | Düşük | Orta | 🟢 **Düşük** | Health check + auto-restart, monitoring log'u | Sisyphus + DevOps |
| 9 | **Performance regression** — 313k LOC'da snapshot/context injection yavaşlayabilir | Düşük | Orta | 🟢 **Düşük** | Faz 3'te performance baseline, her release'de karşılaştır | Performance specialist |

---

## 6. Başarı Metrikleri (KPI)

| # | Metrik | Hedef | Şu Anki Değer | Ölçüm Yöntemi | Sorumlu |
|---|--------|-------|---------------|---------------|---------|
| 1 | **Test pass rate** (full suite) | 100% | ~70% (tahmini) | `bun test` | QA test engineer |
| 2 | **Test isolation** (shim side-effect) | 0 contamination | 🔴 Pozitif | Meta-audit testi (`mock-module-lifecycle-audit`) | QA test engineer |
| 3 | **Pre-existing failure count** | 0 | 3+ (agent-priority, runtime-trace, shared/delegate-task) | Audit script | QA test engineer |
| 4 | **Memory curator compaction** (risk-profile) | %50 küçülme | ~75 satır (20+ duplicate) | `wc -l .opencode/state/memory/risk-profile.md` | Sisyphus |
| 5 | **Memory curator compaction** (decisions.md) | %70 küçülme | ~1900+ satır (çoğu duplicate) | `wc -l .opencode/state/memory/decisions.md` | Sisyphus |
| 6 | **Orchestration E2E coverage** | 8/8 stage test edilmiş | 0/8 | PR8 test sayısı | QA test engineer |
| 7 | **Doctor check pass rate** | 25/25 (11 Hecateq + 14 base) | ~20/25 (tahmini) | `hecateq-openagent doctor && hecateq-openagent hecateq doctor` | DevOps |
| 8 | **Dokümantasyon güncelliği** (rehber/ ↔ AGENTS.md) | Eşzamanlı | ⚠️ Kısmi | Aylık drift kontrol workflow'u | Tech writer |
| 9 | **Public API stability** | SemVer discipline | Experimental | `git diff` + CHANGELOG.md | Release manager |
| 10 | **Typecheck** | 0 error | 0 error ✅ | `bun run typecheck` | CI |
| 11 | **Build** | 0 error | 0 error ✅ | `bun run build` | CI |

---

## 7. Eylem Planı: Hemen Yarın (3-7 Gün)

| # | Eylem | Çıktı | Sorumlu | Süre |
|---|-------|-------|---------|------|
| 1 | **PR5 başlat**: Test kararlılık audit'i | Mevcut tüm test failure'larının kataloğu, root cause analizi | QA test engineer | 2 gün |
| 2 | **Pre-existing failure kataloğu oluştur** | `docs/reference/test-failures.md` — her failure için: nerede, neden, nasıl fix | Tech writer + QA | 1 gün |
| 3 | **Snapshot TTL/cache-key advisory'leri için PR9 aç** | Cache key mode-aware yap, max size sınırı ekle | Sisyphus | 1 gün |
| 4 | **Memory curator tasarım dokümanı yaz** | `docs/hecateq/memory-curator-design.md` — API, schedule, retention policy | Tech writer | 1 gün |
| 5 | **`rehber/README.md`'den `AGENTS.md`'ye link ekle** | Kök AGENTS.md'de rehber/ navigasyonu | Tech writer | 0.5 gün |
| 6 | **Hecateq doctor 25/25 pass doğrula** | Mevcut doctor çıktısını kaydet, eksik check'leri tespit et | DevOps | 1 gün |

### Somut TODO List — Hemen Yarın

```bash
# 1. Test kararlılık audit'i başlat
bun test 2>&1 | tee /tmp/full-test-audit-$(date +%Y%m%d).log

# 2. Bilinen failure'ları dök
echo "=== agent-priority-order.test.ts ==="
grep -n "FAIL" /tmp/full-test-audit-*.log | grep "agent-priority"
echo "=== runtime-trace ==="
grep -n "FAIL" /tmp/full-test-audit-*.log | grep "runtime-trace\|flush"
echo "=== src/shared failures ==="
grep -n "FAIL" /tmp/full-test-audit-*.log | grep "src/shared"
echo "=== src/tools/delegate-task failures ==="
grep -n "FAIL" /tmp/full-test-audit-*.log | grep "delegate-task"
```

```typescript
// 3. PR9 için cache fix — mevcut koda minimal müdahale
// src/hooks/hecateq-project-context-injector/index.ts

// DEĞİŞİKLİK 1: Cache key'e mode'u ekle
- const cacheKey = `context:${sessionId}`;
+ const cacheKey = `context:${sessionId}:${mode}`;

// DEĞİŞİKLİK 2: Cache boyut sınırı ekle
+ const MAX_CACHE_SIZE = 50;
+ if (snapshotCache.size >= MAX_CACHE_SIZE) {
+   const oldest = snapshotCache.keys().next().value;
+   snapshotCache.delete(oldest);
+ }
```

---

## 8. Eylem Planı: Bu Ay (30 Gün)

| # | Eylem | Çıktı | Sorumlu | Süre |
|---|-------|-------|---------|------|
| 1 | **PR5 merge** | Test stabilization suite: cross-test contamination fix, stale assertion update, pre-existing failure audit | Sisyphus + QA | 14 gün |
| 2 | **PR6 merge** | Agent sort shim scope isolation (PR5'in parçası olabilir) | Sisyphus | — |
| 3 | **PR7 merge** | Memory curator MVP: risk-profile dedupe (3 gün) + file-map compaction (3 gün) + decisions dedupe (2 gün) + scheduled run (2 gün) | Sisyphus | 10 gün |
| 4 | **PR9 merge** | Snapshot cache hardening (mode-aware + size-bound) | Sisyphus | 1 gün |
| 5 | **rehber/ + AGENTS.md sync** | Link ekleme, cross-reference doğrulama, CONTRIBUTING.md güncelleme | Tech writer | 3 gün |
| 6 | **Agent index auto-regen docs** | Dokümantasyon: threshold değerleri, test senaryoları | Tech writer | 1 gün |
| 7 | **Hecateq API freeze/deprecation policy doc** | `docs/hecateq/api-stability.md` — hangi API'ler donduruldu, deprecation timeline | Oracle + Tech writer | 3 gün |

**30 günlük hedef:** 4 PR merge (PR5, PR6/PR5, PR7, PR9), tüm Hecateq doctor check'leri pass, rehber/ + AGENTS.md sync.

### Kabul Kriterleri (30 Gün)

```markdown
## Kabul Kriterleri — 30 Gün

- [ ] `bun test` output: 0 pre-existing failure (tümü fix veya documented)
- [ ] `installAgentSortShim` meta-audit testi: 0 contamination
- [ ] `risk-profile.md` duplicate entry sayısı: 0
- [ ] `decisions.md` duplicate stack kararı: 0
- [ ] `file-map.md` Change Impact Map: semantik gruplanmış
- [ ] Doctor check: 25/25 pass
- [ ] PR merge hızı: ortalama 1 PR / hafta
- [ ] rehber/ ↔ AGENTS.md: tüm linkler çalışıyor
```

---

## 9. Eylem Planı: Bu Çeyrek (90 Gün)

| # | Eylem | Çıktı | Sorumlu | Süre |
|---|-------|-------|---------|------|
| 1 | **PR8 merge** | Orchestration E2E test harness: mock adapter, 8-stage test, repair loop scenarios | QA + Sisyphus | 10 gün |
| 2 | **Upstream rebase planı** | `docs/reference/upstream-rebase-strategy.md` — conflict analizi, timeline, risk mitigation | Hecateq Orchestrator + Oracle | 5 gün |
| 3 | **Performance baseline + regression test** | Benchmark script, her release'de karşılaştırma, snapshot/context injection profili | Performance specialist | 10 gün |
| 4 | **OpenClaw hardening** | Rate limiting, error isolation, daemon health check, test kapsamı | Sisyphus | 10 gün |
| 5 | **Dokümantasyon drift kontrol workflow'u** | GitHub Actions: aylık rehber/ ↔ docs/ ↔ kod karşılaştırması | Tech writer + DevOps | 3 gün |
| 6 | **Beta → RC geçiş planı** | Release criteria, checklist, test pass rate gate, API stability gate | Release manager | 5 gün |
| 7 | **Telemetry compliance audit** | KVKK/GDPR checklist, scrubber test, retention policy dokümanı | Compliance specialist | 3 gün |

**90 günlük hedef:** Tüm Faz 1 + Faz 2 tamamlanmış, Faz 3 başlamış. Beta → RC geçişi için net kriterler belirlenmiş.

---

## 10. İzleme ve Raporlama

| Dosya/Kaynak | Sıklık | Kim Kontrol Eder | Ne Kontrol Edilir |
|-------------|--------|-----------------|-------------------|
| `.opencode/state/memory/progress.md` | Haftalık (Pazartesi) | Hecateq Orchestrator | "What Changed Recently" bölümü, tamamlanan/adjusted milestone'lar |
| `.opencode/state/memory/risk-profile.md` | Günlük (curator çalıştıktan sonra) | Sisyphus | Yeni risk entry'leri, duplicate kontrolü, noise/signal oranı |
| `.opencode/state/memory/quality-history.md` | Her commit öncesi | CI + QA | Son quality gate sonucu, trend analizi |
| `bun test` çıktısı | Her commit öncesi | CI | Pass rate, yeni failure, pre-existing failure sayısı |
| `bun run typecheck` | Her commit öncesi | CI | 0 error ✅ |
| `bun run build` | Her commit öncesi | CI | 0 error ✅ |
| `hecateq-openagent doctor` | Haftalık | DevOps | 25/25 pass, yeni check kategorileri |
| `rehber/` klasörü | Kod değişikliği ile birlikte | Tech writer | Dosyalar güncel mi, AGENTS.md ile uyumlu mu |
| `docs/hecateq/` | Kod değişikliği ile birlikte | Tech writer | Hecateq-özel dokümantasyon güncelliği |
| GitHub PR hızı | Haftalık | Hecateq Orchestrator | PR açma → merge süresi, beklemedeki PR sayısı |
| CHANGELOG.md | Her release öncesi | Release manager | Eksik entry, format tutarlılığı |

### Sinyal Tabanlı İzleme

| Sinyal | Anlamı | Aksiyon |
|--------|--------|---------|
| `bun test`'te yeni failure | Regression | Blocker — PR merge edilmez, root cause analizi başlar |
| Doctor check'te yeni uyarı | Konfigürasyon/memory sorunu | Öncelikli olarak incelenir, ticket açılır |
| risk-profile.md'de duplicate > 5 | Curator çalışmıyor | Curator'u manuel tetikle, scheduler'ı kontrol et |
| PR merge hızı < 1/hafta | Darboğaz var | Kapasite planlaması, öncelik revizyonu |
| Upstream'de breaking change | Rebase riski | Acil upstream analizi, fork stratejisi revizyonu |

---

## 11. Sorumluluk Matrisi (RACI)

| Aktivite / Alan | Hecateq Orchestrator | Sisyphus | Oracle | Momus | QA | Security | Tech Writer | DevOps | Release Manager |
|----------------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **Yol haritası planlama** | **R** | C | C | C | I | I | C | I | C |
| **PR5: Test stabilization** | A | **R** | C | C | **R** | — | I | C | I |
| **PR6: Shim scope isolation** | A | **R** | C | C | **R** | — | — | — | I |
| **PR7: Memory curator** | A | **R** | C | C | C | — | C | — | I |
| **PR8: E2E orchestration** | A | C | C | C | **R** | — | I | — | I |
| **PR9: Snapshot cache fix** | A | **R** | C | C | C | — | — | — | I |
| **Memory sistemi bakımı** | I | **R** | I | I | — | — | C | — | — |
| **Doctor check geliştirme** | A | C | I | I | — | — | — | **R** | I |
| **Dokümantasyon (rehber/)** | I | C | C | I | — | — | **R** | — | — |
| **Kod review** | I | C | **R** | C | C | C | — | — | — |
| **Test yazma/çalıştırma** | I | C | I | — | **R** | — | — | C | — |
| **Güvenlik audit** | I | I | C | C | — | **R** | — | I | — |
| **Upstream rebase** | **R** | C | C | C | I | — | — | C | I |
| **Release yönetimi** | C | I | I | I | C | — | C | C | **R** |
| **OpenClaw bakımı** | I | **R** | I | I | C | C | — | C | — |
| **Telemetri uyumluluğu** | C | — | I | I | — | **R** | C | I | — |
| **CI/CD pipeline** | I | I | — | — | C | — | — | **R** | I |
| **KPI takibi** | **R** | C | I | I | C | — | C | C | C |

> **R** = Responsible (yapan), **A** = Accountable (onaylayan), **C** = Consulted (danışılan), **I** = Informed (bilgilendirilen)

---

## 12. Sonuç ve Çağrı

Hecateq OpenAgent, dört büyük PR ile sağlam bir temel üzerine inşa edilmiştir. Memory sistemi, handoff altyapısı ve doktor kontrolleri stabildir. Ancak **test kararlılığı**, projenin büyüme hızını sınırlayan birincil darbogazdır. Bu belgede önerilen 3 fazlı yol haritası, test kararlılığından başlayarak, memory curator ile veri kalitesini iyileştirerek, E2E coverage ile güven oluşturarak ve nihayet performans/ekosistem ile ölçeklenerek ilerlemektedir.

İlk adım **hemen yarın atılmalıdır**: `bun test` ile mevcut tüm failure'ları dökümleyin, PR5'i başlatın, `rehber/README.md`'den kök `AGENTS.md`'ye ilk bağlantıyı ekleyin. Her geciken gün, teknik borcu büyütür.

**Sıradaki adım:** PR5 (Test stabilization suite) için branch açın (`dev` branch'inden), mevcut tüm test failure'larını kataloglayın, root cause analizini tamamlayın — [CONTRIBUTING.md](../CONTRIBUTING.md) ve [docs/reference/known-issues.md](../docs/reference/known-issues.md) bu süreçte size rehberlik edecektir.

---

> **rehber/ serisi (10 dosya):**
> | # | Dosya | Amaç |
> |---|-------|------|
> | [README](./README.md) | Ana indeks, istatistikler, sözlük, okuma sırası |
> | [01](./01-mimari-genel-bakis.md) | Mimari genel bakış, teknoloji stack, başlatma akışı |
> | [02](./02-ajanlar-sistemi.md) | 12 ajan sistemi, prompt mimarisi, model gereksinimleri |
> | [03](./03-hooks-sistemi.md) | 5 katmanlı hook kompozisyonu, kayıt mekanizması |
> | [04](./04-tools-ve-mcp.md) | 20-39 tool, 3 katmanlı MCP, ToolRegistry |
> | [05](./05-ozellikler-modulleri.md) | 21 feature modülü, 8 aşamalı orchestration pipeline |
> | [06](./06-ortak-yardimcilar-ve-config.md) | 297 shared/ dosyası, 30 Zod schema, 9 sub-config |
> | [07](./07-cli-build-ve-packages.md) | Tüm CLI, doctor, build pipeline, platform binary |
> | [08](./08-harici-entegrasyonlar.md) | OpenClaw, GitHub workflows, güvenlik, telemetri |
> | [09](./09-dokumantasyon-ve-proje-yapilandirmasi.md) | Dizin yapısı, test konvansiyonları, anti-patterns |
> | **10** (bu dosya) | **İlerleme planı, yol haritası, risk matrisi, eylem planı** |

> Bu belge, Hecateq OpenAgent v0.1.0-beta.8 (dev branch, commit `39aadbf9f`) için hazırlanmıştır.
> Güncelleme önerileri için PR açınız veya `rehber/` dizininde issue oluşturunuz.
> İlerleme takibi: `.opencode/state/memory/progress.md` (haftalık güncelleme).
