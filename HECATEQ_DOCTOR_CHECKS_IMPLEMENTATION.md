HECATEQ_DOCTOR_CHECKS_IMPLEMENTATION

## Scope

Doctor-only diagnostic improvements for the Hecateq fork.

Included:
- new Hecateq workflow doctor check
- registration diagnostics
- project-root memory diagnostics
- custom agent discovery and sanity diagnostics
- duplicate custom agent name diagnostics
- secret and webhook safety diagnostics with masking
- Hecateq config health diagnostics
- disabled safety hook diagnostics

Excluded by design:
- runtime behavior changes
- Hecateq prompt changes
- routing/category/subagent validation changes
- TUI rendering changes
- installer changes
- package name, binary name, plugin ID, TUI plugin ID, schema path, config file name, installer registration changes

## What Changed

- Added a new doctor check category: `Hecateq Workflow`.
- Registered it in the doctor check registry.
- Implemented a new check file at `src/cli/doctor/checks/hecateq-workflow.ts`.
- Added focused test coverage at `src/cli/doctor/checks/hecateq-workflow.test.ts`.

## Doctor Checks Added

The new `Hecateq Workflow` doctor check aggregates these diagnostics:

1. Hecateq registration check
2. Project-root memory check
3. Custom agent discovery check
4. Duplicate custom agent name check
5. Custom agent frontmatter sanity check
6. Secret and webhook exposure check
7. Hecateq config health check
8. Dangerous disabled hook check

## Hecateq Registration Check

Checks whether `hecateq-orchestrator` is present in:

- builtin agent schema
- overridable agent schema
- display name registry
- default agent ordering
- migration alias map
- agent model requirements

Severity behavior:

- missing core registration such as schema or model requirements -> `error`
- missing display/order/migration support -> `warning`

## Project-Root Memory Check

Checks for:

- `.opencode/memory/knowledge/context/`
- `active-context.md`
- `progress.md`
- `tasks.md`
- `file-map.md`
- `decisions.md`

Severity behavior:

- missing memory root -> `warning`
- partial memory files -> `warning`
- complete memory set -> no issue

This is intentionally not an error because new projects may not have initialized memory yet.

## Custom Agent Discovery Check

Scans these paths:

- OpenCode global agents: `getOpenCodeConfigDirs({ binary: "opencode" })/agents`
- OpenCode project agents: `<project>/.opencode/agents`
- Claude global agents: `getClaudeConfigDir()/agents`
- Claude project agents: `<project>/.claude/agents`

Behavior:

- if no `.md` custom agent files are found anywhere -> `warning`
- includes scanned paths in doctor details/output

## Duplicate Agent Name Check

Custom agent markdown files are parsed and normalized to an effective agent name:

- frontmatter `name` if present
- otherwise filename-derived name

If the same effective name appears in multiple sources, doctor emits a warning that lists every conflicting file path.

This is reported as a routing clarity issue affecting exact subagent routing and Hecateq registry clarity.

## Agent Frontmatter Check

Custom agent markdown files receive low-risk sanity checks for:

- malformed frontmatter
- missing `name`
- missing `description`
- empty body
- unsupported obvious frontmatter fields

This is intentionally a light sanity check, not a full custom schema validator.

## Secret And Webhook Safety Check

Doctor scans parseable JSON/JSONC config files in these places:

- user plugin config:
  - `~/.config/opencode/oh-my-openagent.json[c]` or `OPENCODE_CONFIG_DIR` equivalent
  - legacy `oh-my-opencode.json[c]`
- project config candidates:
  - `<project>/opencode.json`
  - `<project>/opencode.jsonc`
  - `<project>/.opencode/*.json`
  - `<project>/.opencode/*.jsonc`

Patterns checked include key names and value signatures such as:

- `discord_webhook_url`
- `webhook`
- `apiKey`
- `api_key`
- `token`
- `secret`
- `Bearer ...`
- `sk-...`
- `ghp_...`
- `github_pat_...`

Secret values are masked before reporting.
Raw values are never printed.

## Hecateq Config Health Check

Doctor inspects plugin config candidates for Hecateq-specific state.

Behavior:

- if there is no explicit `agents.hecateq-orchestrator` override, doctor adds a detail line that built-in defaults will be used
- if `disabled_agents` contains `hecateq-orchestrator`, doctor emits a `warning`
- if an explicit Hecateq override exists but has invalid structure, doctor emits a `warning`

This is diagnostic only.
No runtime config merge behavior was changed.

## Safety Hook Check

Doctor warns when these hooks are disabled via plugin config:

- `stop-continuation-guard`
- `unstable-agent-babysitter`
- `notepad-write-guard`
- `plan-format-validator`
- `comment-checker`

This is a warning, not an error, because disabling a hook may be intentional.

## Files Changed

- `src/cli/doctor/constants.ts`
- `src/cli/doctor/checks/index.ts`
- `src/cli/doctor/checks/hecateq-workflow.ts`
- `src/cli/doctor/checks/hecateq-workflow.test.ts`
- `HECATEQ_DOCTOR_CHECKS_IMPLEMENTATION.md`

## Tests Added / Updated

Added:

- `src/cli/doctor/checks/hecateq-workflow.test.ts`

Coverage includes:

- missing project-root memory -> warning
- partial project-root memory -> missing file list
- complete project-root memory -> no issue
- no custom agents discovered -> warning
- duplicate custom agent names -> warning
- missing description frontmatter -> warning
- secret masking and discord webhook detection
- `hecateq-orchestrator` disabled -> warning
- disabled safety hooks -> warning
- consolidated check returns valid `CheckResult`

## Tests Run

Executed successfully:

1. `bun test src/cli/doctor`
   - 100 pass
   - 0 fail
2. `bun test src/cli/doctor/checks`
   - 79 pass
   - 0 fail
3. `bun test src/agents/builtin-agents/hecateq-orchestrator-agent.test.ts src/agents/utils.test.ts`
   - 79 pass
   - 0 fail

## Behavior Before

- doctor had no Hecateq-specific workflow check
- doctor did not inspect Hecateq registration completeness
- doctor did not inspect project-root memory readiness
- doctor did not inspect custom agent discovery quality for Hecateq routing
- doctor did not scan plugin/project config for masked Hecateq-relevant secret exposure warnings
- doctor did not warn about Hecateq disablement or disabled safety hooks in a Hecateq workflow context

## Behavior After

- doctor now includes a dedicated `Hecateq Workflow` check
- Hecateq registration health is validated
- project-root memory readiness is validated
- custom agent availability and naming clarity are validated
- frontmatter sanity problems are surfaced as warnings
- suspicious secrets and webhooks are surfaced with masked values
- Hecateq disablement is surfaced as a warning
- disabled safety hooks are surfaced as warnings

## Risks

- secret detection is heuristic and may produce false positives
- custom agent frontmatter sanity is intentionally lightweight and may warn on metadata conventions outside the supported field set
- this is doctor-only behavior; it does not enforce runtime policy
- no runtime routing or agent behavior was changed

## Rollback

To roll back this phase, revert:

- `src/cli/doctor/constants.ts`
- `src/cli/doctor/checks/index.ts`
- `src/cli/doctor/checks/hecateq-workflow.ts`
- `src/cli/doctor/checks/hecateq-workflow.test.ts`
- `HECATEQ_DOCTOR_CHECKS_IMPLEMENTATION.md`

## Direct Answers

### Hangi doctor checks eklendi?

Tek yeni üst check eklendi: `Hecateq Workflow`.
Bu check içinde registration, memory, custom agents, duplicate names, frontmatter sanity, secret/webhook safety, Hecateq config health ve disabled safety hooks alt kontrolleri var.

### Secret değerleri maskeleniyor mu?

Evet. Doctor raw secret değeri yazdırmıyor. Maskelenmiş değer gösteriyor.

### Project-root memory kontrolü warning mi error mu?

Warning.

### Custom agent folder kontrolü hangi pathleri inceliyor?

- OpenCode global config dir(ler)i altındaki `agents/`
- `<project>/.opencode/agents`
- `getClaudeConfigDir()/agents`
- `<project>/.claude/agents`

### Duplicate agent name nasıl raporlanıyor?

Warning olarak raporlanıyor ve aynı effective agent name için çakışan tüm dosya pathleri listeleniyor.

### Hecateq disabled ise ne oluyor?

Doctor `Hecateq Orchestrator is disabled` warning’i üretiyor ve `disabled_agents` içinden kaldırmayı öneriyor.

### Safety hook kapalıysa ne oluyor?

Doctor ilgili hook için warning üretiyor ve hangi config dosyasında disabled olduğunu gösteriyor.

### Existing TUI/comment-checker doctor checkleri bozuldu mu?

Hayır. Mevcut TUI plugin check ve tools/comment-checker doctor kapsamı korunuyor. Yeni check bunların üstüne eklenmiş ayrı bir workflow check’i.

### Hangi testler çalıştı?

- `bun test src/cli/doctor`
- `bun test src/cli/doctor/checks`
- `bun test src/agents/builtin-agents/hecateq-orchestrator-agent.test.ts src/agents/utils.test.ts`
