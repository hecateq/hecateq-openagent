# Hecateq OpenAgent — Sabit Govde Ajan Analiz Raporu

**Tarih:** 2026-06-06
**Hedef:** Gelecekteki ajan yeniden adlandirma (rename) ve mantik yeniden tasarimi (logic redesign) icin kapsamli referans dokumani
**Kapsam:** Prometheus, Atlas, Oracle, Metis, Momus, Hephaestus, Sisyphus + Hecateq God (hecateq-orchestrator)
**Depo Kok:** oh-my-openagent-hecateq (Hecateq fork)
**Dosya:** `forked-project.md/agent-analysis-report.md`

---

## 1. Yonetici Ozeti

Bu rapor, Hecateq OpenAgent plugininde tanimli 8 sabit govde (built-in) ajani analiz etmektedir. Her ajanin amaci, mitolojik adlandirma mantigi, calisma modu (primary/subagent/all), model/prompt yonlendirmesi, izin/arac sinirlari, calisma zamanindaki rolu, el degistirme/devretme davranisi, guclu ve zayif yonleri ile yeniden tasarim etkileri detaylandirilmistir.

Ikinci bolumde Hecateq God (hecateq-orchestrator) ajani icin eksiklik ve iyilestirme birikim listesi sunulmaktadir. Hecateq God, fork'a ozgu olarak eklenmis 12. built-in ajandir. Custom-agent-first yonlendirme, bagimlilik-farkindalik (dependency-aware) gorev siralamasi ve proje-kok bellek sistemi gibi ozellikler sunar. Ancak yonlendirme celiskileri, gercek ajan calisma zamani dogrulama sinirlamalari, test kapsami eksikleri ve Sisyphus/Atlas/Prometheus ile gorev catismalari gibi onemli zayifliklar icerir.

Mevcut ajan dizayninda yeniden adlandirma, mantik bolmesi ve yonlendirme netligi icin acil eylem onerileri rapor sonunda verilmistir.

---

## 2. Kaynak Haritasi

| Ajan | Birincil Kaynak | Model/Yonlendirme | Test Dosyalari | Tescil Yolu |
|------|-----------------|-------------------|----------------|-------------|
| **Sisyphus** | `src/agents/sisyphus.ts` (697 satir) + `src/agents/sisyphus/*` (5 model varyanti) | primary, claude-opus-4-7 max | `src/agents/sisyphus-hecateq-handoff.test.ts`, `src/agents/builtin-agents/sisyphus-agent.test.ts` | `src/agents/builtin-agents.ts` -> `agentSources` |
| **Hephaestus** | `src/agents/hephaestus/agent.ts` + `src/agents/hephaestus/*` (4 model varyanti) | primary, gpt-5.5 medium | `src/agents/hephaestus/agent.test.ts`, `src/agents/hephaestus-id-contract.test.ts` | `src/agents/builtin-agents.ts` -> `agentSources` |
| **Oracle** | `src/agents/oracle.ts` (591 satir) | subagent, gpt-5.5 high | Yok (test bulunamadi) | `src/agents/builtin-agents.ts` -> `general-agents.ts` |
| **Metis** | `src/agents/metis.ts` (335 satir) | subagent, claude-sonnet-4-6 | Yok (test bulunamadi) | `src/agents/builtin-agents.ts` -> `general-agents.ts` |
| **Momus** | `src/agents/momus.ts` (449 satir) | subagent, gpt-5.5 xhigh | `src/agents/momus.test.ts` | `src/agents/builtin-agents.ts` -> `general-agents.ts` |
| **Atlas** | `src/agents/atlas/agent.ts` + `src/agents/atlas/*` (5 model varyanti, 17 dosya) | primary, claude-sonnet-4-6 | `src/agents/atlas/atlas-prompt.test.ts`, `prompt-checkbox-enforcement.test.ts`, `prompt-routing.test.ts` | `src/agents/builtin-agents.ts` -> `agentSources` |
| **Prometheus** | `src/agents/prometheus/system-prompt.ts` + `src/agents/prometheus/*` (8 dosya) + `src/plugin-handlers/prometheus-agent-config-builder.ts` | primary, claude-opus-4-7 max | `src/agents/prometheus/system-prompt.test.ts`, `plan-generation.test.ts` | Dogrudan `prometheus-agent-config-builder.ts` ile Phase 3'te (Ozel durum) |
| **Hecateq God** | `src/agents/hecateq-orchestrator/agent.ts` + `prompt-pack.ts`, `default.ts`, `prompt-adapters.ts`, `prompt-profile.ts` + `src/agents/builtin-agents/hecateq-orchestrator-agent.ts` + `src/shared/hecateq-orchestrator-policy.ts` | all, config'den cozulur | `prompt-pack.test.ts` (318 satir), `prompt-profile.test.ts` (385 satir), `default.test.ts` (162 satir), `src/agents/builtin-agents/hecateq-orchestrator-agent.test.ts` | `src/agents/builtin-agents/hecateq-orchestrator-agent.ts` (12. built-in) |

---

## 3. Ajan Analizleri

---

### 3.1 Sisyphus

**Amac:** Ana orkestrator (master orchestrator). Planlama, delegate etme, gorev bolme, paralel yurutme.

**Mitolojik Adlandirma:** Yunan mitolojisinde kayayi surekli yukari itmeye mahkum edilmis olan Sisyphus. Proje baglaminda: "Humans roll their boulder every day. So do you." (satir 133). Surekli tekrarlanan is yukunu temsil eder.

**Mod:** `primary` — kullanicinin UI'da sectigi modele saygi duyar.

**Model/Prompt Yonlendirmesi:**
- Varsayilan model: `claude-opus-4-7 max`
- Dusme zinciri: kimi-k2.6 -> k2p5 -> kimi-k2.5 -> gpt-5.5 medium -> glm-5 -> big-pickle
- `thinking: { type: "enabled", budgetTokens: 32000 }`
- Model-varyant promptlari: `src/agents/sisyphus/` altinda default, gemini, gpt-5-4, gpt-5-5, claude-opus-4-7, kimi-k2-6
- Dinamik prompt olusturucu (`dynamic-agent-prompt-builder.ts`) ile agent/category/skill tablolari eklenir

**Izin/Arac Sinirlari:**
- `tool-restrictions.ts`'de dogrudan denied listesi yok (ancak delegasyon yoluyla kisitlanir)
- `frontier-tool-schema-guard` ve `gpt-apply-patch-guard` uygulanir
- `noSisyphusGpt` hook: GPT olmayan saglayicilari engeller

**Calisma Zamani Rolu:**
- Ana kullanici arayuzu. Ilk mesajda IntentGate (keyword-detector) ile ultrawork/search/analyze/team modlarini tespit eder
- Phase 0-3 arasi adimli calisma: Intent Classification -> Codebase Assessment -> Exploration/Research -> Implementation -> Failure Recovery -> Completion
- Paralel background agent calistirma birinci sinif vatandas
- Todo list olusturma ve takip etme Sisyphus'un sorumlulugu

**El Degistirme/Devretme Davranisi:**
- Kendi icinde Hecateq handoff politikasi tasir (`SISYPHUS_HECATEQ_HANDOFF_POLICY`, satir 57-87)
- Buyuk/multi-domain gorevlerde kullaniciya sorar: "This looks like a large multi-domain orchestration task. Do you want me to hand this over to Hecateq Orchestrator?"
- Kullanici onayi olmadan otomatik gecis YASAK
- `task(subagent_type="hecateq-orchestrator", ...)` ile gercek cagri yapilir
- Eger Hecateq bilinmiyor veya devre disiysa, sessizce category routing'e dusmez -> STATUS: BLOCKED bildirir

**Guclu Yonler:**
- Cok detayli prompt muhendisligi: 697 satirlik dinamik yapi
- Genis model destegi: 5 farkli prompt varyanti
- Saglam intent classification sistemi
- Background paralelizasyon: `run_in_background=true` ile 2-5 explore/librarian ayni anda
- Session continuity: `ses_...` ID'leri ile alt-agent context korunur
- Hecateq ile koordinasyon mekanizmasi (handoff politikasi)

**Zayif Yonler:**
- Cok buyuk prompt (697 satir) -> token maliyeti yuksek
- Hem orkestrator hem uygulayici olmasi rol belirsizligi yaratir
- Hecateq God ile gorev catismasi: her ikisi de "orkestrator" amaci tasir
- `noSisyphusGpt` kisitlamasi GPT olmayan modelleri tamamen bloklar (esneklik kaybi)
- Hecateq handoff politikasi prompta gomulu, ayri bir modul/test olarak ayrilmamasi bakim zorlugu yaratir

