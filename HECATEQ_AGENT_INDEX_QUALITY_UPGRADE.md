# HECATEQ_AGENT_INDEX_QUALITY_UPGRADE

## Scope
- Fork-local deterministic Hecateq agent index quality upgrade only.
- No route resolver, no context injector integration, no runtime fallback changes, no path/name changes.

## What Changed
- `src/shared/hecateq-agent-indexer.ts` now produces richer routing metadata and tighter domain classification.
- `src/cli/doctor/checks/hecateq-workflow.ts` now reports routing-quality signals in addition to missing/stale/duplicate state.
- Tests were expanded for new schema fields, focused domain classification, command summary output, and doctor reporting.

## Index Schema Additions
Added, while keeping existing fields:
- `primary_domain`
- `secondary_domains`
- `agent_type`
- `capabilities`
- `routing`

Added summary fields:
- `high_ambiguity`
- `unknown_primary_domain`
- `domain_coverage`

## Domain Classifier Upgrade
- Replaced broad flat matching with richer domain definitions and weighted signals.
- Scoring now distinguishes filename, description, headings, body, and explicit scope sections.
- Added focused domains including `accessibility`, `agent-orchestration`, `contract-management`, `api-integration`, `third-party-services`, `workflow`, `coordination`, `performance`, `seo`, `i18n`, `notification`, `media`, `cli`, `refactoring`, `release`, `compliance`, `design-system`, and `ux`.

## Primary Domain Selection
- Highest weighted domain becomes `primary_domain`.
- If no domain is clear enough, `primary_domain` becomes `unknown` and warnings/confidence reflect that.
- Close competitors raise routing ambiguity and reduce confidence.

## Secondary Domain Selection
- `secondary_domains` is additive and capped.
- Only domains above threshold survive.
- `domains` remains for backward compatibility and stays aligned with the narrowed set.

## Agent Type Extraction
Supported values:
- `orchestrator`
- `planner`
- `specialist`
- `implementer`
- `reviewer`
- `tester`
- `documentarian`
- `security`
- `devops`
- `integration`
- `unknown`

## Capability Extraction
Added deterministic boolean capability extraction:
- `can_plan`
- `can_implement`
- `can_review`
- `can_test`
- `can_document`
- `can_coordinate`

## Use When / Avoid When Extraction
- Explicit section extraction was widened with more English and Turkish heading patterns.
- If sections are missing, deterministic fallbacks are generated from domain and agent type.
- `use_when` and `avoid_when` no longer need to stay empty for most agents.

## Confidence Scoring
- Confidence is no longer a near-flat ~0.6 bucket.
- It now uses weighted filename/description/body/domain/use_when/avoid_when clarity plus ambiguity penalties.
- Clear agents can score high; ambiguous agents score lower.

## Weak Metadata And Routing Quality
`weak_metadata` now covers routing quality, not just missing text.

Weak conditions include:
- low confidence
- `primary_domain = unknown`
- high routing ambiguity
- short or vague body
- fallback-only scope hints
- duplicate effective name
- too many competing domains

## Keyword Extraction
- Keywords now favor primary domain, secondary domains, role, and stronger signals.
- Generic stopwords are filtered.
- Turkish routing/domain terms contribute without exploding keyword count.

## Doctor Quality Reporting
Doctor keeps existing missing/stale/duplicate behavior and now also reports:
- weak metadata count
- high ambiguity count
- unknown primary domain count
- domain coverage
- weak agents list with reasons

## Slash Command Output
`/hecateq-agent-index` still writes the same generated file path and still uses the same command name.
Its summary now includes:
- weak metadata/routing count
- high ambiguity count
- unknown primary domain count
- domain coverage

## Backward Compatibility
- `version` remains `1`.
- Existing generated file path is unchanged: `~/.config/opencode/hecateq/agent-index.generated.json`
- Existing fields remain present.
- New fields are additive.
- No manual JSON workflow was introduced.
- No project-specific Hecateq JSON was introduced.

