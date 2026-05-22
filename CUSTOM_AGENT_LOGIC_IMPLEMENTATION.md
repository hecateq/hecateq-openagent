# CUSTOM_AGENT_LOGIC_IMPLEMENTATION

## Scope

Bu değişiklik yalnızca custom agent discovery görünürlüğünü ve `task(subagent_type="...")` exact validation davranışını güçlendirir.

Dokunulmayan alanlar:
- package name
- binary names
- plugin ID
- TUI plugin ID
- schema path
- config file name
- installer registration
- runtime fallback
- TUI
- installer
- skill scoping
- unrelated hook sistemleri

## What Changed

### 1. Exact subagent validation sertleştirildi
- Dosya: `src/tools/delegate-task/subagent-resolver.ts`
- `subagent_type` artık bilinmeyen agent adlarında sessiz fallback yapmıyor.
- Yeni hata formatı:

```text
Unknown subagent_type "unknown-agent". Use one of the available exact agents: <agent-list>. Do not invent agent names.
```

### 2. Disabled agent validation eklendi
- Dosya: `src/tools/delegate-task/subagent-resolver.ts`
- Eğer istenen agent adı `disabled_agents` listesinde ve bilinen bir agent ise artık net hata dönüyor:

```text
Subagent "sisyphus-junior" is disabled by disabled_agents.
```

Bu kontrol unknown hatasından önce uygulanır.

### 3. Available exact agent list helper güçlendirildi
- Dosya: `src/tools/delegate-task/subagent-discovery.ts`
- Yeni davranışlar:
  - final exact agent listesi truncate edilebilir
  - reserved hidden native `build` exact agent listesinde görünmez
  - bilinen agent adı kontrolü için helper eklendi

### 4. Discovery merge kapsamı genişletildi
- Dosya: `src/tools/delegate-task/subagent-discovery.ts`
- `mergeWithDiscoveredAgents(...)` artık server agent listesine ek olarak şu kaynakları da merge eder:
  - OpenCode config inline/definition agents
  - OpenCode project agents
  - OpenCode global agents
  - Claude project agents
  - Claude global agents

Bu sayede exact validation ve available-agent hata listesi daha deterministik hale gelir.

### 5. Delegate task context genişletildi
- Dosyalar:
  - `src/tools/delegate-task/executor-types.ts`
  - `src/tools/delegate-task/types.ts`
  - `src/plugin/tool-registry.ts`
- `disabledAgents` resolver context’ine taşındı.

## Custom Agent Sources

### Global `~/.config/opencode/agents` destekleniyor mu?
Evet.

- Dosya: `src/features/claude-code-agent-loader/loader.ts`
- Fonksiyon: `loadOpencodeGlobalAgents()`
- Path kökü: `src/shared/opencode-config-dir.ts` içindeki `getCliDefaultConfigDir()` ve `getOpenCodeConfigDirs()`

### Project `.opencode/agents` destekleniyor mu?
Evet.

- Dosya: `src/features/claude-code-agent-loader/loader.ts`
- Fonksiyon: `loadOpencodeProjectAgents(directory)`

### Claude global/project agents destekleniyor mu?
Evet.

- Global: `loadUserAgents()` -> `~/.claude/agents`
- Project: `loadProjectAgents(directory)` -> `<project>/.claude/agents`

### Explicit/config-based agent definitions destekleniyor mu?
Evet.

- Dosya: `src/features/claude-code-agent-loader/agent-definitions-loader.ts`
- Fonksiyon: `loadAgentDefinitions(paths, scope)`

### OpenCode config içindeki inline `agent` / `agents` / `agent_definitions` destekleniyor mu?
Evet.

- Dosya: `src/features/claude-code-agent-loader/opencode-config-agents-reader.ts`
- Fonksiyon: `readOpencodeConfigAgents(directory)`

### `AGENTS.md` custom agent discovery için kullanılıyor mu?
Hayır.

- `AGENTS.md` read-context injection için kullanılıyor.
- Custom agent discovery kaynağı değil.

## Resolution Priority

Runtime’daki final merge önceliği `src/plugin-handlers/agent-config-handler.ts` içinde oluşur.

Resolver tarafındaki validation için kullanılan discovery birleşimi şu sırayı korur:
1. server agents (`client.app.agents()`)
2. OpenCode config agents (`readOpencodeConfigAgents`)
3. OpenCode project agents
4. Claude project agents
5. OpenCode global agents
6. Claude global agents

Not:
- Server agent listesi zaten plugin tarafında birincil gerçeklik kaynağıdır.
- Local merge daha çok validation/hata mesajı görünürlüğünü güçlendirmek için vardır.

