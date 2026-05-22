# CODEBASE LOCAL ANALYSIS

Bu rapor yalnızca `/home/berkay/Masaüstü/Projeler/forks/oh-my-openagent-hecateq` içindeki dosyalar okunarak üretildi. Dış kaynak, GitHub, resmi doküman, internet ve runtime dışı varsayım kullanılmadı. Bulunamayan yerlerde bilinçli olarak `UNKNOWN` yazdım.

## 1) Bu repo nasıl çalışıyor?

### Ana entrypoint nerede?
- `src/index.ts`
  - `const pluginModule: PluginModule = createPluginModule()` ile plugin modülünü kuruyor.
  - `export default pluginModule` ile dışarı veriyor.

### Plugin nereden başlıyor?
- `src/testing/create-plugin-module.ts`
  - `createPluginModule()` plugin modülünü kuruyor.
  - `serverPlugin()` içinde sırasıyla config context, legacy migration, auth injection, config load, managers, tools, hooks ve plugin interface kuruluyor.
  - Plugin ID burada sabit: `id: "oh-my-openagent"` (`src/testing/create-plugin-module.ts:183-185`).

### OpenCode bunu nasıl yüklüyor?
- Paket yüzeyi:
  - `package.json`
    - `main: "./dist/index.js"`
    - `exports["."]` ve `exports["./server"]` plugin entrypoint’i `dist/index.js` olarak veriyor.
- Installer kaydı:
  - `src/cli/config-manager/add-plugin-to-opencode-config.ts`
  - `addPluginToOpenCodeConfig()` OpenCode config içindeki `plugin` dizisine `PLUGIN_NAME` sürümlü entry ekliyor.
- Runtime plugin modülü:
  - `src/testing/create-plugin-module.ts` dönen objede `id: "oh-my-openagent"`, `server: serverPlugin` var.

### TUI tarafı nerede?
- Bu fork içinde gerçek bir TUI component / sidebar implementasyonu bulamadım.
- TUI ile ilgili yerler yalnızca:
  - `src/cli/tui-installer.ts`
  - `src/cli/tui-install-prompts.ts`
  - `src/cli/doctor/checks/tui-plugin-config.ts`
- `Roles · Models sidebar` ifadesi doctor uyarısında geçiyor ama onu çizen lokal TS/TSX kodunu bulamadım. Bu yüzden gerçek TUI view kodu için durum: `UNKNOWN`.

### Installer nerede?
- CLI giriş: `src/cli/install.ts`
  - `install(args)` -> `runTuiInstaller()` veya `runCliInstaller()`.
- TUI installer: `src/cli/tui-installer.ts`
- Non-interactive / CLI installer: `src/cli/cli-installer.ts` (`tui-installer.ts` içinden referansla görülebiliyor; bu raporda ana davranış TUI üzerinden doğrulandı).

### Doctor nerede?
- Komut giriş: `src/cli/doctor/index.ts`
  - `doctor()` -> `runDoctor()`.
- Check registry ve alt kontroller `src/cli/doctor/checks/` altında.

---

## 2) Klasör yapısı

### Üst seviye klasörler
- `src/` — ana plugin runtime, CLI, hooks, agents, tools, config, features.
- `packages/` — core package’lar ve web paketi.
- `bin/` — binary shim / platform çözümleme.
- `script/` — build/publish/schema otomasyonu.
- `docs/` — dökümantasyon.
- `assets/` — schema artifact’leri.
- `tests/`, `test-support/`, `test-setup.ts`, `bun-test.d.ts` — test altyapısı.
- `.opencode/`, `.agents/`, `.omo/` — proje içi plugin/skill/agent/workspace verileri.

### Hangi klasör runtime?
- Ana runtime: `src/`
- Plugin entry ve lifecycle:
  - `src/index.ts`
  - `src/testing/create-plugin-module.ts`
  - `src/plugin/`
  - `src/plugin-handlers/`
  - `src/hooks/`
  - `src/tools/`
  - `src/features/`

### Hangi klasör TUI?
- Gerçek TUI render kodu bu forkta lokal olarak bulunamadı: `UNKNOWN`
- TUI registration / installer / doctor kontrolü:
  - `src/cli/tui-installer.ts`
  - `src/cli/tui-install-prompts.ts`
  - `src/cli/doctor/checks/tui-plugin-config.ts`

### Hangi klasör packages/core?
- `packages/agents-md-core/`
- `packages/ast-grep-core/`
- `packages/comment-checker-core/`
- `packages/model-core/`
- `packages/rules-engine/`
- `packages/utils/`
- `packages/boulder-state/`

### Hangi klasör hooks?
- `src/hooks/`

### Hangi klasör agents / skills / config / schema / test içeriyor?
- Agents:
  - `src/agents/`
  - `src/features/claude-code-agent-loader/`
  - proje düzeyi agent kaynakları: `.agents/`, `.opencode/agents`, `.claude/agents` (kodda discovery var)
- Skills:
  - `src/features/opencode-skill-loader/`
  - `src/tools/skill/`
  - proje düzeyi skill kaynakları: `.opencode/skills`, `.opencode/skill`, `.agents/skills`, `.claude/skills`
- Config:
  - `src/plugin-config.ts`
  - `src/config/`
  - `src/cli/config-manager/`
- Schema:
  - `src/config/schema/`
  - artifact: `assets/oh-my-opencode.schema.json` (repo açıklamalarında referanslanıyor)
