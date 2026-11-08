# Urun Gereksinimleri

## Problem

Mobil uygulama gelistirmesi sirasinda backend endpoint'leri her zaman hazir olmuyor. Ekip, uygulama kodunu bekletmeden mobil modellere uygun JSON donen yerel endpoint'ler tanimlamali, response'lari duzenleyebilmeli, ayni gelistirmede gereken birden fazla endpoint'i birlikte calistirabilmeli ve bu tanimlari ekip ile paylasabilmelidir.

Genel mock araclari (Mockoon, WireMock vb.) mock calistirmayi cozer, ancak mobil model kodundan dogru response uretmeyi cozmez. Bu urunun ayirt edici degeri model'den response uretimidir; mock calistirma Mockoon motorundan alinir.

## Hedefler

- Android, iOS ve KMP uygulamalarinin baglanabilecegi yerel HTTP JSON servisleri sunmak.
- Kotlin/Swift modelinden JSON Schema ve semaya uygun ornek response uretmek.
- Endpoint ve response senaryolarini UI ve CLI uzerinden yonetmek.
- Collection'lari birlikte, tek port uzerinden calistirmak.
- Mock tanimlarini git'e konabilen dosyalarla paylasmak.
- AI, cloud hesabi veya ag baglantisi olmadan temel islevleri calistirmak.
- Kurumsal ve bireysel kullanimda ucretsiz kalmak.

## Ana akislar

### Backend beklenirken endpoint tanimlama

1. Kullanici bir mock dosyasi (project) ve collection olusturur.
2. Method, path (`/users/:id` gibi parametreli olabilir), status, header ve body tanimlar.
3. Collection'lari aktif edip `serve` ile baslatir; mobil uygulamanin debug base URL'ini yerel adrese yonlendirir.
4. Gelen istekleri ve eslesmeyen istekleri loglardan izler.

### Modelden response uretme

1. Kullanici Kotlin/Swift model dosyasini/klasorunu secer veya kodu yapistirir.
2. Arac modeli JSON Schema'ya cevirir; cozumlenemeyen tipleri ve desteklenmeyen yapilari raporlar.
3. Kullanici naming strategy (or. snake_case) ve tarih formati gibi decoder seviyesindeki ayarlari secer.
4. Yerel uretici alan adlarina gore anlamli, deterministik veri uretir. Istenirse minimal, tam dolu ve bos liste varyantlari uretilir.
5. Response onizlenir, duzenlenir ve endpoint'e senaryo olarak kaydedilir.

### AI ile is anlamina uygun veri uretme

1. Kullanici Kiro/Copilot chat'inde MCP tool'lari uzerinden model ve istegini verir ("biri iptal edilmis 3 siparis" gibi).
2. AI araci veriyi uretir; arac semaya gore dogrular ve endpoint'e kaydeder.
3. Sonraki asamada ayni akis UI icinden, kullanicinin onayladigi bir AI CLI cagrisi ile de yapilabilir.

### Ekip ile paylasma

1. Mock dosyalari mobil uygulama reposunda veya ayri bir repoda tutulur.
2. Ekip uyeleri dosyalari git ile ceker; arac ve Mockoon desktop degisiklikleri dosya izleme ile yukler.
3. Disaridan gelen dosyalar surum ve sema acisindan dogrulanir; hatali dosya acik hata verir.

## Fonksiyonel gereksinimler

### Mock calistirma