## Exact Agent Validation

### Bilinmeyen `subagent_type` artık ne yapıyor?
- Sessiz fallback yapmıyor.
- Category routing’e düşmüyor.
- Net exact-agent hatası dönüyor.

### Available agent listesi truncate oluyor mu?
Evet.

- İlk 25 exact callable agent gösteriliyor.
- Fazlası varsa:

```text
... and N more
```

### Built-in agent ile custom agent ayrımı nerede yapılıyor?
- Exact validation için:
  - `src/tools/delegate-task/subagent-discovery.ts`
  - `isKnownAgentName(...)`
- Built-in bilinirlik için:
  - `OverridableAgentNameSchema.options`

## Disabled Agent Behavior

### Disabled agent çağrılırsa ne oluyor?
- Artık resolver erken dönüyor:

```text
Subagent "<name>" is disabled by disabled_agents.
```

Bu unknown hatasından önce çalışır.

## Category Routing Interaction

### Category routing otomatik exact agent’a çevriliyor mu?
Hayır.

Bu değişiklik category routing’i exact agent’a çevirmiyor.

### `disabled_categories` davranışı bozuldu mu?
Hayır.

### Custom-agent-first category hint davranışı bozuldu mu?
Hayır.

Önceki değişiklikte eklenen category-level custom-agent-first hint korunuyor.

## Files Changed

- `src/tools/delegate-task/executor-types.ts`
- `src/tools/delegate-task/types.ts`
- `src/plugin/tool-registry.ts`
- `src/tools/delegate-task/subagent-discovery.ts`
- `src/tools/delegate-task/subagent-resolver.ts`
- `src/tools/delegate-task/zauc-mocks-subagent-resolver/subagent-resolver.test.ts`
- `CUSTOM_AGENT_LOGIC_IMPLEMENTATION.md`

## Tests Added / Updated

### Updated
- `src/tools/delegate-task/zauc-mocks-subagent-resolver/subagent-resolver.test.ts`

### New coverage added
- existing enabled `subagent_type` still works
- unknown `subagent_type` returns exact-agent error
- disabled `subagent_type` returns disabled error
- unknown error includes available exact agent list
- long available list truncates with `... and N more`
- OpenCode project agent source can resolve exact agent when server list is empty

## Tests Run

```bash
bun test src/tools/delegate-task/zauc-mocks-subagent-resolver/subagent-resolver.test.ts src/tools/delegate-task/category-resolver.test.ts
```

Result:

```text
83 pass
0 fail
```

```bash
bun test src/plugin-config.test.ts src/tools/delegate-task/category-resolver.test.ts src/tools/delegate-task/zauc-mocks-subagent-resolver/subagent-resolver.test.ts
```

Result:

```text
126 pass
0 fail
```

## Behavior Before

- Unknown `subagent_type` için hata vardı ama format daha gevşekti ve exact-agent vurgusu net değildi.
- Disabled agent için resolver seviyesinde net, öncelikli bir error yoktu.
- Validation listesi Claude global/project kaynaklarıyla sınırlıydı.
- OpenCode global/project/config agent kaynakları exact validation görünürlüğüne tam yansımıyordu.

## Behavior After

- Unknown `subagent_type` net, deterministic exact-agent hatası verir.
- Disabled agent çağrısı unknown’dan önce net disabled error verir.
- Available exact agent listesi truncation destekler.
- Validation için kullanılan discovery merge’i OpenCode kaynaklarını da kapsar.
- Exact `subagent_type` routing korunur; category fallback’e sessizce düşmez.

## Risks

- Validation/hata mesajı üretimi artık daha fazla local source birleştiriyor; bu, çok karmaşık agent setlerinde listede daha fazla isim görünmesine yol açabilir.
- Disabled detection bilinen agent adıyla birlikte çalışacak şekilde sertleştirildi; agent naming alias’ları ileride genişlerse testlere yeni varyantlar eklenmesi gerekebilir.

## Rollback

Geri almak için şu dosyalar revert edilebilir:
- `src/tools/delegate-task/executor-types.ts`
- `src/tools/delegate-task/types.ts`
- `src/plugin/tool-registry.ts`
- `src/tools/delegate-task/subagent-discovery.ts`
- `src/tools/delegate-task/subagent-resolver.ts`
- `src/tools/delegate-task/zauc-mocks-subagent-resolver/subagent-resolver.test.ts`
- `CUSTOM_AGENT_LOGIC_IMPLEMENTATION.md`
