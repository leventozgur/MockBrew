# Gelistirme Rehberi

## Durum

Kaynak kod, test ve scaffold mevcuttur; komutlar [Uygulama komutlari](#uygulama-komutlari) bolumunde gercek script adlariyla yazilidir. Var olmayan komutlari calisir gibi dokumante etmeyin; yeni script eklenince asagiya ekleyin.

## Ortam

- Node.js >= 22.12 (`engines`). Test edilenler: 22.23, 24.22, 25.9. Ayni aralik CI'da (`.github/workflows/ci.yml`) kontrol edilir.
- Paket yoneticisi: npm + lockfile.
- Hedef platformlar: macOS, Windows, Linux (bkz. [Mimari](ARCHITECTURE.md#runtime-ve-platform)).
- Mobil dogrulama icin Android Emulator ve iOS Simulator.

## Bagimlilik kurallari

- Tum bagimliliklar exact version ile eklenir.
- `@mockoon/commons` ve `@mockoon/commons-server` ayni surumde tutulur ve birlikte guncellenir.
- Mockoon guncelleme proseduru:
  1. Mockoon release notlarini ve dosya formati degisikliklerini oku.
  2. Iki paketi ayni surume yukselt.
  3. Runtime entegrasyon testlerini ve Mockoon desktop ile dosya uyumluluk kontrolunu calistir.
  4. Yan dosya formati etkileniyorsa migration ekle.
- Yeni bagimlilik eklemeden once lisansin ucretsiz kullanima uygun oldugu kontrol edilir.
- Mockoon MIT lisans metni ve diger ucuncu parti lisanslar dagitimdaki notice dosyasina eklenir.
- "Mockoon" adi ve logosu paket adinda, UI'da veya ikonlarda kullanilmaz.

## Modul sinirlari

Tek paket, ayri dizinler (`src/`):

| Dizin | Sorumluluk | Mockoon bagimliligi |
|---|---|---|
| `parser/` | tree-sitter ile Kotlin/Swift AST'i -> dil bagimsiz IR; `kotlin/{gson,kotlinx,moshi}.ts` ve `swift/` birbirinden bagimsiz adapter'lar; child process (`host`, `worker`) | yok |
| `schema/` | IR -> JSON Schema, naming/tarih ayarlari, Ajv dogrulama | yok |
| `generator/` | deterministik yerel uretici (alan adi heuristic'leri, varyantlar) | yok |
| `core/` | domain tipleri, dogrulama, cakisma kontrolu, `ProjectService`, model servisi, schema diff, OpenAPI | yok |
| `store/` | Mockoon environment + yan dosya, atomik yazma, dosya izleme | **var** |
| `runtime/` | turetilmis environment, guvenli mod, motoru calistirma, maskeli log | **var** |
| `control-api/` | Fastify, yalniz loopback | yok |
| `mcp/` | MCP tool'lari | yok |
| `ai/` | provider interface'i, process calistirici, prompt | yok |
| `cli/` | komutlar | yok |
| `ui/` (kokte) | React + Vite arayuzu; `src/core/view.ts` gibi saf tip dosyalarini import eder | yok |

Mockoon paketlerine yalnizca `store` ve `runtime` dogrudan bagimlidir. Diger moduller kendi domain tiplerini (`core/model.ts`) kullanir. Gson, Kotlinx Serialization, Moshi ve Swift Codable adapter'lari birbirinden bagimsizdir.

## Test kurallari

### Parser ve uretim

- Fixture'lar kucuk ve sentetiktir; musteri veya production model kodu fixture'a kopyalanmaz.
- Her fixture icin parse sonucu, JSON Schema ve ornek JSON snapshot'i veya semantic assertion'i bulunur.
- Kapsanacak durumlar: nullable/optional, default deger, enum (raw value dahil), liste, map, nested type, basit generic wrapper, baska dosyada tanimli tip, cozumlenemeyen tip, unsupported yapi raporu.
- Naming strategy ve tarih formati ayarlarinin ciktiya etkisi test edilir.
- Yerel uretici deterministiktir: ayni girdi ve seed ayni ciktiyi verir.
- `Long`/`Int64` alanlarinin guvenli aralikta uretildigi ve ham body'de hassasiyetin korundugu test edilir.

### Runtime

- Programatik baslatma/durdurma, port korunmasi ve restartsiz guncelleme.
- Path parametreleri, method/path eslesmesi, collection cakisma ve golgeleme uyarisi.
- Senaryo secimi, latency, status, header, bos body (204).
- Eslesmeyen istek 404 JSON'u ve log isareti.
- CORS preflight, origin yansitma.
- Uretilen environment dosyasinin Mockoon CLI ile de calistigi (uyumluluk testi).

### Dosya katmani

- Atomik yazma, dis degisiklik algilama, kaydedilmemis degisiklikle cakisma.
- Yan dosya icin eski, guncel, bozuk ve bilinmeyen major `schemaVersion`.
- Path traversal ve project klasoru disina yazma denemelerinin reddedilmesi.

### Guvenlik

- Control API'nin loopback disindan, yanlis Host/Origin veya token olmadan erisilemedigi.
- Log maskeleme (Authorization, cookie, API key) ve body loglamanin varsayilan kapali oldugu.
- MCP tool'larinin project klasoru disina erisemedigi ve gecersiz body'yi kaydetmedigi.

### AI CLI adapter

- Mock executable ile: basarili cikti, bozuk JSON, non-zero exit, timeout, cancellation, command not found.
- Kullanici girdisinin shell'e birlestirilmedigi; onay olmadan cagri yapilmadigi.

## Manuel dogrulama matrisi

Durum sutunu, bu depoyu hazirlarken hangi denemenin gercekten yapildigini gosterir.

| Kontrol | Durum |
|---|---|
| Browser: UI acilir, bozuk JSON kaydedilmez, senaryo degisikligi aninda yansir | Yapildi (entegre tarayici; bozuk JSON ayrica otomatik testlerde) |
| Android Emulator: `10.0.2.2` ile response alinir | Yapildi (Pixel_8a AVD, `nc` ile agi dogrular). Uygulama icinde debug `network_security_config` denenmedi |
| Android fiziksel cihaz: `adb reverse` ile `localhost` | `adb reverse` emulatorde dogrulandi; fiziksel cihaz denenmedi |
| iOS Simulator: `localhost` ile response alinir | Yapildi (iPhone 17, `simctl spawn curl`). Uygulama icinde `NSAllowsLocalNetworking` denenmedi |
| iOS fiziksel cihaz: yalnizca LAN binding acikken ve ayni agda baglanir | Denenmedi (LAN secenegi ve uyarilari testlerde) |
| WebView/browser istemcisi: OPTIONS preflight ve CORS ayarlari | HTTP seviyesinde test edildi; gercek bir WebView'de denenmedi |
| Mockoon desktop: arac ile olusturulan dosya acilir, duzenlenir; arac degisikligi algilar | **Denenmedi** (desktop kurulu degil). Mockoon CLI ve Mockoon'un kendi sema dogrulamasi gecti; aracin dis degisikligi algilamasi testlerde |
| Kiro/Copilot: MCP server baglanir, model parse edilir, uretilen body dogrulanip kaydedilir | Protokol seviyesinde SDK istemcisiyle yapildi; gercek Kiro/Copilot chat'i ile denenmedi |
| Windows ve Linux | Denenmedi |
| Ekip kod tabani (Moshi, generic wrapper, sealed class kullanimi) | Denenmedi; `mock-studio generate --list` ile gercek modellerde calistirilmali |

## Release oncesi kontrol

- [x] Control API loopback disina acilmiyor; mock listener LAN'a kullanici secimi olmadan acilmiyor (`test/control-api.test.ts`, `test/cli.test.ts`).
- [x] Mockoon paket surumleri (9.10.0), Node araligi (`>=22.12.0`) ve yan dosya `schemaVersion` (1) belgelenmis.
- [x] Mockoon uyumluluk testi geciyor (Mockoon CLI 9.10.0).
- [x] Lisans notice dosyasi guncel (`npm run notice`); "Mockoon" markasi urun adinda/arayuzde yok.
- [x] Ucretli bir servis veya AI CLI paketlenmiyor; telemetri yok.
- [x] Proje dosyalari mutlak yol, kullanici adi veya token icermiyor (testler). Loglar maskeli; body loglama varsayilan kapali.
- [ ] `@mock-api-studio` npm kapsaminin sahipligi dogrulanmadi; yayin oncesi paket adi kesinlestirilmeli.
- [ ] Mockoon desktop, fiziksel cihaz ve Windows/Linux kontrolleri (yukaridaki matris).
- [ ] Kurumsal kullanim oncesi sirketin acik kaynak arac onayi (MPL-2.0 bagimliligi `@jmespath-community/jmespath` icin not dusuldu).

## Uygulama komutlari

```sh
npm install              # bagimliliklar (exact surum, package-lock.json); `prepare` scripti derlemeyi de yapar
npm run build            # sunucu (tsc -> dist/) ve UI (vite -> dist/ui)
npm run build:server     # yalniz tsc
npm run build:ui         # yalniz UI
npm run dev:ui           # Vite dev sunucusu; MOCK_STUDIO_API=http://127.0.0.1:<ui-portu> ile `ui` komutuna baglanir
npm test                 # vitest (test baslamadan tsc ile dist/ derlenir)
npm run lint             # tip kontrolu: sunucu ve UI
npm run notice           # NOTICE.md'yi uretir

node dist/cli/main.js --help
```

CLI komutlari: `init`, `ui`, `serve`, `generate`, `check`, `export openapi`, `snippets`, `mcp` (`mock-studio <komut> --help`).

Testler derlenmis cikti (`dist/`) uzerinde calisir: parser WASM'i ayri bir child process'te (`--liftoff-only`) oldugu icin `src/parser/host.ts` calisma zamaninda `dist/parser/worker.js`'i bulur. `npm test` bunu `test/global-setup.ts` ile kendisi derler.

## MCP kurulumu (Kiro ve Copilot)

MCP server stdio uzerinden calisir; `--root` model dosyalarinin okunabilecegi klasordur (genelde uygulama reposunun koku), `--project` mock dosyalarinin klasorudur. Ornekler, araci [README'deki kurulum](../README.md#kurulum) ile PATH'e koyduginizi varsayar (`mock-studio --version` calismali). Paket npm'e yayinlandiktan sonra `"command": "npx"` ve `"args": ["-y", "@mock-api-studio/studio", "mcp", ...]` da kullanilabilir.

Kiro (`.kiro/settings/mcp.json`):

```json
{
  "mcpServers": {
    "mock-studio": {
      "command": "mock-studio",
      "args": ["mcp", "--project", "mocks", "--root", "."]
    }
  }
}
```

GitHub Copilot (VS Code, `.vscode/mcp.json`):

```json
{
  "servers": {
    "mock-studio": {
      "type": "stdio",
      "command": "mock-studio",
      "args": ["mcp", "--project", "mocks", "--root", "."]
    }
  }
}
```

Araci PATH'e koymadan denemek icin `"command": "node"` ve `"args": ["<repo>/dist/cli/main.js", "mcp", ...]` kullanin. Chat'te ornek istek: "`app/model/Order.kt` icindeki `Order` icin, biri iptal edilmis uc siparisli bir GET /orders mock'u olustur"; AI sirasiyla `parse_model`, `get_schema`, `save_scenario` tool'larini cagirir ve modele uymayan body reddedilir.