- Test:
  - `tests/`
  - `test-support/`
  - `src/**/*.test.ts`
  - `packages/web/e2e/`

---

## 3) Config mantığı

Ana schema giriş noktası: `src/config/schema/oh-my-opencode-config.ts` içindeki `OhMyOpenCodeConfigSchema`.

Config yükleme ve merge başlangıç noktası:
- `src/plugin-config.ts`
  - `loadPluginConfig()`
  - `loadConfigFromPath()`
  - `parseConfigPartially()`
  - `mergeConfigs()`

### `agents`
- Schema:
  - `src/config/schema/oh-my-opencode-config.ts:61`
  - `src/config/schema/agent-overrides.ts`
- Kullanım:
  - `src/plugin-config.ts` -> `mergeConfigs()` (`agents: deepMerge(base.agents, override.agents)`)
  - `src/plugin-handlers/agent-config-handler.ts` -> `applyAgentConfig()`
  - `src/agents/builtin-agents.ts` -> `createBuiltinAgents(..., params.pluginConfig.agents, ...)`
  - `src/plugin/hooks/create-session-hooks.ts:247` -> `pluginConfig.agents?.hephaestus?.allow_non_gpt_model`
  - `src/hooks/runtime-fallback/fallback-models.ts` -> agent bazlı fallback arıyor
- Ne işe yarıyor:
  - Built-in agent override’ları, model/variant/prompt/tools/permission benzeri alanları taşıyor.
- Nereden başlanır:
  - Agent davranışı için: `src/plugin-handlers/agent-config-handler.ts`
  - Override merge mantığı için: `src/agents/builtin-agents/agent-overrides.ts`

### `categories`
- Schema:
  - `src/config/schema/oh-my-opencode-config.ts:62`
  - `src/config/schema/categories.ts`
- Kullanım:
  - `src/plugin-config.ts` -> `mergeConfigs()` (`categories: deepMerge(...)`)
  - `src/tools/delegate-task/category-resolver.ts` -> `resolveCategoryExecution()`
  - `src/agents/builtin-agents.ts` -> `mergeCategories()` ile built-in + user category birleşimi
  - `src/hooks/runtime-fallback/fallback-models.ts:44-49` -> session category üstünden fallback zinciri
  - `src/plugin-handlers/agent-config-handler.ts` -> built-in agent prompt/context üretimine geçiyor
- Ne işe yarıyor:
  - Category routing model/variant/thinking/prompt_append/fallback model politikasını belirliyor.
- Nereden başlanır:
  - Routing davranışı: `src/tools/delegate-task/category-resolver.ts`
  - Category schema/alanları: `src/config/schema/categories.ts`

### `disabled_categories`
- Schema: `UNKNOWN`
- Kod kullanımı: `UNKNOWN`
- Repo içi grep sonucu: literal `disabled_categories` bulunmadı.
- Not:
  - Category disable davranışı field bazında `categories.<name>.disable` olarak var (`src/config/schema/categories.ts:26-27`).
- Nereden başlanır:
  - Eğer top-level alan eklenecekse `src/config/schema/oh-my-opencode-config.ts` ve `src/tools/delegate-task/category-resolver.ts` başlangıç noktası olur.

### `disabled_hooks`
- Schema:
  - `src/config/schema/oh-my-opencode-config.ts:44`
- Kullanım:
  - `src/plugin-config.ts` -> `mergeConfigs()` array union
  - `src/testing/create-plugin-module.ts:125-127` -> `const disabledHooks = new Set(...)`, `isHookEnabled()`
  - Tüm hook factory dosyaları `isHookEnabled(...)` üzerinden çalışıyor:
    - `src/plugin/hooks/create-session-hooks.ts`
    - `src/plugin/hooks/create-transform-hooks.ts`
    - `src/plugin/hooks/create-tool-guard-hooks.ts`
    - `src/plugin/hooks/create-continuation-hooks.ts`
    - `src/plugin/hooks/create-skill-hooks.ts`
- Ne işe yarıyor:
  - Hook registration aşamasında hook’u hiç kurdurmuyor.
- Nereden başlanır:
  - Hook enable/disable giriş noktası: `src/testing/create-plugin-module.ts`

### `disabled_agents`
- Schema:
  - `src/config/schema/oh-my-opencode-config.ts:42`
- Kullanım:
  - `src/plugin-config.ts` -> merge union
  - `src/plugin-handlers/agent-config-handler.ts:59-63, 187-194`
  - `src/agents/builtin-agents.ts` ve alt helper’lar (`maybeCreateSisyphusConfig`, `maybeCreateHephaestusConfig`, `maybeCreateAtlasConfig`) disabled list ile built-in agent üretimini kesiyor.
- Ne işe yarıyor:
  - Built-in ve custom agent’ları final config’e girmeden filtreliyor.
- Nereden başlanır:
  - Final filtre zinciri için `src/plugin-handlers/agent-config-handler.ts`

### `default_mode`
- Schema:
  - `src/config/schema/oh-my-opencode-config.ts:97`
  - `src/config/schema/default-mode.ts`
