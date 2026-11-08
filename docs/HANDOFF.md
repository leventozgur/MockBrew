# Devir Raporu (Claude Code icin)

Bu belge, projeye Claude Code ile devam edecek kisinin (veya ajanin) ilk okuyacagi ozet ve baslangic noktasidir. Bir **anlik goruntudur**; otorite degildir. Ayrinti icin [Urun gereksinimleri](PRODUCT_REQUIREMENTS.md), [Roadmap](ROADMAP.md), [Mimari](ARCHITECTURE.md) ve [Gelistirme rehberi](DEVELOPMENT.md) dosyalari esas alinmalidir; bu belge onlarla celisirse onlar (ve kod) gecerlidir.

- **Rapor tarihi:** 2026-11-08
- **Rapor sirasinda yeni kod gelistirilmedi.** Yalnizca durum olculdu (lint, build, test) ve bu belge yazildi.
- **Dogrulama etiketleri:** "Bugun calistirildi" = bu raporu yazarken komut olarak calistirildi. "Kayit" = ROADMAP/DEVELOPMENT kaydina dayanir, bu oturumda tekrar edilmedi.

## 1. Proje nedir

**Mock API Studio**, Android, iOS ve Kotlin Multiplatform ekiplerinin backend hazir olmadan, yerelde (localhost) calisan, offline-first, ucretsiz bir mock API araci.

- Kotlin (Gson, Kotlinx Serialization, Moshi) ve Swift (`Codable`) modellerini **derlemeden** okuyup JSON Schema cikarir ve semaya uygun, alan adina gore anlamli, deterministik ornek JSON uretir.
- Endpoint'leri collection'larda gruplar; endpoint basina birden fazla response senaryosu (success, bos liste, 401, 500...) tutar; aktif collection'lari tek port uzerinde birlikte calistirir.
- CORS sorunu olmadan Android Emulator, iOS Simulator, WebView ve browser istemcilerine hizmet verir.
- Mock tanimlari git'e konabilen dosyalardir; ekip git ile paylasir.
- AI istege baglidir ve varsayilan kapalidir. AI olmadan tum temel islevler calisir.

**Dagitim:** Tek npm paketi `@mock-api-studio/studio`, komut `mock-studio` (CLI + yerel web UI + MCP server). Henuz npm'de yayinlanmadi.

**Is dizini:** depo koku (klasor adi `mobile-mock-api-studio`; urun adindan "mobile" kaldirildi).

## 2. Gecmis ve zaman cizelgesi

| Tarih | Olay |
|---|---|
| 2026-11-03 | Ihtiyac tanimlandi. Ucretli oldugu icin Mockoon reddedildi (kullanici). Kapsam, roadmap ve AI/Node/serialization karar noktalari konusuldu. Kotlin serialization bicimleri iki ozel uygulama reposundan dogrulandi. Planlama dokumanlari yazildi (o zaman uygulama yoktu ve plan Fastify ile sifirdan mock server idi). |
| 2026-11-04 | M0-M5 uygulandi. Mock motoru olarak Mockoon'un MIT lisansli paketleri kutuphane olarak secildi (bkz. [Bolum 4](#4-alinan-kararlar), karar 1). Urun adi "Mock API Studio" oldu. Kurulum ve kullanim README'ye eklendi. |
| 2026-11-08 | Bu devir raporu hazirlandi; durum yeniden olculdu. |

## 3. Kullanici istekleri ve karsiligi

