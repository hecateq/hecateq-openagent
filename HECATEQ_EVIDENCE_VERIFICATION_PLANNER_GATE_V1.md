# Hecateq Evidence, Verification & Planner Gate V1

## Objective

Mevcut **Planner V2 + Handoff Contract + Runtime Continuity V1** üzerine ikinci aşamayı uygula.

Bu çalışma dört ana hedef içerir:

1. Runtime Continuity V1 production wiring eksiklerini kapatmak.
2. Task/attempt/execution-bound Evidence sistemi eklemek.
3. Reviewer ve Verifier sorumluluklarını ayırmak.
4. Hecateq Planner activation kararını task size yerine risk/uncertainty üzerinden yapmak.

---

# Non-Negotiable Scope

Bu çalışma sırasında:

- Legacy agent kaldırma **YAPMA**.
- Hecateq Goal subsystem **YAPMA**.
- GOAL / STOP WHEN global contract **YAPMA**.
- Model routing refactor **YAPMA**.
- Reasoning vocabulary refactor **YAPMA**.
- Global fan-out refactor **YAPMA**.
- Team-mode transport rewrite **YAPMA**.
- Yeni background task engine **YAPMA**.
- Momus **KULLANMA**.

**Momus hiçbir routing, fallback, reviewer, verifier veya planner-assistance candidate set'inde bulunmayacak.**

Mevcut runtime primitives, contracts ve state mekanizmaları mümkün olduğunca reuse edilmelidir.

Strict TypeScript kullan. `any` kullanma. Silent fallback yapma.

---

# PART A — Runtime Continuity Production Wiring

Runtime Continuity V1 contract/test altyapısı hazır ancak önceki final raporda production wiring seviyesinde bazı açıklar kaldı.

Evidence/Verifier katmanına geçmeden önce bunları gerçek runtime'a bağla.

## A1. BackgroundManager Liveness Probe

Mevcut:

```ts
probeBackgroundTaskLiveness(...)
```

API'sini production orchestration akışına bağla.

Beklenen:

```text
running background execution
→ real BackgroundManager state
→ alive=true
→ WAITING
→ NOT BLOCKED
```

Cross-feature cyclic dependency yaratma.

Gerekirse orchestration-controller seviyesinde ince bir adapter/factory kullan:

```text
orchestration-controller
→ thin adapter/factory
→ BackgroundManager accessor
```

Yeni BackgroundManager abstraction yazma.

Fail-closed davranış yalnızca gerçek runtime probe sağlanamıyorsa geçerli olmalı.

## A2. Parent Wake Wiring

Mevcut parent-wake / wake-idempotency lifecycle'ını incele.

Gerçek wake/resume event geldiğinde ilgili execution'a:

```ts
attachChannel({
  kind: "parent_wake",
  id: "..."
})
```

eşdeğer correlation bağla.

Wake tüketildiğinde veya channel artık geçerli olmadığında detach et.

Aynı wake event tekrar gelirse:

```text
NO duplicate resume
NO duplicate task spawn
NO duplicate lifecycle transition
```

olmalı.

## A3. `execution_started` Runtime Event

Gerçek authoritative delegation spawn boundary'de:

```text
execution_started
```

event emit et.

Tercihen actual execution başlangıcının source-of-truth olduğu mevcut boundary kullanılmalı (`executePendingDelegations`, delegation-executor veya eşdeğer gerçek spawn noktası).

Event en az:

```text
executionId
taskGraphId
taskId
attempt
agent
timestamp
```

taşımalı.

Model-generated text source of truth olamaz.

## A4. Duplicate Delegation Guard Production Wiring

Mevcut:

```ts
checkDuplicateDelegation(...)
```

yalnız standalone utility/test seviyesinde kalmamalı.

Gerçek delegation başlamadan hemen önce kontrol et.

```text
same taskGraphId
+ same taskId
+ active/waiting execution
→ DO NOT SPAWN NEW EXECUTION
```

Mümkünse mevcut execution reuse et.

Existing execution başka agent ile çalışıyorsa deterministic explicit conflict/block sonucu dön.

Silent duplicate yasak.

Terminal attempt'ten sonra retry gerekiyorsa:

```text
new attempt
→ new executionId
```

---

# PART B — Task-Bound Evidence

Task completion yalnızca agent'ın `"done"` demesine dayanmayacak.

Evidence kesin olarak:

```text
taskGraphId
taskId
attempt
executionId
```

identity'sine bağlanmalı.

## B1. Evidence Contract

Typed contract oluştur.

Örnek:

```ts
interface HecateqTaskEvidence {
  evidenceId: string

  taskGraphId: string
  taskId: string
  attempt: number
  executionId: string

  agent: string
  createdAt: string

  filesChanged?: string[]

  commands?: Array<{
    command: string
    exitCode?: number
  }>

  tests?: Array<{
    name?: string
    command?: string
    passed?: number
    failed?: number
    exitCode?: number
  }>

  checks?: Array<{
    kind: string
    status: "passed" | "failed" | "unknown"
    detail?: string
  }>
}
```

Exact naming mevcut repo convention'ına göre değişebilir.

Strict TypeScript kullan. `any` kullanma.

## B2. Evidence Runtime Truth

Evidence mümkün olduğunca actual runtime/tool metadata'dan gelmeli.

Örnek:

```text
bun test
→ actual exitCode
```

```text
bun run typecheck
→ actual exitCode
```

```text
files changed
→ actual execution/change metadata
```

Şu authoritative evidence değildir:

```text
Agent: "699 test passed"
```

Model bunu özetleyebilir ama runtime doğrulaması olmadan proof değildir.

## B3. Attempt Binding

Örnek:

```text
T4 / attempt 1 / exec_A
```

evidence'i:

```text
T4 / attempt 2 / exec_B
```

için kullanılamaz.

Yeni attempt:

```text
old evidence → historical/stale
new evidence → current
```

## B4. Evidence Freshness

Minimum validation:

```text
executionId mismatch
→ STALE

attempt mismatch
→ STALE

taskId mismatch
→ INVALID

taskGraphId mismatch
→ INVALID
```

Git SHA/tree hash kolay ve mevcut helper ile güvenilir şekilde bağlanabiliyorsa değerlendirilebilir; ancak bu feature'ı commit-bound review framework'üne dönüştürme.

Identity binding bu aşama için yeterlidir.

## B5. Evidence Storage

Mevcut runtime state alanını kullan:

```text
.opencode/state/hecateq/
```

Tercihen minimal:

```text
.opencode/state/hecateq/evidence/
```

Yeni artifact framework kurma.

Evidence içinde:

```text
NO full prompts
NO secrets
NO full model responses
NO huge stdout dumps
NO full tool-output transcripts
```

Sadece concise verification metadata tut.

## B6. Evidence Ledger Integration

Runtime ledger'a minimal event eklenebilir:

```text
evidence_recorded
```

Payload yalnızca referans taşımalı:

```text
evidenceId
taskId
attempt
executionId
```

Evidence'nin tamamını JSONL ledger'a dump etme.

---

# PART C — Reviewer ve Verifier Ayrımı

Momus kullanma.

Reviewer ile Verifier farklı kavramlar olacak.

## C1. Reviewer

Reviewer:

```text
plan/code approach quality
```

kontrol eder.

Görevleri:

- yanlış decomposition
- missing scope
- kötü dependency graph
- yanlış agent assignment
- mimari risk
- unnecessary complexity
- hidden assumptions
- unsafe parallelization

Preferred exact custom agents:

```text
assumption-breaker
agent-contract-manager
```

İhtiyaca göre seç. Her ikisini her işte çağırma.

Silent fallback yok.

## C2. Verifier

Verifier:

```text
gerçek implementation doğru şekilde tamamlandı mı?
```

sorusunu cevaplar.

Primary exact agent:

```text
qa-test-engineer
```

Verifier implementation yapmaz.

Verifier şunları kontrol eder:

- Evidence var mı?
- Doğru task'a mı bağlı?
- Doğru attempt mi?
- Current executionId mi?
- Test gerçekten çalışmış mı?
- Exit status gerçek mi?
- Required checks geçmiş mi?
- Implementation task gereksinimini karşılıyor mu?
- Evidence stale mi?

## C3. Verification Result Contract

Typed result oluştur:

```ts
interface HecateqVerificationResult {
  taskGraphId: string
  taskId: string
  attempt: number
  executionId: string

  status:
    | "verified"
    | "rejected"
    | "insufficient_evidence"

  blockers: string[]
  notes?: string
}
```

`verified` yalnızca current attempt/current execution evidence ile üretilebilir.

---

# PART D — Completion Gate

