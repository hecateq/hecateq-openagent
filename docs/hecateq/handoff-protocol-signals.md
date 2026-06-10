# Hecateq OpenAgent Handoff Protokolü ve Sinyalleri

## Genel Bakış

Hecateq OpenAgent içinde handoff mekanizması agent çıktılarından yapılandırılmış sinyal ve yönlendirme bilgisi çıkarır. Bu sistem iki ana kanal üzerinden çalışır:

| Kanal | Format | Amaç |
|---|---|---|
| Handoff bloğu | `STATUS`, `SIGNALS_EMITTED`, `HANDOFF` | Agent sonucu, routing hedefi ve DAG sinyalleri |
| Memory update bloğu | `<MEMORY_UPDATE>{json}</MEMORY_UPDATE>` | Subagent çıktısından proje belleğine güvenli bilgi aktarımı |

Handoff bloğu `src/features/hecateq-orchestration/handoff-parser.ts` tarafından parse edilir. Runtime persistence ve context summary akışı `src/features/hecateq-orchestration/runtime-handoff-service.ts` içindedir.

## Kanonik Handoff Formatı

```md
STATUS: [DONE | IN_PROGRESS | BLOCKED]
SIGNALS_EMITTED: [{"signal":"<name>","payload":{}}]
HANDOFF: [return_to_caller | return_to_parent_for_routing | <agent-id>]
```

### V2 Ek Alanları

Parser geriye uyumlu şekilde şu alanları da destekler:

```md
CONFIDENCE: <0.0-1.0>
CHANGED_FILES: [{"path":"src/foo.ts","changeType":"modified"}]
QUALITY_NOTES: <free text>
BLOCKERS: ["reason"]
NEXT_RECOMMENDED_AGENT: <agent-id>
```

## STATUS Değerleri

| Değer | Anlam |
|---|---|
| `DONE` | İş tamamlandı |
| `IN_PROGRESS` | İş devam ediyor |
| `BLOCKED` | İş bloklandı, routing bastırılmalı |

## HANDOFF Hedefleri

| Hedef | Anlam |
|---|---|
| `return_to_caller` | Çağıran agente dön |
| `return_to_parent_for_routing` | Parent routing katmanına dön |
| `<agent-id>` | Bilinen agent ID hedefi |

## Runtime Signal Registry

Canonical sinyaller `src/features/hecateq-orchestration/signal-registry.ts` içinde tanımlıdır.

| Signal | Açıklama | Üreten Agent | Tüketen Agentlar |
|---|---|---|---|
| `schema_ready` | Database schema ve migration hazır | `database-specialist` | `nodejs-backend-developer`, `go-backend-developer`, `python-ml-engineer` |
| `backend_ready` | Backend API tamam | `nodejs-backend-developer`, `go-backend-developer` | `qa-test-engineer`, `security-architect`, `performance-specialist` |
| `ui_specs_ready` | UI specs veya wireframe hazır | `design-translator`, `ux-motion-designer` | `nextjs-ui-wizard`, `flutter-dart-master`, `qa-test-engineer` |
| `auth_audit_passed` | Auth denetimi kritik bulgu olmadan geçti | `security-architect` | `nodejs-backend-developer`, `release-manager` |
| `infra_provisioned` | Infra hazır ve erişilebilir | `coolify-devops-specialist`, `devops-engineer` | `nodejs-backend-developer`, `release-manager` |
| `pipeline_secured` | CI/CD security scanning yapılandırıldı | `devsecops-pipeline-architect` | `release-manager`, `coolify-devops-specialist` |
| `tests_passed` | Testler geçti | `qa-test-engineer` | `release-manager`, `nodejs-backend-developer`, `flutter-dart-master` |
| `performance_verified` | Performance threshold geçti | `performance-specialist` | `release-manager`, `qa-test-engineer` |
| `compliance_signed` | Compliance gereksinimleri karşılandı | `compliance-specialist` | `release-manager`, `security-architect` |