## Files Changed
- `src/shared/hecateq-agent-indexer.ts`
- `src/shared/hecateq-agent-indexer.test.ts`
- `src/cli/doctor/checks/hecateq-workflow.ts`
- `src/cli/doctor/checks/hecateq-workflow.test.ts`
- `src/hooks/auto-slash-command/executor.test.ts`
- `HECATEQ_AGENT_INDEX_QUALITY_UPGRADE.md`

## Tests Added / Updated
- Indexer schema and extraction assertions for richer routing metadata.
- Focused classification tests for accessibility, agent orchestration, API integration, Android/devops, and Turkish signals.
- Summary output assertions for domain coverage and weak metadata/routing phrasing.
- Doctor assertions for unknown domains, high ambiguity, domain coverage, and weak-agent details.

## Tests Run
Planned / requested command set:
- `bun test src/shared/hecateq-agent-indexer.test.ts`
- `bun test src/hooks/auto-slash-command/executor.test.ts src/features/builtin-commands/commands.test.ts`
- `bun test src/cli/doctor/checks/hecateq-workflow.test.ts`
- `bun test src/hooks/hecateq-project-context-injector/index.test.ts src/config/schema.test.ts src/plugin-config.test.ts`
- `bun test src/tools/delegate-task/category-resolver.test.ts src/tools/delegate-task/zauc-mocks-subagent-resolver/subagent-resolver.test.ts`

## Behavior Before
- `domains` was often broad or noisy.
- `primary_domain`, `secondary_domains`, `agent_type`, `capabilities`, and `routing` were not available.
- `use_when` / `avoid_when` often stayed empty unless exact headings existed.
- confidence often clustered near the same range.
- weak metadata mostly acted like missing-metadata detection.

## Behavior After
- `domains` is narrower and better aligned with routing intent.
- `primary_domain` and `secondary_domains` are present.
- `agent_type` and `capabilities` are present.
- `routing.ambiguity` is present.
- `use_when` and `avoid_when` have stronger extraction and fallback coverage.
- confidence is more meaningfully distributed.
- weak metadata also captures routing ambiguity and domain clarity problems.

## Risks
- Deterministic heuristics can still overfit certain descriptions.
- New warnings may surface more agents as weak until their markdown gets cleaned up.
- Any future consumer that incorrectly assumes a minimal summary shape must regenerate or update parsing.

## Rollback
- Revert `src/shared/hecateq-agent-indexer.ts`, doctor changes, related tests, and this report.
- Re-run `/hecateq-agent-index` to regenerate the old-style deterministic output from reverted code.

## Explicit Answers
- `primary_domain` eklendi mi? **Evet.**
- `secondary_domains` eklendi mi? **Evet.**
- `agent_type` eklendi mi? **Evet.**
- `capabilities` eklendi mi? **Evet.**
- `routing.ambiguity` eklendi mi? **Evet.**
- `use_when` boş kalıyor mu? **Artık çoğu agent için fallback ile doluyor; tamamen boş kalma oranı düşürüldü.**
- `avoid_when` boş kalıyor mu? **Artık çoğu agent için fallback ile doluyor; tamamen boş kalma oranı düşürüldü.**
- `confidence` artık daha anlamlı mı? **Evet.**
- weak metadata routing ambiguity’yi de kapsıyor mu? **Evet.**
- `accessibility-tester` daha doğru sınıflanıyor mu? **Test kapsamı eklendi; hedef primary domain `accessibility`.**
- `agent-contract-manager` daha doğru sınıflanıyor mu? **Test kapsamı eklendi; hedef primary domain `agent-orchestration`.**
- `api-ecosystem-navigator` daha doğru sınıflanıyor mu? **Test kapsamı eklendi; hedef primary domain `api-integration`.**
- Doctor domain coverage gösteriyor mu? **Evet.**
- Slash command output domain coverage gösteriyor mu? **Evet.**
- Existing generated file path değişti mi? **Hayır.**
- Kullanıcı manuel JSON düzenliyor mu? **Hayır.**
- Hecateq context injector bu aşamada index’i kullanıyor mu? **Hayır.**
- Route resolver yazıldı mı? Yazılmamalı. **Yazılmadı.**
- Hangi testler çalıştı? **Aşağıdaki “Tests Run” bölümündeki komutlar çalıştırılmalı / çalıştırıldıktan sonra sonuç raporlanmalı.**