Şunu kesin ayır:

```text
execution completed
≠
task verified
```

Workflow:

```text
Execution
   ↓
COMPLETED
   ↓
Evidence captured
   ↓
qa-test-engineer
   ↓
VERIFIED
```

Task ancak verification sonrası success kabul edilmelidir.

Mevcut task graph state contract'ını tamamen değiştirme.

Minimum additive integration tercih et.

---

# PART E — Bounded Verification Retry

Infinite loop yasak.

Maksimum:

```text
implementation attempt 1
→ verifier
→ REJECT
→ repair attempt 2
→ verifier final
```

Final verifier yine reject ederse:

```text
verification_failed
→ BLOCKED
→ Hecateq God
```

Üçüncü otomatik implementation attempt başlatma.

---

# PART F — Notification-Driven Verification

Verifier background çalışıyorsa:

```text
spawn
poll
poll
poll
```

yapma.

Runtime Continuity V1 kullan:

```text
Verifier execution
→ WAITING
→ completion event
→ parent wake
→ correlate executionId
→ continue pipeline
```

`background_output` yalnız diagnostic peek olabilir.

Completion mechanism olamaz.

---

# PART G — Risk / Uncertainty Planner Gate

Hecateq Planner çağrısı task büyüklüğüne bağlanmayacak.

Şu kurallar yasak:

```text
3+ files → Planner
100 LOC → Planner
5 tasks → Planner
```

Karar:

```text
risk
+
uncertainty
+
architectural impact
```

üzerinden verilecek.

## G1. Planner Activation Contract

Typed assessment oluştur veya mevcut classification contract'ını genişlet.

Örnek:

```ts
interface PlannerActivationAssessment {
  uncertainty: "low" | "medium" | "high"
  risk: "low" | "medium" | "high"

  architecturalImpact: boolean
  crossSystemDependencies: boolean
  migrationRisk: boolean
  unclearRequirements: boolean

  decision:
    | "direct_delegate"
    | "god_decompose"
    | "planner_required"

  reasons: string[]
}
```

## G2. Direct Delegate

Şunlarda:

```text
risk = low
uncertainty = low
known domain
clear implementation target
localized change
```

akış:

```text
Hecateq God
→ exact specialist
```

Planner çağırma.

## G3. God Decompose

Şunlarda:

```text
risk = low/medium
uncertainty = medium
architecture known
multiple clear work units
```

akış:

```text
Hecateq God
→ small decomposition/task graph
→ exact agents
```

Planner zorunlu değildir.

## G4. Planner Required

Şunlardan biri anlamlı şekilde varsa Planner kullan:

```text
high uncertainty
high risk
architectural ambiguity
cross-system redesign
data migration risk
major API/contract changes
unclear ownership boundaries
unclear requirements
multiple dependent subsystems
```

File count veya LOC tek başına reason olamaz.

---

# PART H — Risk Assessment Agents

Hecateq God gerekli olduğunda exact custom agents kullanabilir.

## `strategy-analyst`

Kullan:

```text
impact
priority
scope trade-off
risk/reward
```

belirsizse.

## `assumption-breaker`

Kullan:

```text
hidden assumptions
failure cases
ambiguity
unsafe assumptions
```

varsa.

## `system-philosopher`

Kullan:

```text
architecture gereksiz karmaşık mı?
neden böyle?
daha basit sınır mümkün mü?
```

gibi mimari belirsizlikte.

## `agent-contract-manager`

Kullan:

```text
agent I/O
handoff
task graph
runtime contracts
protocol boundaries
```

değişiyorsa.

Her assessment'ta bütün agentları çağırma. Minimum gerekli exact agent set'ini kullan.

---

# PART I — Planner Gate Runtime Truth

Planner activation yalnız prompt prose olarak kalmamalı.

Structured result runtime'da taşınmalı.

Runtime ledger'a tek bir karar event'i eklenebilir:

```text
planner_gate_evaluated
```

Örnek metadata:

```json
{
  "decision": "planner_required",
  "risk": "high",
  "uncertainty": "high",
  "reasons": [
    "cross-system contract change"
  ]
}
```

Event ledger'ı telemetry çöplüğüne dönüştürme.

---

# PART J — Runtime Identity Reuse

Yeni sistemler:

```text
Evidence
Verification
Verifier
```

mevcut:

```ts
HecateqExecutionIdentity
```

contract'ını kullanmalıdır.