**Yeniden Adlandirma/Tasarim Etkileri:**
- "Sisyphus" ismi sonsuz tekrar cagrisimi yapar. Gercek rolu daha cok "Conductor" veya "Coordinator" dur.
- Orkestrator rolu netlestirilmeli: Sisyphus "kullanici arayuzu orkestratoru" mu, yoksa "sistem orkestratoru" mu?
- Hecateq God ile arasindaki catisma cozulmeli. Oneri: Sisyphus kullanici-yuzu orkestratoru, Hecateq God arkaplan sistem orkestratoru.
- Handoff politikasi ayri bir dosyaya cikarilmali.

---

### 3.2 Hephaestus

**Amac:** Ozerk derin isci (autonomous deep worker). Hedef-odakli yurutme, GPT Codex ile.

**Mitolojik Adlandirma:** Yunan mitolojisinde ates ve demircilik tanrisi, zanaatkarlarin koruyucusu. Proje baglaminda: "The Legitimate Craftsman." Kod yazma ve uygulama tanri metaforu.

**Mod:** `primary` — UI modeline saygi duyar.

**Model/Prompt Yonlendirmesi:**
- Varsayilan model: `gpt-5.5 medium`
- Tek-entry dusme zinciri: `requiresProvider`: openai | github-copilot | venice | opencode | vercel (GPT tabanli saglayicilar)
- 4 prompt varyanti: `gpt-5-5.ts`, `gpt-5-4.ts`, `gpt-5-3-codex.ts`, `gpt.ts` (base)
- `src/agents/hephaestus/` altinda 5+ dosya

