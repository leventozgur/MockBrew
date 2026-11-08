# Development Guide

## Status

Source code, tests, and scaffolding are available; commands are listed with their actual script names in [Application commands](#application-commands). Do not document nonexistent commands as if they worked; add new scripts below when they are added.

## Environment

- Node.js >= 22.12 (`engines`). Tested versions: 22.23, 24.22, 25.9. The same range is checked in CI (`.github/workflows/ci.yml`).
- Package manager: npm + lockfile.
- Target platforms: macOS, Windows, Linux (see [Architecture](ARCHITECTURE.md#runtime-and-platform)).
- Android Emulator and iOS Simulator for mobile verification.

## Dependency rules

- Add all dependencies at exact versions.
- Keep `@mockoon/commons` and `@mockoon/commons-server` at the same version and update them together.
- Mockoon update procedure:
  1. Read Mockoon release notes and file format changes.
  2. Upgrade both packages to the same version.
  3. Run runtime integration tests and check file compatibility with Mockoon desktop.
  4. Add a migration if the sidecar file format is affected.
- Periodic dependency review: check releases of both engine packages, update them together using the procedure above, run the full test suite, and update `NOTICE.md` with `npm run notice`.
- Before adding a dependency, verify that its license permits free use.
- Add the Mockoon MIT license text and other third-party licenses to the distribution's notice file.
- Do not use the name or logo "Mockoon" in the package name, UI, or icons.

## Module boundaries

Single package, separate directories (`src/`):

| Directory | Responsibility | Mockoon dependency |
|---|---|---|
| `parser/` | Kotlin/Swift AST via tree-sitter -> language-independent IR; `kotlin/{gson,kotlinx,moshi}.ts` and `swift/` are independent adapters; child process (`host`, `worker`) | none |
| `schema/` | IR -> JSON Schema, naming/date settings, Ajv validation | none |
| `generator/` | deterministic local generator (field-name heuristics, variants) | none |
| `core/` | domain types, validation, conflict detection, `ProjectService`, model service, schema diff, OpenAPI | none |
| `store/` | Mockoon environment + sidecar file, atomic writes, file watching | **yes** |
| `runtime/` | derived environment, safe mode, running the engine, masked logs | **yes** |
| `control-api/` | Fastify, loopback only | none |
| `mcp/` | MCP tools | none |
| `ai/` | provider interface, process runner, prompt | none |
| `cli/` | commands | none |
| `ui/` (at root) | React + Vite interface; imports pure type files such as `src/core/view.ts` | none |

Only `store` and `runtime` depend directly on Mockoon packages. Other modules use their own domain types (`core/model.ts`). The Gson, Kotlinx Serialization, Moshi, and Swift Codable adapters are independent of each other.

## Test rules

### Parsing and generation

- Fixtures are small and synthetic; do not copy customer or production model code into fixtures.
- For each fixture, include a parse result, JSON Schema, and example JSON snapshot or semantic assertion.
- Cover: nullable/optional, default values, enums (including raw values), lists, maps, nested types, simple generic wrappers, types defined in another file, unresolved types, and reports of unsupported constructs.
- Test the effect of naming strategy and date format settings on output.
- The local generator is deterministic: the same input and seed produce the same output.
- Test that `Long`/`Int64` fields are generated within the safe range and that precision is preserved in the raw body.

### Runtime

- Programmatic start/stop, port preservation, and updates without restarting.
- Path parameters, method/path matching, collection conflicts, and shadowing warnings.
- Scenario selection, latency, status, headers, and empty body (204).
- The 404 JSON and log marker for unmatched requests.
- CORS preflight and origin reflection.
- Verify that the generated environment file also works with Mockoon CLI (compatibility test).

### File layer

- Atomic writes, detection of external changes, and conflicts with unsaved changes.
- Old, current, malformed, and unknown-major `schemaVersion` values for the sidecar file.
- Rejection of path traversal and attempts to write outside the project directory.

### Security

- The Control API cannot be accessed from outside loopback, with an incorrect Host/Origin, or without a token.
- Log masking (Authorization, cookie, API key) and body logging disabled by default.
- MCP tools cannot access paths outside the project directory and do not save invalid bodies.

### AI CLI adapter

- With a mock executable: successful output, malformed JSON, non-zero exit, timeout, cancellation, and command not found.
- User input is not concatenated into the shell; no calls are made without approval.

## Manual verification matrix

The Status column shows which checks were actually performed while preparing this repository.

| Check | Status |
|---|---|
| Browser: UI opens, malformed JSON is not saved, scenario changes appear immediately | Done (integrated browser; malformed JSON also covered by automated tests) |
| Android Emulator: receives a response via `10.0.2.2` | Done (Pixel_8a AVD; network verified with `nc`). Debug `network_security_config` was not tested in the app |
| Physical Android device: `localhost` via `adb reverse` | `adb reverse` verified on the emulator; not tested on a physical device |
| iOS Simulator: receives a response via `localhost` | Done (iPhone 17, `simctl spawn curl`). `NSAllowsLocalNetworking` was not tested in the app |
| Physical iOS device: connects on the same network when LAN binding is enabled | Not tested (LAN option and warnings are covered by tests) |
| WebView/browser client: OPTIONS preflight and CORS settings | Tested at the HTTP level; not tested in a real WebView |
| Mockoon desktop: opens and edits a file created by the tool; the tool detects the change | **Not tested** (desktop is not installed). Mockoon CLI and Mockoon's own schema validation passed; detection of external changes is covered by tests |
| Kiro/Copilot: connects to the MCP server, parses a model, validates and saves a generated body | Done at the protocol level with an SDK client; not tested with real Kiro/Copilot chat |
| Windows and Linux | Not tested |
| Team codebase (Moshi, generic wrappers, sealed class usage) | Not tested; run against real models with `mockbrew generate --list` |

## Pre-release checklist

- [x] Control API is not exposed beyond loopback; the mock listener does not bind to LAN without user selection (`test/control-api.test.ts`, `test/cli.test.ts`).
- [x] Mockoon package versions (9.10.0), Node range (`>=22.12.0`), and sidecar `schemaVersion` (1) are documented.
- [x] Mockoon compatibility test passes (Mockoon CLI 9.10.0).
- [x] License notice file is up to date (`npm run notice`); the "Mockoon" brand is absent from the product name/UI.
- [x] No paid service or AI CLI package is bundled; no telemetry.
- [x] Project files contain no absolute paths, usernames, or tokens (tests). Logs are masked; body logging is disabled by default.
- [ ] Reserve the `mockbrew` npm package name (free on 2026-11-08) and check the GitHub repository name before publishing.
- [ ] Mockoon desktop, physical device, and Windows/Linux checks (matrix above).
- [ ] Company approval for open-source tools before corporate use (the `@jmespath-community/jmespath` MPL-2.0 dependency has been noted).

## Application commands

```sh
npm install              # dependencies (exact versions, package-lock.json); the `prepare` script also builds
npm run build            # server (tsc -> dist/) and UI (vite -> dist/ui)
npm run build:server     # tsc only
npm run build:ui         # UI only
npm run dev:ui           # Vite dev server; connects to the `ui` command via MOCKBREW_API=http://127.0.0.1:<ui-port>
npm test                 # vitest (dist/ is built with tsc before tests start)
npm run lint             # type checking: server and UI
npm run notice           # generates NOTICE.md

node dist/cli/main.js --help
```

CLI commands: `init`, `ui`, `serve`, `generate`, `check`, `export openapi`, `snippets`, `mcp` (`mockbrew <command> --help`).

Tests run against the compiled output (`dist/`): because the parser WASM runs in a separate child process (`--liftoff-only`), `src/parser/host.ts` locates `dist/parser/worker.js` at runtime. `npm test` builds this itself using `test/global-setup.ts`.

## MCP setup (Kiro and Copilot)

The MCP server runs over stdio; `--root` is the directory from which model files can be read (usually the root of the app repository), and `--project` is the directory for mock files. The examples assume you have added the tool to PATH using the [installation instructions in the README](../README.md#installation) (`mockbrew --version` should work). After the package is published to npm, you can also use `"command": "npx"` and `"args": ["-y", "mockbrew", "mcp", ...]`.

Kiro (`.kiro/settings/mcp.json`):

```json
{
  "mcpServers": {
    "mockbrew": {
      "command": "mockbrew",
      "args": ["mcp", "--project", "mocks", "--root", "."]
    }
  }
}
```

GitHub Copilot (VS Code, `.vscode/mcp.json`):

```json
{
  "servers": {
    "mockbrew": {
      "type": "stdio",
      "command": "mockbrew",
      "args": ["mcp", "--project", "mocks", "--root", "."]
    }
  }
}
```

To try it without adding the tool to PATH, use `"command": "node"` and `"args": ["<repo>/dist/cli/main.js", "mcp", ...]`. Example chat request: "Create a GET /orders mock for `Order` in `app/model/Order.kt` with three orders, one of them canceled"; the AI calls the `parse_model`, `get_schema`, and `save_scenario` tools in sequence, and bodies that do not match the model are rejected.
