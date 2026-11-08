# Roadmap

No estimates are given; each milestone is closed against its exit criteria. Priorities are based on the product's differentiating value (from model to production).

Status: M0-M5 have been implemented; M6-M17 are planned (see [v1 plan](#v1-plan-m6-m17)). The "Result" section at the end of each milestone lists evidence and points that have not yet been verified. "Verified" is used only for a test that was run or a manual check that was performed; the team's codebase, Mockoon desktop, physical devices, and Windows/Linux could not be tested in this environment and therefore remain open items.

## Milestone 0: Technical validation

### Tasks

- **Mockoon engine prototype:** Start/stop an environment programmatically with `@mockoon/commons-server`; try updating without restarting, disabled routes, folders, and port behavior.
- **Collection model:** Validate the Collection = environment folder mapping; choose a mechanism for inactive collections.
- **Sidecar file:** Determine its name, location, and initial `schemaVersion` format.
- **Mockoon desktop compatibility:** Verify that a file written by the tool opens in desktop and that file watching reflects changes in both directions.
- **Parser:** Try the tree-sitter Kotlin/Swift grammars in Node (WASM); measure parseability using representative Gson, Kotlinx, and Codable fixtures.
- **Team codebase scan:** Identify usage of Moshi, generic wrappers, sealed classes, and decoder-level naming/date strategies.
- **JSON Schema:** Choose a draft and shared schema representation.
- **Platform:** Set the Node LTS range, target OS test matrix, and package name (scoped).
- **MCP:** Choose the MCP SDK and tool list.

### Exit criteria

- The engine prototype applies scenario changes without restarting (or without disruption); limitations are documented.
- Collection mapping and sidecar format are fixed.
- Parse success/failure examples and an unsupported list exist for each model type.
- Decisions about Moshi and other scope are based on the team scan.

### Result

Decision details: [Architecture - M0 technical validation results](ARCHITECTURE.md#m0-technical-validation-results).

- **Engine prototype:** Verified. Body/status/header/scenario/latency changes are reflected without a restart through `MockoonServer.updateEnvironment()`; if the port or host changes, the runtime restarts itself with the same port settings. Inactive collections are implemented by excluding them from the environment derived for the runtime.
- **Collection model and sidecar:** Collection = a top-level Mockoon folder; routes outside folders belong to the virtual "Ungrouped" collection. Sidecar: `<name>.studio.json`, `schemaVersion: 1`; a future major version is not loaded silently.
- **Parser:** The tree-sitter Kotlin and Swift WASM grammars run in Node (`web-tree-sitter` 0.24.7 + `tree-sitter-wasms` 0.1.13; incompatible with 0.27 grammars). On Node 24+, V8's WASM compiler crashes from memory exhaustion with these grammars, so the parser runs in a separate child process with `--liftoff-only`.
- **JSON Schema:** Draft 2020-12, validation with Ajv 8.20.
- **Platform:** Node >= 22.12; the full test suite passed on Node 22.23, 24.22, and 25.9. Not tested outside macOS; the CI matrix is defined in `.github/workflows/ci.yml`.
- **MCP:** `@modelcontextprotocol/sdk` 1.32.2, stdio; the tool list is in the [Architecture](ARCHITECTURE.md#mcp-server-primary) section.
- **Mockoon desktop compatibility:** Verified (automated test) with Mockoon's own `EnvironmentSchema` validation and Mockoon CLI 9.10.0. The desktop app is not installed on this machine, so opening and editing in both directions were not manually tested; file watching and loading external changes were tested in the tool.
- **Team codebase scan:** Not done (no access to the codebase). Moshi `@Json(name, ignore)` was included because it was inexpensive; sealed classes, inheritance, `init(from:)`, and custom serializers are unsupported and explicitly reported. Running `mockbrew generate --list` on real models and reviewing the reported `issues` list will close this item.

## Milestone 1: Model-to-output core

### Tasks

- Gson, Kotlinx Serialization, and Swift Codable adapters.
- Normalize to shared JSON Schema; simple generic substitution; multi-file type resolution.
- Naming strategy and date format settings.
- Deterministic local generator with field-name heuristics; minimal / full / empty-list variants.
- Schema validation.
- `generate` CLI command: write JSON from model input to stdout or a Mockoon route.

### Exit criteria

- Fixtures for all three model types, including generic wrappers, pass.
- Generated JSON is valid against the schema; naming and date settings are reflected correctly in the output.
- Unsupported structures and unresolved types are explicitly reported.

### Result

Verified (`test/models.test.ts`, 32 tests): Gson, Kotlinx Serialization, Moshi, and Swift Codable adapters; generic wrapper (`BaseResponse<Page<Product>>`), typealias, recursive types, multi-file resolution, naming (`identity`, `snake_case`) and date (`iso8601`, epoch seconds/milliseconds) settings, safe numeric range for `Long`, minimal/full/empty-list variants, same seed = same output. Generated JSON is valid against the schema for every fixture, variant, and settings combination. Reported structures: sealed class, inheritance, custom serializer/adapter, `init(from:)`, property wrapper, enum associated value, computed/delegated property, syntax error, unresolved type.

## Milestone 2: Mock runtime and local UI (MVP)

### Tasks

- `serve` command: run active collections on a single port with the Mockoon engine.
- Conflict and shadowing checks; JSON 404 for unmatched requests.
- Control API (loopback, token, Host/Origin checks).
- Local web UI: project/collection/endpoint management, scenario editing and selection, latency, status/header/body editor, model generation screen, start/stop, logs.
- File layer: atomic writes, file watching, external change detection.
- CORS settings; log masking.
- Android/iOS debug network configuration snippets and connection guide (`10.0.2.2`, `localhost`, `adb reverse`).

### Exit criteria

- MVP acceptance criteria in PRODUCT_REQUIREMENTS are met.
- The same file also works with Mockoon desktop and Mockoon CLI.

### Result

Verified: `test/project.test.ts` (20), `test/control-api.test.ts` (12), `test/cli.test.ts` (8), `test/safe-mode.test.ts` (4), `test/ui-util.test.ts` (5).

- `serve`, conflict (`duplicate` error, `shadowed` warning) and shadowing checks, JSON 404 and log marker for unmatched requests, CORS preflight and origin reflection, atomic writes, file watching, reload on external changes, refusal to overwrite stale files (`STALE`), refusing to save malformed JSON, log masking and body logging disabled, port conflict message.
- Control API: `127.0.0.1` only, token (TTL 8 hours), Host and Origin checks, no CORS, path traversal and symlink rejection.
- Local UI (React): collection/endpoint/scenario management, JSON validation, model generation dialog, start/stop, request logs, connection guide, settings. Manually tried in a browser (creating a collection, generating a body from a model, starting the server, request list).
- Mockoon CLI 9.10.0 runs the same environment file (automated compatibility test).
- **Manual verification (on this machine):** Android Emulator (Pixel_8a AVD) received the correct response from the mock using `10.0.2.2:<port>` and `adb reverse` + `localhost`; iOS Simulator (iPhone 17) received the correct response using `localhost:<port>`. These checks verify networking; app-level cleartext/ATS settings (`network_security_config`, `NSAllowsLocalNetworking`) were not tested without an application project.
- **Open:** Opening and editing with Mockoon desktop, physical Android/iOS devices, CORS inside a WebView, Windows, and Linux.

When Milestones 1 and 2 are complete, the **offline MVP** is ready.

## Milestone 3: MCP server

### Tasks

- Stdio MCP server: model parsing, schema retrieval, body validation, saving endpoints/scenarios, listing collections.
- Prevent access outside the project directory; reject invalid bodies.
- Setup examples for Kiro and Copilot.

### Exit criteria

- The flow "generate ... with this model" from Kiro or Copilot chat is saved to the file as a validated scenario.
- All MVP flows work exactly as before without MCP.

### Result

Verified (`test/mcp.test.ts`, 7 tests; with a real stdio MCP client): six narrow tools (`list_collections`, `parse_model`, `get_schema`, `generate_sample`, `validate_body`, `save_scenario`); no shell or arbitrary file tool. The "generate with this model" flow writes a validated scenario to the file via `parse_model` -> `get_schema` -> `save_scenario`; invalid JSON or a body that does not match the model is rejected without saving anything; access outside the root (`..`, absolute path, symlink) is rejected. All flows that do not use MCP work without MCP under the same tests.

Setup examples: [Development guide](DEVELOPMENT.md#mcp-setup).

**Open:** The flow was not tried with real Kiro or Copilot chat; it was verified at the protocol level with the SDK client.

## Milestone 4: Optional AI CLI (from the UI)

### Tasks

- Provider interface and a single CLI integration selected based on M0/M3 experience.
- Preview of source/schema/prompt to be sent and explicit approval.
- Secure process launch in a temporary directory, with agent permissions disabled/restricted.
- Validate output; fall back to the local generator on failure.

### Exit criteria

- No data is sent to the CLI without approval.
- If the CLI is missing, authentication fails, or times out, the app continues with local generation.

### Result

Selected integration: **GitHub Copilot CLI** (the team uses Kiro/Copilot, and the CLI supports both non-interactive operation with `-p` and tool/permission filters). The provider interface (`AiProvider`) allows adding another CLI.

Verified (`test/ai.test.ts`, 14 tests; using fake CLI executables): preview starts no process; approval is given only for the hash of the previewed prompt (`FORBIDDEN` if the prompt changes); successful output, output in a code fence, malformed JSON, JSON that does not match the model, nonzero exit code, CLI not found, timeout (process terminated), and cancellation (process terminated) cases; local generation is used in the last five cases. The prompt is a single argv element (no shell); the process starts in an empty temporary directory with an allowlisted environment; `--config-dir` is an empty temporary directory (the user's MCP servers, hooks, and extensions are not loaded); the tool list is emptied; `shell` and `write` are denied. AI is enabled only with `ui --ai copilot`; it is not stored in the project file.

Manually tried with the real Copilot CLI 1.0.27 on one synthetic model: a valid response arrived in ~12 seconds and matched the schema. In initial attempts, the CLI produced no response for 25-90 seconds with the user's regular Copilot configuration (many MCP servers configured), but did respond with an empty `--config-dir`; therefore an isolated `--config-dir` is used (the cause-and-effect relationship was not conclusively attributed to MCP servers). Authentication also remained valid with an empty configuration directory (probably through the system keychain); on an installation that does not use a keychain, the CLI will fail authentication and the tool will fall back to local generation.

## Milestone 5: Advanced scenarios and distribution

Items to evaluate (write separate acceptance criteria for each):

| Item | Decision | Acceptance criteria | Status |
|---|---|---|---|
| Proxy / fallback UI | Done | Disabled by default; when enabled, only unmatched requests go to the specified backend, while a matching mock takes precedence; `proxied` appears in the log; backend address must be `http(s)`, contain no credentials, and must not point to the mock server itself. | Verified (`test/m5.test.ts`) |
| LAN binding UI for physical iOS devices | Done | Explicitly approved LAN option (`0.0.0.0`) in settings; UI and `serve` warn when enabled; connection guide shows the LAN IP; default is `127.0.0.1`. | Verified (`test/project.test.ts`, `test/cli.test.ts`); physical device not tested |
| Schema diff when the model changes | Done | Reload the linked model's source files; list added/deleted/type-changed fields, required-field and enum changes as breaking or compatible; validate saved bodies against the new schema; `mockbrew check` exits with 1 if there are breaking changes. | Verified (`test/m5.test.ts`) |
| OpenAPI export from generated schemas | Done | OpenAPI 3.1; path parameters use `{id}`, status codes come from scenarios, 2xx responses use the linked model schema and example bodies; same-named types with different shapes are disambiguated; inactive collections are excluded by default. This is a contract proposal for the backend team. | Verified (`test/m5.test.ts`); not tried with an external OpenAPI validator |
| UI for request-based response rules | Deferred; moved to M7 (2026-11-08) | Rules are preserved in the file and work; edit by opening the same file in Mockoon desktop. If a UI is built: add/remove/reorder rules (target/modifier/value/operator), validate before saving, and round-trip with desktop using the same file. | Open |
| Sealed class / polymorphism, inheritance | Deferred | Explicitly reported as unsupported in the first version (`sealed-class`, `inheritance`). If implemented: `oneOf` schema from sealed subtypes, configurable `type` discriminator, and a generation variant for each subtype. Included in scope for Moshi in M0. | Open |
| Single binary or Docker distribution | Single-binary M6 prototype moved to M13; Docker removed from scope on 2026-11-08 | Docker is not installed on this machine, and Node SEA packaging of WASM/UI assets has not been tried. Acceptance criteria: `serve`/`ui` run with `docker run` on a clean machine, and the image contains only production dependencies. | Open |

## v1 plan (M6-M17)

Source: user decisions, 2026-11-08 (see [Handoff - Section 8](HANDOFF.md#8-decisions-pending-from-the-user)). Design details: [Architecture - v1 designs](ARCHITECTURE.md#v1-designs-proposal). None of the milestones in this section have been implemented yet; their status is "Planned".

The v1 product goals:

1. **During development, LLMs use the tool automatically through MCP:** create endpoints, scenarios, conditions, and test profiles; read the model, generate responses, and update mocks when the model changes.
2. **During testing, developers use the dashboard:** see how the app behaves in different situations by returning different responses (status, body, header, delay) based on headers, parameters, body, or request order.
3. **End-user product:** installation and updates, including Node, take one command; the project is published as open source (MIT) on GitHub.

Principle: Every new feature is implemented in core and made available through **CLI, MCP, and UI** in the same milestone (feature parity). A feature is not considered "done" until it is available through MCP.

### Milestone 6: Open-source readiness and foundational hardening

- Turn the project into a git repository; remove company/customer references before the first commit (including reference application paths in `docs/HANDOFF.md`).
- Fix timing flakiness in `test/ai.test.ts` (wait for the recording file; assert that `call` is defined).
- Add `windows-latest` to the CI matrix; run CI for the first time.
- `CONTRIBUTING.md`, `SECURITY.md`, issue/PR templates, `CHANGELOG.md`.
- Translate all documentation into English (user decision, 2026-11-08); code and UI text are already in English.
- **Name check:** Check the "MockBrew" name for conflicts and distinctiveness on GitHub, npm, and Homebrew; suggest a new name to the user if needed.
- **Single-binary prototype (Node SEA):** Can `serve`, `ui`, `mcp`, and the parser child process (WASM) run with UI assets in a single executable? The result determines the M13 distribution design.
- **Dependency note:** Explain in the README how `npm audit` warnings (faker/joi pulled in through Mockoon) are mitigated by safe mode; add a periodic dependency update step to the DEVELOPMENT guide.
- **UI E2E tests:** Initial Playwright tests for core dashboard flows (create collection/endpoint/scenario, start server, logs); later milestones protect UI changes with these tests.

**Exit criteria:** CI is green on macOS, Linux, and Windows with Node 22/24 (once the GitHub repository is opened); the full test suite is stable across 5 consecutive runs; no company references remain in the repository; the SEA prototype result (works/does not work and why) is recorded; a name decision is made.

**Status (2026-11-08): in progress.**
- Done: git repository (local, no remote) with company references removed; flaky `test/ai.test.ts` fixed (5 consecutive focused runs and full suite passed); `windows-latest` added to the CI matrix; docs translated to English; CONTRIBUTING, SECURITY, CHANGELOG and issue/PR templates; `npm audit` note and periodic dependency review step; Playwright E2E suite (`npm run test:e2e`, 1 scenario covering scenario editing, live switching, logs and local generation; passed locally) and a separate CI job.
- SEA prototype: works on macOS arm64 (see [SEA research](research/SEA.md)); release work remains for M13.
- Open: CI has never run (no GitHub repository yet); name decided: **MockBrew** (user, 2026-11-08; the previous name was taken). Package/command `mockbrew`, free on npm and Homebrew on 2026-11-08; GitHub not verified.

### Milestone 7: Conditional responses (rule engine)

First step (2026-11-08 correction): **close MCP gaps in existing features**: create/update/delete endpoints, update/delete/activate scenarios, create/activate collections, start/stop/check server status, and recent request logs. Since the primary use is LLMs working through MCP, this does not wait for M10.

Expose Mockoon's response rules, which already work in the file, through the domain model, UI, CLI, and MCP. Design: [Conditional responses](ARCHITECTURE.md#conditional-responses).

- Domain model: `rules` and `rulesOperator` (AND/OR) on a scenario; `responseMode` (rules / fixed / sequential / random) on an endpoint.
- Condition targets: header, query, route parameter, body (JSON path or form field), cookie, request order (`request_number`). Operators: equals, regex (case-sensitive and insensitive), empty/missing, array contains, empty array; each condition can be negated.
- Forced selection: the `X-Mock-Scenario: <scenario name>` header (enabled/disabled by project setting; enabled by default) takes precedence over other rules. Used to select a scenario from the app's debug menu.
- UI: rule editor in the scenario list, drag-and-drop ordering (first match wins), "default" marker, rule validation.
- Logging and inspection: show which scenario was selected for each request and why ("why this response"). First use information reported by the engine (response uuid, events); if the matched rule cannot be retrieved from the engine, reevaluate the rules in core for display only and log a warning about the difference from the engine.
- Sidecar `schemaVersion: 2`: rules are in the environment file; tool data such as endpoint mode/profile/variables is in the sidecar; v1 files are automatically upgraded without loss (migration test), and v2 files are rejected with a clear error by older versions.
- MCP/CLI: add/remove/reorder rules and endpoint mode.

**Exit criteria:** The same endpoint returns different status/body based on header, query, route parameter, and body conditions; the default scenario is returned when no rule matches; `X-Mock-Scenario` overrides every rule; sequential mode returns 500 on request 1 and 200 on request 2; rules apply without restart; the file behaves the same with Mockoon CLI; all are verified with integration tests.

**Status (2026-11-08): M7a and M7b done.**
- MCP gaps closed: 16 tools for collections, endpoints, scenarios, server start/stop/status, masked request logs and model check (`test/mcp.test.ts`).
- M7a: rules, AND/OR, invert, endpoint modes, scenario ordering, `X-Mock-Scenario` (by name or id, case-insensitive header name, can be disabled), `scenarioReason` in logs, request counter reset, sidecar `schemaVersion: 2` with v1 migration, control API routes and MCP tools `set_scenario_rules`, `set_endpoint_mode`, `reorder_scenarios`, `reset_request_counters`. Verified with real HTTP integration tests (123 tests passing).
- Known limits: `X-Mock-Scenario` is not available in sequential/random modes (the engine bypasses rules there; a runtime note is shown). `scenarioReason` is left empty when the engine cannot tell whether the default scenario matched by rule or as fallback. Resetting counters restarts the server on the same port, which may drop open connections. In safe mode a response with any unsafe rule has all its rules ignored.
- M7b: dashboard response-mode selector, ordered scenario list with condition summaries, condition editor with presets and validation, reason badges in the request log, counter reset button and the `X-Mock-Scenario` setting. E2E (`npm run test:e2e`, 2 tests) covers header rule selection, fallback, forcing and log reasons; a manual browser check confirmed a preset rule is saved to the environment file.
- Open: manual check with the engine's desktop app; the "New collection" field does not submit on Enter (minor).

### Milestone 8: Test profiles and network conditions

- **Test profile:** A named selection that changes scenarios for many endpoints with one click ("Session expired: 401 everywhere", "Server error", "Empty list", "Slow network"). Stored in the sidecar and shared through git; select the active profile in the dashboard or with `serve --profile`.
- **Network conditions (global or per profile):** Fixed delay and timeout simulation (very long delay). Random error rate and delay jitter were removed from scope on 2026-11-08: the engine does not support them, and they make test results non-repeatable; the same need is met deterministically with sequential mode, `X-Mock-Scenario`, and profiles.
- Reset request counter (for sequential mode and `request_number` rules).

**Exit criteria:** Profile changes apply without restart; deleting a profile restores the previous scenarios; global delay and timeout are verified with integration tests.

**Status (2026-11-08): done (backend, CLI, MCP, control API and dashboard).**
- Profiles live in the sidecar (schemaVersion 2 kept: optional fields, passthrough readers). Activation switches the listed endpoints to the chosen scenario in the derived environment without restart and without touching the environment file; deactivation restores the file's selection. `X-Mock-Scenario` still wins. Optional global latency and timeout simulation (all or listed endpoints). Stale references are reported and ignored. Logs carry the profile name and reason `profile`.
- `mockbrew serve --profile <name>`, `mockbrew profiles list [--json]`, MCP `list_profiles`, `save_profile`, `delete_profile` (preview unless confirm), `activate_profile`, `deactivate_profile`; control API routes. `test/profiles.test.ts` plus CLI/MCP/API coverage.
- Dashboard: profiles panel (create/edit, start from current selections, templates "all endpoints -> 401", "5xx", "slow network"), one-click activate/deactivate, active-profile badge with "Turn off", profile reason in the request log. E2E covers template, activation and restore.

### Milestone 9: Update mocks when the model changes

Current `check` only shows the diff; updating bodies is left to the user. Design: [Updating bodies when the model changes](ARCHITECTURE.md#updating-bodies-when-the-model-changes).

- **Merge suggestion** for each linked scenario: preserve existing values, fill new fields with the local generator, remove deleted fields, regenerate fields whose types changed, and replace values outside an enum with a valid value.
- Per-scenario diff preview and approval; "apply all".
- CLI: `mockbrew check --fix` (preview), `--fix --yes` (apply). MCP: `check_models`, `apply_model_update`. UI: model-change notification and one-click update.
- Watch source files; show a warning on the dashboard when a model changes.

**Exit criteria:** For fixtures with added/deleted/type-changed/enum-changed/nullable-changed fields, the updated body is valid against the new schema and manually entered values are preserved; 4xx/5xx scenarios are untouched.

**Status (2026-11-08): done (backend, CLI, MCP, control API and dashboard).**
- `src/core/model-update.ts`: merge keeps valid manual values and raw number lexemes (64-bit safe), adds required fields with the local generator (optional fields on request), removes unknown fields, regenerates type/enum/nullability changes, keeps the body's indentation style.
- Preview and hash-approved apply in the service, `mockbrew check --fix [--yes]`, MCP `preview_model_update` / `apply_model_update`, control API routes. Only model-bound 2xx scenarios change; non-JSON bodies are reported as skipped. `test/model-update.test.ts` plus CLI/MCP/API coverage (128 tests passing).
- Dashboard: drift badges after an explicit check, per-scenario line diff and change counts, skipped reasons, optional-field filling, hash-approved apply with re-preview on STALE (E2E covers a Kotlin model change end to end). Applying any selected scenario updates the endpoint's stored schema; unselected scenarios keep their bodies (the preview warns).
- Open: background watching of model source files.

### Milestone 10: Fully automated use through MCP

- Missing tools: create/update/delete endpoints; update/delete/activate scenarios; rules and endpoint mode; test profiles; create/activate collections; start/stop/check server status; recent request logs; model check and update; import/export.
- Keep tools narrow: no shell, no arbitrary file reads/writes, preserve the `--root` boundary. Destructive tools (delete, bulk update) return a preview first.
- MCP resources/prompts: project-specific usage guide ("create an endpoint with this model and add 401/500/empty-list scenarios").
- `mockbrew mcp install <client>`: run the client's own official command if it has one (e.g. `claude mcp add`, `codex mcp add`; with user approval); otherwise (Copilot, Kiro, Gemini), show a configuration snippet to paste. Do not directly edit clients' configuration files.

**Exit criteria:** Manually verify the flow "create an endpoint with this model, add 3 scenarios and a header condition, start the server" with a real LLM client (at least Claude Code and one other); automatically test all tools with the SDK client.

**Status (2026-11-08): implemented; manual check with a real LLM client open.**
- MCP now has 41 narrow tools (collections, endpoints, scenarios, rules and modes, profiles, server, logs, model check/update, import/export, recording), a `mockbrew://guide` resource and the prompts `mock_endpoint_from_model` and `add_error_scenarios`.
- `mockbrew mcp install claude|codex|gemini|copilot|kiro [--scope] [--yes|--print]` runs the client's official `mcp add` command after showing it and asking (non-TTY without `--yes` refuses); Kiro gets a config snippet. Client config files are never edited directly. Tested with fake client executables only.
- Real-client check (2026-11-08, one-off configs passed on the command line; no client config was changed): Claude Code (`claude -p --strict-mcp-config --mcp-config <tmp>`, model sonnet) read a synthetic kotlinx `OrderResponse`, created collection, endpoint `GET /orders/:id`, four scenarios (200 validated against the model, 401, 404, 500) and a "missing Authorization header" rule. Served with `mockbrew serve` and checked with curl: no header -> 401, with header -> 200 model body (`customer_email` in snake_case), `X-Mock-Scenario: Server error` -> 500, unmatched path -> JSON 404; `check` reports the model link ok. Codex (`codex exec -c mcp_servers.mockbrew...`, gpt-6-luna) added `GET /orders` with a body validated against `List<OrderResponse>`, but its approval policy refused `save_profile`: write tools lacked `destructiveHint: false` (MCP defaults to destructive). Fixed and re-run: Codex then created the "Server down" profile through `save_profile` (confirmed with `mockbrew profiles list`).
- Open: `mcp install` itself has not registered a real client (tested with fake client executables).

### Milestone 11: Multiple AI CLI providers

- Automatically detect installed CLIs on the machine (scan `PATH`; only `--version` before running): Claude Code (`claude`), Codex (`codex`), GitHub Copilot CLI (`copilot`), Gemini CLI (`gemini`), Kiro CLI (`kiro-cli`).
- Implement non-interactive operation, isolated configuration, disabling tools/permissions, and output extraction separately for each provider; test with fake CLIs. If a provider cannot be isolated, mark it "limited" and show this to the user.
- Provider selection in UI and CLI (`--ai auto|claude|codex|copilot|gemini|kiro`); preview + hash-based approval rule applies identically to all providers.

**Exit criteria:** Manually generate with each installed provider using one synthetic model; automatically verify fallback to local generation when a CLI is missing, authentication fails, or times out.

**Status (2026-11-08): implemented; real-provider generation not yet verified.**
- Registry in `src/ai/registry.ts`; `mockbrew ui --ai auto|copilot|claude|codex|gemini` (comma lists). Detection runs only `--version`/`--help`. Copilot keeps full isolation (hidden `--config-dir` still accepted by 1.0.85). Claude Code (`--print`, `--tools ""`, `--safe-mode`, `--strict-mcp-config`), Codex (`exec --sandbox read-only --ignore-user-config --ephemeral`, output file) and Gemini (`-p`, `--approval-mode plan`, JSON output) are offered as **limited** with a note in the Generate dialog and preview. Only provider-specific auth variables are forwarded. Kiro CLI is listed as not supported yet (not installed here; no offline docs).
- Approval binds provider and prompt hash. Tests use fake executables (`test/ai.test.ts`, `test/ai-registry.test.ts`).
- Open: one manual generation per installed provider with a synthetic model; Kiro CLI support.

### Milestone 12: Import / export and recording mode

Design: [Import and export](ARCHITECTURE.md#import-and-export).

- **Our own package format** (`*.mockbrew.json`): one or more collections; endpoint, scenario, rule, model link, and schema. Preview and conflict resolution on import (skip / rename / overwrite).
- **Import:** Postman Collection v2.1 (saved example responses become scenarios), OpenAPI 3.x (generate from examples or schema), HAR (from Charles/Proxyman/browser capture), cURL.
- **Export:** our own package format, Postman Collection v2.1 (requests to the mock address), OpenAPI 3.1 (existing).
- **Recording mode** (user approval, 2026-11-08): while the proxy is enabled, save real backend responses for unmatched requests as scenarios for endpoints selected by the user; preview before saving, omit sensitive headers (Authorization, Cookie, Set-Cookie), and warn about token-like fields in the body.
- Treat imported content as data: safe mode and size limits apply.

**Exit criteria:** Round-trip test (export -> import produces the same project); synthetic fixture test for every import format; malformed files are rejected without writing anything; recording mode is tested with a local fake backend and sensitive headers are not written to the file.

**Status (2026-11-08): done (backend, CLI, MCP, control API and dashboard).**
- Bundle `*.mockbrew.json` export/import with preview, hash-approved apply and conflict strategies (skip / rename / replace) in one atomic save; converters for Postman v2.1, OpenAPI 3.0/3.1 JSON (YAML must be converted first), HAR 1.2 and cURL with warnings for unsupported items; export to bundle, Postman v2.1 and OpenAPI. CLI `mockbrew import` / `mockbrew export`, MCP `preview_import`, `apply_import`, `export_bundle`, control API routes.
- Record mode: while proxying, unmatched requests answered by the backend are captured in memory (sensitive and hop-by-hop headers stripped, sensitive-looking body keys warned, size-limited, truncated recordings cannot be saved), then previewed and saved as endpoints/scenarios with path-pattern overrides. MCP `start_recording`, `stop_recording`, `list_recordings`, `preview_recordings`, `save_recordings`; control API routes. Note: the engine buffers a proxied response fully before its transaction event.
- Tests: `test/transfer-bundle.test.ts`, `test/import-formats.test.ts`, `test/record-transfer.test.ts`, MCP OpenAPI import (164 tests passing).
- Dashboard: import dialog (file or paste, format choice, preview with conflicts and warnings, conflict strategy), export menu (bundle/Postman/OpenAPI, collection selection), recording panel (start/stop, path pattern editing, preview, save). E2E covers Postman import, bundle export and serving a recorded response after the backend stops.
- Open: a multi-collection export from the dashboard combines one request per collection, so edits made during the download can produce a mixed snapshot.

### Milestone 13: End-user distribution and updates

Design: [Distribution and updates](ARCHITECTURE.md#distribution-and-updates).

- **Primary path: single binary** (if the M6 SEA prototype succeeds): executables with Node embedded for macOS (arm64/x64), Linux (x64/arm64), and Windows (x64) on GitHub Releases; install and update through Homebrew tap and Scoop/winget (`brew upgrade`, etc.). Users do not need to install Node.
- **Fallback path** (if SEA fails): an install script (`install.sh` for macOS/Linux, `install.ps1` for Windows) downloads the official Node.js distribution to the user's directory (`~/.mockbrew/runtime`), verifies it with SHASUMS256, and does not require `sudo`; `mockbrew update` installs the new version in a sibling directory and keeps the previous version for rollback.
- Check for updates only on user command or when explicitly enabled by a setting (no telemetry).
- `mockbrew doctor`: diagnose Node, ports, permissions, AI CLIs, and project files.
- Continue publishing to npm (with provenance) as a secondary path for developers.

**Exit criteria:** On clean macOS, Windows, and Linux machines without Node installed, install with one command and run `mockbrew ui`; a package manager or `update` upgrades from the previous version.

**Status (2026-11-08): build tooling done; no release run yet.**
- `node scripts/sea/build.mjs` builds `dist-bin/mockbrew-<os>-<arch>` + SHA-256 for the current platform (pinned postject; Node 22 required for releases, `--allow-any-node` for local experiments; universal macOS Node refused). Cross-platform asset cache with once-per-version, concurrency-safe extraction. `mockbrew doctor` checks runtime, project, port, UI assets, parser, cache, AI and MCP client CLIs.
- `.github/workflows/release.yml`: per-platform binaries with smoke tests on tags, draft GitHub Release with SHA256SUMS, manual npm publish with provenance. Homebrew and Scoop templates plus `scripts/release/update-manifests.mjs`.
- Verified locally: macOS arm64 binary (Node 23.9, ad-hoc signed) passed `--version`, `doctor`, `generate --list`, `serve` + curl.
- Open: the release workflow has never run (no GitHub repository); Linux, Windows and macOS x64 binaries untested; notarization; tap/bucket repositories; the asset cache does not re-verify files after the first extraction.

### Milestone 14: Request-aware and validated responses

Moved from the proposal pool into the plan (user approval, 2026-11-08).

- **Safe dynamic values:** a limited, fixed list of tokens such as `{{uuid}}`, `{{now}}`, `{{request.params.id}}`, `{{request.query.x}}`, `{{request.body.$.name}}`. Process them with our own small interpreter; keep Mockoon templating (Handlebars/faker) disabled so code cannot run. For returning a record created after a POST.
- **Project variables:** project-level variables such as `{{vars.baseImageUrl}}` (in the sidecar; no secret values stored).
- **Request model validation:** link a Kotlin/Swift request model to an endpoint; if a POST/PUT/PATCH body does not match the model, return a configurable 400/422 scenario and show invalid fields in the log.
- **File/binary responses:** serve files such as images and PDFs from the project directory (path remains within `--root`); accept and log multipart upload requests.

**Exit criteria:** Dynamic tokens work only from the allowlist; unknown tokens are left as-is with a warning; request model validation chooses the correct 2xx/4xx path; file paths cannot escape the root. Verify all with integration tests.

**Status (2026-11-08): done (backend, control API, MCP and dashboard); physical/edge verification open.**
- Architecture change: the engine now listens on an OS-assigned 127.0.0.1 port behind our own node:http(s) front layer (`src/runtime/front.ts`), which owns the public host/port and streams traffic unchanged unless a feature applies (about 0.3 ms added per request locally). Reason: the engine exposes no pre-send hook, its header handling invokes its template parser and its FILE body type allows unrestricted paths. Engine templating stays off for all user content.
- The engine's selected scenario reaches the front layer through a private static header keyed with a per-run secret and stripped before clients see it.
- Opt-in `dynamic` scenarios: allowlisted tokens `{{uuid}}`, `{{now}}`, `{{now:epoch}}`, `{{now:epochMillis}}`, `{{request.params|query|header.<name>}}`, `{{request.body.<path>}}`, `{{vars.<name>}}`, string and `{{json ...}}` forms, interpreted by our own code (no eval/Handlebars). Hostile templates (`{{faker}}`, `{{#each}}`, `{{lookup}}`, triple braces, `{{setVar}}`) are served literally (tested in body and headers). Project variables in the sidecar (plaintext; no secrets).
- Request models: invalid or unparsable POST/PUT/PATCH bodies are answered with an "Invalid request (422)" scenario listing errors; logs carry `requestValidation`.
- Body files streamed from inside `--root` (no symlinks, `O_NOFOLLOW`, 50 MB, content type by extension). Imported engine FILE bodies are disabled with a safe-mode note. Multipart metadata (names, file names, types, sizes) logged without content.
- MCP `set_variables`, `set_scenario_dynamic`, `set_request_model`, `set_scenario_file`, `validate_tokens`; control API routes; `test/dynamic.test.ts`, `test/front.test.ts`, `test/tokens.test.ts` (200 tests passing).
- Follow-ups done: dashboard (dynamic toggle with token helper and warnings, inline/file body, request model linking, project variables, log details; E2E `e2e/dynamic.spec.ts`); bundles carry `dynamic`, `bodyFile`, `requestModel` and variables (keep/overwrite/skip); HEAD answers with GET's headers; HTML/XML values escaped; logs show substituted bodies and file placeholders; responses without Content-Length buffered up to the cap; runtime warnings surface in status notes; the engine port lookup is isolated behind one checked function (210 unit + 7 E2E tests passing).
- Open: OpenAPI export does not annotate dynamic/file scenarios; a missing body file after import is reported only in the import preview; dashboard scenario saves use several API calls, so a failure midway can leave earlier changes saved.

### Milestone 15: Parser coverage: polymorphism and inheritance

Deferred from M5 (user approval, 2026-11-08).

- Kotlin `sealed class`/`sealed interface` (Kotlinx `@SerialName` + `classDiscriminator`, configurable discriminator for Gson/Moshi) and `oneOf` schemas from Swift enum/protocol-based types.
- Fields inherited from parent classes (Kotlin `open`/`abstract` base classes, Swift class inheritance).
- Generation variant for each subtype.
- Real-world scan: run `generate --list` on open-source Android/iOS/KMP applications and report the `issues` list (no company code used).

**Exit criteria:** Generate schema-compliant output for each subtype in synthetic fixtures; unsupported patterns are still explicitly reported.

**Status (2026-11-08): implemented for Kotlin; partial for Swift.**
- Kotlin `sealed class`/`sealed interface` -> `oneOf` with a discriminator (Kotlinx `@SerialName`, `@JsonClassDiscriminator`, project `classDiscriminator`; configurable discriminator for Gson/Moshi with a custom-adapter warning; moshi-sealed generator strings). Inherited fields from Kotlin open/abstract bases and Swift Codable base classes (with a warning about Swift synthesis). Deterministic per-subtype generation, mixed subtypes in arrays, `generate --subtype`, MCP `subtype` argument. Synthetic fixtures in `test/models.test.ts`.
- Limits: sealed declarations with some separate-line annotations are misparsed by the bundled Kotlin grammar and reported as `unsupported-sealed-syntax`; generic superclass arguments are not substituted; Swift associated-value enums and hand-written decoders remain reported.
- Real-world scan (2026-11-08, clones deleted afterwards): Now in Android: 294 types, issues unresolved-type 147, delegated-property 16, syntax-error 8, computed-property 5. JetBrains Compose Multiplatform template: 4 types, computed-property 2. Unresolved types are mostly framework/library types outside the scanned folder.

### Milestone 16: Device connectivity

- **Connection screen:** Base URLs and QR codes for emulators, simulators, and physical devices in the dashboard; the QR code also links to a short guide explaining use of `X-Mock-Scenario`.
- **Local HTTPS:** Generate a local CA and certificate per project (with user approval); document Android `network_security_config` and iOS device trust steps. HTTP remains the default.

**Exit criteria:** Manually verify QR connection and HTTPS requests on physical Android and iOS devices.

**Status (2026-11-08): implemented; physical-device checks open.**
- Connection screen: copyable base URLs and SVG QR codes per target (Android Emulator, iOS Simulator, `adb reverse`, LAN when enabled) using `qrcode-generator` 1.4.4 (MIT), with `X-Mock-Scenario` and debug network notes.
- Local HTTPS (off by default): `mockbrew certs create|show|delete` and the dashboard create a local CA and server certificate (SANs for localhost, 127.0.0.1, ::1, 10.0.2.2 and LAN IPs) after confirmation, stored under `~/.mockbrew/certs/<project>` with 0600 keys, never in the project folder; only the public CA can be downloaded through the control API; CA install guidance for Android and iOS. Tests: QR generation, certificate SANs/permissions, HTTPS request trusted with the generated CA (`test/connectivity.test.ts`), E2E connect screen.
- Certificates are created in pure JS with `node-forge` 1.4.3 (async RSA-2048; tested with an empty PATH, no OpenSSL needed).
- Open: Windows not run; recreate certificates when LAN addresses change; QR scanning, CA install and HTTPS on physical devices not tested.

### Milestone 17: Additional protocols (as needed)

Added to the plan with user approval; work begins when a use case arises.

- WebSocket and Server-Sent Events: scheduled message scenarios.
- GraphQL: select scenarios on a single endpoint based on `operationName` and variables (on top of the M7 rule engine), generate examples from the schema file.

**Exit criteria:** Written when the milestone starts.

## Phase transition rule

Do not add features from the next phase to the core flow until a milestone's exit criteria are met. If there is uncertainty in the parser or engine integration, clarify supported cases and error messages instead of expanding scope. LAN access and AI are not enabled by default; the user must explicitly enable them.
