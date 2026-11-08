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
| `core/import/` | import format readers and conversion into project data | none |
| `core/model-update.ts` | model drift merge, preview, and approved body updates | none |
| `core/certs.ts` | local CA and HTTPS certificate lifecycle | none |
| `core/recording.ts` | proxy recording, filtering, preview, and save | none |
| `store/` | Mockoon environment + sidecar file, atomic writes, file watching | **yes** |
| `runtime/` | derived environment, safe mode, running the engine, masked logs | **yes** |
| `control-api/` | Fastify, loopback only | none |
| `mcp/` | MCP server, guide resource, and narrowly scoped tools under `src/mcp/tools/` | none |
| `ai/` | provider registry (`src/ai/registry.ts`), process runner, prompt | none |
| `cli/` | entry point and command implementations under `src/cli/commands/` | none |
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

### Running tests

```sh
npm test
npm run test:e2e
```

`npm test` builds the server output before running Vitest. `npm run test:e2e` runs the Playwright browser suite using Chromium. Tests in agent sandboxes may hit the operating-system file-watcher limit (`EMFILE`); this is an environment limit, not by itself evidence of a product failure.

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

| Command | Purpose |
|---|---|
| `mockbrew init [dir]` | Create a project (defaults to `./mocks`). |
| `mockbrew ui` | Start the loopback-only dashboard; `--root` bounds model-file reads and `--ai` optionally enables providers. |
| `mockbrew serve` | Run active collections; `--profile` selects a test profile; `--lan` explicitly enables network access. |
| `mockbrew profiles list` | List saved test profiles (`--json` for JSON output). |
| `mockbrew generate` | Parse Kotlin/Swift models and print or save a generated body. |
| `mockbrew check` | Check model drift; `--fix` previews updates and `--yes` applies them. |
| `mockbrew import <file>` | Preview or import bundle, Postman, OpenAPI JSON, HAR, or cURL. |
| `mockbrew export bundle\|postman\|openapi` | Export project data. |
| `mockbrew mcp` / `mockbrew mcp install <client>` | Run the stdio server or configure a supported client. |
| `mockbrew certs create\|show\|delete` | Manage local HTTPS certificates. |
| `mockbrew snippets` | Print debug network setup guidance. |
| `mockbrew doctor` | Diagnose runtime, project, port, assets, parser, cache, and CLI availability. |

Use `mockbrew <command> --help` for exact options. The current CLI help is the option reference.

```sh
npm run build            # server (tsc -> dist/) and UI (vite -> dist/ui)
npm run build:server     # tsc only
npm run build:ui         # UI only
npm run dev:ui           # Vite dev server; connects to the `ui` command via MOCKBREW_API=http://127.0.0.1:<ui-port>
npm run lint             # type checking: server and UI
npm run notice           # generates NOTICE.md
```

Tests run against the compiled output (`dist/`): because the parser WASM runs in a separate child process (`--liftoff-only`), `src/parser/host.ts` locates `dist/parser/worker.js` at runtime. `npm test` builds this itself using `test/global-setup.ts`.

## MCP setup

The MCP server uses stdio. Run `mockbrew mcp install <client>` for `claude`, `codex`, `gemini`, `copilot`, or `kiro`; use `--scope user|project`, `--yes`, or `--print` as shown by `mockbrew mcp install --help`. The command shows the official client command and asks before running it when available. For Kiro, it prints a configuration snippet. Client configuration files are not edited directly. Use `--project` for mock files and `--root` to bound model-file reads.

The server provides the `mockbrew://guide` resource plus tools and prompts for working with the project. Real-client registration and the full flow with a real LLM client have not been verified; setup was exercised with fake client executables.