- Kullanım:
  - `src/plugin-interface.ts:63-66` -> `createSystemTransformHandler(pluginConfig.default_mode, getUltraworkMessage)`
  - `src/plugin/chat-message.ts:313-320` -> ilk mesajda `default_mode.ralph_loop` ise `hooks.ralphLoop.startLoop(...)`
  - `src/plugin/hooks/create-transform-hooks.ts:59-65` -> keyword detector’a `defaultMode` geçiliyor
  - `src/plugin/system-transform.ts:13-24` -> `defaultMode.ultrawork` ise ultrawork system prompt inject ediliyor
- Ne işe yarıyor:
  - Session başlangıcında ultrawork prompt ve/veya ralph loop’u otomatik açıyor.
- Nereden başlanır:
  - Ultrawork auto injection: `src/plugin/system-transform.ts`
  - Ralph auto-start: `src/plugin/chat-message.ts`

### `ralph_loop`
- Schema:
  - `src/config/schema/oh-my-opencode-config.ts:69`
  - `src/config/schema/ralph-loop.ts`
- Kullanım:
  - `src/plugin/hooks/create-session-hooks.ts:211-217` -> `createRalphLoopHook(ctx, { config: pluginConfig.ralph_loop, ... })`
  - `src/hooks/ralph-loop/ralph-loop-hook.ts:46-58` -> state dir ve config’i alıyor
  - `src/hooks/ralph-loop/loop-state-controller.ts` -> `default_max_iterations`, `default_strategy`
- Ne işe yarıyor:
  - Ralph loop state dizini, varsayılan iteration ve strategy ayarlarını belirliyor.
- Nereden başlanır:
  - Loop config uygulaması: `src/hooks/ralph-loop/ralph-loop-hook.ts`
  - State/iteration mantığı: `src/hooks/ralph-loop/loop-state-controller.ts`

### `background_task`
- Schema:
  - `src/config/schema/oh-my-opencode-config.ts:76`
  - `src/config/schema/background-task.ts`
- Kullanım:
  - `src/features/background-agent/concurrency.ts` -> `defaultConcurrency`, `providerConcurrency`, `modelConcurrency`
  - `src/features/background-agent/task-poller.ts` -> stale / ttl / cleanup timeout’ları
  - `src/features/background-agent/manager.ts` -> BackgroundManager ana orkestra nesnesi bu config’i kullanıyor
  - `src/features/background-agent/subagent-spawn-limits.ts` ve delegate-task testlerinde `maxDepth`
- Ne işe yarıyor:
  - Background task eşzamanlılık, stale/TTL ve runaway korumalarını belirliyor.
- Nereden başlanır:
  - Concurrency için `src/features/background-agent/concurrency.ts`
  - Stale/TTL için `src/features/background-agent/task-poller.ts`

### `runtime_fallback`
- Schema:
  - `src/config/schema/oh-my-opencode-config.ts:75`
  - `src/config/schema/runtime-fallback.ts`
- Kullanım:
  - `src/plugin/hooks/create-session-hooks.ts:262-273` -> `createRuntimeFallbackHook(...)`
  - `src/plugin/chat-message.ts:187-193` -> runtime fallback açıksa eski `model-fallback` hook’u bypass ediyor
  - `src/plugin/event.ts:231-236` -> runtime fallback enable kontrolü
  - `src/hooks/runtime-fallback/*`
- Ne işe yarıyor:
  - Provider/model hata anında fallback chain ile yeni model denemesi yapıyor.
- Nereden başlanır:
  - Top-level behavior: `src/hooks/runtime-fallback/hook.ts`
  - Retry/dispatch: `src/hooks/runtime-fallback/auto-retry.ts`, `fallback-retry-dispatcher.ts`

### `memory_bank`
- Schema: `UNKNOWN`
- Kod kullanımı: `UNKNOWN`
- Repo içi literal arama sonucu bulunmadı.

### `notification`
- Schema:
  - `src/config/schema/oh-my-opencode-config.ts:77`
  - `src/config/schema/notification.ts`
- Kullanım:
  - Bu alanın doğrudan runtime consumer’ını incelediğim dosyalarda kanıtlayamadım: `UNKNOWN`
  - Mevcut schema yalnızca `force_enable` içeriyor.
- Ne işe yarıyor:
  - Schema seviyesinde session notification hook’una force enable amacı taşıyor görünüyor; fakat bu alanın aktif consumer fonksiyonunu bu taramada sabitleyemedim.
- Nereden başlanır:
  - `src/config/schema/notification.ts`
  - Ardından `src/plugin/hooks/create-session-hooks.ts` ve `src/hooks/session-notification*` zinciri taranmalı.

### `telemetry`
- Schema: `UNKNOWN`
- Kod kullanımı:
  - Config alanı olarak bulunmadı.
  - Telemetry yalnızca environment/CLI seviyesinde metin ve testlerde görünüyor:
    - `src/cli/tui-installer.ts:88`
    - `src/cli/run/runner.ts`
- Ne işe yarıyor:
  - Config alanı olarak değil, env ile kontrol edilen telemetry davranışı var.
- Nereden başlanır:
  - `src/cli/run/runner.ts`

### `google_auth`
- Schema: `UNKNOWN`
- Kod kullanımı: `UNKNOWN`
- Repo içi literal arama sonucu bulunmadı.

### `experimental`
- Schema:
  - `src/config/schema/oh-my-opencode-config.ts:66`
  - `src/config/schema/experimental.ts`
