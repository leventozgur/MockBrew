# Roadmap

Sure tahmini verilmez; her asama cikis kriterleriyle kapatilir. Oncelik sirasi, urunun ayirt edici degerine (modelden uretim) gore belirlenmistir.

Durum: M0-M5 uygulanmistir; M6-M17 planlandi (bkz. [v1 plani](#v1-plani-m6-m17)). Her asamanin sonunda "Sonuc" bolumu kanitlari ve henuz dogrulanmayan noktalari listeler. "Dogrulandi" yalnizca calistirilan test veya elle yapilan kontrol icin kullanilir; ekip kod tabani, Mockoon desktop, fiziksel cihazlar ve Windows/Linux bu ortamda denenemedigi icin acik madde olarak kalir.

## Milestone 0: Teknik dogrulama

### Isler

- **Mockoon motoru prototipi:** `@mockoon/commons-server` ile bir environment'i programatik baslat/durdur; restartsiz guncelleme, disabled route, folder ve port davranisini dene.
- **Collection modeli:** Collection = environment folder eslemesini dogrula; pasif collection mekanizmasini sec.
- **Yan dosya:** Adini, konumunu ve ilk `schemaVersion` formatini belirle.
- **Mockoon desktop uyumu:** Arac ile yazilan dosyanin desktop'ta acildigini ve dosya izleme ile iki yonlu degisikliklerin yansidigini dogrula.
- **Parser:** tree-sitter Kotlin/Swift grammar'larini Node'da (WASM) dene; temsilci Gson, Kotlinx ve Codable fixture'lariyla parse edilebilirligi olc.
- **Ekip kod tabani taramasi:** Moshi, generic wrapper, sealed class, decoder seviyesindeki naming/tarih stratejisi kullanimini cikar.
- **JSON Schema:** Draft ve ortak schema temsilini sec.
- **Platform:** Node LTS araligini, hedef OS test matrisini ve paket adini (scoped) sabitle.
- **MCP:** MCP SDK'sini ve tool listesini belirle.

### Cikis kriterleri

- Motor prototipi senaryo degisikligini restartsiz (veya fark ettirmeden) uyguluyor; kisitlar belgelenmis.
- Collection eslemesi ve yan dosya formati sabitlenmis.
- Her model turu icin parse basari/hata ornekleri ve unsupported listesi var.
- Moshi ve diger kapsam kararlari ekip taramasina gore verilmis.

### Sonuc

Kararlarin ayrintisi: [Mimari - M0 sonuclari](ARCHITECTURE.md#m0-teknik-dogrulama-sonuclari).

- **Motor prototipi:** Dogrulandi. `MockoonServer.updateEnvironment()` ile body/status/header/senaryo/latency degisikligi restartsiz yansir; port veya host degisirse runtime ayni port ayarlariyla kendini yeniden baslatir. Pasif collection, runtime icin turetilen environment'tan cikarilarak uygulanir.
- **Collection modeli ve yan dosya:** Collection = kok seviyedeki Mockoon folder; folder disindaki route'lar "Ungrouped" sanal collection'indadir. Yan dosya `<ad>.studio.json`, `schemaVersion: 1`; gelecek major surum sessizce yuklenmez.
- **Parser:** tree-sitter Kotlin ve Swift WASM grammar'lari Node'da calisir (`web-tree-sitter` 0.24.7 + `tree-sitter-wasms` 0.1.13; 0.27 grammar'larla uyumsuz). Node 24+ uzerinde V8'in WASM derleyicisi bu grammar'larla bellek yetersizligiyle cokuyor; bu yuzden parser `--liftoff-only` ile ayri bir child process'te calisir.
- **JSON Schema:** Draft 2020-12, dogrulama Ajv 8.20.
- **Platform:** Node >= 22.12; tum test paketi Node 22.23, 24.22 ve 25.9 uzerinde gecti. macOS disinda denenmedi; CI matrisi `.github/workflows/ci.yml` icinde tanimlidir.
- **MCP:** `@modelcontextprotocol/sdk` 1.32.2, stdio; tool listesi [Mimari](ARCHITECTURE.md#mcp-server-birincil) bolumunde.
- **Mockoon desktop uyumu:** Mockoon'un kendi `EnvironmentSchema` dogrulamasi ve Mockoon CLI 9.10.0 ile (otomatik test) dogrulandi. Desktop uygulamasi bu makinede kurulu olmadigi icin acilis ve iki yonlu duzenleme elle denenmedi; arac tarafinda dosya izleme ve dis degisikligi yukleme test edildi.
- **Ekip kod tabani taramasi:** Yapilamadi (kod tabanina erisim yok). Moshi `@Json(name, ignore)` ucuz oldugu icin kapsama alindi; sealed class, kalitim, `init(from:)` ve custom serializer desteklenmeyip acikca raporlaniyor. Gercek modeller uzerinde `mock-studio generate --list` calistirilip raporlanan `issues` listesi bu maddeyi kapatir.

## Milestone 1: Modelden uretim cekirdegi

### Isler

- Gson, Kotlinx Serialization ve Swift Codable adapter'lari.
- Ortak JSON Schema'ya normalizasyon; basit generic substitution; cok dosyali tip cozumleme.
- Naming strategy ve tarih formati ayarlari.
- Alan adi heuristic'li deterministik yerel uretici; minimal / tam / bos liste varyantlari.
- Schema dogrulama.
- `generate` CLI komutu: model girdisinden JSON'i stdout'a veya bir Mockoon route'una yazar.

### Cikis kriterleri

- Uc model turu de generic wrapper dahil fixture testlerini geciyor.
- Uretilen JSON semaya gore gecerli; naming ve tarih ayarlari ciktiya dogru yansiyor.
- Desteklenmeyen yapilar ve cozumlenemeyen tipler acikca raporlaniyor.

### Sonuc

Dogrulandi (`test/models.test.ts`, 32 test): Gson, Kotlinx Serialization, Moshi ve Swift Codable adapter'lari; generic wrapper (`BaseResponse<Page<Product>>`), typealias, recursive tipler, cok dosyali cozumleme, naming (`identity`, `snake_case`) ve tarih (`iso8601`, epoch saniye/milisaniye) ayarlari, `Long` icin guvenli sayi araligi, minimal/tam/bos liste varyantlari, ayni seed = ayni cikti. Uretilen JSON her fixture, varyant ve ayar kombinasyonunda semaya gore gecerli. Raporlanan yapilar: sealed class, kalitim, custom serializer/adapter, `init(from:)`, property wrapper, enum associated value, hesaplanan/delegated alan, sozdizimi hatasi, cozumlenemeyen tip.

## Milestone 2: Mock calistirma ve yerel UI (MVP)

### Isler

- `serve` komutu: aktif collection'lari tek port uzerinde Mockoon motoruyla calistirir.
- Cakisma ve golgeleme kontrolu; eslesmeyen istekler icin 404 JSON'u.
- Control API (loopback, token, Host/Origin kontrolu).
- Yerel web UI: project/collection/endpoint yonetimi, senaryo duzenleme ve secimi, latency, status/header/body editoru, modelden uretim ekrani, start/stop, loglar.
- Dosya katmani: atomik yazma, dosya izleme, dis degisiklik algilama.
- CORS ayarlari; log maskeleme.
- Android/iOS debug ag yapilandirma snippet'leri ve baglanti rehberi (`10.0.2.2`, `localhost`, `adb reverse`).

### Cikis kriterleri

- PRODUCT_REQUIREMENTS'taki MVP kabul kriterleri karsilaniyor.
- Ayni dosya Mockoon desktop ve Mockoon CLI ile de calisiyor.

### Sonuc

Dogrulandi: `test/project.test.ts` (20), `test/control-api.test.ts` (12), `test/cli.test.ts` (8), `test/safe-mode.test.ts` (4), `test/ui-util.test.ts` (5).

- `serve`, cakisma (`duplicate` hata, `shadowed` uyari) ve golgeleme kontrolu, eslesmeyen istek icin JSON 404 ve log isareti, CORS preflight ve origin yansitma, atomik yazma, dosya izleme, dis degisiklikte yeniden yukleme, eski dosya uzerine yazmayi reddetme (`STALE`), bozuk JSON'un kaydedilmemesi, log maskeleme ve body loglamanin kapali olmasi, port cakismasi mesaji.
- Control API: yalnizca `127.0.0.1`, token (TTL 8 saat), Host ve Origin kontrolu, CORS yok, path traversal ve symlink reddi.
- Yerel UI (React): collection/endpoint/senaryo yonetimi, JSON dogrulama, modelden uretim dialogu, baslat/durdur, istek loglari, baglanti rehberi, ayarlar. Tarayicida elle denendi (collection olusturma, modelden body uretme, sunucuyu baslatma, istek listesi).
- Mockoon CLI 9.10.0 ayni environment dosyasini calistirir (otomatik uyumluluk testi).
- **Elle dogrulama (bu makinede):** Android Emulator (Pixel_8a AVD) `10.0.2.2:<port>` ve `adb reverse` + `localhost` ile mock'tan dogru response aldi; iOS Simulator (iPhone 17) `localhost:<port>` ile dogru response aldi. Bu denemeler agi dogrular; uygulama icindeki cleartext/ATS ayarlari (`network_security_config`, `NSAllowsLocalNetworking`) bir uygulama projesi olmadan denenmedi.
- **Acik:** Mockoon desktop ile acma ve duzenleme, fiziksel Android/iOS cihaz, WebView icinde CORS, Windows ve Linux.

Milestone 1 ve 2 tamamlandiginda **offline MVP** hazirdir.

## Milestone 3: MCP server

### Isler

- Stdio MCP server: model parse, schema getirme, body dogrulama, endpoint/senaryo kaydetme, collection listeleme.
- Project klasoru disina erisimi engelleme; gecersiz body'yi reddetme.
- Kiro ve Copilot icin kurulum ornekleri.

### Cikis kriterleri

- Kiro veya Copilot chat'inden "bu modelle ... uret" akisi, dogrulanmis bir senaryo olarak dosyaya kaydediliyor.
- MCP olmadan tum MVP akislari aynen calisiyor.

### Sonuc

Dogrulandi (`test/mcp.test.ts`, 7 test; gercek stdio MCP istemcisi ile): alti dar tool (`list_collections`, `parse_model`, `get_schema`, `generate_sample`, `validate_body`, `save_scenario`); shell veya keyfi dosya tool'u yok. "Bu modelle uret" akisi `parse_model` -> `get_schema` -> `save_scenario` ile dogrulanmis senaryo olarak dosyaya yaziliyor; gecersiz JSON veya modele uymayan body hicbir sey kaydetmeden reddediliyor; root disina erisim (`..`, mutlak yol, symlink) reddediliyor. MCP kullanmayan tum akislar ayni testlerle MCP'siz calisiyor.

Kurulum ornekleri: [Gelistirme rehberi](DEVELOPMENT.md#mcp-kurulumu-kiro-ve-copilot).

**Acik:** Akis gercek Kiro veya Copilot chat'i ile denenmedi; protokol seviyesinde SDK istemcisiyle dogrulandi.

## Milestone 4: Istege bagli AI CLI (UI icinden)

### Isler

- Provider interface'i ve M0/M3 deneyimine gore secilen tek CLI entegrasyonu.
- Gonderilecek source/schema/prompt onizlemesi ve acik onay.
- Agent yetkilerini kapatan/daraltan, gecici dizinde calisan guvenli process baslatma.
- Cikti dogrulama; basarisizlikta yerel ureticiye donus.

### Cikis kriterleri

- Onaysiz hicbir veri CLI'a gitmiyor.
- CLI yokken, auth hatasinda veya timeout'ta uygulama yerel uretimle devam ediyor.

### Sonuc

Secilen entegrasyon: **GitHub Copilot CLI** (ekip Kiro/Copilot kullaniyor ve CLI hem `-p` ile etkilesimsiz calisiyor hem arac/izin filtreleri sunuyor). Provider interface'i (`AiProvider`) baska bir CLI eklemeye aciktir.

Dogrulandi (`test/ai.test.ts`, 14 test; sahte CLI executable'lariyla): onizleme hicbir process baslatmaz; onay yalnizca onizlenen promptun hash'i ile verilir (prompt degisirse `FORBIDDEN`); basarili cikti, code fence icinde cikti, bozuk JSON, modele uymayan JSON, sifir olmayan cikis kodu, CLI bulunamadi, timeout (process olur) ve iptal (process olur) durumlari; son bes durumda yerel uretici devreye girer. Prompt tek bir argv elemanidir (shell yok), process bos gecici klasorde ve izin listeli ortam degiskenleriyle baslar, `--config-dir` bos gecici klasordur (kullanicinin MCP sunuculari, hook'lari ve eklentileri yuklenmez), arac listesi bosaltilir, `shell` ve `write` reddedilir. AI yalnizca `ui --ai copilot` ile acilir; proje dosyasinda saklanmaz.

Gercek Copilot CLI 1.0.27 ile tek bir sentetik model uzerinde elle denendi: ~12 sn'de gecerli yanit geldi ve semaya uydu. Ilk denemelerde CLI, kullanicinin normal Copilot yapilandirmasiyla (cok sayida MCP sunucusu tanimli) 25-90 sn boyunca hic yanit vermedi, bos bir `--config-dir` ile ise yanit verdi; bu yuzden izole `--config-dir` kullaniliyor (neden-sonuc iliskisi MCP sunucularina kesin olarak baglanmadi). Giris bilgisi bos yapilandirma klasorunde de gecerli kaldi (muhtemelen sistem anahtarligi); anahtarlik kullanmayan bir kurulumda CLI giris hatasi verir ve arac yerel uretime duser.

## Milestone 5: Ileri senaryolar ve dagitim

Degerlendirilecekler (her biri icin kabul kriteri ayri yazilir):

| Madde | Karar | Kabul kriteri | Durum |
|---|---|---|---|
| Proxy / fallback UI | Yapildi | Varsayilan kapali; acikken yalniz eslesmeyen istekler girilen backend'e gider, eslesen mock kazanir; log'da `proxied` gorunur; backend adresi `http(s)` olmali, kimlik bilgisi icermemeli ve mock sunucunun kendisini gostermemeli. | Dogrulandi (`test/m5.test.ts`) |
| iOS fiziksel cihaz icin LAN binding UI'i | Yapildi | Ayarlarda acik onayli LAN secenegi (`0.0.0.0`), acikken UI ve `serve` uyari verir; baglanti rehberi LAN IP'sini gosterir; varsayilan `127.0.0.1`. | Dogrulandi (`test/project.test.ts`, `test/cli.test.ts`); fiziksel cihaz denenmedi |
| Model degistiginde schema diff'i | Yapildi | Bagli modelin kaynak dosyalari yeniden okunur; eklenen/silinen/tipi degisen alan, zorunlu alan ve enum degisiklikleri bozucu veya uyumlu diye listelenir; kayitli body'ler yeni semaya karsi dogrulanir; `mock-studio check` bozulma varsa 1 ile cikar. | Dogrulandi (`test/m5.test.ts`) |
| Uretilen semadan OpenAPI export | Yapildi | OpenAPI 3.1; path parametreleri `{id}`, status kodlari senaryolardan, 2xx response'lar bagli model semasiyla ve ornek body'lerle; ayni adli farkli tipler ayrisir; pasif collection'lar varsayilan olarak disarida. Backend ekibine sozlesme onerisidir. | Dogrulandi (`test/m5.test.ts`); harici bir OpenAPI validator ile denenmedi |
| Request'e gore response kurallari icin UI | Ertelendi; M7'ye tasindi (2026-11-08) | Kurallar dosyada korunur ve calisir; duzenleme icin ayni dosya Mockoon desktop ile acilir. UI yapilirsa: kural (target/modifier/value/operator) ekleme-silme-siralama, kaydetmeden once dogrulama ve desktop ile ayni dosyada gidis-donus. | Acik |
| Sealed class / polymorphism, kalitim | Ertelendi | Ilk surumde desteklenmeyip acikca raporlanir (`sealed-class`, `inheritance`). Yapilirsa: sealed alt tiplerinden `oneOf` sema, `type` discriminator ayari ve her alt tip icin uretim varyanti. Moshi M0'da kapsama alindi. | Acik |
| Tek binary veya Docker dagitimi | Tek binary M6 prototipi ve M13'e tasindi; Docker 2026-11-08'de kapsamdan cikarildi | Bu makinede Docker yok ve Node SEA ile WASM/UI asset paketleme denenmedi. Kabul kriteri: temiz makinede `docker run` ile `serve`/`ui` calismasi ve imajda yalniz production bagimliliklari. | Acik |

## v1 plani (M6-M17)

Kaynak: kullanici kararlari, 2026-11-08 (bkz. [Devir raporu - Bolum 8](HANDOFF.md#8-kullanicidan-karar-bekleyen-konular)). Tasarim ayrintilari: [Mimari - v1 tasarimlari](ARCHITECTURE.md#v1-tasarimlari-oneri). Bu bolumdeki milestone'larin hicbiri henuz uygulanmadi; durum "Planlandi"dir.

Urunun v1 hedefi:

1. **Gelistirme sirasinda LLM'ler MCP ile araci otomatik kullanir:** endpoint, senaryo, kosul ve test profili olusturur; modeli okur, response uretir, model degisince mock'u gunceller.
2. **Test sirasinda gelistirici dashboard'u kullanir:** header, parametre, body veya istek sirasina gore farkli response (status, body, header, gecikme) donerek uygulamanin bu durumlardaki davranisini gorur.
3. **Son kullanici urunu:** Node dahil kurulum ve guncelleme tek komutla yapilir; proje GitHub'da acik kaynak (MIT) yayinlanir.

Ilke: Her yeni ozellik core'da yazilir ve ayni milestone icinde **CLI, MCP ve UI** uzerinden kullanilabilir hale gelir (ozellik paritesi). MCP'de olmayan bir ozellik "bitti" sayilmaz.

### Milestone 6: Acik kaynak hazirligi ve temel saglamlastirma

- Projeyi git deposuna cevir; ilk commit'ten once firma/musteri referanslarini temizle (`docs/HANDOFF.md` icindeki referans uygulama yollari dahil).
- `test/ai.test.ts` icindeki zamanlama kararsizligini duzelt (kayit dosyasini bekle, `call` tanimli oldugunu assert et).
- CI matrisine `windows-latest` ekle; CI'i ilk kez calistir.
- `CONTRIBUTING.md`, `SECURITY.md`, issue/PR sablonlari, `CHANGELOG.md`.
- Tum dokumanlar Ingilizceye cevrilir (kullanici karari, 2026-11-08); kod ve UI metinleri zaten Ingilizce.
- **Isim kontrolu:** "Mock API Studio" adinin GitHub, npm ve Homebrew'da cakismasi ve ayirt ediciligi kontrol edilir; gerekirse yeni ad kullaniciya onerilir.
- **Tek binary prototipi (Node SEA):** `serve`, `ui`, `mcp` ve parser child process'i (WASM) ile UI asset'leri tek calistirilabilir dosyada calisiyor mu? Sonuc M13 dagitim tasarimini belirler.
- **Bagimlilik notu:** README'de `npm audit` uyarilarinin (Mockoon uzerinden gelen faker/joi) guvenli modla nasil kapatildigi aciklanir; periyodik bagimlilik guncelleme adimi DEVELOPMENT rehberine eklenir.
- **UI E2E testleri:** Playwright ile dashboard'un temel akislari (collection/endpoint/senaryo olusturma, sunucu baslatma, log) icin ilk testler; sonraki milestone'lar UI degisikliklerini bu testlerle korur.

**Cikis kriterleri:** CI macOS, Linux ve Windows'ta Node 22/24 ile yesil (GitHub deposu acilinca); tam test paketi art arda 5 calistirmada kararli; depoda firma referansi yok; SEA prototipinin sonucu (calisiyor/calismiyor ve nedenleri) kayitli; isim karari verilmis.

### Milestone 7: Kosullu response'lar (kural motoru)

Ilk adim (2026-11-08 duzeltmesi): **mevcut ozelliklerin MCP eksikleri kapatilir**: endpoint olusturma/guncelleme/silme, senaryo guncelleme/silme/aktif etme, collection olusturma/aktif etme, sunucu baslat/durdur/durum ve son istek loglari. Ana kullanim LLM'lerin MCP ile calismasi oldugu icin bu, M10'u beklemez.

Mockoon'un dosyada zaten calisan response kurallari domain modeline, UI'a, CLI'a ve MCP'ye acilir. Tasarim: [Kosullu response'lar](ARCHITECTURE.md#kosullu-responselar).

- Domain modeli: senaryoya `rules` ve `rulesOperator` (AND/OR), endpoint'e `responseMode` (kurallar / sabit / sirali / rastgele).
- Kosul hedefleri: header, query, route parametresi, body (JSON path veya form alani), cookie, istek sirasi (`request_number`). Operatorler: esittir, regex (buyuk/kucuk harf duyarli ve duyarsiz), bos/yok, dizi icerir, bos dizi; her kosul tersine cevrilebilir.
- Zorla secim: `X-Mock-Scenario: <senaryo adi>` header'i (proje ayariyla acilip kapanir; varsayilan acik) diger kurallardan once gelir. Uygulamanin debug menusunden senaryo secmek icin kullanilir.
- UI: senaryo listesinde kural editoru, surukle-birak siralama (ilk eslesen kazanir), "varsayilan" isareti, kural dogrulama.
- Log ve inceleme: her istek icin hangi senaryonun neden secildigi ("neden bu response") gosterilir. Once motorun raporladigi bilgi (response uuid, olaylar) kullanilir; eslesen kural motordan alinamiyorsa kurallarin core'da yeniden degerlendirilmesi yalniz gosterim icindir ve motorla farki uyari olarak loglanir.
- Yan dosya `schemaVersion: 2`: kurallar environment dosyasinda, endpoint modu/profil/degisken gibi arac verisi yan dosyada; v1 dosyalari otomatik ve kayipsiz yukseltilir (migration testi), v2 dosyasi eski surumde acik hatayla reddedilir.
- MCP/CLI: kural ekleme/silme/siralama ve endpoint modu.

**Cikis kriterleri:** Ayni endpoint'te header, query, route parametresi ve body kosuluna gore farkli status/body donuyor; kural eslesmezse varsayilan senaryo donuyor; `X-Mock-Scenario` her kurali ezer; sirali modda 1. istek 500, 2. istek 200 donuyor; kurallar restartsiz yansiyor; dosya Mockoon CLI ile ayni davranisi veriyor; hepsi entegrasyon testleriyle dogrulaniyor.

### Milestone 8: Test profilleri ve ag kosullari

- **Test profili:** Bircok endpoint'in senaryosunu tek tikla degistiren adlandirilmis secim ("Oturum dustu: her yer 401", "Sunucu hatasi", "Bos liste", "Yavas ag"). Yan dosyada saklanir ve git ile paylasilir; aktif profil dashboard'da ve `serve --profile` ile secilir.
- **Ag kosullari (global veya profil bazinda):** sabit gecikme ve zaman asimi simulasyonu (cok uzun gecikme). Rastgele hata orani ve gecikme jitter'i 2026-11-08'de kapsamdan cikarildi: motor desteklemiyor ve test sonuclarini tekrarlanamaz yapiyor; ayni ihtiyac sirali mod, `X-Mock-Scenario` ve profillerle deterministik karsilanir.
- Istek sayaci sifirlama (sirali mod ve `request_number` kurallari icin).

**Cikis kriterleri:** Profil degisikligi restartsiz uygulanir; profil silinince senaryolar eski haline doner; global gecikme ve zaman asimi entegrasyon testleriyle dogrulanir.

### Milestone 9: Model degisince mock'u guncelleme

Mevcut `check` yalniz farki gosteriyor; body'leri guncellemek kullaniciya kaliyor. Tasarim: [Model guncelleme](ARCHITECTURE.md#model-degisikliginde-body-guncelleme).

- Her bagli senaryo icin **birlestirme onerisi:** var olan degerler korunur, yeni alanlar yerel ureticiyle doldurulur, silinen alanlar kaldirilir, tipi degisen alan yeniden uretilir, enum disi deger gecerli bir degerle degistirilir.
- Senaryo bazinda fark onizlemesi ve onay; "tumunu uygula".
- CLI: `mock-studio check --fix` (onizleme), `--fix --yes` (uygula). MCP: `check_models`, `apply_model_update`. UI: model degisikligi bildirimi ve tek tikla guncelleme.
- Kaynak dosya izlenir; model degisirse dashboard uyari gosterir.

**Cikis kriterleri:** Alan ekleme/silme/tip degisikligi/enum degisikligi/nullable degisikligi fixture'larinda guncellenen body yeni semaya gore gecerli ve elle girilmis degerler korunuyor; 4xx/5xx senaryolarina dokunulmuyor.

### Milestone 10: MCP ile tam otomatik kullanim

- Eksik tool'lar: endpoint olusturma/guncelleme/silme, senaryo guncelleme/silme/aktif etme, kural ve endpoint modu, test profilleri, collection olusturma/aktif etme, sunucu baslat/durdur/durum, son istek loglari, model kontrolu ve guncelleme, import/export.
- Tool'lar dar kalir: shell yok, keyfi dosya okuma/yazma yok, `--root` siniri korunur. Yikici tool'lar (silme, toplu guncelleme) once onizleme dondurur.
- MCP resource/prompt'lari: projeye ozel kullanim rehberi ("bu modelle endpoint olustur ve 401/500/bos liste senaryolarini ekle").
- `mock-studio mcp install <istemci>`: istemcinin kendi resmi komutu varsa onu calistirir (or. `claude mcp add`, `codex mcp add`; kullanici onayiyla); yoksa (Copilot, Kiro, Gemini) yapistirilacak yapilandirma parcasini gosterir. Istemcilerin yapilandirma dosyalari dogrudan duzenlenmez.

**Cikis kriterleri:** Gercek bir LLM istemcisiyle (en az Claude Code ve bir digeri) "bu modelle endpoint olustur, 3 senaryo ve header kosulu ekle, sunucuyu baslat" akisi elle dogrulanir; tum tool'lar SDK istemcisiyle otomatik test edilir.

### Milestone 11: Coklu AI CLI provider'i

- Makinede kurulu CLI'lar otomatik bulunur (`PATH` taramasi; calistirmadan once yalniz `--version`): Claude Code (`claude`), Codex (`codex`), GitHub Copilot CLI (`copilot`), Gemini CLI (`gemini`), Kiro CLI (`kiro-cli`).
- Her provider icin etkilesimsiz calistirma, izole yapilandirma, arac/izin kapatma ve cikti ayiklama ayri yazilir ve sahte CLI ile test edilir. Bir provider'in izolasyonu saglanamiyorsa provider "sinirli" isaretlenir ve kullaniciya gosterilir.
- UI ve CLI'da provider secimi (`--ai auto|claude|codex|copilot|gemini|kiro`); onizleme + hash'li onay kurali tum provider'lar icin aynen gecerli.

**Cikis kriterleri:** Kurulu her provider ile tek sentetik modelde elle uretim; CLI yokken, giris hatasinda, timeout'ta yerel uretime donus otomatik testle dogrulanir.

### Milestone 12: Import / export ve kayit modu

Tasarim: [Import ve export](ARCHITECTURE.md#import-ve-export).

- **Kendi paket formatimiz** (`*.mockstudio.json`): bir veya birden fazla collection; endpoint, senaryo, kural, model baglantisi ve sema. Import'ta onizleme ve cakisma cozumu (atla / yeniden adlandir / ustune yaz).
- **Import:** Postman Collection v2.1 (kayitli ornek response'lar senaryo olur), OpenAPI 3.x (ornekler veya semadan uretim), HAR (Charles/Proxyman/tarayici kaydindan), cURL.
- **Export:** kendi paket formatimiz, Postman Collection v2.1 (mock adresine istekler), OpenAPI 3.1 (mevcut).
- **Kayit modu** (kullanici onayi, 2026-11-08): proxy acikken eslesmeyen isteklerin gercek backend yanitlari, kullanicinin sectigi endpoint'ler icin senaryo olarak kaydedilir; kaydetmeden once onizleme, hassas header'lar (Authorization, Cookie, Set-Cookie) atilir ve body'deki token benzeri alanlar uyarilir.
- Import edilen icerik veri olarak ele alinir: guvenli mod ve boyut sinirlari gecerli.

**Cikis kriterleri:** Gidis-donus testi (export -> import ayni projeyi uretir); her import bicimi icin sentetik fixture testi; bozuk dosya hicbir sey yazmadan reddedilir; kayit modu yerel sahte backend ile test edilir ve hassas header'lar dosyaya yazilmaz.

### Milestone 13: Son kullanici dagitimi ve guncelleme

Tasarim: [Dagitim ve guncelleme](ARCHITECTURE.md#dagitim-ve-guncelleme).

- **Birincil yol: tek binary** (M6 SEA prototipi basariliysa): macOS (arm64/x64), Linux (x64/arm64) ve Windows (x64) icin Node gomulu calistirilabilir dosyalar GitHub Releases'ta; kurulum ve guncelleme Homebrew tap ve Scoop/winget ile (`brew upgrade` vb.). Kullanicinin Node kurmasi gerekmez.
- **Yedek yol** (SEA basarisizsa): kurulum betigi (macOS/Linux `install.sh`, Windows `install.ps1`) resmi Node.js dagitimini kullanici dizinine (`~/.mock-studio/runtime`) indirir, SHASUMS256 ile dogrular, `sudo` istemez; `mock-studio update` yeni surumu yan klasore kurar ve geri alma icin onceki surumu saklar.
- Guncelleme kontrolu yalnizca kullanici komutuyla veya acikca acilan ayarla yapilir (telemetri yok).
- `mock-studio doctor`: Node, port, izinler, AI CLI'lari ve proje dosyalari icin tani.
- npm'e yayin (provenance ile) gelistiriciler icin ikincil yol olarak devam eder.

**Cikis kriterleri:** Node kurulu olmayan temiz macOS, Windows ve Linux makinede tek komutla kurulum ve `mock-studio ui` calisiyor; paket yoneticisi veya `update` bir onceki surumden yukseltiyor.

### Milestone 14: Istege duyarli ve dogrulayan response'lar

Oneri havuzundan plana alindi (kullanici onayi, 2026-11-08).

- **Guvenli dinamik degerler:** `{{uuid}}`, `{{now}}`, `{{request.params.id}}`, `{{request.query.x}}`, `{{request.body.$.name}}` gibi sinirli, sabit bir token listesi. Kendi kucuk yorumlayicimizla islenir; Mockoon templating (Handlebars/faker) kapali kalir ve kod calismaz. POST sonrasi olusturulan kaydi geri dondurmek icin.
- **Proje degiskenleri:** `{{vars.baseImageUrl}}` gibi proje bazli degiskenler (yan dosyada; gizli deger tutulmaz).
- **Request modeli dogrulamasi:** Endpoint'e Kotlin/Swift request modeli baglanir; POST/PUT/PATCH body'si modele uymazsa ayarlanabilir 400/422 senaryosu doner ve log hatali alanlari gosterir.
- **Dosya/binary response:** Resim, PDF gibi dosyalar proje klasorunden sunulur (yol `--root` icinde kalir); multipart upload istekleri kabul edilir ve loglanir.

**Cikis kriterleri:** Dinamik token'lar yalniz izin listesindekilerle calisir, bilinmeyen token oldugu gibi birakilip uyarilir; request modeli dogrulamasi 2xx/4xx yolunu dogru secer; dosya yolu kok disina cikamaz. Hepsi entegrasyon testleriyle dogrulanir.

### Milestone 15: Parser kapsami: polymorphism ve kalitim

M5'ten ertelenen madde (kullanici onayi, 2026-11-08).

- Kotlin `sealed class`/`sealed interface` (Kotlinx `@SerialName` + `classDiscriminator`, Gson/Moshi icin ayarlanabilir discriminator) ve Swift enum/protocol tabanli tiplerden `oneOf` sema.
- Kalitimla gelen alanlar (Kotlin `open`/`abstract` ust sinif, Swift class kalitimi).
- Her alt tip icin uretim varyanti.
- Gercek dunya taramasi: acik kaynak Android/iOS/KMP uygulamalarinda `generate --list` calistirilip `issues` listesi raporlanir (firma kodu kullanilmaz).

**Cikis kriterleri:** Sentetik fixture'larda her alt tip icin semaya uygun uretim; desteklenmeyen kaliplar hala acikca raporlanir.

### Milestone 16: Cihaz baglantisi

- **Baglanti ekrani:** Dashboard'da emulator, simulator ve fiziksel cihaz icin base URL'ler ve QR kod; QR, `X-Mock-Scenario` kullanimini anlatan kisa rehbere de baglanir.
- **Yerel HTTPS:** Proje basina yerel CA ve sertifika uretimi (kullanici onayiyla); Android `network_security_config` ve iOS cihaz guven adimlari rehberde. Varsayilan HTTP kalir.

**Cikis kriterleri:** Fiziksel Android ve iOS cihazda QR ile baglanti ve HTTPS ile istek elle dogrulanir.

### Milestone 17: Ek protokoller (ihtiyaca bagli)

Kullanici onayiyla plana alindi; ancak bir kullanim ihtiyaci dogdugunda baslatilir.

- WebSocket ve Server-Sent Events: zamanlanmis mesaj senaryolari.
- GraphQL: tek endpoint uzerinde `operationName` ve degiskenlere gore senaryo secimi (M7 kural motoru uzerine), sema dosyasindan ornek uretim.

**Cikis kriterleri:** Milestone baslarken yazilir.

## Faz gecis kurali

Bir milestone'un cikis kriterleri gecmeden sonraki fazin ozellikleri temel akisa eklenmez. Parser veya motor entegrasyonunda belirsizlik varsa kapsam genisletmek yerine desteklenen durum ve hata mesaji netlestirilir. LAN erisimi ve AI, kullanici acikca etkinlestirmeden varsayilan olmaz.
