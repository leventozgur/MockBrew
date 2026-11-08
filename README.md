# MockBrew

An offline-first, free tool for mocking local endpoints during Android, iOS, and Kotlin Multiplatform development, before a backend is ready.

The tool is an **independent npm package** that uses the MIT-licensed mock engine from Mockoon as a library. It is not a fork or plugin. The engine provides mock runtime features; MockBrew adds response generation from Kotlin/Swift models, collection management, a local web UI, and MCP integration for Kiro/Copilot.

## Product goals

- Derive a shared JSON Schema from Kotlin (Gson, Kotlinx Serialization, Moshi) and Swift (Codable) models and generate meaningful example JSON that conforms to it.
- Edit endpoint methods, paths, statuses, headers, and bodies; keep multiple response scenarios per endpoint (success, empty list, 401, 500).
- Group endpoints into collections and run multiple collections together on one port.
- Serve Android Emulator, iOS Simulator, WebView, and browser clients on localhost without CORS issues.
- Share mock definitions with a team as Git-friendly JSON files.
- Optionally generate domain-appropriate data with AI tools such as Kiro/Copilot; all core features also work without AI.

## Key decisions

- **Distribution:** One npm package (CLI + local web UI + MCP server). Package and command: `mockbrew` (the name was free on npm and Homebrew on 2026-11-08; reserve it before publishing).
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

The package is not yet published to npm, so there are two tested installation options. Both make `mockbrew` available and require no `sudo`.

**1. From the team repository, in a separate tools directory (recommended)**

```sh
mkdir -p ~/tools/mockbrew && cd ~/tools/mockbrew
npm init -y
npm install git+ssh://git@<host>/<org>/<repo>.git     # the prepare script builds the tool (a few minutes)

# Add to ~/.zshrc:
export PATH="$HOME/tools/mockbrew/node_modules/.bin:$PATH"
```

To update, repeat `npm install git+ssh://...` in the same directory (append `#<tag>` to pin a specific version).

**2. Clone and build**

```sh
git clone <repo-url> ~/tools/mockbrew && cd ~/tools/mockbrew
npm ci        # installs dependencies and builds

# Add to ~/.zshrc:
alias mockbrew='node ~/tools/mockbrew/dist/cli/main.js'
```

To update, run `git pull && npm ci`. (`npm link` is also an option; npm's global directory must be writable.)

A project that already uses Node (for example, React Native or KMP web) can add the tool as a dependency with `npm install -D git+ssh://...` and run `npx mockbrew <command>`.

**After npm publication**, use `npx mockbrew <command>` or `npm install -g mockbrew`.

**After the first release**, prebuilt single binaries are planned for macOS, Linux and Windows, with no Node installation required. Install paths will include a Homebrew tap (`brew install <tap>/mockbrew`), Scoop (`scoop install mockbrew` after adding the bucket), and direct downloads from the GitHub Releases page. The tap, bucket, and release URLs will be announced when available.

Check the installation with `mockbrew --version`.

## Usage

Keep project files in the application repository (for example, `mocks/`) and share them through Git.

### Create, edit, and serve a project

```sh
mockbrew init mocks --name "Shop API"
mockbrew ui -p mocks --root . --open
mockbrew serve -p mocks
```

`init` creates an empty project. The UI listens on loopback and can read model files under `--root`. `serve` runs active collections without the UI. Android Emulator uses `http://10.0.2.2:3000/`; iOS Simulator uses `http://localhost:3000/`.

### Conditional responses and profiles

Set scenario rules in the dashboard to select a response from request headers, query values, route parameters, body fields, cookies, or request order. For an app debug menu, add `X-Mock-Scenario: <scenario name>` to a request to force that scenario; this override works in rule mode. Sequential and random modes bypass rules, so the header does not apply there.

Save test profiles in the dashboard to switch scenarios across endpoints. List them or run one directly:

```sh
mockbrew profiles list -p mocks
mockbrew serve -p mocks --profile "Session expired"
```

### Check model drift

```sh
mockbrew check -p mocks --root .
mockbrew check -p mocks --root . --fix       # preview body updates
mockbrew check -p mocks --root . --fix --yes # apply the preview
```

The check compares saved model-linked bodies with current model source. `--fix` previews changes; `--yes` applies that preview. Model source files are read, never executed.

### Import, export, and record

```sh
mockbrew import collection.json -p mocks --format postman --dry-run
mockbrew export bundle -p mocks -o mocks.mockbrew.json
mockbrew export postman -p mocks -o collection.json
mockbrew export openapi -p mocks -o openapi.json
```

Import supports MockBrew bundles, Postman v2.1, OpenAPI JSON, HAR, and cURL. OpenAPI YAML must first be converted to JSON. Import previews can be reviewed in the dashboard or with `--dry-run`; export formats are bundle, Postman, and OpenAPI. Recording mode is available in the dashboard and through MCP: while proxying, unmatched backend responses can be previewed and saved as scenarios.

### MCP clients

Install the server configuration with `mockbrew mcp install claude|codex|gemini|copilot|kiro`. The command invokes the client's official setup command when available, or prints instructions; it does not edit client configuration files. The server exposes the `mockbrew://guide` resource. See the [Development Guide](docs/DEVELOPMENT.md#mcp-setup).

### Optional AI generation

```sh
mockbrew ui -p mocks --root . --ai auto --open
# or select providers explicitly: --ai copilot,claude,codex,gemini
```

AI generation is off by default. Each prompt and result requires preview and approval; the local generator remains available as fallback. "Limited isolation" means a provider's CLI cannot be given the same process/configuration isolation as Copilot, so the UI labels that provider and presents the limitation before approval.

### Connect devices and optional HTTPS

The dashboard connection screen shows base URLs and QR codes for supported emulator, simulator, `adb reverse`, and LAN targets. Physical-device QR scanning and HTTPS have not been verified. HTTP is the default; create project certificates only if HTTPS is needed:

```sh
mockbrew certs create -p mocks
mockbrew snippets --port 3000
```

Certificate creation requires interactive confirmation. Certificates are stored outside the project. LAN access requires explicit `--lan` selection and makes the mock reachable to devices on the network.

### Diagnose setup

```sh
mockbrew doctor -p mocks
```

See `mockbrew <command> --help` for all command options.

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