- Kullanım örnekleri:
  - `src/testing/create-plugin-module.ts:128` -> `safe_hook_creation`
  - `src/plugin/hooks/create-session-hooks.ts:184` -> `anthropic-context-window-limit-recovery` hook’a geçiliyor
  - `src/plugin-handlers/agent-config-handler.ts:113` -> `disable_omo_env`
  - `src/plugin/system-transform.ts` ve tool registry yollarında dolaylı kullanımlar var
- Ne işe yarıyor:
  - Safe hook creation, task system, hashline edit, fallback title, tool cap gibi deneysel davranış anahtarları taşıyor.
- Nereden başlanır:
  - `src/config/schema/experimental.ts`
  - Sonra ilgili consumer modülüne gidilmeli.

---

## 4) Agent mantığı

### Built-in agent’lar nerede tanımlı?
- Ana kayıt:
  - `src/agents/builtin-agents.ts`
  - `agentSources` içinde built-in agent factory map’i var.
- Factory dosyaları:
  - `src/agents/sisyphus.ts`
  - `src/agents/hephaestus/agent.ts` ve varyantları
  - `src/agents/oracle.ts`
  - `src/agents/librarian.ts`
  - `src/agents/explore.ts`
  - `src/agents/metis.ts`
  - `src/agents/momus.ts`
  - `src/agents/atlas.ts`
  - `src/agents/multimodal-looker.ts`
  - `src/agents/sisyphus-junior.ts`

### Custom agent’lar nereden okunuyor?
- `src/plugin-handlers/agent-config-handler.ts:115-125`
  - `loadUserAgents()`
  - `loadProjectAgents()`
  - `loadOpencodeGlobalAgents()`
  - `loadOpencodeProjectAgents()`
  - `loadAgentDefinitions()`
  - `readOpencodeConfigAgents()`
- Source loader’lar:
  - `src/features/claude-code-agent-loader/loader.ts`
  - `src/features/claude-code-agent-loader/agent-definitions-loader.ts`
  - `src/features/claude-code-agent-loader/opencode-config-agents-reader.ts`
  - `src/features/claude-code-plugin-loader/agent-loader.ts`

### AGENTS.md okunuyor mu?
- Evet, ama custom agent discovery için değil; read sonrası context injection için.
- Zincir:
  - `src/hooks/directory-agents-injector/hook.ts`
  - `packages/agents-md-core/src/injector.ts`
  - `findAgentsMdUp(...)` çağrılıyor ve içerik read output’una context block olarak ekleniyor.

### `agents/*.md` okunuyor mu?
- Genel bir çıplak `agents/*.md` discovery mantığını kanıtlayamadım: `UNKNOWN`
- Kanıtlanan path’ler:
  - `~/.claude/agents` -> `loadUserAgents()`
  - `<project>/.claude/agents` -> `loadProjectAgents()`
  - OpenCode config dir `agents/` -> `loadOpencodeGlobalAgents()`
  - `<project>/.opencode/agents` -> `loadOpencodeProjectAgents()`
  - explicit `agent_definitions` listesi -> `loadAgentDefinitions()`

### `~/.config/opencode/agents` okunuyor mu?
- Evet.
- Zincir:
  - `src/features/claude-code-agent-loader/loader.ts:53-68` -> `loadOpencodeGlobalAgents()`
  - `src/shared/opencode-config-dir.ts:58-74` -> default config dir `~/.config/opencode`

### Agent adı, model, variant, permission, prompt_append nasıl uygulanıyor?
- Name:
  - Markdown agent dosyalarında dosya adından veya frontmatter `name` alanından türetiliyor.
  - `src/features/claude-code-agent-loader/agent-definitions-loader.ts:19-22`
- Model:
  - Markdown / config model alanı `mapClaudeModelToOpenCode()` ile normalize ediliyor.
  - `src/features/claude-code-agent-loader/agent-definitions-loader.ts:26-35`
  - Built-in override model çözümü `src/agents/builtin-agents/model-resolution.ts` üzerinden helper’larda uygulanıyor; çağrılar:
    - `src/agents/builtin-agents/sisyphus-agent.ts:56-67`
    - `src/agents/builtin-agents/hephaestus-agent.ts:56-68`
    - `src/agents/builtin-agents/atlas-agent.ts:41-50`
- Variant:
  - Model resolution’dan dönen variant built-in agent config’e ekleniyor.
  - Örnek: `src/agents/builtin-agents/atlas-agent.ts:50-63`
- Permission:
  - Agent override schema’da var: `src/config/schema/agent-overrides.ts:29`
  - Merge uygulaması `deepMerge(base, rest)` ile `mergeAgentConfig()` içinde yapılıyor:
    - `src/agents/builtin-agents/agent-overrides.ts:38-55`
- `prompt_append`:
  - Category seviyesinde: `applyCategoryOverride()`
    - `src/agents/builtin-agents/agent-overrides.ts:31-33`
  - Agent override seviyesinde: `mergeAgentConfig()`
    - `src/agents/builtin-agents/agent-overrides.ts:44-53`

### `task(subagent_type="...")` mantığı nerede?
- Tool girişi:
  - `src/tools/delegate-task/tools.ts`
- Subagent resolution:
  - `src/tools/delegate-task/subagent-resolver.ts`
  - Ana fonksiyon: `resolveSubagentExecution(...)`

### `delegate_task(category="...")` mantığı nerede?
- Literal tool adı `delegate_task` yerine repo içinde `task` tool’u category parametresi alıyor.
- Entry:
  - `src/tools/delegate-task/tools.ts`