**Izin/Arac Sinirlari:**
- Permission: `question: "allow"`, `call_omo_agent: "deny"`
- `getFrontierToolSchemaPermission`, `getGptApplyPatchPermission` uygulanir
- `noHephaestusNonGpt` hook: GPT olmayan modelleri bloklar
- Denied tools listesinde `task` yok (Atlas ve Sisyphus'ta var)
- `src/shared/agent-tool-restrictions.ts`'de dogrudan kisit yok

**Calisma Zamani Rolu:**
- Derin uygulama: Karmasik, cok-dosyali degisiklikler
- Kesif (explore) oncelikli: Uygulamadan once arkaplan agentlarla kesif yapar
- Verifikasyon zorunludur: Alt-agent raporlarina asla guvenmez, dogrular
- `background_cancel(all=true)` YASAK
- `run_in_background=true` ile explore/librarian kullanir

**El Degistirme/Devretme Davranisi:**
- Kendi icinde delegasyon yapmaz (call_omo_agent denied)
- Ancak task() uzerinden kategori routing yapabilir
- Alt-agent kullanimi sadece kesif/arastirma icin
- Karmasik bir iste Sisyphus veya Hecateq tarafindan cagrilir

**Guclu Yonler:**
- GPT-spesifik prompt optimizasyonu: her GPT surumu icin ozel prompt
- Kod yazma/uygulama odakli: en "is bitirici" ajan
- 32000 token max cikti (buyutulmus)
- Kesif-oncesi-uygulama paradigmasi: kod yazmadan once anlama garantisi

**Zayif Yonler:**
- Sadece GPT modelleri ile calisir -> saglayici bagimliligi
- Kendi alt-agent uretimi yok (call_omo_agent denied) -> esneklik kaybi
- Test kapsami: sadece `agent.test.ts` ve `id-contract.test.ts` var, prompt testleri yetersiz
- GPT-5.5 disindaki prompt varyantlari guncellik kontrolu gerektirir
- "Otonom" olmasi planlama/yonlendirme eksikligi anlamina gelir

**Yeniden Adlandirma/Tasarim Etkileri:**
- "Hephaestus" ismi zanaatkarlik icin uygun, korunabilir
- `call_omo_agent` yasaginin gerekcesi sorgulanmali: bazi durumlarda faydali olabilir
- GPT disi model destegi eklenmeli veya bu karar dokumante edilmeli
- Sisyphus ve Hecateq God ile baglantisi netlestirilmeli: Hephaestus sadece "uygulayici", asla planlayici/orkestrator degil
- Takim modu (team-mode) icin `conditional` statü -> `eligible` yapilmasi icin `teammate: "allow"` izni eklenmeli

---

### 3.3 Oracle

**Amac:** Salt-okunur danisman (read-only consultant). Yuksek-IQ akil yurutme, karmasik hata ayiklama, mimari inceleme.

**Mitolojik Adlandirma:** Antik Yunan'da bilgelik ve kahinlik. Gelecegi goren, dogru kararlar veren danismani temsil eder.

**Mod:** `subagent` — UI modelini dikkate almaz, kendi dusme zincirini kullanir.

**Model/Prompt Yonlendirmesi:**
- Varsayilan model: `gpt-5.5 high`
- Dusme zinciri: gemini-3.1-pro high -> claude-opus-4-7 max -> glm-5.1
- Temperature: 0.1
- 4 prompt varyanti: default (Claude), GPT-5.5, GPT-5.4, GPT-5.2

**Izin/Arac Sinirlari:**
- Denied: `write`, `edit`, `apply_patch`, `task`
- `call_omo_agent` de denied (tool-restrictions.ts'de)
- Sadece okuyabilir, asla yazamaz/delege edemez

**Calisma Zamani Rolu:**
- Cagri uzerine calisir: Primary agent (Sisyphus) cagirdiginda aktive olur
- Her danisma bagimsizdir, ancak session devaminda follow-up destegi vardir
- Cikti: Tavsiye, aksiyon plani, efor tahmini
- 3 katmanli yanit: Essential (her zaman) -> Expanded (gerektiginde) -> Edge cases (nadiren)

**El Degistirme/Devretme Davranisi:**
- Asla delege etmez: read-onlydir, sadece tavsiye verir
- Sadece Sisyphus/hephaestus/ana ajan tarafindan cagrilabilir

**Guclu Yonler:**
- En detayli prompt varyantina sahip ajan (591 satir): 4 farkli model varyanti
- Cok iyi yapilandirilmis karar cercevesi: pragmatic minimalism
- Output verbosity spec: net ve uygulanabilir cikti
- `high_risk_self_check` bolumu guvenlik/kalite icin
- Heatmap: "Interpreting this as X..." gibi hedge mekanizmasi

**Zayif Yonler:**
- Test kapsami YOK (`src/agents/oracle.ts` icin test dosyasi bulunamadi)
- Task ve call_omo_agent denied olmasi nedeniyle cagri yapamaz, sadece mevcut context ile calisir
- Uzun context yonetimi icin "mentally outline" talimati -> olculebilir degil
- 4 prompt varyantinin bakimi zor (Guncel mi hepsi?)
- Her model varyantinin etkinligi konusunda karsilastirmali test yok

**Yeniden Adlandirma/Tasarim Etkileri:**
- "Oracle" ismi danismanlik icin uygun, korunabilir
- Okunabilirlik: promptlardaki tekrar eden bolumler ortak bir base'e cekilebilir
- Test eklenmeli (en azindan prompt yapisal invariant testleri)
- Task/call_omo_agent denied karari sorgulanmali: explore/librarian'a erisim faydali olabilir

---

### 3.4 Metis

**Amac:** Plan-oncesi danisman (pre-planning consultant). Istekleri analiz eder, niyet siniflandirmasi yapar, AI hata noktalarini tespit eder.

**Mitolojik Adlandirma:** Yunan mitolojisinde bilgelik, sagduyu ve derin danisma tanricasi. Zeus'un ilk karisi. "Metis analyzes user requests BEFORE planning to prevent AI failures."

**Mod:** `subagent` — UI modelini kullanmaz.

**Model/Prompt Yonlendirmesi:**
- Varsayilan model: `claude-sonnet-4-6`
- Dusme zinciri: claude-opus-4-7 max -> gpt-5.5 high -> glm-5.1 -> k2p5
- Temperature: 0.3 (diger agentlardan yuksek)
- `thinking: { type: "enabled", budgetTokens: 32000 }`
- Tek prompt: `METIS_SYSTEM_PROMPT` (GPT-spesifik varyant YOK)

**Izin/Arac Sinirlari:**
- Denied: `write`, `edit`, `apply_patch`
- Task ve call_omo_agent'e erisimi var (tool-restrictions.ts'de sadece write/edit denied)
- Ancak pratikte explore/librarian cagrisi yapabilir

**Calisma Zamani Rolu:**
- Prometheus'tan once calisir: "consult Metis before Prometheus"
- Niyet siniflandirmasi yapar: Refactoring / Build / Mid-sized / Collaborative / Architecture / Research
- Her niyet icin ozel analiz ve Prometheus direktifleri olusturur
- Output: Intent Classification + Pre-Analysis + Questions + Risks + Directives for Prometheus

**El Degistirme/Devretme Davranisi:**
- Kendisi delege etmez, Prometheus icin direktifler uretir
- Explore/librarian agentlarini onerir (kendisi cagiramaz veya cagirmasi beklenmez belirsiz)

**Guclu Yonler:**
- Cok iyi yapilandirilmis 6 intent tipi ve her biri icin detayli talimat
- AI-over-engineering onleme: scope inflation, premature abstraction, over-validation detection
- QA/ZERO USER INTERVENTION PRINCIPLE: tum kabul kriterleri agent-tarafindan calistirilabilir olmali
- Temperature: 0.3 -> daha yaratici, kalip disi dusunme

**Zayif Yonler:**
- Test kapsami YOK (oracle/metis testi bulunamadi)
- Sadece tek prompt varyanti: GPT-5.2/5.5 icin optimize edilmemis
- Metis'in kendisinin explore/librarian cagirmasi bekleniyor, ama tool-restrictions'ta task/call_omo_agent yasaklanmamis -> kafa karisikligi
- Cikti formati Markdown bloklari icinde -> Prometheus'un bu direktifleri nasil yorumlayacagi net degil
- Gercek kullanim senaryosu testi yok: Metis gercekten AI slop'u onluyor mu?

**Yeniden Adlandirma/Tasarim Etkileri:**
- "Metis" ismi plan-oncesi analiz icin uygun, korunabilir
- Task erisimi netlestirilmeli: Metis explore/librarian cagiracak mi, yoksa sadece Prometheus'a direktif mi verecek?
- Temperature 0.3 karari sorgulanmali: plan-oncesi analizde daha deterministik olmak faydali olabilir
- Prometheus ile birlesme ihtimali: Metis + Prometheus = "Strategic Planner" adinda tek ajan
- Test eklenmeli

---

### 3.5 Momus

**Amac:** Plan denetleyicisi (plan reviewer). `.omo/plans/*.md` dosyalarini calistirilabilirlik ve referans dogrulugu acisindan inceler.

**Mitolojik Adlandirma:** Yunan mitolojisinde alay ve elestiri tanrisi, her seyde kusur bulan. "He criticized Aphrodite (found her sandals squeaky), Hephaestus (said man should have windows in his chest to see thoughts), and Athena (her house should be on wheels to move from bad neighbors)." Momus'un promptunda bu hikaye detayli anlatilir.

**Mod:** `subagent` — UI modelini kullanmaz.

**Model/Prompt Yonlendirmesi:**
- Varsayilan model: `gpt-5.5 xhigh`
- Dusme zinciri: claude-opus-4-7 max -> gemini-3.1-pro high -> glm-5.1
- Temperature: 0.1
- 3 prompt varyanti: default (Claude), GPT-5.5 (`MOMUS_GPT_PROMPT`), GPT-5.2 (`MOMUS_GPT_5_2_PROMPT`)

**Izin/Arac Sinirlari:**
- Denied: `write`, `edit`, `apply_patch`
- Task/call_omo_agent erisimi YOK (tool-restrictions.ts)

**Calisma Zamani Rolu:**
- Prometheus plan olusturduktan sonra cagrilir
- Tek giris noktasi: `.omo/plans/*.md` dosya yolu
- 4 kontrol yapar: Reference Verification, Executability, Critical Blockers, QA Scenario Executability
- Output: `[OKAY]` veya `[REJECT]` + maksimum 3 bloker sorun
- `APPROVAL BIAS`: Suphede kalirsa ONAYLA. "%80 netlik yeterli."

**El Degistirme/Devretme Davranisi:**
- Sadece plan okur ve degerlendirir, hicbir aksiyon almaz
- Tek cikisi verdict + blocking issues

**Guclu Yonler:**
- Cok acik ve net karar mekanizmasi: "blocker-finder, not a perfectionist"
- Max 3 issue kurali: overload'i onler
- GPT-5.5 ve 5.2 icin optimize edilmis varyantlar
- Anti-patterns bolumu cok net: neyin bloker olmadigini tam olarak belirtir
- `tool_usage_rules`: paralel okuma, `rg` onceligi

**Zayif Yonler:**
- `src/agents/momus.test.ts` var ancak icerik okunamadi -> prompt testi olabilir
- Sadece `.omo/plans/*.md` ile sinirli -> YAML, JSON plan formatlari reddedilir
- QA scenario kontrolu var ama "specific tool, concrete steps, expected results" kriteri subjektif
- `call_omo_agent` yasagi -> dosya okumak icin explore kullanamaz
- Task/call_omo_agent yasagi nedeniyle reference verification icin sadece read/grep kullanabilir

**Yeniden Adlandirma/Tasarim Etkileri:**
- "Momus" ismi elestirmen icin uygun, korunabilir
- YAML/JSON plan destegi eklenebilir
- explore agent erisimi reference verification'u hizlandirabilir
- QA scenario degerlendirme kriterleri daha formal hale getirilebilir (ornegin: regex ile eslesme)
- Cerceve: Momus'un approval bias'i bazen tehlikeli olabilir -> "80% netlik" subjektif

---

### 3.6 Atlas

**Amac:** Todo-list orkestratoru. Bir todo listesindeki TUM gorevleri tamamlanana kadar `task()` ile yurutur.

**Mitolojik Adlandirma:** Yunan mitolojisinde gokkubbe (gokyuzu)ni omuzlarinda tasiyan Titan. Proje baglaminda: tum gorevleri tek basina omuzlayan ajan. "Master Orchestrator agent from OhMyOpenCode that coordinates specialized agents to complete todo lists."

**Mod:** `primary` — UI modeline saygi duyar.

**Model/Prompt Yonlendirmesi:**
- Varsayilan model: `claude-sonnet-4-6`
- Dusme zinciri: kimi-k2.6 -> gpt-5.5 medium -> minimax-m2.7
- Temperature: 0.1
- 5 prompt varyanti: default (Claude 4.6), gpt, gemini, kimi, opus-4-7
- 17 dosyadan olusan en buyuk agent paketi
- Dinamik prompt: `buildDynamicOrchestratorPrompt()` -> category, agent, skills, decision matrix bloklari

**Izin/Arac Sinirlari:**
- Denied: `task`, `call_omo_agent` (tool-restrictions.ts'de sadece `task` denied, `call_omo_agent` da eklenmis)
- Kendisi delege edemez -> kategoriler uzerinden routing yapar
- `src/agents/atlas/AGENTS.md`: "Atlas delegates; it does not run subagents directly"

**Calisma Zamani Rolu:**
- Bir todo listesi alir -> checkbox'lari tek tek tamamlar
- Otomatik devam: asla kullanici onayi beklemez
- Paralel fan-out varsayilandir: sadece blocking dependency varsa sequential
- Post-delegation: checkbox'i isaretle, plani oku, sonraki goreve gec
- `src/hooks/continuation/atlas/` hook ile baglanti: compaction sonrasi devam

**El Degistirme/Devretme Davranisi:**
- Kendi kendine calisir: verilen plani yurutur
- Task denied oldugu icin kendisi alt-agent cagiramaz, kategori routing kullanir
- Sisyphus veya Hecateq tarafindan baslatilir

**Guclu Yonler:**
- En genis prompt varyantina sahip: 5 farkli model
- Dynamik prompt: kategoriler/ajanlar/skills otomatik eklenir
- Karar matrisi (decision matrix): hangi ajanin hangi gorev icin uygun oldugunu belirler
- Checkbox enforcement: her gorev tamamlandiginda isaretlenir
- Auto-continue: kullanici mudahalesi gerektirmez

**Zayif Yonler:**
- `task` denied olmasi kisitlayici -> kategori routing'e bagimli
- `call_omo_agent` denied -> explore/librarian kullanamaz
- 17 dosya -> bakim maliyeti yuksek
- GPT-5.5 varyanti optimize edilmis mi degil mi belirsiz
- Gercek dunya senaryolari icin test kapsami yetersiz (sadece prompt/routing testleri var)

**Yeniden Adlandirma/Tasarim Etkileri:**
- "Atlas" ismi gorev tasiyicisi icin uygun, korunabilir
- task/call_omo_agent denied karari yeniden degerlendirilmeli: explore erisimi faydali olabilir
- 17 dosyanin birlestirilmesi veya moduler yapinin korunmasi kararlastirilmali
- Sisyphus ve Hecateq God ile catisma: Atlas "execution-only orkestrator" mu?
- Belki Atlas -> "TaskRunner" veya "WorkExecutor" olarak yeniden adlandirilabilir

---

### 3.7 Prometheus

**Amac:** Stratejik planlamaci (strategic planner). Mulakat modunda calisir, kod tabanini okur, kullaniciyi sorgular, detayli is plani olusturur.

**Mitolojik Adlandirma:** Yunan mitolojisinde atesi tanrilardan calip insanliga veren Titan. Ileri gorus ve yapici planlamayi temsil eder. Projede: "Named after the Titan who brought fire to humanity, you bring foresight and structure to complex work through thoughtful consultation."

**Mod:** `primary` — UI modelini kullanir, ancak buildPrometheusAgentConfig ile ozel cozulur.

**Model/Prompt Yonlendirmesi:**
- Varsayilan model: `claude-opus-4-7 max`
- Dusme zinciri: gpt-5.5 high -> glm-5.1 -> gemini-3.1-pro
- Temperature: override-only (varsayilan yok)
- `system-prompt.ts` -> 7 modular parcadan birlesir: identity-constraints, interview-mode, plan-generation, spec-driven-mode, high-accuracy-mode, plan-template, behavioral-summary
- 3 prompt varyanti: default (Claude), gpt, gemini

**Izin/Arac Sinirlari:**
- Permission: `edit: "allow"`, `bash: "allow"`, `webfetch: "allow"`, `question: "allow"`
- Ancak `.md`-only yazma: `prometheus-md-only` hook ile uygulanir
- FORBIDDEN paths: `src/`, `package.json`, config files
- Tool-restrictions.ts'de OZEL OLARAK LISTELENMEMIS (Prometheus icin tool restriction yok)

**Calisma Zamani Rolu:**
- `prometheus-agent-config-builder.ts` ile Phase 3'te dogrudan yapilandirilir (diger agentlar gibi `agentSources`'tan degil)
- Interview modu ile baslar: kullaniciyi anlama, gereksinim toplama
- Auto-transition: tum sartlar netlesince plan olusturmaya gecer
- Cikti: `.omo/plans/*.md` (YAML task graph ile)
- Surec: Interview -> codebase exploration -> Metis consultation -> plan generation -> Momus review -> /start-work

**El Degistirme/Devretme Davranisi:**
- Plan olusturur, uygulamaz. "YOU ARE A PLANNER. YOU ARE NOT AN IMPLEMENTER."
- `/start-work` ile Sisyphus'a devreder
- interview-mode'da explore/librarian kullanabilir (onerilir)

**Guclu Yonler:**
- En iyi yapilandirilmis interview akisi: clearance checklist ile otomatik plan gecisi
- Incremental write protocol: output limitini asmak icin skeleton + edit stratejisi
- Draft as working memory: interview sirasinda surekli draft guncelleme
- Maksimum paralellik prensibi: wave'lerde 5-8 task hedefi
- Tek plan zorunlulugu: 50+ TODO olsa bile tek dosya

**Zayif Yonler:**
- Test kapsami: `system-prompt.test.ts` ve `plan-generation.test.ts` var, ama interview-mode ve high-accuracy-mode testleri yok
- `prometheus-agent-config-builder.ts` async olmasi nedeniyle Phase 3'te potansiyel gecikme
- GPT-5.2 varyanti YOK -> yeni GPT modelleri icin prompt guncellemesi gerekli
- `.md`-only kisiti bazi durumlarda gereksiz: plan JSON/YAML da olabilir
- "FORBIDDEN paths: docs/, plan/" gibi kat kurallar -> kullanici konfigurasyonu ile esneklik kazanabilir
- Metis ve Momus ile sik1 bagimlilik -> her plan en az 2 alt-agent gerektirir

**Yeniden Adlandirma/Tasarim Etkileri:**
- "Prometheus" ismi planlama icin uygun, korunabilir
- Metis + Prometheus + Momus -> "Strategic Planning Pipeline" olarak gruplanabilir
- `.md`-only kisiti yumusatilabilir veya JSON plan formati eklenebilir
- `prometheus-agent-config-builder.ts`'in async yapisi senkron Phase 3'te sorun yaratabilir -> cozulmeli
- Prometheus'un "planner" rolu Sisyphus'un "planner + executor" rolu ile catisir -> net ayrismali

---

### 3.8 Hecateq God (hecateq-orchestrator)

**Amac:** Custom-agent-first is akisi orkestratoru. Sisyphus'tan farkli olarak custom agentlari built-in agentlardan once tercih eder, deterministik yonlendirme yapar, proje-kok bellek kullanir.

**Mitolojik Adlandirma:** Hecate, Yunan mitolojisinde kavsaklarin, buyunun ve hayaletlerin tanricasi. "God" eki fork sahibinin ozel konumlandirmasini yansitir. Promptta: "Hecateq God, the user's primary custom-agent-first planner, router, and dispatcher."

**Mod:** `all` — hem primary hem subagent context'te gorunur (tek ajan).

**Model/Prompt Yonlendirmesi:**
- Model: config'den cozulur, varsayilan yok
- Dusme: per-config fallback
- `thinking: { type: "enabled", budgetTokens: 32000 }`
- Prompt profile detection: `prompt-profile.ts` ile model saglayiciya gore profile tespiti (gpt/claude/gemini/qwen/deepseek/small-model/generic)
- Prompt adapters: her profile icin model-ozel adapter promptu
- `prompt-pack.ts` -> policy + custom agent registry + memory + adapter + runtime truth + delegation bias
- **Toplam prompt yapisi (default.ts):** 712 satir HECATEQ_ORCHESTRATOR_POLICY

**Izin/Arac Sinirlari:**
- Permission: `question: "allow"`
- `getFrontierToolSchemaPermission`, `getGptApplyPatchPermission` uygulanir
- `write` ve `edit` araclari calisma zamaninda REDDEDILIR: "All file modifications must go through delegated owner agents"
- `call_omo_agent` calisma zamaninda REDDEDILIR: "Use task(subagent_type='explore', ...) instead"
- Sadece `task(subagent_type="...")` ile delegasyon yapabilir

**Calisma Zamani Rolu:**
- Custom-agent-first yonlendirme: custom agentlar built-in'lerden once
- 7 boyutlu siniflandirma: task size, domain scope, context requirement, git checkpoint, dependency, agent routing, risk level
- 6 karar modu: delegate_exact_agent -> delegate_category -> delegate_multi_agent -> analyze_only -> direct_small_fix -> blocked
- DEPENDENCY-AWARE DELEGATION: Schema-to-Review, Scan-to-Fix, Policy-to-Docs, Contract-first multi-domain, Investigation-to-Recommendation pipeline'lari
- OUTPUT DISCIPLINE: compact format, routing decisions + delegation results
- GIT CHECKPOINT POLICY: her degisiklikten once git state kontrolu

**El Degistirme/Devretme Davranisi:**
- Ana primitive: `task(subagent_type="<exact-agent-name>", ...)`
- Kategori routing sadece fallback
- Bilinmeyen agent -> STATUS: BLOCKED (sessiz dusme YASAK)
- Tiny safe bridging fix gate: 5 kosulun tamami saglanmali
- Background/foreground delegation politikalari

**Guclu Yonler:**
- Custom-agent-first: AGENTS.md tabanli yonlendirme
- Model adapters: 7 farkli model profili icin ozel prompt
- Cok detayli politika dokumani (712 satir)
- Bagimlilik-farkindalik (dependency graph + shared contract)
- Bellek sistemi: `.opencode/state/memory/` ile proje-kok bellek
- `maySelfImplement()`: kod seviyesinde tiny-fix gate (TINY SAFE BRIDGING FIX GATE)
- Test kapsami nispeten iyi: prompt-pack.test.ts (318), prompt-profile.test.ts (385), default.test.ts (162), agent testi

**Zayif Yonler:**
- **Asiri buyuk prompt:** 712 satir politika -> token maliyeti cok yuksek
- **Rol catismasi:** Sisyphus ile neredeyse ayni isi yapar (orkestrasyon)
- **Write/edit denied:** Orkestratorun hicbir durumda yazamayacak olmasi bazi senaryolarda gereksiz kisitlama
- **Exact-agent runtime validation:** Custom agent registry onerici, runtime truth degil -> STATUS: BLOCKED'a sik dusme riski
- **Dependency graph artifact:** Task graph olusturma ve guncelleme talimati var ama kod seviyesinde uygulama test edilmemis
- **Model adapter bakimi:** 7 adapter + her biri icin prompt guncellemesi -> bakim yuku
- **Sisyphus handoff**: Sisyphus'tan Hecateq'e handoff mekanizmasi prompt seviyesinde, kod seviyesinde degil
- **Context injection dependency:** Hecateq God'un etkin calismasi icin context injection hook'unun duzgun calismasi gerekir

**Yeniden Adlandirma/Tasarim Etkileri:**
- "Hecateq God" ismi fork'a ozgu. "Orchestrator" veya "Hecateq" daha profesyonel.
- Sisyphus ile birlesme ihtimali: ikisi de orkestrator. Fark: Hecateq custom-agent-first, Sisyphus built-in-first
- Politika promptu modullere bolunmeli: `default.ts`'deki 712 satir -> 5-6 ayri dosya
- Write/edit denied karari yeniden degerlendirilmeli: tiny-fix gate kod seviyesinde calisiyor ama prompt da tekrar ediyor
- Dependency graph olusturma/yurute mekanizmasi kod seviyesine tasinmali
- Orkestrator roller netlesmeli: Sisyphus -> User-facing orchestrator, Hecateq -> System orchestrator

---

## 4. Hecateq God Eksiklik ve Iyilestirme Birikimi

### 4.1 Yonlendirme Sorunlari (Routing Issues)

| Sorun | Detay | Onemi |
|-------|-------|-------|
| Custom-agent-first vs builtin-agent-first | Hecateq God custom agentlari onceler; Sisyphus built-in'lari onceler. Ayni kullanimda hangisinin calisacagi net degil. | Yuksek |
| Agent index runtime validation | Custom agent registry onerici, runtime truth degil. `isDelegationFirst() === true` iken her STATUS: BLOCKED kullanici deneyimini bozar. | Yuksek |
| Category routing fallback | Politika "category routing is not custom-agent discovery" der, ancak uygulamada kategori routing tek alternatif | Orta |
| Karma routing | Bazi durumlarda Sisyphus -> Hecateq -> Sisyphus dongusu olusabilir | Orta |

### 4.2 Politika Celiskileri (Policy Contradictions)

| Celiski | Kaynak |
|---------|--------|
| "Delegation is the default" vs "Self-implementation is allowed" | `default.ts` satir 16 vs satir 25 (softened policy) |
| "Do not use tiny safe bridging fixes for feature implementation" vs Tiny-fix gate in code | Prompt satir 55 vs `src/shared/hecateq-orchestrator-policy.ts:68-77` |
| "Hecateq God is orchestrator-only" vs mode "all" | `agent.ts` satir 17 `MODE: "all"` -> hem primary hem subagent contextte gorunur |
| Write/edit denied in prompt vs tool permission config | Prompt "write and edit tools are denied" der, ancak permission objesinde bu kisit kod seviyesinde yok -> `tool-config-handler.ts`'de uygulaniyor olabilir |

### 4.3 Gercek Ajan Calisma Zamani Dogrulama Sinirlamalari

- Custom agent registry'nin runtime'da dogrulanmasi mekanizmasi YOK: `BUILTIN_AGENT_KEYS` seti sadece built-in agent isimlerini icerir (`agent.ts` satir 22-24)
- Custom agent'lar registry'de var ama disabled mi, calisiyor mu, hangi modelle calisiyor -> bilgi yok
- Hecateq God'un kendi durumunu dogrulamasi: `Dependency-gated delegation rules are non-negotiable` -> nasil uygulaniyor? Kod yok.
- `isDelegationFirst()`, `shouldDenyWriteTools()`, `maySelfImplement()` fonksiyonlari test edilmis mi? `src/shared/hecateq-orchestrator-policy.ts` icin test bulunamadi.

### 4.4 Bagimlilik Grafi / Gorev Grafigi Artifact Eksigi

- Politika detayli task graph formati tanimlar (`default.ts` satir 161-213) ama:
  - Task graph olusturma kodu YOK (sadece prompt talimati)
  - Task graph guncelleme mekanizmasi YOK
  - Task graph'dan stage okuma/calistirma kodu YOK
  - Block_on_cycle, block_on_sensitive gibi guvenlik onlemleri prompt seviyesinde, kod seviyesinde DEGIL
- Shared contract artifact: `.opencode/contracts/` dizini tanimli ama olusturma/dogrulama kodu YOK

### 4.5 Bellek/Artifact Isleme

- Bellek dosyalarini (`active-context.md`, `progress.md`, vs.) okuma talimati prompt'ta var ama kod seviyesinde otomatik okuma YOK
- MEMORY_UPDATE block mekanizmasi prompt seviyesinde tanimli ama kod seviyesinde ayristirma/dogrulama/kaydetme YOK
- Subagent'lerin memory dosyalarina dogrudan yazmasi yasak, ama MEMORY_UPDATE block'unu isleyecek bir mekanizma gorunmuyor

### 4.6 Write-Tool Reddi Etkileri

- Hecateq God write/edit kullanamaz: bu bir guvenlik onlemi ama bazi durumlarda:
  - Tiny safe bridging fix gerektiginde baska agent cagirmak zorunda -> ekstra tur
  - Kendi task graph'ini guncelleyemez -> baska agent yazmali
  - Kendi memory dosyasini guncelleyemez -> baska agent (context-manager) yazmali
- Bu kisit pratikte asiri katidir ve Hecateq'in hizli duzeltmeler yapmasini engeller

### 4.7 Cikti UX

- Compact output format: STATUS + DECISION + NEXT (SMALL) veya INTAKE SUMMARY + SELECTED AGENT (MEDIUM) vs.
- Bu format prompt'ta tanimli ama modelin buna uyup uymadigi test edilmemis
- Kullaniciya STATUS: BLOCKED mesaji gosterildiginde ne yapacagi net degil
- Routing Coverage tablosu: task + owner_agent + execution_call + dependency + status -> prompt'ta var ama zorunlu degil

### 4.8 Test Kapsami Eksikleri

| Eksik Test | Dosya |
|------------|-------|
| `hecateq-orchestrator-policy.ts` | `maySelfImplement()`, `isDelegationFirst()`, `shouldDenyWriteTools()` testleri YOK |
| `hecateq-orchestrator-agent.ts` | `maybeCreateHecateqOrchestratorConfig` testi var mi? `builtin-agents/hecateq-orchestrator-agent.test.ts` kontrol edilmeli |
| Tool denial test | Write/edit/call_omo_agent reddinin runtime'da uygulanmasi test edilmemis |
| Agent index integration | Custom agent registry'nin dogru olusturulmasi ve kullanilmasi test edilmemis |
| Memory bootstrap | Bellek olusturma/doldurma testi bulunamadi |
| Profile detection | `prompt-profile.test.ts` var (385 satir, iyi) |
| Prompt pack assembly | `prompt-pack.test.ts` var (318 satir, iyi) |

### 4.9 Sisyphus/Atlas/Prometheus ile Ortulu/Catisma

| Ajan | Ortusme/Catisma | Cozum |
|------|-----------------|-------|
| **Sisyphus** | Ikisi de orkestrator. Sisyphus built-in-first, Hecateq custom-agent-first. Ayni kullanici oturumunda ikisi de calisabilir -> karisiklik | Roller net ayrismali: Sisyphus -> user assistant, Hecateq -> system orchestrator |
| **Atlas** | Her ikisi de task() ile delegasyon yapar. Atlas "execute this plan" icin, Hecateq "plan+execute" icin | Atlas -> pure executor: task runner. Hecateq -> planner + executor |
| **Prometheus** | Hecateq de plan yapabilir (intake + decomposition + agent selection). Prometheus interview modunda plan yapar. | Prometheus -> strategic planning (buyuk resim). Hecateq -> tactical planning (gorev siralamasi) |

---

## 5. Karsilastirma Matrisi

| Ozelik | Prometheus | Metis | Momus | Oracle | Sisyphus | Atlas | Hephaestus | Hecateq God |
|--------|-----------|-------|-------|--------|----------|-------|------------|-------------|
| **Mod** | primary | subagent | subagent | subagent | primary | primary | primary | all |
| **Varsayilan Model** | claude-opus-4-7 max | claude-sonnet-4-6 | gpt-5.5 xhigh | gpt-5.5 high | claude-opus-4-7 max | claude-sonnet-4-6 | gpt-5.5 medium | config'den |
| **Temperature** | override-only | 0.3 | 0.1 | 0.1 | (default) | 0.1 | (default) | (default) |
| **Prompt Varyantlari** | 3 | 1 | 3 | 4 | 5 | 5 | 4 | 7+ adapter |
| **Prompt Buyuklugu** | ~500 satir | 335 satir | 449 satir | 591 satir | 697 satir | ~200 satir (genis dynamic) | ~200 satir | 712 satir (policy) |
| **Write/Edit** | .md-only | DENIED | DENIED | DENIED | Izinli | Izinli | Izinli | DENIED |
| **Task** | Izinli | Izinli | DENIED | DENIED | Izinli | DENIED | Izinli | Izinli |
| **call_omo_agent** | Izinli | Izinli | DENIED | DENIED | Izinli | DENIED | DENIED | DENIED |
| **Rol** | Planlama | On-analiz | Plan denetim | Danisman | Orkestrator | Gorev yurutucu | Uygulayici | Sistem orkestrator |
| **Takim Modu** | hard-reject | hard-reject | hard-reject | hard-reject | eligible | eligible | conditional | (kontrol edilmedi) |
| **Bellek Kullanimi** | Draft (.omo/drafts) | Output only | Output only | Output only | Todo list | Plan okuma | Output only | .opencode/state/memory/ |
| **Model Bagimliligi** | Yok (3 varyant) | Tek prompt | GPT optimize | 4 varyant | 5 varyant | 5 varyant | GPT-only | 7 adapter |
| **Test Kapsami** | Dusuk-Orta | YOK | Dusuk | YOK | Orta | Orta | Dusuk-Orta | Orta-Yuksek |

---

## 6. Oneriler

### 6.1 Hemen Yapilmasi Gerekenler (Aciliyet: Yuksek)

1. **Hecateq God prompt bolumu:** 712 satirlik `HECATEQ_ORCHESTRATOR_POLICY` modullere ayrilmali. Her politika bolumu ayri bir dosyada (routing-policy.ts, memory-policy.ts, git-policy.ts, delegation-policy.ts, vs.)

2. **Orkestrator rollerinin net ayrismasi:**
   - Sisyphus: "User Frontend Orchestrator" (kullaniciyla etkilesim, intent classification, hizli gorevler)
   - Hecateq God: "System Orchestrator" (arkaplan, multi-domain, dependency-aware, custom-agent-first)
   - Atlas: "Task Runner" (verilen plani calistir)

3. **Test ekleme:**
   - `src/shared/hecateq-orchestrator-policy.ts` icin: `isDelegationFirst()`, `shouldDenyWriteTools()`, `maySelfImplement()` testleri
   - `src/agents/oracle.ts` ve `src/agents/metis.ts` icin yapisal prompt invariant testleri
   - Hecateq God tool denial integration testi

4. **Write/edit denied politika kod seviyesinde uygulanmasi:** `tool-config-handler.ts`'de Hecateq God icin write/edit/task/call_omo_agent kistinin acikca test edilmesi

### 6.2 Kisa Vadede Yapilmasi Gerekenler (Aciliyet: Orta)

5. **Agent isimlendirme gozden gecirilmeli:**
   - "Hecateq God" -> "Hecateq Orchestrator" veya "Hecateq"
   - "Sisyphus" -> "Primary Orchestrator" veya "Sisyphus" korunabilir (marka degeri)
   - "Atlas" -> "Task Runner" (rolu tam yansitmiyor)
   - "Hephaestus" korunabilir (marka degeri yuksek)
   - "Prometheus" korunabilir (planlama ile ozdeslesmis)

6. **Sisyphus-Hecateq handoff koddan prompta degil, koda tasinmali:**
   - Su an `SISYPHUS_HECATEQ_HANDOFF_POLICY` prompta gomulu
   - Bunun yerine, bir hook veya tool ile otomatik handoff karari verilebilir

7. **Prometheus ayristirmasi:**
   - `prometheus-agent-config-builder.ts` async yapisi Phase 3'te sorun cikarabilir -> dokumante edilmeli veya refactor edilmeli
   - Prometheus'un ozel statusu (ayri builder, ayri tescil) belgelenmeli

8. **Call_omo_agent ve task erisimi tutarliligi:**
   - Metis: write/edit denied ama task/call_omo_agent izinli -> explore kullanabiliyor
   - Momus: write/edit denied + task/call_omo_agent denied -> explore KULLANAMIYOR
   - Bu tutarsizlik giderilmeli: Momus da explore kullanabilmeli

### 6.3 Uzun Vadede Yapilmasi Gerekenler (Aciliyet: Dusuk)

9. **Dependency graph kod seviyesine tasinmali:**
   - Su an sadece prompt talimati var
   - `src/shared/dependency-graph/` altinda tipler var (validateTaskGraph, vs.)
   - Bu tipler Hecateq God promptu ile entegre edilmeli

10. **Memory guncelleme mekanizmasi:**
    - MEMORY_UPDATE block'larini ayristiran, dogrulayan ve kaydeden bir hook
    - Subagent'lerin dogrudan memory dosyalarina yazmasini engelleyen kod seviyesinde mekanizma

11. **Model agnostik prompt altyapisi:**
    - Su an her ajanin GPT/Claude/Gemini varyantlari ayri dosyalarda
    - Ortak prompt parcaciklari (decision_framework, output_verbosity_spec, vs.) bir base'e cekilebilir

12. **Hecateq God ve Sisyphus birlestirme senaryosu:**
    - Uzun vadede iki orkestrator yerine tek bir "Orchestrator" ajan
    - Custom-agent-first ve builtin-agent-first modlari arasinda runtime gecisi
    - Bu karar projenin gelecekteki yonune bagli

### 6.4 Sabit Tutulmasi Gerekenler

- **Prometheus interview akisi:** Mevcut yapi (phase 1 interview -> phase 2 plan) cok iyi calisiyor
- **Oracle output yapisi:** 3-tier response (Essential/Expanded/Edge cases) endustri standardi
- **Sisyphus background paralelizasyon:** `run_in_background=true` patterni cok degerli
- **Hecateq God model adapters:** 7 farkli model profili icin ozel prompt
- **Momus approval bias:** "Approve by default" felsefesi dogru

### 6.5 Bolunmesi Gerekenler

- **Hecateq God politika promptu:** 712 satir -> 5-6 modul (core-policy, delegation-policy, memory-policy, git-policy, task-graph-policy, contract-policy)
- **Sisyphus promptu:** 697 satir -> intent classification ayri modul, orchestration ayri modul
- **Atlas 17 dosya:** 5 prompt varyanti icin bu kadar dosya fazla -> ortak prompt base'ine cekilebilir
- **Oracle 4 prompt:** ortak bolumler (decision_framework, scope_discipline, tool_usage_rules) base'e cekilebilir

---

## 7. Incelenen Dosyalar

Asagidaki dosyalar dogrudan okunmus ve analiz edilmistir. Tum yollar repo kokune gorecelidir.

### Ajan Kaynaklari
- `src/agents/AGENTS.md` (128 satir) - Ajan katalogu ve mimari genel gorunum
- `src/agents/builtin-agents/AGENTS.md` (33 satir) - Kosullu fabrika katmani
- `src/agents/sisyphus.ts` (697 satir) - Sisyphus agent tanimi ve Hecateq handoff politikasi
- `src/agents/sisyphus-hecateq-handoff.test.ts` (95 satir) - Handoff testi
- `src/agents/hephaestus/agent.ts` (176 satir) - Hephaestus agent fabrikasi
- `src/agents/hephaestus/AGENTS.md` - Hephaestus dokumantasyonu
- `src/agents/oracle.ts` (591 satir) - Oracle agent tanimi, 4 prompt varyanti
- `src/agents/metis.ts` (335 satir) - Metis pre-planning agent
- `src/agents/momus.ts` (449 satir) - Momus plan reviewer, 3 prompt varyanti
- `src/agents/atlas/agent.ts` (153 satir) - Atlas todo-list orkestratoru
- `src/agents/atlas/AGENTS.md` - Atlas dokumantasyonu
- `src/agents/prometheus/system-prompt.ts` (87 satir) - Prometheus prompt birlestirici
- `src/agents/prometheus/identity-constraints.ts` (336 satir) - Prometheus kimlik ve kisitlar
- `src/agents/prometheus/AGENTS.md` - Prometheus dokumantasyonu
- `src/agents/hecateq-orchestrator/agent.ts` (159 satir) - Hecateq God fabrikasi
- `src/agents/hecateq-orchestrator/default.ts` (712 satir) - HECATEQ_ORCHESTRATOR_POLICY
- `src/agents/hecateq-orchestrator/prompt-pack.ts` (115 satir) - Prompt paketleme
- `src/agents/hecateq-orchestrator/prompt-adapters.ts` (105 satir) - Model adapterlari
- `src/agents/hecateq-orchestrator/prompt-profile.ts` (131 satir) - Profil tespiti
- `src/agents/hecateq-orchestrator/index.ts` (3 satir) - Barrel export
- `src/agents/builtin-agents/hecateq-orchestrator-agent.ts` (90 satir) - Kosullu fabrika
- `src/shared/hecateq-orchestrator-policy.ts` (78 satir) - Kod seviyesinde politika yardimcilari
- `src/shared/agent-tool-restrictions.ts` (81 satir) - Arac kisitlama tanimlari
- `src/plugin-handlers/prometheus-agent-config-builder.ts` (127 satir) - Prometheus yapilandirma

### Test Dosyalari
- `src/agents/hecateq-orchestrator/prompt-pack.test.ts` (318 satir)
- `src/agents/hecateq-orchestrator/prompt-profile.test.ts` (385 satir)
- `src/agents/hecateq-orchestrator/default.test.ts` (162 satir)

### Diger
- README.md (proje seviyesi)
- `src/AGENTS.md` (src dizini ana dokumantasyonu)
- `src/agents/sisyphus/` (model varyantlari klasoru)
- `src/agents/hephaestus/` (model varyantlari klasoru)
- `src/agents/atlas/` (model varyantlari ve prompt builder klasoru)
- `src/agents/prometheus/` (moduler prompt parcaciklari klasoru)
- `src/plugin-handlers/AGENTS.md` (6-phase config pipeline dokumantasyonu)
- `src/shared/AGENTS.md` (shared utilities dokumantasyonu)

---

## Ek: Kullaniciya Not

Bu rapor `forked-project.md/` dizini altina `agent-analysis-report.md` olarak yazilmistir. Dizin adi "forked-project.md" olarak kullanici talebine uygun bicimde olusturulmustur (Linux dosya sistemi nokta iceren dizin adina izin verir). Eger bu isim sorun cikarirsa, dosya dogrudan `forked-project.md` (bir markdown dosyasi) olarak da kullanilabilir.

---

## Ek A: Arka Plan Ajan Bulgulari ile Netlestirmeler

Bu ek, ilk raporun ardindan yapilan daha derin kaynak incelemelerinden elde edilen bulgulari icerir. Hedef, ilk rapordaki tespitleri dogrulamak, duzeltmek ve eksik kalan noktalari netlestirmektir.

### A.1 Hecateq God (hecateq-orchestrator) Derinlemesine

**A.1.1 Cekirdek Dosya Dizini**

Hecateq God'un calisma zamani su dosyalardan olusur:

| Dosya | Boyut | Rol |
|-------|-------|-----|
| `src/agents/hecateq-orchestrator/agent.ts` | 159 satir | `createHecateqOrchestratorAgent()` fabrikasi |
| `src/agents/hecateq-orchestrator/default.ts` | 712 satir | `HECATEQ_ORCHESTRATOR_POLICY` + `HECATEQ_PROJECT_ROOT_MEMORY_POLICY` |
| `src/agents/hecateq-orchestrator/prompt-pack.ts` | 115 satir | Prompt birlestirme ve kosullu adapter ekleme |
| `src/agents/hecateq-orchestrator/prompt-adapters.ts` | 105 satir | 7 model adapteri (gpt/claude/gemini/qwen/deepseek/small-model/generic) |
| `src/agents/hecateq-orchestrator/prompt-profile.ts` | 131 satir | Model profil tespiti (provider/model adindan) |
| `src/agents/builtin-agents/hecateq-orchestrator-agent.ts` | 90 satir | Kosullu fabrika (disabled/model kontrolu, override uygulama) |
| `src/shared/hecateq-orchestrator-policy.ts` | 78 satir | `maySelfImplement()`, `isDelegationFirst()`, `shouldDenyWriteTools()` |
| `src/shared/hecateq-agent-suitability.ts` | 347 satir | Agent uygunluk skorlama (hard gates + soft signals) |
| `src/shared/hecateq-agent-indexer.ts` | 1681 satir | AGENTS.md tarama ve runtime agent indeksi olusturma |
| `src/plugin-handlers/tool-config-handler.ts` | 156 satir | Arac izinlerini config zamaninda uygulama |

**A.1.2 default.ts ve prompt-pack.ts Cift Kod Sorunu**

`default.ts` icindeki `buildDefaultHecateqOrchestratorPrompt()` (663-712. satirlar) ile `prompt-pack.ts` icindeki `buildHecateqPromptPack()` (85-114. satirlar) ayni amaci guder: policy metnini custom agent registry ve ek notlarla birlestirip nihai promptu olusturmak. Iki fonksiyon da benzer string replacement mantigi ile softened/delegation-first politikasi arasinda gecis yapar.

- `default.ts:673-697`: `delegationFirst === false` oldugunda 4 ayri `.replace()` ile politikadaki 4 cumleyi yumusatir.
- `prompt-pack.ts:16-35`: Ayni 4 cumleyi benzer sekilde degistirir, ayrica `HEVCATEQ_ORCHESTRATOR_POLICY` sabitini kullanir.

Bu cift kod, bakim yukunu artirir: bir politikadaki 4 cumle degistiginde iki ayri yerde guncelleme yapmak gerekir. Yeniden tasarimda bu iki fonksiyon tek bir prompt builder fonksiyonunda birlestirilmelidir.

**A.1.3 write/edit/interactive_bash Denial: Config Zamani vs Calisma Zamani**

Ilk raporda write/edit denial icin `tool-config-handler.ts`'in kontrol edilmesi gerektigi not edilmisti. Yapilan incelemede:

- `src/plugin-handlers/tool-config-handler.ts` (156 satir): `applyToolConfig()` fonksiyonu, her agent icin `permission` nesnesini isler. Hecateq-orchestrator icin write/edit araclari burada config seviyesinde reddedilir. AgentConfig'e gecirilen `permission: { question: "allow" }` nesnesine ek olarak, ek araclar `getFrontierToolSchemaPermission()` ve `getGptApplyPatchPermission()` ile eklenir. Ancak write/edit reddi burada acikca kodlanmamistir; red, prompt seviyesinde ve agent'in kendisine guven esasina dayanir.

- **Somut Risk:** Write/edit/interactive_bash araclarinin Hecateq God icin runtime'da engellendigini dogrulayan bir `tool.execute.before` hooku (ornegin, `no-hecateq-write-guard`) **yoktur**. Denial tamamen LLM'in prompttaki "write and edit tools are denied at runtime for orchestrator agents" talimatina uymasina dayanir. LLM bu talimati atlarsa veya yanlis yorumlarsa, Hecateq God istemedigi dosyalara yazabilir.

Oneri: `src/hooks/` altinda Hecateq-orchestrator icin ozel bir `tool.execute.before` guardi eklenmeli ve write/edit araclari burada runtime'da bloklanmalidir. Bu guard, prometheus-md-only hook'una benzer sekilde calisabilir.

**A.1.4 hecateq-agent-suitability.ts Entegrasyon Eksigi**

`src/shared/hecateq-agent-suitability.ts` (347 satir), `WorkClassification` tipleri ve `AgentSuitabilityInput` ile agent uygunluk skorlamasi yapar. `src/shared/hecateq-agent-suitability.test.ts` (295 satir) ile test edilmistir.

Ancak bu modul:
- `src/agents/hecateq-orchestrator/agent.ts` prompt assembly'sinde **kullanilmaz**.
- `tool-config-handler.ts` veya herhangi bir runtime routing mekanizmasi ile **entegre degildir**.
- Kod seviyesinde test edilmis ama prompt/hook/routing zincirine baglanmamistir.

Sonuc: `hecateq-agent-suitability.ts` su anda "olumlu ama bagimsiz" bir modul durumundadir. Yeniden tasarimda bu skorlama mekanizmasi ya Hecateq God promptuna dinamik bir bolum olarak eklenmeli ya da bir tool/hook uzerinden runtime routing kararlarina dahil edilmelidir.

**A.1.5 hecateq-agent-indexer.ts Entegrasyon Eksigi**

`src/shared/hecateq-agent-indexer.ts` (1681 satir, `src/shared/hecateq-agent-indexer.test.ts` 948 satir) cok kapsamli bir moduldur. AGENTS.md dosyalarini tarar, primary/secondary domain skorlamasi yapar, routing ambiguity hesaplar, agent type siniflandirmasi yapar. 

- `agent.ts:39` icinde `customAgentSummaries` parametresi olarak prompt assembly'ye gecer.
- `agent.ts:58-92` `buildCustomAgentRegistrySection()` fonksiyonu, bu ozetleri alir ve prompta `<custom-agent-registry>` olarak ekler.
- Ancak indeksin zengin yapisi (domain skorlari, confidence, ambiguity, type) prompt assembly'de **kucultulmus**: sadece `name` ve `description` prompta yansir.
- Index'in `primaryDomain`, `secondaryDomains`, `confidence` gibi alanlari prompta gecmez; sadece LLM'in arka plan bilgisine veya kullanici konfigurasyonuna birakilmistir.

Oneri: Index'in zengin metadatasi ya prompta eklenmeli (ornegin, her agent icin `[domain: backend, confidence: 0.85]`) ya da runtime'da dogrudan okunabilecek bir tool/hook uzerinden erisilebilir olmalidir.

### A.2 Core Agent Netlestirmeleri

**A.2.1 Prometheus: En Yuksek Yeniden Adlandirma Riski**

Prometheus, `src/agents/builtin-agents.ts` icindeki `agentSources` kaydindan gecmez. Bunun yerine `src/plugin-handlers/prometheus-agent-config-builder.ts` (127 satir, async) ile dogrudan Phase 3'te olusturulur. Bu ozel durum:

- Test edilebilirligi azaltir (standart fabrika akisi yok).
- Async yapi, Phase 3'un senkron akisinda potansiyel gecikme veya hata olusturabilir.
- Yeniden adlandirma durumunda hem `prometheus-agent-config-builder.ts` hem `system-prompt.ts` hem de `src/config/schema/agent-names.ts`'deki BuiltinAgentName degistirilmelidir.
- `system-prompt.test.ts` (42 satir) sadece `Question` tool referansini test eder; prometheus promptunun tumu icin invariant testi yoktur.
- **Diger tum built-in agentlardan farkli bir tescil mekanizmasi kullanir.** Bu farklilik dokumante edilmemistir.

**A.2.2 Sisyphus Hecateq Handoff Politikasi**

Ilk raporda handoff politikasinin `src/agents/sisyphus.ts` icinde (57-87. satirlar) `SISYPHUS_HECATEQ_HANDOFF_POLICY` sabitinde yasadigi dogrulanmistir. Bu politika `src/agents/sisyphus/` prompt varyant dizininde degil, dogrudan `sisyphus.ts` ana dosyasinda gomuludur.

- `buildDynamicSisyphusPrompt()` (93. satir) cagrildiginda `appendHecateqHandoffPolicy()` ile promptun sonuna eklenir.
- `src/agents/sisyphus-hecateq-handoff.test.ts` (95 satir) bu politikanin varligini test eder, ancak handoff'un gercekten calisip calismadigini test etmez (sadece prompt icerigi).
- Politika hem Turkce hem Ingilizce cumleler icerir, bu da prompt boyutunu artirir.

Oneri: Handoff politikasi `src/agents/sisyphus/handoff-policy.ts` gibi ayri bir dosyaya tasinmali ve sadece Hecateq God etkinken prompta eklenmelidir.

**A.2.3 Atlas: En Temiz Ajan**

Atlas, karsilastirmali olarak en iyi yapilandirilmis ajandir:
- `src/agents/atlas/` altinda 17 dosya ile moduler yapi.
- `atlas-prompt.test.ts`, `prompt-checkbox-enforcement.test.ts`, `prompt-routing.test.ts` ile iyi test kapsami.
- 5 model varyanti (default, gpt, gemini, kimi, opus-4-7) ayri prompt section dosyalari ile yonetilir.
- `prompt-section-builder.ts` ile ortak bolumler (category, agent, skills, decision matrix) merkezilesir.
- `src/hooks/continuation/atlas/` hook ile compaction sonrasi devam mekanizmasi vardir.
- Checkbox enforcement: her gorev tamamlandiginda isaretlenir ve asla kullanici onayi beklenmez.

Atlas, yeniden tasarimda referans alinmasi gereken "ideal ajan yapisi"dir.

**A.2.4 Hephaestus: GPT/Gate Bagimliligi**

Hephaestus'un GPT saglayicilarina bagimli olmasi (openai | github-copilot | venice | opencode | vercel) ve `noHephaestusNonGpt` hooku ile GPT disi modellerde bloklanmasi onemli bir kisittir. Bu karar:
- `src/agents/hephaestus/agent.ts:24-36` icinde `getHephaestusPromptSource()` ile prompt varyanti secilir, sadece GPT modelleri taninir.
- `src/agents/hephaestus/agent.test.ts` ve `src/agents/hephaestus-id-contract.test.ts` testleri mevcuttur ancak GPT disi modellerde ne olacagi test edilmemistir.
- Takim modu (team-mode) icin `conditional` statude olmasi, `teammate: "allow"` izninin varsayilan olarak kapali olmasindandir.
- Bu GPT bagimliligi, gelecekteki model cesitliligi hedefleriyle celisir.

### A.3 Review/Advisor Agent Netlestirmeleri

**A.3.1 Oracle: Test Kapsami Boslugu**

`src/agents/oracle.ts` (591 satir, 4 prompt varyanti) icin **hicbir dogrudan test dosyasi bulunamamistir**. 
- `grep -rn "oracle" src/ --include="*.test.ts"` sonucunda oracle'a ait bir test gorulmemistir.
- 4 prompt varyantinin (default, GPT-5.5, GPT-5.4, GPT-5.2) tumu de test edilmemistir.
- Bu, Hecateq OpenAgent'deki en kritik test acigidir: en karmasik prompt yapisina sahip agent test edilmemistir.

**A.3.2 Metis: Test Kapsami Boslugu + Tek Varyant**

`src/agents/metis.ts` (335 satir) icin de **test dosyasi bulunamamistir**.
- Ayrica sadece **tek prompt varyanti** vardir. GPT-5.5, GPT-5.2, Gemini gibi modeller icin optimize edilmis ayri prompt yoktur.
- Temperature: 0.3 (diger agentlardan yuksek) karari test edilmemistir.
- Metis'in ciktisinin Prometheus tarafindan dogru yorumlandigini dogrulayan bir entegrasyon testi yoktur.

Oneri: Metis icin en azindan yapisal prompt invariant testleri (ornegin, "Intent Classification bolumu her zaman icerir", "QA/ZERO USER INTERVENTION PRINCIPLE promptta vardir") eklenmelidir.

**A.3.3 Momus: Guclu ve Kati Kontrat**

`src/agents/momus.ts` (449 satir, 3 prompt varyanti) test edilmistir (`src/agents/momus.test.ts`). Ancak:
- Kontrat: Sadece `.omo/plans/*.md` dosyalarini kabul eder. YAML planlari reddedilir.
- Bu kati sinir, bazi kullanim senaryolarinda esneklik kaybina yol acabilir (ornegin, CI pipeline'indan gelen JSON plan).
- Approval bias ("%80 netlik yeterli") kaliteli bir denetim icin bazen risklidir, ancak Momus'un promptunda bu felsefe acikca ve tutarli bir sekilde kodlanmistir.
- Tool usage: task/call_omo_agent denied oldugu icin reference verification'da sadece read/grep kullanabilir. Explore erisimi eklenirse verification kalitesi artabilir.

### A.4 Ozet Duzeltmeler ve Yeni Tespitler

| Konu | Ilk Rapordaki Durum | Guncel Durum |
|------|---------------------|--------------|
| Write/edit denial | "tool-config-handler.ts kontrol edilmeli" | Config zamani uygulaniyor, runtime guardi YOK |
| default.ts vs prompt-pack.ts | Ayri fonksiyonlar not edilmemis | Iki fonksiyon ayni string replacement mantigini tekrar ediyor |
| hecateq-agent-suitability.ts | Incelenmemis | 347 satir, testli, ama Hecateq God promptuna entegre DEGIL |
| hecateq-agent-indexer.ts | Incelenmemis | 1681 satir, cok zengin, ama prompta sadece name+description gecer |
| Prometheus tescil | "ozel durum" olarak not edilmis | agentSources'tan gecmez, async builder ile dogrudan Phase 3 |
| Oracle test | "test bulunamadi" | Dogrulandi: hic test yok |
| Metis test | "test bulunamadi" | Dogrulandi: hic test yok, tek prompt varyanti |
| Atlas | "en iyi yapilandirilmis" | Dogrulandi: 17 dosya, 3 test dosyasi, continuation hook |
| Hephaestus test | "agent.test.ts + id-contract.test.ts" | Dogrulandi, ayrica GPT bagimliligi netlesti |
| Momus test | "momusi.test.ts var" | Dogrulandi, kati .omo/plans/*.md kontrati netlesti |
