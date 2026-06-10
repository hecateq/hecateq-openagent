# Qwen Compatibility Implementation Report

## Summary
Qwen model compatibility has been implemented for Hecateq OpenAgent. Layer 1 (mandatory) tasks are complete. Tool-calling normalizer is documented as integration-blocked.

## Files Changed

| File | Change |
|------|--------|
| `src/generated/model-capabilities.generated.json` | Added `qwen3.7-plus` and `qwen3.7-max` capability entries (1M context, reasoning, toolCall) |
| `packages/model-core/src/provider-model-id-transform.ts` | Changed `qwen` prefix mapping from `dashscope` to `opencode-go` |
| `packages/model-core/src/provider-model-id-transform.test.ts` | Added tests for Qwen provider inference |
| `packages/model-core/src/model-requirements.ts` | Added Qwen entries to 5 agent fallback chains |
| `packages/model-core/src/model-requirements.test.ts` | Added tests for new chain entries, fixed pre-existing agent count bug (11→12) |

## Implemented Changes

### Model Family Detection
**Status:** Already implemented (committed in `1a09d008`)

The `HEURISTIC_MODEL_FAMILY_REGISTRY` in `model-capability-heuristics.ts` already contains a Qwen entry:
- Family: `qwen`
- Includes: `["qwen", "qwq"]`
- Variants: `["low", "medium", "high"]`
- Reasoning efforts: `["low", "medium", "high"]`
- Supports thinking: `true`

Test file `model-capability-heuristics.test.ts` (145 lines, 8 tests) was already committed.

### Provider Model ID Transform
**Status:** Implemented

Changed `inferSubProvider()` in `provider-model-id-transform.ts`:
- Before: `startsWith("qwen-")` → `"dashscope"`
- After: `startsWith("qwen")` → `"opencode-go"`

The prefix was changed from `"qwen-"` to `"qwen"` to match all Qwen model ID variants including `qwen3.5-plus` (no hyphen after "qwen").

### Runtime Fallback Chains
**Status:** Implemented

Added Qwen 3.7 models to 5 agent fallback chains:

| Agent | Model | Position | Variant |
|-------|-------|----------|---------|
| hecateq-orchestrator | qwen3.7-plus | #3 (after claude-sonnet-4-6, before kimi-k2.6) | - |
| sisyphus | qwen3.7-max | #5 (after kimi-k2.5, before gpt-5.5) | high |
| oracle | qwen3.7-max | #4 (after claude-opus-4-7, before glm-5.1) | high |
| metis | qwen3.7-max | #4 (after gpt-5.5, before glm-5.1) | high |
| momus | qwen3.7-max | #4 (after gemini-3.1-pro, before glm-5.1) | high |

**Preserved:** Librarian and Explore `qwen3.5-plus` entries unchanged.

### Tool Calling Normalization
**Status:** Integration Blocked

The raw LLM response parsing (tool_calls extraction, finish_reason handling, function.arguments JSON parsing) happens inside the OpenCode host SDK, not in the plugin. The plugin receives already-parsed `Message`/`Part` objects through the hook system.

**Evidence:**
- Zero matches for `tool_calls`, `finish_reason`, or `function.arguments` in `src/` and `packages/` directories
- Plugin hooks operate on typed `Message` objects, not raw JSON
- The `json-error-recovery` hook detects JSON errors in tool OUTPUT, not tool call arguments from LLM responses

**Upstream integration point:** The Qwen-specific tool-call format normalization would need to be added in the OpenCode host SDK's provider adapter layer, not in this plugin.

### Capability Data
**Status:** Implemented

Added two new model capability entries to `src/generated/model-capabilities.generated.json`:

| Model | Family | Context | Input Modalities | Reasoning | ToolCall |
|-------|--------|---------|-----------------|-----------|----------|
| qwen3.7-plus | qwen | 1048576 (1M) | text, image, video | true | true |
| qwen3.7-max | qwen | 1048576 (1M) | text | true | true |

## Tests Added or Updated

| Test File | Tests Added | Purpose |
|-----------|-------------|---------|
| `provider-model-id-transform.test.ts` | +3 assertions | Verify `qwen-*` → `opencode-go` mapping |
| `model-requirements.test.ts` | +6 assertions | Verify Qwen entries in 5 agent chains |
| `model-requirements.test.ts` | Bug fix | Pre-existing agent count 11→12 |

## Test Results

### Baseline (pre-change)
- Total: 265 tests
- Passed: 264
- Failed: 1 (pre-existing: agent count 11 vs 12)

### Post-change
- Total: 267 tests (+2 added)
- Passed: 267
- Failed: 0
- Pre-existing failure: FIXED (agent count corrected)

### Typecheck
- Status: PASS
- Errors: 0

### Hecateq Orchestrator Tests
- prompt-profile.test.ts: PASS (Qwen detection works)
- prompt-pack.test.ts: PASS (Qwen adapter injection works)

## Deferred (Layer 2 items not implemented)

| Item | Reason |
|------|--------|
| Error Classifier (Qwen/DashScope errors) | Time constraint; existing generic error patterns (429, 503, rate limit) already handle Qwen errors |
| Prompt Adapter Strengthening | Existing Qwen adapter (lines 39-49 in prompt-adapters.ts) is functional; strengthening is optional enhancement |
| Reasoning/Thinking Variant | Already supported via heuristic entry (`supportsThinking: true`, `reasoningEfforts: ["low", "medium", "high"]`) |
| Token/Context Handling | Context limits now correctly set to 1M; no additional handling needed |

## Integration Blocked

| Component | Blocker | Upstream Integration Point |
|-----------|---------|---------------------------|
| Tool-calling normalizer | Raw LLM response parsing happens in OpenCode host SDK | OpenCode SDK provider adapter layer |

## Known Limits

1. **Conservative output limits:** `qwen3.7-plus` output set to 16384, `qwen3.7-max` to 32768. Actual limits may be higher.
2. **No streaming-specific handling:** Plugin does not handle streaming chunk edge cases for Qwen tool calls.
3. **Provider-specific options:** No Qwen-specific provider options (e.g., `enable_search`) are configured.

## Follow-up Recommendations

1. **Monitor Qwen tool-call behavior:** If Qwen produces malformed tool arguments, consider adding patterns to `json-error-recovery` hook.
2. **Upstream contribution:** Contribute Qwen-specific response normalization to OpenCode host SDK if edge cases emerge.
3. **Capability refresh:** Run `bun run build:model-capabilities` periodically to sync with models.dev updates.

## No-Commit Note

All changes are uncommitted. The user will review and commit manually.

Suggested commit message:
```
feat(model-core): add Qwen 3.7 model compatibility

- Add qwen3.7-plus and qwen3.7-max capability entries (1M context)
- Fix provider transform: qwen prefix → opencode-go
- Add Qwen fallbacks to Hecateq God, Sisyphus, Oracle, Metis, Momus
- Fix pre-existing agent count test bug (11→12)
- Document tool-calling normalizer as integration-blocked
```