- Category resolution:
  - `src/tools/delegate-task/category-resolver.ts`
  - Ana fonksiyon: `resolveCategoryExecution(...)`

### Category routing nerede devreye giriyor?
- `src/tools/delegate-task/tools.ts`
  - Tool args hem `category` hem `subagent_type` kabul ediyor.
- `src/tools/delegate-task/category-resolver.ts`
  - Category -> model/prompt/fallback/sisyphus-junior route’u çıkarıyor.

---

## 5) Hook sistemi

`disabled_hooks` kapatma mekanizması:
- `src/testing/create-plugin-module.ts:125-127`
  - `disabledHooks = new Set(pluginConfig.disabled_hooks ?? [])`
  - `isHookEnabled = (hookName) => !disabledHooks.has(hookName)`
- Tüm hook factory’leri bunu kullanıyor.

### `stop-continuation-guard`
- Dosya:
  - `src/hooks/stop-continuation-guard/hook.ts`
  - registration: `src/plugin/hooks/create-continuation-hooks.ts:51-56`
- Ne zaman çalışır:
  - `event`
  - `chat.message`
  - ayrıca `stop()/clear()/isStopped()` API sağlar
- Neyi engeller / ekler:
  - Session’ı stopped işaretler.
  - Descendant background task’ları `cancelTask()` ile iptal eder.
- Kapatma:
  - `disabled_hooks: ["stop-continuation-guard"]`

### `subagent-question-blocker`
- Dosya: `UNKNOWN`
- Registration: `UNKNOWN`
- Repo içi literal arama sonucu bulunmadı.
- Kapatma:
  - Bu hook adı schema’da da görünmüyor; mevcut repo state’inde `UNKNOWN`.

### `unstable-agent-babysitter`
- Dosya:
  - `src/hooks/unstable-agent-babysitter/unstable-agent-babysitter-hook.ts`
  - wrapper: `src/plugin/unstable-agent-babysitter.ts`
  - registration: `src/plugin/hooks/create-continuation-hooks.ts` (type alanında var; aynı dosya create sırasında bağlanıyor)
- Ne zaman çalışır:
  - Background / continuation akışında unstable agent task’larını izler.
- Neyi engeller / ekler:
  - Timeout / stuck unstable agent için ana session’a internal prompt ile reminder veya wake-up dispatch eder.
- Kapatma:
  - `disabled_hooks: ["unstable-agent-babysitter"]`

### `sisyphus-junior-notepad`
- Dosya:
  - `src/hooks/sisyphus-junior-notepad/hook.ts`
  - registration: `src/plugin/hooks/create-session-hooks.ts:236-238`
- Ne zaman çalışır:
  - `tool.execute.before`
  - Sadece `task` tool çağrısında
- Neyi engeller / ekler:
  - Orchestrator caller ise `task` prompt’unun başına notepad directive inject eder.
- Kapatma:
  - `disabled_hooks: ["sisyphus-junior-notepad"]`

### `keyword-detector`
- Dosya:
  - `src/hooks/keyword-detector/hook.ts`
  - registration: `src/plugin/hooks/create-transform-hooks.ts:55-67`
- Ne zaman çalışır:
  - `chat.message`
  - transform tier
- Neyi engeller / ekler:
  - Ultrawork/search/analyze/team keyword’lerini bulup mode message inject eder.
  - System directive veya synthetic-only text ise skip eder.
- Kapatma:
  - `disabled_hooks: ["keyword-detector"]`

### `category-skill-reminder`
- Dosya:
  - `src/hooks/category-skill-reminder/hook.ts`
  - registration: `src/plugin/hooks/create-skill-hooks.ts:34-37`
- Ne zaman çalışır:
  - Delegatable tool kullanımlarından sonra.
- Neyi engeller / ekler:
  - Sisyphus / Sisyphus-Junior / Atlas için delegation tool kullanılmıyorsa reminder inject eder.
- Kapatma:
  - `disabled_hooks: ["category-skill-reminder"]`

### `comment-checker`
- Dosya:
  - `src/hooks/comment-checker/hook.ts`
  - registration: `src/plugin/hooks/create-tool-guard-hooks.ts:65-66`
- Ne zaman çalışır:
  - `tool.execute.before` ve `tool.execute.after` zinciri içinde `write` / `edit` / `multiedit`
- Neyi engeller / ekler:
  - Comment checker CLI ile AI-slop comment kalıplarını tarar.
  - Violation varsa tool seviyesinde failure üretir.
- Kapatma:
  - `disabled_hooks: ["comment-checker"]`

### `notepad-write-guard`
- Dosya:
  - `src/hooks/notepad-write-guard/index.ts`
  - registration: `src/plugin/hooks/create-tool-guard-hooks.ts:156-157`
- Ne zaman çalışır:
  - `tool.execute.before`
  - Sadece `write` tool’unda
- Neyi engeller / ekler:
  - `.sisyphus/notepads` ve `.omo/notepads` altına `Write` ile overwrite’i engeller.
- Kapatma:
  - `disabled_hooks: ["notepad-write-guard"]`

### `plan-format-validator`
- Dosya:
  - `src/hooks/plan-format-validator/hook.ts`
  - registration: `src/plugin/hooks/create-tool-guard-hooks.ts:152-153`