Kullanicinin kendi sozleriyle ifade ettigi istekler ve su anki durumu. "Sapma" olanlar kullanici teyidi gerektirir ([Bolum 8](#8-kullanicidan-karar-bekleyen-konular)).

| Istek (kaynak: 2026-11-03 mesajlari) | Durum | Not |
|---|---|---|
| Kotlin/Swift modellerine uygun JSON donen localhost servisi | Karsilandi | Parser + yerel uretici. Gson, Kotlinx, Moshi, Swift Codable. Gercek ekip modelleriyle taranmadi. |
| CORS hatasi olmamasi | Karsilandi (HTTP seviyesinde) | `wildcard` ve `reflect` (credentials) modlari. Gercek WebView'de denenmedi. |
| Response'u duzenleyebilmek, endpoint'i belirleyebilmek | Karsilandi | Web UI + CLI. |
| Endpoint ve response'larla collection olusturmak, ayni anda birden fazla endpoint | Karsilandi | Collection = Mockoon kok folder; aktif collection'lar tek portta. |
| Postman gibi JSON export/import ile ortak kullanim | **Kismen / sapma** | Collection icin UI/API'de import-export yok. Paylasim, proje dosyalarinin (`*.environment.json` + `*.studio.json`) git ile veya kopyalayarak paylasilmasidir. `export openapi` var ama tek yonlu ve bir sozlesme onerisidir. Bkz. karar sorusu 3. |
| Senkron/online yapi gerekmez, tamamen offline olabilir | Karsilandi | Telemetri yok, bulut yok. |
| Mockoon ucretli, uygun degil | **Sapma (teyit gerekli)** | Urun, Mockoon'un MIT lisansli motor paketlerini bagimlilik olarak kullaniyor. Bkz. karar 1 ve karar sorusu 1. |
| Copilot CLI, Kiro CLI vb. ile oto-generate; istege bagli prompt alani; prompt yoksa modele uygun uretim | Kismen | UI'da opsiyonel prompt alani var (`ui --ai copilot`). Tek provider GitHub Copilot CLI. Kiro CLI provider'i yok; Kiro/Copilot **chat** icin MCP server var. AI yoksa yerel yapisal uretim devreye girer. |
| Basta yalnizca Android, iOS, KMP | Karsilandi | |
| Gecikme/hata senaryolari (ilk faz icin zorunlu degil) | Kismen | Response basina sabit gecikme ve status/senaryo var. Request'e gore kurallar dosyada calisir, UI'si ertelendi. |
| Grafik arayuz; web UI olabilir; en hizli/en islevsel yol | Karsilandi | Localhost web UI (React + Vite), Fastify ile sunuluyor. Masaustu uygulama yok. |
| Node.js kurulum asamasinda kontrol edilsin; yoksa once kurup devam eden yapi | **Sapma (teyit gerekli)** | Yalnizca surum kontrolu ve hata mesaji var; arac Node kurmuyor. PRODUCT_REQUIREMENTS bunu "MVP disi" yapmis. Bkz. karar sorusu 2. |
| Kotlin serialization bicimi gercek uygulamalardan belirlensin | Yapildi | Android: Gson (`@SerializedName`, Retrofit). KMP: `kotlinx.serialization` (`@Serializable`, `@SerialName`, Ktor ContentNegotiation). Moshi incelenen projelerde gorulmedi; ucuz oldugu icin yine de eklendi. |
| Proje adi "Mock API Studio" olsun; baska developer'lar nasil kurar/calistirir | Yapildi | README "Kurulum" ve "Kullanim". |

## 4. Alinan kararlar

Kaynak: ARCHITECTURE "Karar kaydi", PRODUCT_REQUIREMENTS, ROADMAP ve oturum kayitlari.

| # | Karar | Gerekce | Geri alinabilirlik |
|---|---|---|---|
| 1 | Mock motoru olarak `@mockoon/commons` ve `@mockoon/commons-server` **9.10.0** (MIT), exact pin; urun bagimsiz npm paketi, Mockoon fork'u veya eklentisi **degil** | Path param, senaryo, latency, proxy, CORS, log gibi ozellikler hazir; imzalama maliyeti yok; ayni dosya Mockoon CLI ile de calisir. Fork ve sifirdan Fastify reddedildi. | Zor: dosya formati ve runtime motora bagli. |
| 2 | Veri formati: `<ad>.environment.json` (Mockoon) + `<ad>.studio.json` (yan dosya, `schemaVersion: 1`) | Git'e konabilir, Mockoon uyumlu, arac metadata'si ayri. | Orta. |
| 3 | Collection = kok seviyedeki Mockoon folder; folder disindaki route'lar "Ungrouped" | M0'da dogrulandi. | Orta. |
| 4 | Parser: tree-sitter (WASM) AST, ayri child process, `--liftoff-only` | Node 24/25 uzerinde V8 optimize edici WASM derleyicisi bellek yetersizligiyle cokuyor. | Dusuk risk. |
| 5 | JSON Schema Draft 2020-12, dogrulama Ajv | | Kolay. |
| 6 | **Guvenli mod varsayilan:** templating, data bucket, callback, CRUD/WebSocket route'lari kapali | `@faker-js/faker` code-execution advisory'si Mockoon paketleri uzerinden geliyor; paylasilan dosyadan kod calismamali. | Proje ayariyla acilabilir. |
| 7 | Control API yalniz `127.0.0.1`, token (8 saat), Host/Origin kontrolu, CORS yok | DNS rebinding ve LAN erisimine karsi. | Kolay. |
| 8 | Mock listener varsayilan `127.0.0.1`; LAN yalnizca acik kullanici secimiyle | Fiziksel iOS cihaz icin gerekli. | Kolay. |
| 9 | AI: once MCP server, sonra UI icinden opsiyonel AI CLI (yalniz GitHub Copilot CLI); varsayilan kapali, her gonderim onizleme + hash'li onay gerektirir | Gizlilik; AI hicbir temel akisi zorunlu kilmaz. | Kolay (provider arayuzu acik). |
| 10 | Copilot CLI bos gecici `--config-dir`, bos gecici cwd, izin listeli ortam degiskenleri, arac listesi bos, `shell`/`write` reddedilir | Kullanicinin normal yapilandirmasiyla CLI 25-90 sn yanit vermedi; izole config ile ~12 sn. Neden-sonuc MCP sunucularina kesin baglanmadi (Kayit). | Kolay. |
| 11 | Runtime: kurulu Node >= 22.12; arac Node **kurmaz** | Sadelik. Kullanicinin istegiyle celisiyor olabilir (bkz. Bolum 3). | Orta. |
| 12 | Paylasim dosya/git tabanli; ayri collection import/export UI'si yok | Mockoon dosya formati dogrudan paylasilir. Kullanicinin "Postman gibi JSON export/import" istegiyle farkli yorum. | Kolay (ekleme). |
| 13 | "Mockoon" adi/logosu urun adinda ve UI'da kullanilmaz; lisans [NOTICE.md](../NOTICE.md) icinde | Marka riski (Kayit: Mockoon AB markasi). | Kolay. |
| 14 | Dil: README/docs ASCII Turkce (diakritiksiz); kod ve CLI/UI metinleri Ingilizce | Mevcut dosyalarda gozlenen duzen. | Kolay. |

## 5. Neler gelistirildi (M0-M5)

Ayrintili kanitlar [Roadmap](ROADMAP.md) dosyasindaki "Sonuc" bolumlerindedir.

| Asama | Kapsam | Durum |
|---|---|---|
| M0 | Motor prototipi, collection modeli, yan dosya, parser/WASM, JSON Schema, Node araligi, MCP SDK | Uygulandi |
| M1 | Gson/Kotlinx/Moshi/Swift adapter'lari, generic/typealias/recursive, naming ve tarih ayarlari, yerel uretici, `generate` | Uygulandi |
| M2 | `serve`, cakisma/golgeleme kontrolu, 404 JSON, control API, web UI, dosya katmani, CORS, log maskeleme, baglanti rehberi | Uygulandi |
| M3 | Stdio MCP server, alti dar tool, root disina erisim engeli | Uygulandi |
| M4 | UI icinden opsiyonel AI CLI (Copilot CLI), onizleme/onay, izole process, yerel fallback | Uygulandi |
| M5 | Proxy fallback (kapali baslar), LAN binding UI'si, model degisikligi kontrolu (`check`), OpenAPI 3.1 export | Uygulandi |

**CLI:** `init`, `ui`, `serve`, `generate`, `check`, `export openapi`, `snippets`, `mcp`.

**MCP tool'lari:** `list_collections`, `parse_model`, `get_schema`, `generate_sample`, `validate_body`, `save_scenario` (shell veya keyfi dosya tool'u yok).

**Boyut (yaklasik, bugun olculdu):** `src/` ~6.5 bin satir TypeScript, `ui/src/` ~1.7 bin satir, `test/` ~1.9 bin satir; 9 test dosyasi, 116 test.

## 6. Dogrulama durumu

### Bugun calistirildi (2026-11-08, Node v25.9.0, npm 11.12.1)

| Kontrol | Sonuc |
|---|---|
| `npm run lint` (sunucu + UI tip kontrolu) | Gecti |
| `npm run build` (tsc + Vite) | Gecti; `node dist/cli/main.js --version` -> `0.1.0` |
| `npm test` (tam paket) | **115 / 116 gecti, 1 basarisiz** (`test/ai.test.ts`) |
| `npx vitest run test/ai.test.ts` (3 ayri calistirma) | Her seferinde 2 basarisiz, 12 gecti |

Onceki oturum (2026-11-04) lint, build ve 116 testin tamaminin gectigini ve testlerin Node 22, 24, 25'te gectigini bildirmisti (Kayit). Bugunku fark asagidaki zamanlama sorunundan kaynaklaniyor.

### Basarisiz testler: test kararsizligi, urun hatasi degil

- **Testler:** `test/ai.test.ts` icinde `falls back on timeout and kills the process` ve `stops the process when the request is cancelled`.
- **Belirti:** `expected [Function] to throw an error` (`process.kill(call?.pid ?? 0, 0)` hata firlatmiyor).
- **Kanit (bugun olculdu):**
  - Testin birebir senaryosu (400 ms timeout, ayni sahte CLI betigi, gercek `runCli`) vitest disinda 8 kez calistirildi: 6 calistirmada sahte CLI, 400 ms dolmadan kayit dosyasini yazamadi; kayit yazilan 2 calistirmada child process zaman asimindan 300 ms sonra yasamiyordu.
  - 1500 ms timeout ile gercek `runCli`: child process zaman asimindan sonra olduruldu (300 ms sonra yasamiyor).
  - Bu makinede `node -e 0` soguk baslangici 110-117 ms; shebang'li bir betigin ilk calistirmasi 545 ms surdu (sonrakiler ~130 ms); yuk ortalamasi ~4.
- **Cikarim (kod okumasindan):** Test, sahte CLI kaydini 400 ms icinde yazacagini varsayiyor. Yazilmadiysa `call` tanimsiz kalir ve assertion `process.kill(0, 0)` ile calisir; bu POSIX'te kendi process grubunu hedefler ve hata firlatmaz. Bu assertion yolu dogrudan ayri olarak denenmedi.
- **Sonuc:** `src/ai/cli-runner.ts` zaman asimi ve iptalde sureci dogru oldurduruyor; basarisizlik test zamanlamasi (CPU yukune duyarli yaris) kaynakli.
- **Onerilen duzeltme (uygulanmadi):** Zaman asimi/iptalden once kayit dosyasinin gorunmesini bekle (yoklama), `call` tanimli oldugunu assert et ve timeout degerini artir. CI'da bu test ayni nedenle kararsiz olabilir.

### Kayit (bu oturumda tekrar edilmedi)

- Android Emulator (Pixel_8a AVD) `10.0.2.2:<port>` ve `adb reverse` + `localhost` ile mock'tan dogru response aldi; iOS Simulator (iPhone 17) `localhost:<port>` ile dogru response aldi. Bu yalnizca ag erisimini dogrular.
- Yerel UI tarayicida elle denendi (collection olusturma, modelden body uretme, sunucu baslatma, istek listesi).
- Mockoon CLI 9.10.0 ve Mockoon'un kendi `EnvironmentSchema` dogrulamasi ayni dosyayi kabul etti.
- Gercek Copilot CLI 1.0.27 ile tek sentetik modelde ~12 sn'de gecerli yanit alindi.
- Lisans taramasi (production agaci, 234 paket): hepsi izin verici lisansli; tek istisna `@jmespath-community/jmespath` (MPL-2.0, degistirilmeden kullaniliyor).

## 7. Dogrulanmamis / acik maddeler

Hicbiri denenmedi; "calisiyor" diye raporlanmamalidir.

- **Mockoon desktop:** Dosya acma ve iki yonlu duzenleme elle denenmedi (desktop kurulu degil).
- **Fiziksel cihazlar:** Android (`adb reverse`) ve iOS (LAN binding) denenmedi.
- **WebView icinde CORS:** Yalnizca HTTP seviyesinde test edildi.
- **Uygulama ici ag ayarlari:** Debug `network_security_config` (Android) ve `NSAllowsLocalNetworking` (iOS) bir uygulama projesiyle denenmedi.
- **Windows ve Linux:** Denenmedi. CI matrisi yalnizca `ubuntu-latest` ve `macos-latest` (Node 22, 24) icin yazildi ve **hic calistirilmadi** (proje bir git deposu degil).
- **Ekip kod tabani taramasi:** Gercek modeller uzerinde `mock-studio generate --list` calistirilip raporlanan `issues` listesine bakilmadi. Moshi, generic wrapper, sealed class kullanimi bu yuzden bilinmiyor.
- **Kiro/Copilot chat ile MCP akisi:** Yalnizca SDK istemcisiyle protokol seviyesinde denendi.
- **OpenAPI export:** Harici bir OpenAPI validator ile denenmedi.
- **`@mockoon/commons-server` kararliligi:** Genel kullanim icin stabil API garantisi yok; exact pin ve entegrasyon testleriyle korunuyor.
- **`npm audit`:** `@faker-js/faker` (code execution) ve `joi` (DoS) advisory'leri Mockoon paketleri uzerinden geliyor; `npm audit fix` Mockoon'u eski surume dusurur, **yapilmamalidir**. Faker riski guvenli modla kapatiliyor.

### Ertelenenler (ROADMAP M5 tablosunda kabul kriterleriyle)

- Request'e gore response kurallari icin UI (kurallar dosyada calisir; duzenleme icin Mockoon desktop).
- Sealed class / polymorphism ve kalitim (acikca raporlanir).
- Tek binary veya Docker dagitimi (Docker bu makinede yok).

### Yayin oncesi

- `@mock-api-studio` npm kapsaminin sahipligi dogrulanmadi (duz `mock-api-studio` adi alinmis).
- **Proje bir git deposu degil:** `.git` yok, remote yok. README'deki `git+ssh://<sunucu>/<org>/<repo>.git` kurulum yolu bir depo olusturulana kadar kullanilamaz.
- Kurumsal kullanim oncesi sirketin acik kaynak arac onayi (MPL-2.0 bagimliligi notlandi).

## 8. Kullanicidan karar bekleyen konular

**Guncelleme 2026-11-08 (kullanici yaniti):** Asagidaki dort soru yanitlandi. (1) Mockoon motoru MIT ve ucretsiz oldugu icin kullanilmaya devam eder. (2) Node yoksa kurulum araci kurmali; kurulum ve guncelleme son kullanici icin kolay olmali (M13). (3) Postman benzeri export/import plana alindi (M12). (4) Kurulu tum AI CLI'lari desteklenecek (M11). Ek kararlar: proje kisisel ve acik kaynak (MIT, GitHub); hedef kullanim gelistirmede MCP ile LLM'ler, testte dashboard; header/parametre/body/sira kosullu response'lar (M7-M8); model degisince body guncelleme (M9). Ayrinti: [Roadmap - v1 plani](ROADMAP.md#v1-plani-m6-m17), [Mimari - v1 tasarimlari](ARCHITECTURE.md#v1-tasarimlari-oneri).

Acik kalan sorular: acik kaynak dokuman dili (Ingilizce oneriliyor). Oneri havuzu 2026-11-08'de onaylandi ve M14-M17 olarak plana alindi.

Asagidaki metin 2026-11-08 oncesi durumdur ve tarihce olarak korunur.

1. **Mockoon motoru.** Kullanici "Mockoon ucretli, uygun degil" demisti. Urun Mockoon'un MIT lisansli motor paketlerini kutuphane olarak kullaniyor (Kayit: Mockoon repo ve paketleri MIT; Mockoon'un yerlesik AI asistani ucretli Cloud planlarina bagli). Erisilebilen oturum kayitlarinda bu gecis icin acik bir onay veya itiraz kaydi bulamadim. Kullanici bunun kapsamini ve lisans durumunu bilerek onayliyor mu?
2. **Node.js otomatik kurulumu.** Kullanici "yoksa once kurup sonra devam edecek bir yapi" istemisti; arac yalnizca kontrol edip hata veriyor. Bootstrap istenirse tasarim, onay ve guvenlik (checksum, kullanici dizini, `sudo` yok) acisindan ayri ele alinmali.
3. **Postman benzeri JSON export/import.** Tek dosya veya bundle olarak collection import/export UI'si/API'si isteniyor mu, yoksa dosya/git tabanli paylasim yeterli mi?
4. **Kiro CLI provider'i** gerekiyor mu, yoksa Copilot CLI + MCP yeterli mi?

