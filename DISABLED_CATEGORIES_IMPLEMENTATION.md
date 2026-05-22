# disabled_categories Implementation Summary

## Scope

Bu çalışma yalnızca `disabled_categories` top-level config alanını gerçek runtime davranışına bağlamak için yapıldı.

## What Changed

### 1. Config schema
- `src/config/schema/oh-my-opencode-config.ts`
- `disabled_categories: string[]` alanı schema'ya eklendi.

### 2. Config merge / partial parse
- `src/plugin-config.ts`
- `disabled_categories` diğer disabled listeler gibi:
  - partial parse sırasında korunur
  - merge sırasında duplicate olmadan union edilir

### 3. Delegate task context
- `src/tools/delegate-task/executor-types.ts`
- `src/tools/delegate-task/types.ts`
- `src/plugin/tool-registry.ts`
- `disabled_categories` değeri delegate-task resolver zincirine taşındı.

### 4. Category routing enforcement
- `src/tools/delegate-task/category-resolver.ts`
- Aşağıdaki iki durumda category routing reddedilir:
  1. `disabled_categories` içinde category varsa
  2. `categories.<name>.disable === true` ise

- Üretilen hata mesajı:

```text
Category "<name>" is disabled by disabled_categories. Use task(subagent_type="...") with an exact custom agent instead.
```

## Preserved Behavior

- `subagent_type` ile exact agent routing etkilenmedi.
- Mevcut `categories.<name>.disable` desteği bozulmadı.
- İki sistem birlikte çalışır hale getirildi:
  - top-level `disabled_categories`
  - nested `categories.<name>.disable`

## Tests Added / Updated

### `src/plugin-config.test.ts`
- `disabled_categories` merge testi eklendi
- `disabled_categories` schema compatibility testi eklendi
- `parseConfigPartially()` koruma testi eklendi

### `src/tools/delegate-task/category-resolver.test.ts`
- top-level `disabled_categories` red testi eklendi
- `categories.<name>.disable` red testi eklendi

## Test Run

```bash
bun test src/plugin-config.test.ts src/tools/delegate-task/category-resolver.test.ts
```

Result:

```text
61 pass
0 fail
```

## Files Changed

- `src/config/schema/oh-my-opencode-config.ts`
- `src/plugin-config.ts`
- `src/tools/delegate-task/executor-types.ts`
- `src/tools/delegate-task/types.ts`
- `src/plugin/tool-registry.ts`
- `src/tools/delegate-task/category-resolver.ts`
- `src/plugin-config.test.ts`
- `src/tools/delegate-task/category-resolver.test.ts`

## Notes

- Bu değişiklik package name, binary name, plugin ID, TUI plugin ID, schema path, config file name veya installer registration alanlarına dokunmaz.
- Bu değişiklik minimum kapsamda tutuldu; runtime fallback, skill scoping veya TUI tarafına genişletilmedi.