- Ne zaman çalışır:
  - `tool.execute.before`
  - Plan dosyasına Write/Edit sırasında
- Neyi engeller / ekler:
  - `## TODOs` ve `## Final Verification Wave` checkbox formatını kontrol eder.
  - `getPlanProgress()` parse edemiyorsa warning block ekler.
- Kapatma:
  - `disabled_hooks: ["plan-format-validator"]`

---

## 6) Runtime fallback

### Hata yakalama nerede?
- Hook factory:
  - `src/hooks/runtime-fallback/hook.ts`
- Event tabanlı:
  - `src/hooks/runtime-fallback/event-handler.ts`
- Message update tabanlı:
  - `src/hooks/runtime-fallback/message-update-handler.ts`
- Session status retry tabanlı:
  - `src/hooks/runtime-fallback/session-status-handler.ts`

### Fallback model seçimi nerede?
- Session için fallback listesi:
  - `src/hooks/runtime-fallback/fallback-models.ts`
  - `getFallbackModelsForSession()`
- Retry dispatch:
  - `src/hooks/runtime-fallback/fallback-retry-dispatcher.ts`
  - `prepareFallback(...)`

### `retry_on_errors` nerede uygulanıyor?
- `src/hooks/runtime-fallback/hook.ts:39-45` config normalizasyonu
- `src/hooks/runtime-fallback/message-update-handler.ts:115-123`
  - `extractStatusCode(error, config.retry_on_errors)`
  - `isRetryableError(error, config.retry_on_errors)`
- Default değerler:
  - `src/hooks/runtime-fallback/constants.ts:12-18`

### `timeout_seconds` nerede kullanılıyor?
- `src/hooks/runtime-fallback/hook.ts:43`
- `src/hooks/runtime-fallback/auto-retry.ts:77,103`
- `src/hooks/runtime-fallback/message-update-handler.ts:23`
- `src/hooks/runtime-fallback/session-status-handler.ts:30`

### `notify_on_fallback` nerede tetikleniyor?
- `src/hooks/runtime-fallback/fallback-retry-dispatcher.ts:27-38`
  - `ctx.client.tui.showToast(...)`

### Fallback davranışını değiştirmek istersek hangi dosyaya bakmalıyız?
- İlk bakılacak çekirdek dosyalar:
  - `src/hooks/runtime-fallback/hook.ts`
  - `src/hooks/runtime-fallback/auto-retry.ts`
  - `src/hooks/runtime-fallback/fallback-models.ts`
  - `src/hooks/runtime-fallback/fallback-retry-dispatcher.ts`
  - `src/hooks/runtime-fallback/event-handler.ts`

---

## 7) Background agent/task sistemi

### Background task nerede başlatılıyor?
- Tool seviyesinde:
  - `src/tools/background-task/create-background-task.ts`
  - `src/tools/delegate-task/tools.ts` -> `executeBackgroundTask(...)`
- Ana manager:
  - `src/features/background-agent/manager.ts`

### Concurrency ayarları nerede uygulanıyor?
- `src/features/background-agent/concurrency.ts`
  - `ConcurrencyManager.getConcurrencyLimit()`
  - sıra: `modelConcurrency` -> `providerConcurrency` -> `defaultConcurrency` -> fallback `5`

### `staleTimeoutMs` nerede kullanılıyor?
- Schema:
  - `src/config/schema/background-task.ts:14-15`
- Runtime poll/prune mantığı:
  - `src/features/background-agent/task-poller.ts`
  - `DEFAULT_STALE_TIMEOUT_MS` default’ı `src/features/background-agent/constants.ts:7`

### parent wake / stream activity nerede takip ediliyor?
- Parent wake:
  - `src/features/background-agent/parent-wake-notifier.ts`
- Stream activity parse:
  - `src/features/background-agent/session-stream-activity.ts`
- Session activity -> task progress refresh:
  - `src/features/background-agent/task-activity-refresh.ts`

### ghost/stale session önlemleri nerede?
- Session existence check:
  - `src/features/background-agent/session-existence.ts`
- Stale prune / TTL / session gone timeout:
  - `src/features/background-agent/task-poller.ts`
- Default constants:
  - `src/features/background-agent/constants.ts`

---

## 8) Default mode / ultrawork / ralph loop

### `default_mode.ultrawork` nerede uygulanıyor?
- `src/plugin/system-transform.ts:13-24`
  - `defaultMode.ultrawork` true ise ultrawork system prompt inject ediyor.

### `default_mode.ralph_loop` nerede uygulanıyor?
- `src/plugin/chat-message.ts:313-320`
  - İlk mesajda `hooks.ralphLoop.startLoop(...)` çağrılıyor.

### Ultrawork prompt’u nerede?
- Router:
  - `src/hooks/keyword-detector/ultrawork/index.ts`
  - `getUltraworkMessage()`
- Default prompt metni:
  - `src/hooks/keyword-detector/ultrawork/default.ts`
  - `ULTRAWORK_DEFAULT_MESSAGE`

### `ralph_loop` döngüsü nerede?
- Hook factory:
  - `src/hooks/ralph-loop/ralph-loop-hook.ts`
- Event handler:
  - `src/hooks/ralph-loop/ralph-loop-event-handler.ts`
- State controller:
  - `src/hooks/ralph-loop/loop-state-controller.ts`

### Yeni session başlarken bunlar nasıl aktif oluyor?
- Plugin kurulumu:
  - `src/testing/create-plugin-module.ts`
