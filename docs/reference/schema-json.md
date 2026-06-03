# assets/oh-my-opencode.schema.json — JSON Schema Referansı

## Nedir?

`assets/oh-my-opencode.schema.json`, bu projenin Zod v4 konfigürasyon şemasından otomatik üretilen bir **JSON Schema (draft-07)** dosyasıdır. IDE'lerde ve metin düzenleyicilerinde **otomatik tamamlama (autocomplete)**, **doğrulama (validation)** ve **dökümantasyon ipuçları** sağlamak için kullanılır.

## Hangi Config Dosyasını Doğrular?

Schema, `.opencode/oh-my-openagent.jsonc` ve `~/.config/opencode/oh-my-openagent.jsonc` dosyalarını hedefler. Kullanıcı, config dosyasının en üstüne şu `$schema` anahtarını ekleyerek IDE desteğini aktif eder:

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/oh-my-opencode.schema.json"
}
```

Hecateq fork kullanıcıları için ayrıca şu alias mevcuttur:

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/hecateq/hecateq-openagent/main/assets/hecateq-openagent.schema.json"
}
```

İki dosya da içerik olarak aynıdır; yalnızca `$id` ve `title` alanları farklıdır.

## Nasıl Üretilir?

Schema, **Zod v4'ün `z.toJSONSchema()` API'si** ile `OhMyOpenCodeConfigSchema` nesnesinden otomatik çıkarılır. Üretim akışı şöyledir:

1. Kaynak: `src/config/schema/index.ts` (ve altındaki 30+ Zod şema dosyası)
2. Dönüşüm: `script/build-schema-document.ts` → `createOhMyOpenCodeJsonSchema()`
3. Çıktı: `script/build-schema.ts` → `assets/oh-my-opencode.schema.json` + `dist/oh-my-opencode.schema.json`
4. Hecateq alias: aynı script `assets/hecateq-openagent.schema.json` + `dist/hecateq-openagent.schema.json` da üretir

**Yeniden üretmek için:**

```bash
bun run build:schema
```

Bu komut `bun run script/build-schema.ts` çalıştırır. `bun run build` komutu da otomatik olarak `build:schema` adımını içerir.

## Önemli Üst Düzey Konfigürasyon Alanları

Schema, 43 üst düzey özellik tanımlar. İşte en kritik olanları:

| Alan | Tür | Açıklama |
|------|-----|----------|
| `hecateq` | `object` | Hecateq orkestrasyon motoru yapılandırması (context injection, memory, agent index, git checkpoint, dependency graph, orchestration, auto-spawn, delegation chain) |
| `agents` | `object` | Her bir agent için model, prompt, sıcaklık, yetki, fallback zinciri gibi geçersiz kılmalar |
| `categories` | `object` | Task delegasyon kategorileri ve model gereksinimleri |
| `team_mode` | `object` | Paralel multi-agent koordinasyonu (11 alan: max_parallel_members, max_messages_per_run, vb.) |
| `experimental` | `object` | Deneysel özellik bayrakları |
| `disabled_*` | `string[]` | Devre dışı bırakılacak agent, tool, hook, MCP, kategori, skill, komut ve provider listeleri |
| `model_fallback` | `boolean` | Proaktif model düşüş zinciri (per-agent) |
| `runtime_fallback` | `boolean \| object` | Reaktif provider düşüşü (hata kodu bazlı) |
| `keyword_detector` | `object` | IntentGate anahtar kelime algılama yapılandırması |
| `auto_update` | `boolean` | Otomatik güncelleme denetimi |
| `hashline_edit` | `boolean` | LINE#ID içerik-hash kontrollü düzenleme aracı |
| `mcp_env_allowlist` | `string[]` | `.mcp.json` içinde izin verilen ortam değişkenleri (yalnızca kullanıcı config'inde) |
| `agents`, `claude_code`, `skills`, `ralph_loop`, `openclaw`, `tmux`, `websearch`, `babysitting`, `git_master`, `start_work`, `default_mode`, `sisyphus`, `sisyphus_agent`, `comment_checker`, `notification`, `i18n`, `browser_automation_engine`, `background_task`, `model_capabilities` | `object` | Diğer özellik modülleri |

## Geliştiriciler İçin Uyarılar / Önemli Notlar

1. **Schema elle düzenlenmez.** `assets/oh-my-opencode.schema.json` tamamen otomatik üretilir. Değişiklik yapmanız gerekiyorsa, kaynak Zod şemasını (`src/config/schema/`) düzenleyip `bun run build:schema` çalıştırın.

2. **Config anahtarları `snake_case`** kullanır. Schema dosyasında yeni bir alan eklerken tutarlılık için Zod şemasında da `snake_case` kullandığınızdan emin olun.

3. **İki çıktı dosyası vardır:**
   - `assets/oh-my-opencode.schema.json` — upstream `$id` ile
   - `assets/hecateq-openagent.schema.json` — Hecateq fork `$id` ile
   - Her ikisi de `dist/` altına da kopyalanır
   - Her iki dosyayı da güncellemek için `bun run build:schema` tek komut yeterlidir

4. **Hecateq alias** (`hecateq-openagent.schema.json`) otomatik olarak upstream schema'nın `$id`, `title` ve `description` alanlarını değiştirerek üretilir. Ayrı bir Zod şeması yoktur.

5. **Zod v4 `z.toJSONSchema()`** tüm Zod tiplerini JSON Schema'ya çeviremeyebilir. `unrepresentable: "any"` parametresi, dönüştürülemeyen tiplerin `{}` (any) olarak geçmesini sağlar. Bu durumda schema autocomplete çalışır ancak o alan için tam doğrulama yapılamaz.

6. **CI'da otomatik güncellenir.** [`ci.yml`](/.github/workflows/ci.yml) workflow'u `master` branch'ine push sırasında schema değişikliklerini otomatik commit eder.

7. **Schema dosyası npm paketine dahildir.** `package.json` içindeki `"files"` dizisi `assets/` klasörünü içerir, böylece yayınlanan pakette schema dosyası da bulunur.