Yeni ikinci execution identity sistemi oluşturma.

Canonical chain:

```text
Task Graph
→ Task
→ Attempt
→ HecateqExecutionIdentity
→ Evidence
→ Verification Result
```

---

# PART K — Handoff Integration

Mevcut canonical handoff formatını koru:

```text
STATUS
SIGNALS_EMITTED
HANDOFF
CONFIDENCE
QUALITY_NOTES
NEXT_RECOMMENDED_AGENT
```

Verification result gerekirse signal ile taşınabilir:

```json
{
  "signal": "verification_complete",
  "payload": {
    "task_id": "T4",
    "execution_id": "exec_...",
    "status": "verified"
  }
}
```

Evidence'nin tamamını handoff içine koyma.

---

# PART L — Momus Hard Exclusion

Bu feature'ın hiçbir yerinde Momus kullanılmayacak.

Kontrol et:

```text
Reviewer routing
Verifier routing
Planner gate assistance
fallback candidates
prompt recommendations
candidate ranking
tests
runtime chains
```

Candidate set içinde `momus` varsa çıkar.

Explicit regression test yaz:

```text
Hecateq Evidence/Verification/Planner pipeline
NEVER selects momus
```

---

# PART M — Behavioral Regression Tests

En az aşağıdaki davranışları pinle.

## Runtime Wiring

1. production BackgroundManager probe live task → WAITING
2. dead/missing task → BLOCKED/FAILED according to existing semantics
3. parent wake attaches correct execution
4. duplicate parent wake is idempotent
5. `execution_started` emitted from actual delegation boundary
6. duplicate delegation guard prevents second live execution
7. completed attempt allows new attempt with new executionId

## Evidence

8. evidence bound to correct task
9. evidence bound to correct attempt
10. evidence bound to correct executionId
11. old attempt evidence becomes stale
12. wrong task evidence rejected
13. wrong graph evidence rejected
14. runtime exitCode preserved
15. model text alone does not become authoritative evidence
16. evidence persistence/readback works
17. evidence storage excludes full prompt
18. evidence storage excludes large output dump

## Verification

19. current valid evidence → VERIFIED
20. stale evidence → insufficient_evidence/rejected
21. missing evidence → insufficient_evidence
22. failed test evidence → rejected
23. verifier result references executionId
24. completed execution alone is NOT verified
25. first rejection allows one repair
26. second rejection stops automatic repair
27. verifier background work uses WAITING/resume contract

## Planner Gate

28. low-risk known localized task → direct_delegate
29. medium uncertainty known architecture → god_decompose
30. high uncertainty → planner_required
31. high-risk migration → planner_required
32. cross-system redesign → planner_required
33. file count alone does not trigger planner
34. LOC count alone does not trigger planner
35. structured reasons are emitted
36. planner gate result can be recorded in ledger

## Agent Routing

37. `qa-test-engineer` is preferred verifier
38. `assumption-breaker` can review high-risk assumptions
39. `agent-contract-manager` can review contract-heavy plan
40. missing preferred exact agent does not silently category fallback
41. Momus is excluded from reviewer candidates
42. Momus is excluded from verifier candidates
43. Momus is excluded from planner gate assistance
44. pipeline never selects Momus

## Compatibility

45. Planner V2 existing tests remain green
46. Runtime Continuity V1 existing tests remain green
47. Handoff runtime tests remain green
48. handoff-history backward compatibility remains green
49. background-agent affected tests remain green
50. existing reviewer-routing tests remain green or are intentionally migrated with equivalent behavior

Behavioral tests tercih et.

Prompt sentence/string snapshot testlerine gereksiz yere güvenme.

Timing-based async test yazma. Explicit completion signal/event kullan.

---

# PART N — Adversarial Review

Implementation tamamlandıktan sonra `assumption-breaker` ile özellikle şu edge case'leri incelet:

```text
stale evidence accidentally accepted
wrong attempt verified
duplicate verifier execution
duplicate parent wake
execution completed but unverified
verification retry infinite loop
planner over-trigger
planner under-trigger
Momus accidentally reachable
missing runtime probe producing false state
```

Bulunan gerçek sorunları düzelt.

Sadece rapor üretip bırakma.

---

# PART O — Agent Contract Review

`agent-contract-manager` şunları kontrol etsin:

```text
ExecutionIdentity
Evidence
VerificationResult
PlannerActivationAssessment
Handoff
Runtime Event Ledger
```

Aralarında:

- field mismatch
- duplicated source of truth
- ambiguous ownership
- mutable identity
- incompatible naming
- unnecessary parallel contracts

var mı?

Mümkün olduğunca mevcut contract'ları reuse et.

---

# PART P — Verification Commands

En az:

```text
new evidence tests
new verification tests
new planner-gate tests
runtime-continuity tests
hecateq-orchestration full suite
affected background-agent tests
handoff tests
planner-v2 tests
typecheck
```

çalıştır.

Mümkünse broader relevant suite de çalıştır.

Shared test process'i kirleten pre-existing test varsa isolated run ile yeniden doğrula ve açıkça raporla.

Test hatası oluşursa:

1. İlk olarak bunun yeni değişiklikten kaynaklanıp kaynaklanmadığını belirle.
2. Yeni değişiklik kaynaklıysa düzelt ve ilgili testleri tekrar çalıştır.
3. Pre-existing ise clean/baseline kanıtı ile ayır.
4. Yeni feature'ın başarısız testini "pre-existing" diye etiketleme.

---

# PART Q — Final Invariants

Final raporda aşağıdakilerin her birini açıkça doğrula:

```text
live work != blocked

same logical task != duplicate execution

execution completed != task verified

old attempt evidence != current proof

model claim != runtime evidence

verification rejection != infinite retry

task size != planning necessity

planner decision = risk + uncertainty

Momus != reviewer

Momus != verifier

Momus != fallback
```

---

# PART R — Agent Assignments

Sadece gerçek mevcut agent ID'lerini kullan.

## `explore`

Önce ilgili dosya ve runtime akışlarını haritalar:

- Runtime Continuity V1
- BackgroundManager
- parent wake
- delegation executor/controller
- task graph
- Planner V2
- handoff
- reviewer routing
- state persistence
- relevant tests

Kod değiştirmez; implementasyon agentlarına dosya/contract haritası sağlar.

## `context-manager`

Mevcut:

- active-context
- progress
- decisions
- task graph
- Hecateq state
- previous implementation contracts

ile yeni feature'ın uyumunu kontrol eder.

## `agent-contract-manager`

Contract ownership ve entegrasyonu inceler/uygular:

- ExecutionIdentity
- TaskEvidence
- VerificationResult
- PlannerActivationAssessment
- Handoff
- Runtime Event Ledger

Duplicate source of truth yaratılmasını engeller.

## `nodejs-backend-architect`

Production wiring, Evidence/Verification architecture ve Planner Gate'in mevcut orchestration layer'a nasıl oturacağını belirler.

Gereksiz yeni abstraction oluşturmaz.

## `nodejs-backend-developer`

Ana runtime implementation'ı yapar:

- production continuity wiring
- evidence store
- evidence validation
- verification pipeline
- planner gate
- ledger integration

## `error-recovery-agent`

Özellikle:

- retry sınırları
- stale evidence
- failed verifier
- dead child
- parent-wake edge cases
- insufficient evidence
- retry sonrası terminal behavior

üzerinde çalışır.

## `qa-test-engineer`

Primary verifier/test owner.

- Behavioral tests yazar.
- Targeted suite çalıştırır.
- Broader affected suites çalıştırır.
- Typecheck doğrular.
- Evidence'nin gerçek runtime sonuçlarına dayandığını kontrol eder.

## `assumption-breaker`

Implementation sonrası adversarial review yapar.

Gerçek blocker bulursa implementation agent'ına geri gönderilir ve düzeltilir.

## `strategy-analyst`

Planner activation policy'sinin risk/uncertainty kararlarını inceler.

Size-based veya aşırı planner çağıran heuristics oluşmasını engeller.

## `system-philosopher`

Yalnız mimari karmaşıklık gereksiz büyümüşse çağır.

Yeni sistem mevcut mekanizmalarla daha basit kurulabiliyorsa sadeleştirme önerisi verir.

## `github-specialist`

Bu görevde otomatik commit/push/PR yapma.

Yalnız kullanıcı açıkça delivery isterse kullanılacak.

---

# PART S — Delegation Rules

Fleet/Coordinator görevi kendisi implement etmez.

İhtiyaca göre exact custom agent'lara delegate eder.