- `default_mode.ultrawork`:
  - `experimental.chat.system.transform` üzerinden `createSystemTransformHandler()`
- `default_mode.ralph_loop`:
  - `chat.message` ilk user message sırasında auto-start

---

## 9) Skills sistemi

### Skills nereden okunuyor?
- Ana loader:
  - `src/features/opencode-skill-loader/loader.ts`
- Dizin bazlı loader:
  - `src/features/opencode-skill-loader/skill-directory-loader.ts`
- Tekil skill parse:
  - `src/features/opencode-skill-loader/loaded-skill-from-path.ts`
- Scope kaynakları:
  - `.claude/skills`
  - `.agents/skills`
  - `.opencode/skills`, `.opencode/skill`
  - global OpenCode config dir `skills` / `skill`

### `target_agent` veya scoped skill mantığı var mı?
- Literal `target_agent` alanını bulmadım: `UNKNOWN`
- Scoped/agent alanı var:
  - `src/config/schema/skills.ts:17`
  - `src/features/opencode-skill-loader/types.ts:11`
  - `src/features/opencode-skill-loader/loaded-skill-from-path.ts:43-51` -> `definition.agent = data.agent`
- Fakat bu alanın delegate-time enforcement consumer’ını bu taramada net bağlayamadım: `UNKNOWN`

### Skill prompt’a nerede inject ediliyor?
- `task` tool skill çözümü:
  - `src/tools/delegate-task/tools.ts:71-87`
  - `resolveSkillContent(...)`
- Agent prompt system content birleştirme:
  - `src/tools/delegate-task/prompt-builder.ts:69-84`
  - `buildSystemContent(...)`
- `skill` tool yükleme:
  - `src/tools/skill/tools.ts`

### Delegate sırasında skill kısıtlaması nerede uygulanıyor?
- `allowed-tools` parse ediliyor:
  - `src/features/opencode-skill-loader/loaded-skill-from-path.ts:62`
- `agent` metadata parse ediliyor:
  - `src/features/opencode-skill-loader/loaded-skill-from-path.ts:48-49`
- Ancak `load_skills` sırasında agent-scope kısıtlamasını uygulayan net bir enforcement noktası bu incelemede kanıtlanamadı: `UNKNOWN`

---

## 10) TUI sistemi

### `oh-my-openagent/tui` nerede?
- Lokal repo içinde `./tui` export veya TUI component kodu bulamadım: `UNKNOWN`

### `tui.json` plugin kaydı nasıl bekleniyor?
- `src/cli/doctor/checks/tui-plugin-config.ts`
  - `detectTuiPluginRegistration()` `tui.json` içindeki `plugin` array’ini okuyor.
  - Kabul edilen entry:
    - `oh-my-openagent/tui`
    - `oh-my-opencode/tui`
    - bunların version suffix’li halleri
    - ya da accepted package name’e işaret eden `file:` plugin entry

### Roles/Models sidebar kodu nerede?
- Bu fork içinde gerçek UI kodunu bulamadım: `UNKNOWN`
- Bu feature yalnızca doctor uyarı açıklamasında referanslanıyor:
  - `src/cli/doctor/checks/tui-plugin-config.ts:135-140`

### TUI komutları nerede?
- Lokal TUI-only command implementasyonu kanıtlayamadım: `UNKNOWN`

---

## 11) Doctor / installer

### `doctor` komutu nerede?
- `src/cli/doctor/index.ts`
- CLI wiring:
  - `src/cli/cli-program.ts`

### `“TUI plugin entry missing from tui.json”` uyarısı hangi dosyada?
- `src/cli/doctor/checks/tui-plugin-config.ts:133`

### `“Comment checker unavailable”` uyarısı hangi dosyada?
- `src/cli/doctor/checks/tools.ts:50`

### Installer hangi dosyaları yazıyor?
- Kanıtlayabildiğim dosyalar:
  - OpenCode server plugin config:
    - `src/cli/config-manager/add-plugin-to-opencode-config.ts`
    - `opencode.json` veya `opencode.jsonc`
  - Plugin’in kendi config dosyası:
    - `src/cli/config-manager/write-omo-config.ts`
    - `oh-my-openagent.json` / `oh-my-openagent.jsonc` canonical path
- `tui.json` için lokal yazıcı bulamadım: `UNKNOWN`

### `opencode.json` ve `tui.json` nasıl güncelleniyor?
- `opencode.json`:
  - `src/cli/config-manager/add-plugin-to-opencode-config.ts`
  - `addPluginToOpenCodeConfig()` parse -> backup -> merge -> write yapıyor.
- `tui.json`:
  - Doctor kontrolü var (`src/cli/doctor/checks/tui-plugin-config.ts`) fakat bu taramada installer tarafında `tui.json` yazan fonksiyon bulamadım: `UNKNOWN`

---

## 12) Güvenli değişiklik haritası

