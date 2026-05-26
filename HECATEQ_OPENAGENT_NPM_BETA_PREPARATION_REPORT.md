# Hecateq OpenAgent npm beta preparation report

## Özet

Bu çalışma kapsamında repository, yayın yapılmadan `@hecateq/openagent` kimliğine göre npm beta yayınına hazırlanmıştır.

- Paket adı: `@hecateq/openagent`
- Sürüm: `0.1.0-hecateq.1`
- Repository: `https://github.com/hecateq/hecateq-openagent`
- Lisans: `SUL-1.0`
- Yayın hedefi: `beta`
- Durum: hazırlandı ve doğrulandı, publish edilmedi

## Yapılan değişiklikler

### Paket ve yayın metadatası

- `package.json` Hecateq kimliğine geçirildi.
- `bin` alanına `hecateq-openagent` eklendi.
- Eski `oh-my-opencode` ve `oh-my-openagent` bin alias'ları uyumluluk için korundu.
- `files` alanı npm paket içeriği için daraltıldı.
- `publishConfig.access` alanı `public` olarak ayarlandı.

### Dokümantasyon

- `README.md` Hecateq public identity için yeniden yazıldı.
- `NOTICE.md` eklendi.
- `CONTRIBUTING.md` sade Hecateq katkı rehberi ile değiştirildi.
- `CLA.md` upstream sahibine hak devreden yapıdan çıkarılıp sade contribution notice formatına çevrildi.
- `SECURITY.md` eklendi.
- `docs/release.md` eklendi.

### Telemetry güvenliği

- Telemetry varsayılan olarak kapatıldı.
- Yeni açık opt-in değişkeni: `HECATEQ_SEND_ANONYMOUS_TELEMETRY=1`
- Legacy destek korundu:
  - `OMO_SEND_ANONYMOUS_TELEMETRY`
  - `OMO_DISABLE_POSTHOG`
- README ve ilgili docs dosyaları yeni davranışa göre güncellendi.

### Auto-update güvenliği

- Auto-update kontrolü upstream paket yerine Hecateq paketine yönlendirildi.
- `@hecateq/openagent` plugin entry kabulü eklendi.
- Upstream paketi öneren davranış kaldırıldı.

### Schema uyumluluğu

- Eski `oh-my-opencode.schema.json` korunmuştur.
- Yeni alias eklendi:
  - `assets/hecateq-openagent.schema.json`
  - `dist/hecateq-openagent.schema.json`
- Export alias eklendi:
  - `./schema.json`
  - `./hecateq-schema.json`

### Postinstall uyumluluk düzeltmesi

Scoped Hecateq paket adı ile legacy platform binary paketleri arasında bir uyumsuzluk oluştuğu görüldü.

- `postinstall.mjs` küçük ve güvenli bir bridging fix ile düzeltildi.
- Legacy `oh-my-opencode-*` platform paketleri kullanılmaya devam ediyor.
- Böylece publish öncesi gereksiz internal rename yapılmadan kurulum akışı korunmuş oldu.

## Değişen dosyalar

- `package.json`
- `README.md`
- `NOTICE.md`
- `CONTRIBUTING.md`
- `CLA.md`
- `SECURITY.md`
- `docs/release.md`
- `.github/workflows/publish.yml`
- `src/shared/posthog.ts`
- `src/shared/plugin-identity.ts`
- `src/hooks/auto-update-checker/constants.ts`
- `src/hooks/auto-update-checker/checker/plugin-entry.ts`
- `script/build-schema.ts`
- `assets/hecateq-openagent.schema.json`
- `postinstall.mjs`
- `src/cli/cli-installer.ts`
- `src/cli/tui-installer.ts`
- `docs/guide/installation.md`
- `docs/legal/privacy-policy.md`
- `docs/reference/cli.md`
- `docs/reference/configuration.md`

## Doğrulama sonuçları

### Geçen kontroller

- `bun install`: geçti
- `bun run typecheck`: geçti
- `bun run build`: geçti
- `npm pack --dry-run`: geçti

Dry-run paket sonucu doğrulandı:

- isim: `@hecateq/openagent`
- sürüm: `0.1.0-hecateq.1`

### Başarısız testler

Tam test paketi yeşil değil:

- `bun test`: başarısız

Başarısızlıklar paketleme değişiklikleriyle sınırlı değil. Repository içinde önceden de geniş kapsamlı test kırıkları bulunduğu görüldü. Örnek alanlar:

- `src/plugin-config.test.ts`
- `src/cli/model-fallback.test.ts`
- `src/config/schema.test.ts`
- dashboard testleri
- bazı `src/shared/*` testleri

Bu yüzden repo şu anda tam test-suite seviyesinde tamamen green değildir.

## Güvenlik ve içerik taraması

### Temiz çıkanlar

Şu dosya tiplerinde eşleşme bulunmadı:

- `.env*`
- `*.pem`
- `*.key`
- `*.log`

### Dikkat gerektiren bulgular

Regex taraması çok sayıda dokümantasyon ve test referansı döndürdü. Bunların çoğu gerçek secret sızıntısı değil, açıklama veya test fixture içeriği.

Öne çıkan noktalar:

- `src/shared/posthog.ts` içinde built-in PostHog API key bulunuyor
- `tests/hashline/headless.ts` içinde test amaçlı `apiKey` fallback string bulunuyor
- bazı docs ve workflow dosyaları secret kavramını metin olarak referanslıyor

Bu bulgular otomatik silinmedi.

## Bilerek korunmuş legacy / upstream uyumluluk parçaları

Riskli iç rename yapılmadı. Aşağıdakiler uyumluluk amacıyla korundu:

- `bin/oh-my-opencode.js`
- `oh-my-opencode-*` platform optional dependency isimleri
- `@oh-my-opencode/*` workspace dependency isimleri
- `oh-my-opencode.schema.json`
- çeşitli internal legacy sabitler ve compatibility yolları

## Kalan riskler

### Telemetry

- varsayılan kapalı duruma getirildi
- fakat `posthog-node` dependency olarak hâlâ mevcut
- built-in PostHog key kod içinde duruyor

### Auto-update

- artık upstream pakete bakmıyor
- ilk beta publish öncesinde update bulunmaması normal davranış olacak

### Upstream branding kalıntıları

- bazı localized README dosyaları hâlâ upstream/default telemetry metni içeriyor
- bazı kullanıcıya görünen metinlerde `oh-my-opencode` adı sürüyor
- bu alanlar bu çalışmada agresif biçimde rename edilmedi

### Test durumu

- paketleme hazırlığı tamam olsa da repository tam test-suite seviyesinde green değil

## Sonraki manuel adımlar

1. GitHub repo adını `hecateq-openagent` olarak doğrula.
2. `git remote -v` ile remote'u kontrol et.
3. Değişiklikleri commit et.
4. GitHub'a push et.
5. Uygun olduğunda beta yayın için şunu çalıştır:

```bash
npm publish --access public --tag beta
```

6. Sonrasında npm Trusted Publishing yapılandırmasını tamamla.

## Not

Bu çalışma sırasında publish yapılmadı. Sadece hazırlık, uyumluluk düzeltmesi, dokümantasyon ve doğrulama yapıldı.