Not: `analysis_completed` ve `github_ops_completed` ekosistem dokümanlarında görülebilir, fakat mevcut runtime registry içinde canonical signal olarak kayıtlı değildir.

## Parser Davranışı

`parseHandoffBlock(input: string): HandoffBlock` şu davranışlara sahiptir:

- Hata fırlatmaz, sorunları `validationIssues` içinde toplar.
- Bilinmeyen `STATUS` değerini error olarak işaretler.
- `SIGNALS_EMITTED` JSON array değilse error olarak işaretler.
- Registry içinde olmayan signal adlarını warning olarak işaretler.
- Bilinmeyen `HANDOFF` hedeflerini warning olarak işaretler.
- V2 alanları eksikse geriye uyumlu şekilde boş veya `null` döner.

## Handoff İşleme Akışı

Ana entrypoint:

```ts
processHandoffInAgentResponse(textContent, directory, sessionId)
```

Bu fonksiyon şu adımları uygular:

1. Agent cevabından handoff bloğunu çıkarır.
2. `.omo/hecateq/state.json` içine canonical handoff state yazar.
3. Run-continuation marker içine fallback state yazar.
4. Boulder state içine backward-compatible fallback yazar.
5. `tasks.jsonl` için task-state memory entry üretir.
6. Decision benzeri kalite notları varsa `decisions.jsonl` entry dener.
7. `QUALITY_NOTES` varsa `quality-history.md` günceller.
8. `CHANGED_FILES` varsa risk profile ve file-map change impact günceller.

Canonical read order:

1. `.omo/hecateq/state.json`
2. Run-continuation marker
3. Boulder task session state

## Producer ve Consumer Dosyaları

### Producer veya Extractor

| Dosya | Rol |
|---|---|
| `src/features/hecateq-orchestration/runtime-handoff-service.ts` | Handoff extract ve persist ana akışı |
| `src/features/background-agent/background-handoff-ingestor.ts` | Background task son assistant cevabını aynı pipeline'a verir |
| `src/tools/delegate-task/sync-task.ts` | Sync task sonucunda handoff işler |
| `src/tools/delegate-task/sync-continuation.ts` | Continuation sonucunda handoff işler |

### Consumer

| Dosya | Rol |
|---|---|
| `src/features/hecateq-orchestration/routing-policy-engine.ts` | Parsed handoff üstünden routing kararı üretir |
| `src/features/hecateq-orchestration/signal-dag-executor.ts` | Completed task result içindeki signal verisini DAG aktivasyonu için tüketir |
| `src/features/hecateq-orchestration/omo-state-manager.ts` | Handoff ve signal state persistence katmanı |
| `src/features/hecateq-orchestration/runtime-handoff-service.ts` | Handoff state'i context summary için tekrar okur |

## Routing Decision Mantığı

`routing-policy-engine.ts` saf karar üretir, agent spawn etmez.

| Decision kind | Durum |
|---|---|
| `no_handoff_data` | Handoff metadata yok |
| `invalid_target_blocked` | `STATUS: BLOCKED`, routing bastırılır |
| `return_to_caller` | Caller'a dön |
| `return_to_parent_for_routing` | Parent routing kararı istendi |
| `role_policy_violation` | Source agent target'a handoff yapamaz |
| `unknown_target_fallback` | Target bilinmeyen agent veya direktif |

Bilinen agent ID hedefi geldiğinde engine karar üretir, fakat kendisi auto-dispatch yapmaz. Gerçek delegation akışı delegation controller ve runtime delegation consumer tarafındadır.

## Signal DAG Akışı

`signal-dag-executor.ts` şu işleri yapar:

- Task dependency ve `requiredSignals` şartlarını kontrol eder.
- Completed task result içinde signal varsa state manager'a kaydeder.
- Unknown signal tüketmez.
- Pending signal'ları consumed state'e geçirir.
- Sinyale bağlı ready task varsa delegation controller'a verir.

Agent to signal fallback mapping ayrıca bu dosyada hardcoded durumdadır. Bu mapping `signal-registry.ts` ile drift riski taşır.