- FR-01: Project birden fazla collection, collection birden fazla endpoint icerebilmelidir.
- FR-02: Collection'lar tek tek aktif/pasif yapilabilmeli; aktif collection'lar ayni port uzerinden birlikte calismalidir.
- FR-03: Endpoint method, path, status, header ve body tasimalidir. Path parametreleri desteklenmelidir.
- FR-04: Bir endpoint birden fazla response senaryosu tasiyabilmeli ve aktif senaryo UI/CLI'dan secilebilmelidir.
- FR-05: Aktif collection'lar arasinda ayni method + path cakismasi, baslatmadan ve calisirken collection aktif edildiginde acik hata olarak gosterilmelidir. Hangi collection ve endpoint'in cakistigi belirtilmelidir.
- FR-06: Response basina sabit gecikme (latency) ayarlanabilmelidir.
- FR-07: Bos body ile 204 gibi status'ler desteklenmeli; JSON body'ler kaydetmeden once parse edilerek dogrulanmalidir.
- FR-08: Body ham metin olarak saklanmali ve oldugu gibi sunulmalidir (64-bit sayilarin hassasiyeti korunur).
- FR-09: Calisan sunucuda yapilan degisiklik, kullanici yeniden baslatma yapmadan yansimalidir.
- FR-10: Eslesmeyen istekler aciklayici bir JSON ile 404 donmeli ve logda ayrica isaretlenmelidir.
- FR-11: Varsayilan `Content-Type` `application/json; charset=utf-8` olmalidir.
- FR-12: CORS ve OPTIONS preflight ayarlanabilmeli; credentials iceren istekler icin origin yansitma secenegi olmalidir.
- FR-13: Mock'lar UI olmadan, CLI ile (`serve`) calistirilabilmelidir (CI ve UI testleri icin).

### Modelden uretim

- FR-20: Kotlin girdisinde Gson `@SerializedName` (alternate dahil) ve Kotlinx `@Serializable`/`@SerialName` dikkate alinmalidir.
- FR-21: Swift girdisinde `Codable`, `CodingKeys`, Optional alanlar, raw value'lu enum'lar ele alinmalidir.
- FR-22: Basit generic wrapper'lar (`BaseResponse<T>` gibi) tip yerine koyma ile desteklenmelidir.
- FR-23: Naming strategy (birebir, snake_case) ve tarih formati (ISO 8601, epoch saniye/milisaniye) uretim ayari olarak secilebilmelidir.
- FR-24: Birden fazla dosya veya klasor girdisi ile baska dosyada tanimli tipler cozulmeli; cozumlenemeyen tip uyari olarak raporlanmalidir.
- FR-25: Yerel uretici alan adina gore anlamli deger uretmelidir (email, isim, telefon, URL, fiyat, tarih vb.) ve ayni girdide ayni ciktiyi vermelidir.
- FR-26: Minimal (yalniz zorunlu alanlar), tam dolu ve bos liste varyantlari uretilebilmelidir.
- FR-27: Uretilen veya elle duzenlenen body, bagli model semasina gore dogrulanmali; ihlaller uyari olarak gosterilmelidir.

### AI entegrasyonu

- FR-30: Arac, Kiro/Copilot gibi istemcilerin cagirabilecegi bir MCP server sunmalidir (model parse, body dogrulama, endpoint kaydetme).
- FR-31: Istege bagli UI icinden AI CLI uretimi; prompt opsiyoneldir, prompt yoksa alan adlarindan anlamsal veri uretilir.
- FR-32: AI kullanilamiyor veya kapaliysa yerel uretici tum akislari karsilamalidir.

### v1 gereksinimleri (2026-11-08, planlandi)

