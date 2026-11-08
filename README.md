# Mock API Studio

Android, iOS ve Kotlin Multiplatform gelistirmelerinde backend hazir olmadan endpoint'leri yerelde taklit etmek icin offline-first, ucretsiz bir arac.

Arac, Mockoon'un MIT lisansli mock motorunu kutuphane olarak kullanan **bagimsiz bir npm paketidir**. Mockoon'un fork'u veya eklentisi degildir. Mock calistirma ozelliklerini Mockoon motorundan alir; ustune Kotlin/Swift modelinden response uretimi, collection yonetimi, yerel web UI ve Kiro/Copilot icin MCP entegrasyonu ekler.

## Urun hedefi

- Kotlin (Gson, Kotlinx Serialization, Moshi) ve Swift (Codable) modellerinden ortak JSON Schema cikarmak ve semaya uygun, anlamli ornek JSON uretmek.
- Endpoint method, path, status, header ve body'yi duzenlemek; bir endpoint icin birden fazla response senaryosu (success, bos liste, 401, 500) tutmak.
- Endpoint'leri collection'larda gruplamak ve birden fazla collection'i ayni port uzerinde birlikte calistirmak.
- Localhost uzerinde CORS sorunu olmadan Android Emulator, iOS Simulator, WebView ve browser istemcilerine hizmet vermek.
- Mock tanimlarini git'e konabilen JSON dosyalarinda ekip ile paylasmak.
- Istege bagli olarak Kiro/Copilot gibi AI araclariyla is anlamina uygun veri uretmek; AI olmadan da tum temel islevleri calistirmak.

## Temel kararlar