## 9. Kod haritasi

Tek paket, ayri dizinler. Ayrintili tablo: [Gelistirme rehberi - Modul sinirlari](DEVELOPMENT.md#modul-sinirlari).

| Dizin | Sorumluluk | Mockoon bagimliligi |
|---|---|---|
| `src/parser/` | tree-sitter AST -> dil bagimsiz IR; `kotlin/{gson,kotlinx,moshi}.ts`, `swift/`; `host.ts` + `worker.ts` ayri child process | yok |
| `src/schema/` | IR -> JSON Schema, naming/tarih ayarlari, Ajv dogrulama | yok |
| `src/generator/` | Deterministik yerel uretici (alan adi heuristic'leri, varyantlar, seed) | yok |
| `src/core/` | Domain tipleri, `ProjectService`, cakisma kontrolu, model servisi, schema diff, OpenAPI, guvenli yol | yok |
| `src/store/` | Mockoon environment + yan dosya, atomik yazma, dosya izleme | **var** |
| `src/runtime/` | Turetilmis environment, guvenli mod, motoru calistirma, maskeli log | **var** |
| `src/control-api/` | Fastify, yalniz loopback, UI asset'leri | yok |
| `src/mcp/` | MCP tool'lari | yok |
| `src/ai/` | Provider arayuzu, process calistirici (`cli-runner.ts`), Copilot provider, prompt | yok |
| `src/cli/` | Komutlar (`main.ts` giris noktasi) | yok |
| `ui/` | React + Vite arayuzu; `src/core/view.ts` gibi saf tip dosyalarini import eder | yok |
| `test/` | Vitest; `fixtures/` sentetik Kotlin/Swift modelleri; testler `dist/` uzerinde calisir | - |

Mockoon paketlerine yalnizca `store/` ve `runtime/` dogrudan bagimlidir.

**Onemli mekanikler**

- Motor ilk eslesen route'u secer ve cakismayi kendisi raporlamaz; cakisma kontrolu `core/` icinde runtime'a gecmeden once yapilir.
- Pasif collection'lar dosyada kalir; runtime, route'lari cikararak turetilmis bir environment kurar.
- Degisiklikler `MockoonServer.updateEnvironment()` ile restartsiz yansir; yalniz port/host degisirse runtime yeniden baslar.
- Eslesmeyen istekler icin motorun 404'u JSON olmadigindan, OPTIONS haric her method icin catch-all route eklenir; proxy aciksa eklenmez.
- Body ham string olarak saklanir (64-bit sayilarin hassasiyeti icin).
- `src/parser/host.ts` calisma zamaninda `dist/parser/worker.js`'i bulur; bu yuzden `npm test` oncesi `test/global-setup.ts` `tsc` ile derleme yapar.

## 10. Calisma ortami ve komutlar

| Komut | Amac | Bugun calistirildi |
|---|---|---|
| `npm install` / `npm ci` | Bagimliliklar; `prepare` derlemeyi de yapar | Hayir (`node_modules` mevcut) |
| `npm run build` | Sunucu (tsc -> `dist/`) ve UI (Vite -> `dist/ui`) | Evet |
| `npm run lint` | Sunucu ve UI tip kontrolu | Evet |
| `npm test` | Vitest (oncesinde `tsc` ile `dist/` derlenir) | Evet |
| `npm run dev:ui` | Vite dev sunucusu; `MOCK_STUDIO_API=http://127.0.0.1:<ui-portu>` ile `ui` komutuna baglanir | Hayir |
| `npm run notice` | `NOTICE.md` uretir | Hayir |
| `node dist/cli/main.js --help` | CLI | `--version` evet |

Gereksinim: Node.js >= 22.12 (`engines`). CI matrisi Node 22 ve 24; yerelde Node 25.9 kullanildi. Paket yoneticisi npm + `package-lock.json`.

Kullanim ornekleri icin [README](../README.md#kullanim).

**Notlar**

- Vitest calisirken `DEP0060` (`util._extend`) kullanimdan kaldirma uyarisi cikiyor; basarisizlikla iliskili degil.
- `.agent-work/` onceki ajan oturumlarinin artifaktlaridir ve `.gitignore` icindedir; devam icin gerekmez.
- `dist/` ve `node_modules/` `.gitignore` icindedir.

## 11. Claude Code icin calisma kurallari

Mevcut dokumanlarda ve karar kaydinda yazili kurallardan turetilmistir.

1. **Oncelik:** Once [Bolum 8](#8-kullanicidan-karar-bekleyen-konular)deki kararlari kullaniciya sor; bu kararlar mimariyi etkileyebilir.
2. **Dogruluk:** "Dogrulandi" yalnizca calistirilan test veya elle yapilan kontrol icin kullanilir. Yeni dogrulama yapinca ROADMAP "Sonuc" bolumunu ve [manuel dogrulama matrisini](DEVELOPMENT.md#manuel-dogrulama-matrisi) guncelle. Var olmayan komutlari calisir gibi dokumante etme.
3. **Bagimliliklar:** Exact version kullan. `@mockoon/commons` ve `@mockoon/commons-server` ayni surumde kalsin; birlikte guncelle ([Mockoon guncelleme proseduru](DEVELOPMENT.md#bagimlilik-kurallari)). `npm audit fix` calistirma. `web-tree-sitter` 0.24.7 ile `tree-sitter-wasms` 0.1.13'u 0.27'ye yukseltme (grammar'larla uyumsuz).
4. **Guvenlik degistirilmez:** Control API loopback; LAN yalniz acik secimle; guvenli mod varsayilan; log maskeleme ve body loglamanin kapali olmasi; telemetri yok; AI onizleme/onay/hash zorunlulugu; MCP'de shell veya serbest dosya tool'u yok.
5. **Kod calistirma yok:** Kullanici model kodu, import edilen JSON veya prompt hicbir zaman shell komutu olarak calistirilmaz; parser kaynak kodu derlemez ve ayri process'te kalir.
6. **Test verisi:** Fixture'lar sentetik olur; musteri veya production model kodu fixture'a kopyalanmaz.
7. **Marka:** "Mockoon" adi urun adinda, UI'da veya ikonlarda kullanilmaz; bagimlilik ve lisans olarak belirtilir.
8. **Kapsam disiplini:** Bir milestone'un cikis kriterleri gecmeden sonraki fazin ozelliklerini temel akisa ekleme (ROADMAP "Faz gecis kurali").
9. **Dokumanlar:** Mevcut dosyalar ASCII Turkce yazilmis; ayni duzeni koru.
10. **Surec:** Is bittiginde lint, build ve testi calistir ve sonucu oldugu gibi raporla.

## 12. Onerilen ilk adimlar

1. Bu belge ve [Roadmap](ROADMAP.md) "Sonuc" bolumlerini oku; `npm run lint && npm run build && npm test` ile durumu yeniden olc.
2. `test/ai.test.ts` icindeki iki kararsiz testi duzelt (kayit dosyasini bekle, `call` tanimli oldugunu assert et, timeout degerini artir) ve tam paketi birkac kez calistirip kararlilik dogrula.
3. [Bolum 8](#8-kullanicidan-karar-bekleyen-konular)deki sorulari kullaniciyla netlestir; yanita gore Node bootstrap, collection import/export veya Kiro provider'i planla.
4. Projeyi git deposuna cevir (kullanici onayiyla) ve CI'i ilk kez calistir; Linux ve Node 22 sonuclarini kaydet.
5. Gercek ekip modelleri (Android Gson, KMP Kotlinx, Swift Codable) uzerinde `mock-studio generate --list` calistirip `issues` listesine gore parser kapsamini guncelle.
6. Acik dogrulamalari sirayla kapat: Mockoon desktop, fiziksel cihazlar, WebView CORS, uygulama icinde cleartext/ATS, Kiro/Copilot chat ile MCP.
7. Yayin oncesi: npm kapsam sahipligi, paket adi, lisans onayi.

## 13. Kaynaklar

- [README](../README.md): kurulum ve kullanim.
- [Urun gereksinimleri](PRODUCT_REQUIREMENTS.md), [Roadmap](ROADMAP.md), [Mimari](ARCHITECTURE.md), [Gelistirme rehberi](DEVELOPMENT.md), [NOTICE](../NOTICE.md).