## MEMORY_UPDATE Kanalı

Memory update formatı:

```md
<MEMORY_UPDATE>
{
  "session_id": "<current-session-id>",
  "agent_name": "<your-agent-name>",
  "status": "completed",
  "entries": [
    {
      "target": "changed_files",
      "action": "append",
      "data": {
        "files": ["src/foo.ts"],
        "reason": "implemented feature X"
      }
    }
  ]
}
</MEMORY_UPDATE>
```

Bu kanal subagent'ların `.opencode/state/memory/` altına doğrudan yazmasını engeller. Memory writer bileşenleri bu blokları parse edip persistence yapar.

Valid memory status değerleri:

- `completed`
- `blocked`
- `in_progress`
- `cancelled`

Known memory targets:

- `changed_files`
- `decisions`
- `quality`
- `risks`
- `open_questions`
- `next_actions`
- `changed_files_summary`

## Tespit Edilen Boşluklar

1. Runtime registry ile ekosistem sinyal listesi tam aynı değil. `analysis_completed` ve `github_ops_completed` runtime registry içinde yok.
2. `getKnownAgentIds()` hardcoded liste kullanıyor, runtime discovery veya agent index ile beslenmiyor.
3. Signal registry ile `signal-dag-executor.ts` içindeki agent to signal mapping tekrar ediyor.
4. Routing engine auto-dispatch yapmıyor; sadece karar üretiyor.
5. HANDOFF ve MEMORY_UPDATE ayrı kanallar. Aynı task'a ait olduklarını bağlayan zorunlu ortak `task_id` alanı yok.

## Önerilen Standart Agent Çıktısı

```md
## Summary

Kısa sonuç özeti.

## Files Inspected

- `relative/path.ts`: İnceleme nedeni.

## Files Changed

- `relative/path.ts`: Değişiklik özeti.

## Verification

- `bun test path/to/test.ts`: passed

## Risks

- Kalan risk yok veya açık risk listesi.

STATUS: DONE
SIGNALS_EMITTED: [{"signal":"tests_passed","payload":{"scope":"targeted"}}]
HANDOFF: return_to_caller
CONFIDENCE: 0.9
CHANGED_FILES: []
QUALITY_NOTES: Targeted verification completed
BLOCKERS: []
NEXT_RECOMMENDED_AGENT:
```

Read-only araştırma işleri için:

```md
STATUS: DONE
SIGNALS_EMITTED: []
HANDOFF: return_to_caller
CONFIDENCE: 0.9
CHANGED_FILES: []
QUALITY_NOTES: Read-only research completed
BLOCKERS: []
```

## Geliştirme Önerileri

1. `signal-registry.ts` tek kaynak yapılmalı, `signal-dag-executor.ts` içindeki hardcoded map kaldırılmalı.
2. `analysis_completed` ve `github_ops_completed` için karar verilmeli: runtime registry'ye eklensin ya da dokümandan çıkarılsın.
3. `getKnownAgentIds()` runtime discovery veya agent index ile beslenmeli.
4. `HandoffSignal["signal"]` tipi registry tabanlı literal union veya branded type olmalı.
5. HANDOFF ve MEMORY_UPDATE arasında ortak `task_id` standardı eklenmeli.
6. `docs/hecateq/routing.md` V2 alanlarıyla güncellenmeli.

## Ana Kaynak Dosyalar

- `docs/hecateq/routing.md`
- `src/features/hecateq-orchestration/handoff-parser.ts`
- `src/features/hecateq-orchestration/signal-registry.ts`
- `src/features/hecateq-orchestration/runtime-handoff-service.ts`
- `src/features/hecateq-orchestration/routing-policy-engine.ts`
- `src/features/hecateq-orchestration/signal-dag-executor.ts`
- `src/features/background-agent/background-handoff-ingestor.ts`
- `src/shared/memory-update-signal.ts`
- `src/tools/delegate-task/sync-task.ts`
- `src/tools/delegate-task/sync-continuation.ts`