- **Dagitim:** Tek npm paketi (CLI + yerel web UI + MCP server). Paket adi `@mock-api-studio/studio`, komut `mock-studio`. `mock-api-studio` adi npm'de alinmis oldugu icin scoped ad kullanilir; `@mock-api-studio` kapsaminin sahipligi yayin oncesi dogrulanmalidir.
- **Mock motoru:** `@mockoon/commons` ve `@mockoon/commons-server` 9.10.0 (MIT), exact version ile sabitlenir.
- **Veri formati:** `<ad>.environment.json` (Mockoon environment) + `<ad>.studio.json` (araca ozel yan dosya, `schemaVersion: 1`). Ayni environment dosyasi Mockoon CLI ile de calisir.
- **Fork yok:** Electron/Angular bakim yuku, kod imzalama maliyeti ve upstream merge sorunlari nedeniyle reddedildi. Ayrintisi: [Mimari](docs/ARCHITECTURE.md#karar-kaydi).
- **Model parser:** Kotlin ve Swift kaynagi derlenmeden, tree-sitter (WASM) AST'i uzerinden parse edilir; ayri bir child process'te calisir.
- **AI:** Once MCP server (AI araci bizim tool'larimizi cagirir), sonra istege bagli UI icinden AI CLI cagrisi (GitHub Copilot CLI). AI hicbir temel akisi zorunlu kilmaz ve varsayilan kapalidir.
- **Runtime:** Kurulu Node.js >= 22.12 (LTS 22 ve 24 test edildi). Arac kendi Node kurulumunu yapmaz.
- **Guvenli mod:** Paylasilan Mockoon dosyalarindaki templating, data bucket, callback ve CRUD/WebSocket route'lari varsayilan olarak calistirilmaz.
- **Marka:** "Mockoon" adi ve logosu urun adinda veya arayuzde kullanilmaz; bagimlilik ve lisans olarak belirtilir ([NOTICE.md](NOTICE.md)).

## Kurulum

Gereksinim: Node.js >= 22.12 (`node -v`). Android/iOS projesinde baska bir sey gerekmez; arac Kotlin ve Swift kodunu derlemeden okur.

Paket henuz npm'de yayinlanmadigi icin su an iki yol var (ikisi de denendi); sonunda `mock-studio` komutu elinizin altinda olur. Ikisi de `sudo` gerektirmez.

**1. Takim reposundan, ayri bir arac klasorune (onerilen)**

```sh
mkdir -p ~/tools/mock-studio && cd ~/tools/mock-studio
npm init -y
npm install git+ssh://git@<sunucu>/<org>/<repo>.git     # kurulurken `prepare` scripti araci derler (birkac dakika)

# ~/.zshrc icine ekleyin:
export PATH="$HOME/tools/mock-studio/node_modules/.bin:$PATH"
```

Guncellemek icin ayni klasorde `npm install git+ssh://...` komutunu tekrar calistirin (belirli bir surume sabitlemek icin adresin sonuna `#<tag>` ekleyin).

**2. Klonlayip derleme**

```sh
git clone <repo-url> ~/tools/mock-api-studio && cd ~/tools/mock-api-studio
npm ci        # bagimliliklari kurar ve derler

# ~/.zshrc icine ekleyin:
alias mock-studio='node ~/tools/mock-api-studio/dist/cli/main.js'
```

Guncellemek icin `git pull && npm ci`. (`npm link` de kullanilabilir; npm'in global klasoru yazilabilir olmalidir.)

**Zaten Node kullanan bir proje** (React Native, KMP web gibi) araci `npm install -D git+ssh://...` ile bagimlilik olarak ekleyip `npx mock-studio <komut>` diyebilir.

**npm'e yayinlandiktan sonra** kurulum gerekmez: `npx @mock-api-studio/studio <komut>` (ya da `npm install -g @mock-api-studio/studio`).

Kontrol: `mock-studio --version`

## Kullanim

Mock dosyalari mobil uygulama reposunda (ornegin `mocks/`) tutulur ve git ile paylasilir.

**Ilk kez, bir kisi:**

```sh
cd <uygulama-reposu>
mock-studio init mocks --name "Shop API"     # mocks/shop-api.environment.json + shop-api.studio.json
mock-studio ui -p mocks --root . --open        # yerel web UI (--root: model dosyalarinin okunabilecegi klasor)
git add mocks && git commit -m "Add mocks"
```

**Ekipten herkes (git pull sonrasi):**

```sh
mock-studio serve -p mocks                     # aktif collection'lari http://127.0.0.1:3000 uzerinde calistirir
mock-studio ui -p mocks --root . --open        # ya da UI ile duzenleyip calistirin
```

Uygulamanin debug build'ini mock'a yonlendirin: Android Emulator `http://10.0.2.2:3000/`, iOS Simulator `http://localhost:3000/`. Debug `network_security_config` / ATS ayarlari ve fiziksel cihaz adimlari icin `mock-studio snippets`.

Diger komutlar:

```sh
mock-studio generate -m app/model -t "BaseResponse<User>" \
  -p mocks --collection Users --method GET --path /users/:id   # modelden senaryo kaydet
mock-studio check -p mocks --root .                            # model degisti mi? (CI icin; degisiklik varsa 1 ile cikar)
mock-studio export openapi -p mocks -o openapi.json
mock-studio mcp -p mocks --root .                              # Kiro / Copilot icin MCP
```

Komutlarin tam listesi icin `mock-studio --help`; MCP kurulumu ve gelistirme icin [Gelistirme rehberi](docs/DEVELOPMENT.md).

## Dokumanlar

- [Urun gereksinimleri](docs/PRODUCT_REQUIREMENTS.md)
- [Roadmap](docs/ROADMAP.md)
- [Mimari ve guvenlik](docs/ARCHITECTURE.md)
- [Gelistirme rehberi](docs/DEVELOPMENT.md)
- [Devir raporu (Claude Code icin)](docs/HANDOFF.md)
- [Ucuncu parti bildirimleri](NOTICE.md)

## Durum

Roadmap'teki M0-M5 asamalari uygulanmistir; her asamanin kanitlari [Roadmap](docs/ROADMAP.md) dosyasindadir. Dogrulanmayan noktalar (Mockoon desktop, fiziksel cihazlar, Windows/Linux, gercek ekip kod tabani taramasi, Kiro/Copilot chat) orada ve [Gelistirme rehberi](docs/DEVELOPMENT.md#manuel-dogrulama-matrisi) icinde acikca listelenmistir.