Kaynak: kullanici kararlari, 2026-11-08. Milestone ve kabul kriterleri [Roadmap - v1 plani](ROADMAP.md#v1-plani-m6-m17) icindedir; henuz uygulanmadi.

- FR-40: Senaryo secimi kosullara baglanabilmelidir: header, query, route parametresi, body alani, cookie ve istek sirasi; esittir, regex, bos/yok, dizi icerir operatorleri; AND/OR birlesimi; tersine cevirme. Eslesme yoksa varsayilan senaryo doner. (M7)
- FR-41: Endpoint modu secilebilmelidir: kurallara gore, sabit senaryo, sirali, rastgele. (M7)
- FR-42: Istemci `X-Mock-Scenario` header'i ile senaryoyu zorla secebilmelidir (proje ayariyla kapatilabilir). (M7)
- FR-43: Request logu hangi senaryonun neden secildigini gostermelidir. (M7)
- FR-44: Adlandirilmis test profilleri bircok endpoint'in senaryosunu tek islemle degistirebilmeli; profiller git ile paylasilabilmelidir. (M8)
- FR-45: Gecikme jitter'i, zaman asimi ve oranli hata gibi ag kosullari simule edilebilmelidir. (M8)
- FR-46: Model degistiginde bagli 2xx body'ler yeni modele uygun olarak, var olan degerler korunarak, onizleme ve onayla guncellenebilmelidir (CLI, MCP, UI). (M9)
- FR-47: MCP, UI ve CLI'daki tum yonetim islemlerini (endpoint, senaryo, kural, profil, collection, sunucu, log, model kontrolu, import/export) dar ve dogrulanan tool'larla sunmalidir. (M10)
- FR-48: Makinede kurulu AI CLI'lari (Claude Code, Codex, Copilot, Gemini, Kiro CLI) algilanmali ve secilebilmelidir. (M11)
- FR-49: Collection'lar tek dosya paketi olarak export/import edilebilmeli; Postman v2.1, OpenAPI 3.x, HAR ve cURL import, Postman v2.1 export desteklenmelidir. (M12)
- FR-50: Node.js kurulu olmayan makinede tek komutla kurulum ve `mock-studio update` ile guncelleme/geri alma yapilabilmelidir. (M13)
- FR-51: Proxy uzerinden gelen gercek backend yanitlari, onizleme ve hassas header temizligiyle senaryo olarak kaydedilebilmelidir. (M12)
- FR-52: Response'larda izin listeli, kod calistirmayan dinamik degerler ve proje degiskenleri kullanilabilmelidir. (M14)
- FR-53: Request body'si bagli request modeline gore dogrulanabilmeli; uymazsa 400/422 senaryosu donmelidir. (M14)
- FR-54: Dosya/binary response sunulabilmeli, multipart upload istekleri kabul edilmelidir. (M14)
- FR-55: Sealed class/polymorphism ve kalitim modellerden sema ve ornek uretilebilmelidir. (M15)
- FR-56: Dashboard cihaz baglantisi icin base URL ve QR kod gostermeli; istege bagli yerel HTTPS sunulmalidir. (M16)
- FR-57: WebSocket/SSE ve GraphQL ihtiyac halinde desteklenir. (M17)

## Ilk parser kapsami

- Kotlin: data class, temel scalar tipler, nullable alanlar, default degerli alanlar, ic ice tipler, `List`/`Set`/`Map<String, T>`, enum'lar, basit generic'ler, `@Serializable`, `@SerialName`, `@Transient`, Gson `@SerializedName`.
- Swift: `Codable` struct, `CodingKeys`, temel scalar tipler, Optional alanlar, ic ice tipler, diziler, sozlukler, raw value'lu enum'lar, basit generic'ler.
- Bilinen tipler icin eslemeler: `Date`, `Instant`, `kotlinx.datetime`, `UUID`, `URL`, `BigDecimal`, `Long`/`Int64`.
- Unsupported olarak raporlanacaklar: custom serializer/`init(from:)`, sealed class / polymorphism, property wrapper'lar, hesaplanan alanlar, kalitim ile gelen alanlar (ilk surumde).
- Swift'te baslangic degeri olan `let` alanlarin decode edilmedigi dikkate alinmalidir.
- Parser kaynak kodu derlememeli veya calistirmamalidir. Desteklenmeyen yapilar sessizce atlanmaz.
- Moshi (`@Json(name=)`) kullanimi M0'da ekip kod tabanlarinda kontrol edilir; yayginsa ilk kapsama alinir.

## Offline, guvenlik ve gizlilik

- Yonetim UI/API yalnizca loopback'te dinler. Mock listener varsayilan olarak `127.0.0.1`'e bind edilir; LAN erisimi acik kullanici secimiyle acilir.
- Model uretimi ve mock calistirma ag baglantisi gerektirmez.
- AI'a hicbir veri kullanici aksiyonu ve gorunur onay olmadan gonderilmez.
- Request loglarinda Authorization, cookie ve API key basliklari maskelenir; body kaydi varsayilan kapalidir.
- Kullanici model kodu, import edilen JSON veya prompt hicbir sekilde shell komutu olarak calistirilmaz.
- Telemetri yoktur.

## Lisans ve maliyet

- Arac ve tum calisma zamani bagimliliklari ucretsiz ve acik kaynak lisanslidir.
- Mockoon paketlerinin MIT lisans metni dagitimda korunur; "Mockoon" markasi urun adinda veya logosunda kullanilmaz.
- Ucretli bir hizmet veya AI CLI paketlenmez. AI kullanimi kullanicinin kendi lisansiyla olur.
- Kisisel acik kaynak projedir (MIT); hicbir sirketle baglantisi yoktur ve GitHub'da yayinlanacaktir (kullanici karari, 2026-11-08). Depoda firma veya musteri kodu, adi ya da verisi bulunmaz.

## MVP kabul kriterleri

- Bir Kotlin Gson, bir Kotlinx Serialization ve bir Swift Codable modelinden (generic wrapper dahil) semaya uygun JSON uretilir.
- Naming strategy ve tarih formati ayarlari uretilen JSON'a dogru yansir.
- UI'da project, birden fazla collection ve endpoint olusturulur; endpoint basina birden fazla senaryo tutulur.
- Aktif collection'lar tek port uzerinden calisir; cakisan method/path acik hata verir.
- Body/status/header/senaryo degisikligi restart gerektirmeden yansir; bozuk JSON kaydedilmez.
- Android Emulator (`10.0.2.2`) ve iOS Simulator (`localhost`) dogru response'u alir.
- Mock dosyasi Mockoon desktop ile acildiginda route'lar ve response'lar korunmus olur.
- `serve` komutu UI olmadan ayni dosyayi calistirir.
- Tum bu akislar AI ve ag baglantisi olmadan calisir.

## MVP disi

- Online ekip senkronizasyonu, hesap sistemi.
- Stateful CRUD backend davranisi (Mockoon'un data bucket ozellikleri dosyada korunur ama UI'da yonetilmez).
- Request'e gore response kurallari, proxy ve sablonlama icin UI (Mockoon desktop ile ayni dosya uzerinden kullanilabilir). Kurallar icin UI v1'de planlandi (FR-40).
- Sealed class/polymorphism, custom serializer ve kalitim destegi. Sealed class ve kalitim v1'de planlandi (FR-55); custom serializer kapsam disi kalir.
- UI icinden AI CLI cagrisi (MCP sonrasi).
- Kendi Node.js kurulumunu yapan bootstrap, tek binary veya Docker dagitimi. Node kurulumu ve guncelleme v1'de planlandi (FR-50).
- Varsayilan acik LAN erisimi.

## Uygulama notlari

Gereksinimlerin uygulamada nasil yorumlandigi; kanitlar [Roadmap](ROADMAP.md) dosyasindadir.

- FR-05: Path parametre adlari cakisma kontrolunde onemsizdir (`/users/:id` ile `/users/:userId` ayni route'tur). Daha once gelen parametreli route'un sonradan gelen sabit route'u golgelemesi (`/users/:id` ve `/users/me`) hata degil uyari olarak raporlanir.
- FR-12: CORS `wildcard` (`*`) veya `reflect` (istegin origin'i, `Allow-Credentials: true`, `Vary: Origin`) modunda yapilandirilir.
- FR-27: Endpoint'e bagli model, yalnizca 2xx senaryolarinin body'sini dogrular; 4xx/5xx hata response'lari kendi seklini tasir ve basarili response modeline gore denetlenmez. Ihlaller UI'da uyari, `save_scenario` ve `check` icinde hata olarak gorunur.
- FR-31: UI icinden AI CLI uretimi `mock-studio ui --ai copilot` ile acilir; prompt opsiyoneldir; her gonderim onizleme ve onay gerektirir.
- Kapsam eki: Moshi `@Json(name, ignore)` ilk parser kapsamindadir; typealias ve recursive tipler desteklenir.
- Kapsam eki (guvenlik): Mockoon templating, data bucket, callback ve CRUD/WebSocket route'lari varsayilan olarak calistirilmaz (guvenli mod); proje ayarindan acikca acilabilir.
- M5 ile gelenler: eslesmeyen istekler icin gercek backend'e proxy (kapali baslar), model degisikligi kontrolu (`check`), OpenAPI export.
