# Mock API Studio

An offline-first, free tool for mocking local endpoints during Android, iOS, and Kotlin Multiplatform development, before a backend is ready.

The tool is an **independent npm package** that uses the MIT-licensed mock engine from Mockoon as a library. It is not a fork or plugin. The engine provides mock runtime features; Mock API Studio adds response generation from Kotlin/Swift models, collection management, a local web UI, and MCP integration for Kiro/Copilot.

## Product goals

- Derive a shared JSON Schema from Kotlin (Gson, Kotlinx Serialization, Moshi) and Swift (Codable) models and generate meaningful example JSON that conforms to it.
- Edit endpoint methods, paths, statuses, headers, and bodies; keep multiple response scenarios per endpoint (success, empty list, 401, 500).
- Group endpoints into collections and run multiple collections together on one port.
- Serve Android Emulator, iOS Simulator, WebView, and browser clients on localhost without CORS issues.
- Share mock definitions with a team as Git-friendly JSON files.
- Optionally generate domain-appropriate data with AI tools such as Kiro/Copilot; all core features also work without AI.

## Key decisions

- **Distribution:** One npm package (CLI + local web UI + MCP server). Package: `@mock-api-studio/studio`; command: `mock-studio`. The unscoped `mock-api-studio` name is taken on npm, so a scoped name is used; ownership of `@mock-api-studio` must be verified before publishing.
- **Mock engine:** `@mockoon/commons` and `@mockoon/commons-server` 9.10.0 (MIT), pinned to exact versions.
- **Data format:** `<name>.environment.json` (Mockoon environment) + `<name>.studio.json` (tool-specific sidecar, `schemaVersion: 1`). The environment file also works with Mockoon CLI.
- **No fork:** Rejected due to Electron/Angular maintenance, code-signing cost, and upstream merge burden. Details: [Architecture](docs/ARCHITECTURE.md#decision-log).
- **Model parser:** Parse Kotlin and Swift source without compiling it, using a tree-sitter (WASM) AST in a separate child process.
- **AI:** First an MCP server (the AI tool calls our tools), then an optional AI CLI call from the UI (GitHub Copilot CLI). No core workflow requires AI; it is disabled by default.
- **Runtime:** Installed Node.js >= 22.12 (LTS 22 and 24 tested). The tool does not install Node itself.
- **Safe mode:** Templating, data buckets, callbacks, and CRUD/WebSocket routes in shared Mockoon files are not executed by default.
- **Brand:** The Mockoon name and logo are not used in the product name or UI; the dependency and license are identified in [NOTICE.md](NOTICE.md).

## Installation

Requirement: Node.js >= 22.12 (`node -v`). No additional Android/iOS project setup is needed; the tool reads Kotlin and Swift without compiling them.

The package is not yet published to npm, so there are two tested installation options. Both make `mock-studio` available and require no `sudo`.

**1. From the team repository, in a separate tools directory (recommended)**

```sh
mkdir -p ~/tools/mock-studio && cd ~/tools/mock-studio
npm init -y
npm install git+ssh://git@<host>/<org>/<repo>.git     # the prepare script builds the tool (a few minutes)

# Add to ~/.zshrc:
export PATH="$HOME/tools/mock-studio/node_modules/.bin:$PATH"
```

To update, repeat `npm install git+ssh://...` in the same directory (append `#<tag>` to pin a specific version).

**2. Clone and build**

```sh
git clone <repo-url> ~/tools/mock-api-studio && cd ~/tools/mock-api-studio
npm ci        # installs dependencies and builds

# Add to ~/.zshrc:
alias mock-studio='node ~/tools/mock-api-studio/dist/cli/main.js'
```

To update, run `git pull && npm ci`. (`npm link` is also an option; npm's global directory must be writable.)

A project that already uses Node (for example, React Native or KMP web) can add the tool as a dependency with `npm install -D git+ssh://...` and run `npx mock-studio <command>`.

**After npm publication**, use `npx @mock-api-studio/studio <command>` or `npm install -g @mock-api-studio/studio`.

Check the installation with `mock-studio --version`.

## Usage

Keep mock files in the mobile application repository (for example, `mocks/`) and share them through Git.

**First-time setup (one team member):**

```sh
cd <application-repository>
mock-studio init mocks --name "Shop API"     # mocks/shop-api.environment.json + shop-api.studio.json
mock-studio ui -p mocks --root . --open        # local web UI (--root: directory from which model files may be read)
git add mocks && git commit -m "Add mocks"
```

**Everyone else (after `git pull`):**

```sh
mock-studio serve -p mocks                     # runs active collections at http://127.0.0.1:3000
mock-studio ui -p mocks --root . --open        # or edit and run them in the UI
```

Point the application's debug build at the mock: Android Emulator `http://10.0.2.2:3000/`, iOS Simulator `http://localhost:3000/`. For debug `network_security_config` / ATS settings and physical-device steps, run `mock-studio snippets`.

Other commands:

```sh
mock-studio generate -m app/model -t "BaseResponse<User>" \
  -p mocks --collection Users --method GET --path /users/:id   # save a scenario from a model
mock-studio check -p mocks --root .                            # check for model changes (exit 1 if changed; for CI)
mock-studio export openapi -p mocks -o openapi.json
mock-studio mcp -p mocks --root .                              # MCP for Kiro / Copilot
```

Run `mock-studio --help` for the full command list. For MCP setup and development, see the [Development Guide](docs/DEVELOPMENT.md).

## About `npm audit` warnings

Advisories for `@faker-js/faker` (code execution) and `joi` (denial of service) come through the mock engine packages. Safe mode, which is enabled by default, disables the risky engine features such as templating. **Do not run `npm audit fix`**: it downgrades the engine.

## Documentation

- [Product Requirements](docs/PRODUCT_REQUIREMENTS.md)
- [Roadmap](docs/ROADMAP.md)
- [Architecture and Security](docs/ARCHITECTURE.md)
- [Development Guide](docs/DEVELOPMENT.md)
- [Handoff](docs/HANDOFF.md)
- [Third-party notices](NOTICE.md)

## Status

Milestones M0-M5 in the roadmap are implemented; evidence for each milestone is in the [Roadmap](docs/ROADMAP.md). Unverified items (Mockoon desktop, physical devices, Windows/Linux, scanning real team codebases, and Kiro/Copilot chat) are explicitly listed there and in the [Development Guide manual verification matrix](docs/DEVELOPMENT.md#manual-verification-matrix).