| Değiştirmek istediğimiz davranış | Şu anki dosya/fonksiyon | Nereden değiştirmeliyiz | Risk | Test |
|---|---|---|---|---|
| Custom agent discovery güçlendirme | `src/plugin-handlers/agent-config-handler.ts` / `applyAgentConfig()`; `src/features/claude-code-agent-loader/loader.ts` | Önce loader katmanı, sonra merge sırası `applyAgentConfig()` | Medium | loader testleri + `agent-config-handler.test.ts` |
| Exact custom-agent-first routing zorlama | `src/tools/delegate-task/subagent-resolver.ts` / `resolveSubagentExecution()` | Subagent match sırası ve fallback davranışı burada değiştirilmeli | Medium | `subagent-resolver.test.ts` |
| Category routing’i sınırlandırma | `src/tools/delegate-task/category-resolver.ts` / `resolveCategoryExecution()` | Category -> sisyphus-junior route mantığı burada | Medium | `category-resolver.test.ts` |
| `default_mode` davranışını düzenleme | `src/plugin/system-transform.ts`; `src/plugin/chat-message.ts` | Ultrawork ve auto-ralph ayrık dosyalarda | Low | `default-mode-priority.test.ts` + chat-message testleri |
| runtime fallback davranışını düzenleme | `src/hooks/runtime-fallback/hook.ts`; `auto-retry.ts`; `fallback-retry-dispatcher.ts` | Hook çekirdeği burada | Medium | runtime-fallback test klasörü |
| background concurrency ayarını düzenleme | `src/features/background-agent/concurrency.ts` | Doğrudan `getConcurrencyLimit()` | Low | `concurrency.test.ts` |
| doctor uyarılarını iyileştirme | `src/cli/doctor/checks/*.ts` | İlgili check dosyası | Low | ilgili `*.test.ts` |
| TUI Roles/Models görünümünü iyileştirme | `UNKNOWN` | Lokal TUI render kodu bulunamadı | High | UNKNOWN |
| skill scoping iyileştirme | `src/features/opencode-skill-loader/loaded-skill-from-path.ts`; `src/tools/delegate-task/tools.ts` | Önce metadata parse, sonra delegate enforcement | Medium | skill loader testleri + delegate-task testleri |
| routing coverage çıktısını iyileştirme | `src/agents/sisyphus.ts` veya prompt builder zinciri; ayrıca `src/tools/delegate-task/prompt-builder.ts` | Çıktı formatını üreten prompt katmanı | Medium | prompt snapshot / agent config testleri |

---

## 13) Dokunulmayacak yerler

- Package name
  - `package.json:name` = `oh-my-opencode`
- Binary names
  - `package.json:bin`
  - `oh-my-opencode`
  - `oh-my-openagent`
- Plugin IDs
  - `src/testing/create-plugin-module.ts:183` -> `id: "oh-my-openagent"`
- TUI plugin ID
  - doctor beklentisi: `oh-my-openagent/tui` ve legacy `oh-my-opencode/tui`
  - `src/cli/doctor/checks/tui-plugin-config.ts:64-72`
- Schema path
  - `package.json:exports["./schema.json"]`
  - `src/cli/model-fallback.ts:26` -> schema URL
- Config file name
  - `src/shared/plugin-identity.ts:5-6`
  - `CONFIG_BASENAME = "oh-my-openagent"`
  - `LEGACY_CONFIG_BASENAME = "oh-my-opencode"`
- Installer registration names
  - `src/shared/plugin-identity.ts:1-4`
  - `PLUGIN_NAME`, `LEGACY_PLUGIN_NAME`, `ACCEPTED_PACKAGE_NAMES`
- OpenCode plugin registration surfaces
  - `package.json` `main` / `exports`
  - `src/testing/create-plugin-module.ts`
  - `src/cli/config-manager/add-plugin-to-opencode-config.ts`

---

## 14) İlk önerilen işlev değişikliği

### Öneri
`src/cli/doctor/checks/tui-plugin-config.ts` içindeki TUI uyarısını, lokal installer akışıyla uyumlu hale getirmek.

### Hangi dosyada?
- `src/cli/doctor/checks/tui-plugin-config.ts`

### Hangi fonksiyonda?
- `checkTuiPluginConfig()`

### Şu anki davranış ne?
- `server.registered && !tui.registered` durumunda doctor şu fix’i öneriyor:
  - `Re-run the installer (...) to auto-write tui.json`
- Fakat bu incelemede `src/cli/tui-installer.ts` ve `src/cli/config-manager/*` içinde `tui.json` yazan lokal fonksiyon bulamadım.

### İstenen davranış ne?
- Fix mesajı daha temkinli olmalı:
  - Installer önerisini koşullu / softer yapmalı
  - doğrudan manuel `tui.json` düzenleme yolunu birincil öneri yapmalı
  - veya gerçekten varsa ayrı bir `tui.json` writer bağlanmalı

### Nasıl test edilir?
- `src/cli/doctor/checks/tui-plugin-config.test.ts`
  - `server registered, tui missing` senaryosunda yeni message/fix text assert edilmeli.

### Nasıl geri alınır?
- Sadece `checkTuiPluginConfig()` içindeki issue description/fix metnini eski haline döndürmek yeterli.

---

## Ek kısa notlar

- Bu forkta `disabled_categories`, `memory_bank`, `google_auth` için top-level config kanıtı bulamadım.
- `telemetry` config alanı da görünmüyor; telemetry davranışı daha çok env/CLI katmanında.
- Gerçek TUI rendering kodu bu lokal repo taramasında görünmüyor; şu an sadece TUI registration ve doctor check kanıtlanabiliyor.
- `AGENTS.md` runtime’da gerçekten okunuyor, ama custom agent discovery’nin parçası olarak değil; `Read` sonrasında context injection amacıyla.