- `spawn_subagent` kullanma.
- Mevcut sistem uygunsa `delegate` / exact `subagent_type` kullan.
- Category routing'i ancak açıkça gerekli ve exact agent bulunmadığında kullan; bu feature'ın kritik contract görevlerinde silent category fallback yapma.
- Aynı dosyada çakışacak paralel implementasyon başlatma.
- Bağımsız read/research görevleri paralel olabilir.
- Dependency olan implementation görevleri doğru sırada çalıştır.
- Her agent'a task'ın tamamını değil, sahip olduğu feature slice'ı ver.
- Agent sonucu geldikten sonra sadece rapora güvenme; değişen kodu ve test kanıtını doğrula.

---

# PART T — Autonomous Execution Protocol

Bu görev uzun süre otonom yürütülebilir.

Kullanıcıdan implementasyon sırasında tekrar onay isteme.

Belirsizlik olduğunda:

1. Mevcut codebase contract'ını oku.
2. En az breaking, backward-compatible yolu seç.
3. Assumption'ı final raporda belirt.
4. Riskli/destructive işlem yapma.
5. Scope dışında kalan refactor'u sonraya bırak.

Bir task başarısız olduğunda bütün çalışmayı durdurma.

Bağımsız ready task'lara devam et.

Ancak contract corruption, veri kaybı veya ciddi architecture conflict varsa fail closed davran ve final raporda BLOCKED olarak açıkla.

---

# PART U — Definition of Done

Görev yalnızca kod yazılınca DONE değildir.

DONE için:

- Runtime Continuity production wiring gerçek runtime'da bağlı olmalı.
- Duplicate delegation guard production path'te çalışmalı.
- Evidence current task/attempt/execution'a bağlı olmalı.
- Stale evidence verification'da reddedilmeli.
- Execution completion ve verification ayrılmış olmalı.
- `qa-test-engineer` verifier olarak gerçek pipeline'da kullanılabilir olmalı.
- Max one automatic repair cycle uygulanmalı.
- Planner activation size-based olmamalı.
- Planner decision structured runtime result olmalı.
- Momus tüm yeni yolların dışında olmalı.
- New behavioral tests geçmeli.
- Existing affected tests regress etmemeli.
- Typecheck temiz olmalı.
- Adversarial review yapılmalı ve bulunan gerçek sorunlar giderilmeli.
- Final agent-contract review tamamlanmalı.

---

# PART V — Final Report Format

Final çıktıyı şu formatta ver:

```text
HECATEQ EVIDENCE, VERIFICATION & PLANNER GATE V1 — FINAL REPORT

STATUS:
DONE | PARTIAL | BLOCKED

1. FILES CHANGED
- new
- modified
- deleted (expected: none unless clearly justified)

2. RUNTIME CONTINUITY PRODUCTION WIRING
- BackgroundManager probe
- Parent wake
- execution_started
- duplicate delegation guard

3. EVIDENCE CONTRACT
- types
- storage
- runtime source
- attempt/execution binding
- stale rules

4. VERIFICATION PIPELINE
- verifier routing
- verification result
- completion gate
- retry policy
- notification-driven verifier waiting

5. PLANNER ACTIVATION GATE
- risk model
- uncertainty model
- decisions
- runtime integration

6. MOMUS EXCLUSION
List every runtime/prompt/test exclusion point.

7. AGENT WORK SUMMARY
For every delegated agent:
- agent
- task
- result
- changed files

8. TESTS RUN
For every suite:
- command
- passed
- failed

9. TYPECHECK
- command
- exit code

10. ADVERSARIAL REVIEW
- findings
- fixes

11. CONTRACT REVIEW
- findings
- fixes

12. PRE-EXISTING FAILURES
Only with evidence/baseline separation.

13. KNOWN RISKS
No hidden TODOs.

14. INVARIANTS VERIFIED
Explicitly report all required invariants.

15. OUT-OF-SCOPE FOLLOW-UPS
Only genuinely deferred work.

HANDOFF
STATUS: DONE | PARTIAL | BLOCKED
SIGNALS_EMITTED: [...]
HANDOFF: return_to_caller
CONFIDENCE: 0.0-1.0
QUALITY_NOTES: ...
NEXT_RECOMMENDED_AGENT: ...
```

Do not claim DONE if production wiring remains as unused/opt-in helper APIs only.

Do not claim tests passed unless they were actually executed.

Do not hide failing tests.

Do not auto-commit or push unless explicitly requested.
