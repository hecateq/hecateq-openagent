HECATEQ_AGENT_VISIBILITY_FIX

## Scope

Fix the visibility bug where `hecateq-orchestrator` was loaded by the plugin and callable by slash commands, but did not appear in the OpenCode Select agent picker.

Constraints preserved:
- internal id remains `hecateq-orchestrator`
- `task(subagent_type="hecateq-orchestrator")` remains valid
- no package/plugin identity changes
- no slash-command regressions
- no Hecateq config/context/doctor behavior regressions outside visibility/display/order

## Root Cause

Plugin loading was already working.
Slash commands were already working.
The built-in Hecateq agent was already being created and passed through final agent config assembly.

The actual visibility bug was that `src/agents/hecateq-orchestrator/agent.ts` exported Hecateq with:

- `mode: "subagent"`

OpenCode’s selectable agent surface only showed agents that are usable as picker-visible interactive agents. In practice, the visible set aligned with agents configured as `primary` or `all`, while subagent-only entries remained callable for delegation but did not appear in the picker.

So Hecateq existed in the plugin, but was filtered out of the UI-facing agent selection path because it was subagent-only.

## What Changed

Changed Hecateq from subagent-only to dual-use picker + delegation mode:

- `src/agents/hecateq-orchestrator/agent.ts`
  - `mode: "subagent"` → `mode: "all"`
  - description updated to `Primary custom-agent-first workflow orchestrator`

Updated display-name surfaces:

- `src/shared/agent-display-names.ts`
  - visible picker/display name changed to `Hecateq God`
  - legacy `Hecateq Orchestrator` still resolves back to the same internal id

- `src/shared/migration/agent-names.ts`
  - added `Hecateq God` alias mapping to `hecateq-orchestrator`

Updated tests to assert visibility/display behavior.

## Display Name

Visible display name is now:

- `Hecateq God`

## Internal ID Preservation

Internal id changed: **No**

Internal id remains:

- `hecateq-orchestrator`

Subagent delegation path remains:

- `task(subagent_type="hecateq-orchestrator")`

## Agent Picker / Visibility Path

Observed path:

1. built-in agent config is created in `src/agents/builtin-agents.ts`
2. Hecateq config is produced by `src/agents/builtin-agents/hecateq-orchestrator-agent.ts`
3. final agent config is assembled in `src/plugin-handlers/agent-config-handler.ts`
4. display names are remapped through `src/plugin-handlers/agent-key-remapper.ts`
5. ordering is applied via `src/plugin-handlers/agent-priority-order.ts`

Why it was invisible:

- built-in config existed
- display-name registry existed
- order registry existed
- but Hecateq’s mode was `subagent`, so it was not eligible for picker visibility

## Ordering

Ordering behavior preserved and validated.

Default core order already included Hecateq second:

- `sisyphus`
- `hecateq-orchestrator`
- `hephaestus`
- `prometheus`
- `atlas`

So after becoming picker-visible, Hecateq should appear immediately after Sisyphus.

## Disabled Agent Behavior

Disabled behavior remains intact.

If `disabled_agents` contains `hecateq-orchestrator`, the agent is still omitted from final agent creation.

## Files Changed

- `src/agents/hecateq-orchestrator/agent.ts`
- `src/shared/agent-display-names.ts`
- `src/shared/migration/agent-names.ts`
- `src/plugin-handlers/agent-config-handler.test.ts`
- `src/agents/builtin-agents/hecateq-orchestrator-agent.test.ts`
- `src/shared/agent-display-names.test.ts`
- `src/agents/utils.test.ts`

## Tests Added / Updated

Updated assertions for:

- Hecateq mode is `all`
- Hecateq description is `Primary custom-agent-first workflow orchestrator`
- Hecateq display name resolves to `Hecateq God`
- both `Hecateq God` and legacy `Hecateq Orchestrator` resolve back to `hecateq-orchestrator`
- final built-in agent config still includes Hecateq in ordered output

## Tests Run

Ran:

1. `bun test src/plugin-handlers/agent-config-handler.test.ts src/agents/builtin-agents/hecateq-orchestrator-agent.test.ts src/agents/utils.test.ts`
2. `bun test src/features/builtin-commands/commands.test.ts src/hooks/auto-slash-command/executor.test.ts`
3. `bun test src/shared/agent-display-names.test.ts src/plugin-handlers/agent-config-handler.test.ts`
4. `bun run build`

Also ran LSP diagnostics on all changed files with no diagnostics found.

## Behavior Before

- Plugin yükleniyor muydu? **Evet**
- Slash command çalışıyor muydu? **Evet**
- `hecateq-orchestrator` dist output içinde miydi? **Evet**
- Agent picker’da görünüyor muydu? **Hayır**

## Behavior After

- `hecateq-orchestrator` picker-visible mode ile üretiliyor
- picker display name `Hecateq God`
- internal id korunuyor
- ordering korunuyor; Hecateq ikinci sırada kalıyor
- slash-command behavior unchanged
- subagent task behavior preserved

## Risks

- `mode: "all"` makes Hecateq eligible in both picker and subagent contexts by design. That is the intended fix, but it slightly broadens where the agent is selectable versus the previous subagent-only behavior.
- If any hidden downstream assumption relied on Hecateq being strictly subagent-only, that assumption would now be invalid. Current tests did not show such a dependency.

## Rollback

To roll back this fix:

1. Revert `src/agents/hecateq-orchestrator/agent.ts` mode from `all` back to `subagent`
2. Revert display name changes from `Hecateq God` back to `Hecateq Orchestrator`
3. Remove the added alias mapping for `Hecateq God`
4. Revert the updated tests
5. Re-run the same test set and build

## Direct Answers

- Plugin yükleniyor muydu? **Evet**
- Slash command çalışıyor muydu? **Evet**
- Hecateq neden agent picker’da görünmüyordu? **Çünkü agent config’i `mode: "subagent"` idi; picker-visible selection path’e girmiyordu**
- Hangi dosya/list/map eksikti? **Eksik olan şey registry değil, Hecateq’in picker-eligible mode ayarıydı. Görünen ad için display-name map de yeni isme güncellendi**
- Görünen ad ne oldu? **`Hecateq God`**
- Internal id değişti mi? **Hayır**
- `task(subagent_type="hecateq-orchestrator")` bozuldu mu? **Hayır**
- Sisyphus/Hephaestus etkileniyor mu? **Hayır, mevcut davranışları korunuyor**
- `/hecateq-agent-index` bozuldu mu? **Hayır, command regression testleri geçti**
- Hangi testler çalıştı? **Yukarıdaki “Tests Run” bölümündeki 4 komut**
