# CUSTOM_AGENT_FIRST_ROUTING_IMPLEMENTATION

## Scope

Bu değişiklik yalnızca category routing akışına düşük riskli bir `custom-agent-first` runtime talimatı ekler.

Amaç:
- `subagent_type` exact routing davranışını bozmamak
- `disabled_categories` ve `categories.<name>.disable` davranışını bozmamak
- category route açık kaldığında generic category davranışından önce exact custom agent arama zorunluluğunu prompt seviyesinde standartlaştırmak

Bu değişiklik category çağrısını otomatik olarak exact agent’a dönüştürmez.

## What Changed

### 1. Category prompt append zincirine custom-agent-first hint eklendi
- Dosya: `src/tools/delegate-task/category-resolver.ts`
- Fonksiyonlar:
  - `appendCustomAgentFirstHint(...)`
  - `resolveCategoryPromptAppendForModel(...)`

Eklenen runtime hint:

```text
Before executing through generic category behavior, inspect the available custom agents first.
If an exact specialist exists, delegate using task(subagent_type="exact-agent-name").
Use category fallback only when no exact custom agent exists.
Do not invent agent names.
If no suitable exact custom agent exists, return BLOCKED and list the closest candidate agents.
```

### 2. Mevcut category prompt zinciri korunarak birleşim yapıldı
- Eğer category için built-in context varsa korunur.
- Eğer user config `prompt_append` varsa korunur.
- Yeni hint en sona eklenir.
- Eğer `prompt_append` zaten `<custom-agent-first-routing>` bloğu içeriyorsa duplicate eklenmez.

## Preserved Behavior

### `subagent_type` exact routing bozulmadı mı?
Evet, bozulmadı.

- `src/tools/delegate-task/subagent-resolver.ts` değiştirilmedi.
- `task(subagent_type="...")` akışı aynen mevcut resolver üzerinden devam ediyor.
- Category tarafındaki yeni enforcement yalnızca `categoryPromptAppend` üretiminde yapıldı.

### `disabled_categories` davranışı bozulmadı mı?
Evet, bozulmadı.

- `src/tools/delegate-task/category-resolver.ts` içindeki mevcut disabled category red davranışı korunuyor.
- Hata mesajı aynen korunuyor:

```text
Category "<name>" is disabled by disabled_categories. Use task(subagent_type="...") with an exact custom agent instead.
```

### `categories.<name>.disable` davranışı bozulmadı mı?
Evet, bozulmadı.

- Aynı disabled hata akışı devam ediyor.

### Category `prompt_append` korunuyor mu?
Evet, korunuyor.

- User-configured `prompt_append` silinmiyor.
- Built-in category context de silinmiyor.
- Yeni hint sadece ekleniyor.
- Mevcut hint varsa duplicate üretilmiyor.

## Files Changed

- `src/tools/delegate-task/category-resolver.ts`
- `src/tools/delegate-task/category-resolver.test.ts`
- `CUSTOM_AGENT_FIRST_ROUTING_IMPLEMENTATION.md`

## Tests Added / Updated

### `src/tools/delegate-task/category-resolver.test.ts`
Yeni testler:
- category açıkken `custom-agent-first` hint ekleniyor mu?
- mevcut `prompt_append` korunuyor mu?
- mevcut `custom-agent-first` bloğu duplicate olmuyor mu?

## Tests Run

```bash
bun test src/tools/delegate-task/category-resolver.test.ts src/tools/delegate-task/coordinator-subagent-guard.test.ts
```

Result:

```text
26 pass
0 fail
```

```bash
bun test src/plugin-config.test.ts src/tools/delegate-task/category-resolver.test.ts
```

Result:

```text
63 pass
0 fail
```

## Behavior Before

- Category route açık olduğunda category-specific prompt context çalışıyordu.
- Fakat runtime seviyesinde standart bir `custom-agent-first` zorlaması yoktu.
- Exact custom agent delegation vurgusu yalnızca category config içindeki mevcut `prompt_append` metinlerine bırakılmış olabiliyordu.

## Behavior After

- Category kapalıysa aynı disabled error dönüyor.
- Category açıksa route yine çalışabiliyor.
- Ama category agent prompt’una runtime’dan standart bir `custom-agent-first` instruction ekleniyor.
- Böylece category route generic fallback davranışı olmadan önce mevcut exact custom agent’ları değerlendirmek zorunda kalıyor.

## Risks

- Bu enforcement prompt-level olduğu için semantic bir yönlendirme sağlar, hard runtime remap yapmaz.
- Bazı category’lerde built-in context uzun olduğu için ek instruction prompt boyutunu küçük miktarda artırır.
- Eğer ileride exact agent discovery/selection hard-enforced istenirse ayrı bir intent-matching katmanı gerekir.

## Rollback

Geri almak için yeterli dosyalar:

- `src/tools/delegate-task/category-resolver.ts`
- `src/tools/delegate-task/category-resolver.test.ts`
- `CUSTOM_AGENT_FIRST_ROUTING_IMPLEMENTATION.md`

Özellikle kaldırılacak nokta:
- `appendCustomAgentFirstHint(...)`
- `resolveCategoryPromptAppendForModel(...)` içindeki hint birleştirme çağrıları

## Implementation Note

Custom-agent-first hint şu dosyada ve şu fonksiyonda ekleniyor:

- Dosya: `src/tools/delegate-task/category-resolver.ts`
- Fonksiyon: `resolveCategoryPromptAppendForModel(...)`

Bu nokta düşük riskli seçildi çünkü:
- `categoryPromptAppend` zaten `buildSystemContent()` içine akıyor
- `subagent_type` resolver’a dokunmuyor
- disabled category kontrolüyle çakışmıyor
- mevcut `prompt_append` semantiğini bozmuyor
