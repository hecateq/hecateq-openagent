# PLUGIN_NEXT_STEPS_ROADMAP

## Philosophy

This fork should optimize for reducing ambiguity between prompt policy and runtime truth. The strongest next steps are the ones that make routing, memory injection, and safety behavior easier to verify from code rather than from convention.

## What Not To Build Yet

- a giant new abstraction layer for every future harness
- more prompt-only routing rules without matching runtime enforcement
- more Hecateq context sources before precedence and budget rules are documented
- new artifact types beyond memory/contracts/task-graphs until current ones are stable

## Safe Next Steps

1. Document the exact runtime precedence of built-in agents, discovered custom agents, agent index, and category fallback.
2. Align AGENTS/docs counts and doctor category descriptions with live code.
3. Add explicit docs for `call_omo_agent` versus `task` so users know which one is advisory-search versus real execution.
4. Add regression tests for stale/missing Hecateq agent index behavior.
5. Add regression tests for Hecateq `disabled_categories` and exact-agent disabled handling if missing.

## Medium-Risk Next Steps

1. Consolidate Hecateq routing checks into a single reusable resolver contract.
2. Make doctor surface a clearer summary of prompt-level versus runtime-level Hecateq features.
3. Expose a compact internal doc for token budget accounting across all context injectors.
4. Move more Hecateq-neutral logic into reusable core packages in line with `ROADMAP.md`.

## High-Risk / Later

1. Make agent index part of deterministic runtime routing without a transition plan.
2. Auto-checkpoint or auto-commit more aggressively in dirty repos.
3. Expand context injection breadth without first pinning budget and precedence rules.
4. Rework all hook tiers during the multi-harness refactor before current behavior is fully documented.

## Suggested Order

1. truth-of-routing documentation
2. test hardening for Hecateq exact-agent/index behavior
3. doctor/doc alignment
4. token-budget visibility
5. core-package extraction of reusable logic

## Why

The current fork already has strong capabilities. Its main risk is not lack of power, but distributed truth: policy text, hook gates, config, index data, and executor behavior are all present, but not always described from one place. The safest roadmap is therefore to reduce ambiguity first and refactor second.

### Verification note

No tests run because this was documentation-only analysis.
