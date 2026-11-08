# Handoff Report (for Claude Code)

This document is the summary and starting point that the person (or agent) continuing the project with Claude Code should read first. It is a **snapshot**, not an authority. For details, refer to [Product requirements](PRODUCT_REQUIREMENTS.md), [Roadmap](ROADMAP.md), [Architecture](ARCHITECTURE.md), and the [Development guide](DEVELOPMENT.md); if this document conflicts with them, those documents (and the code) take precedence.

- **Report date:** 2026-11-08
- **No new code was developed while preparing this report.** Only the status was measured (lint, build, test), and this document was written.
- **Verification labels:** "Run today" means run as a command while preparing this report. "Recorded" means based on a ROADMAP/DEVELOPMENT record and not rerun in this session.

## 1. What is the project

**MockBrew** is a free, offline-first mock API tool for Android, iOS, and Kotlin Multiplatform teams. It runs locally (localhost) before the backend is ready.

- Reads Kotlin (Gson, Kotlinx Serialization, Moshi) and Swift (`Codable`) models **without compiling them**, derives JSON Schema, and generates deterministic sample JSON that conforms to the schema and is meaningful for each field name.
- Groups endpoints into collections; stores multiple response scenarios per endpoint (success, empty list, 401, 500...); runs active collections together on one port.
- Serves Android Emulator, iOS Simulator, WebView, and browser clients without CORS issues.
- Mock definitions are files that can be committed to git; teams share them through git.
- AI is optional and disabled by default. All core functionality works without AI.

**Distribution:** A single npm package, `mockbrew`, with the `mockbrew` command (CLI + local web UI + MCP server). Not yet published to npm.

**Working directory:** repository root (folder name `mobile-mock-api-studio`; "mobile" was dropped from the product name).

## 2. History and timeline

| Date | Event |
|---|---|
| 2026-11-03 | The need was defined. Mockoon was rejected because it is paid (user). Scope, roadmap, and AI/Node/serialization decision points were discussed. Kotlin serialization formats were verified against two private implementation repositories. Planning documents were written (there was no implementation at the time, and the plan was to build a mock server from scratch with Fastify). |
| 2026-11-04 | M0-M5 were implemented. Mockoon's MIT-licensed packages were chosen as the mock engine library (see [4. Decisions made](#4-decisions-made), decision 1). The product was named "MockBrew." Installation and usage were added to the README. |
| 2026-11-08 | This handoff report was prepared; status was measured again. |

## 3. User requests and how they were addressed

Requests expressed in the user's own words and their current status. Items marked "Deviation" require user confirmation ([8. Decisions pending from the user](#8-decisions-pending-from-the-user)).

| Request (source: 2026-11-03 messages) | Status | Notes |
|---|---|---|
| Localhost service returning JSON that matches Kotlin/Swift models | Met | Parser + local generator. Gson, Kotlinx, Moshi, Swift Codable. Not scanned against real team models. |
| No CORS errors | Met (at HTTP level) | `wildcard` and `reflect` (credentials) modes. Not tested in a real WebView. |
| Ability to edit responses and specify endpoints | Met | Web UI + CLI. |
| Create collections with endpoints and responses; multiple endpoints at once | Met | Collection = Mockoon root folder; active collections share one port. |
| Shared use through JSON export/import like Postman | **Partial / deviation** | No collection import/export in the UI/API. Sharing is done by sharing project files (`*.environment.json` + `*.studio.json`) through git or copying them. `export openapi` exists, but is one-way and a contract proposal. See decision question 3. |
| No need for synchronous/online architecture; fully offline is acceptable | Met | No telemetry, no cloud. |
| Mockoon is paid and unsuitable | **Deviation (confirmation required)** | The product uses Mockoon's MIT-licensed engine packages as dependencies. See decision 1 and decision question 1. |
| Auto-generate with Copilot CLI, Kiro CLI, etc.; optional prompt field; generate a model-appropriate response when no prompt is given | Partial | There is an optional prompt field in the UI (`ui --ai copilot`). The only provider is GitHub Copilot CLI. There is no Kiro CLI provider; an MCP server is available for Kiro/Copilot **chat**. Local structural generation is used when AI is unavailable. |
| Initially support only Android, iOS, and KMP | Met | |
| Latency/error scenarios (not required for the first phase) | Partial | Fixed per-response latency and status/scenario are available. Request-based rules work in the file; their UI was deferred. |
| Graphical interface; web UI is acceptable; choose the fastest/most functional path | Met | Localhost web UI (React + Vite), served with Fastify. No desktop app. |
| Check for Node.js during installation; if missing, install it first and then continue | **Deviation (confirmation required)** | Only a version check and error message are provided; the tool does not install Node. PRODUCT_REQUIREMENTS marks this "out of MVP." See decision question 2. |
| Determine Kotlin serialization formats from real applications | Done | Android: Gson (`@SerializedName`, Retrofit). KMP: `kotlinx.serialization` (`@Serializable`, `@SerialName`, Ktor ContentNegotiation). Moshi was not found in the projects examined; it was still added because it was inexpensive to support. |
| Name the project "MockBrew"; explain how other developers install/run it | Done | README "Installation" and "Usage." |

## 4. Decisions made

Sources: ARCHITECTURE "Decision log," PRODUCT_REQUIREMENTS, ROADMAP, and session records.

| # | Decision | Rationale | Reversibility |
|---|---|---|---|
| 1 | Use `@mockoon/commons` and `@mockoon/commons-server` **9.10.0** (MIT) as the mock engine, with exact pins; this is an independent npm package, not a Mockoon fork or extension | Features such as path parameters, scenarios, latency, proxy, CORS, and logging are ready to use; no signing cost; the same file also works with Mockoon CLI. A fork and building from scratch with Fastify were rejected. | Difficult: file format and runtime depend on the engine. |
| 2 | Data format: `<name>.environment.json` (Mockoon) + `<name>.studio.json` (sidecar, `schemaVersion: 1`) | Can be committed to git, Mockoon-compatible, tool metadata is separate. | Medium. |
| 3 | Collection = Mockoon folder at the root level; routes outside folders are "Ungrouped" | Verified in M0. | Medium. |
| 4 | Parser: tree-sitter (WASM) AST, separate child process, `--liftoff-only` | On Node 24/25, the V8 optimizing WASM compiler crashes due to insufficient memory. | Low risk. |
| 5 | JSON Schema Draft 2020-12, validation with Ajv | | Easy. |
| 6 | **Safe mode by default:** templating, data bucket, callback, CRUD/WebSocket routes disabled | The `@faker-js/faker` code-execution advisory comes through Mockoon packages; shared files must not execute code. | Can be enabled through project settings. |
| 7 | Control API on `127.0.0.1` only, token (8 hours), Host/Origin checks, no CORS | Protects against DNS rebinding and LAN access. | Easy. |
| 8 | Mock listener defaults to `127.0.0.1`; LAN binding only by explicit user choice | Required for physical iOS devices. | Easy. |
| 9 | AI: MCP server first, then optional AI CLI from the UI (GitHub Copilot CLI only); disabled by default, every submission requires preview + hash-based approval | Privacy; AI is not required for any core flow. | Easy (provider interface is open). |
| 10 | Copilot CLI gets an empty temporary `--config-dir`, empty temporary cwd, allowlisted environment variables, empty tool list; `shell`/`write` are denied | With the user's normal configuration the CLI did not respond for 25-90 seconds; with isolated config it took about 12 seconds. Cause was not definitively tied to MCP servers (Recorded). | Easy. |
| 11 | Runtime: installed Node >= 22.12; the tool does **not** install Node | Simplicity. May conflict with the user's request (see section 3). | Medium. |
| 12 | Sharing is file/git-based; there is no separate collection import/export UI | Mockoon files can be shared directly. This is a different interpretation of the user's "JSON export/import like Postman" request. | Easy (to add). |
| 13 | The name/logo "Mockoon" is not used in the product name or UI; license is in [NOTICE.md](../NOTICE.md) | Trademark risk (Recorded: Mockoon AB trademark). | Easy. |
| 14 | Docs are English (user decision 2026-11-08) | User decision. | Easy. |

## 5. What was implemented (M0-M5)

Detailed evidence is in the "Results" sections of the [Roadmap](ROADMAP.md).

| Milestone | Scope | Status |
|---|---|---|
| M0 | Engine prototype, collection model, sidecar, parser/WASM, JSON Schema, Node range, MCP SDK | Implemented |
| M1 | Gson/Kotlinx/Moshi/Swift adapters, generic/typealias/recursive, naming and date settings, local generator, `generate` | Implemented |
| M2 | `serve`, conflict/shadowing checks, JSON 404, control API, web UI, file layer, CORS, log masking, connection guide | Implemented |
| M3 | Stdio MCP server, six narrow tools, block access outside root | Implemented |
| M4 | Optional AI CLI from the UI (Copilot CLI), preview/approval, isolated process, local fallback | Implemented |
| M5 | Proxy fallback (disabled by default), LAN binding UI, model change check (`check`), OpenAPI 3.1 export | Implemented |

**CLI:** `init`, `ui`, `serve`, `generate`, `check`, `export openapi`, `snippets`, `mcp`.

**MCP tools:** `list_collections`, `parse_model`, `get_schema`, `generate_sample`, `validate_body`, `save_scenario` (no shell or arbitrary file tools).

**Size (approximate, measured today):** `src/` ~6.5 thousand lines of TypeScript, `ui/src/` ~1.7 thousand lines, `test/` ~1.9 thousand lines; 9 test files, 116 tests.

## 6. Verification status

### Run today (2026-11-08, Node v25.9.0, npm 11.12.1)

| Check | Result |
|---|---|
| `npm run lint` (server + UI type check) | Passed |
| `npm run build` (tsc + Vite) | Passed; `node dist/cli/main.js --version` -> `0.1.0` |
| `npm test` (full suite) | **115 / 116 passed, 1 failed** (`test/ai.test.ts`) |
| `npx vitest run test/ai.test.ts` (3 separate runs) | 2 failed and 12 passed each time |

The previous session (2026-11-04) reported that lint, build, and all 116 tests passed, and that tests passed on Node 22, 24, and 25 (Recorded). Today's difference is caused by the timing issue below.

### Failed tests: test flakiness, not a product bug

- **Tests:** `falls back on timeout and kills the process` and `stops the process when the request is cancelled` in `test/ai.test.ts`.
- **Symptom:** `expected [Function] to throw an error` (`process.kill(call?.pid ?? 0, 0)` does not throw).
- **Evidence (measured today):**
  - The exact test scenario (400 ms timeout, same fake CLI script, real `runCli`) was run outside Vitest 8 times: in 6 runs, the fake CLI did not write its call log before 400 ms elapsed; in the 2 runs where the log was written, the child process was no longer alive 300 ms after the timeout.
  - With a 1500 ms timeout, real `runCli` killed the child process (it was no longer alive 300 ms later).
  - On this machine, cold startup for `node -e 0` takes 110-117 ms; the first run of a shebang script took 545 ms (later runs took ~130 ms); average system load is ~4.
- **Inference (from code reading):** The test assumes the fake CLI will write its call log within 400 ms. If it does not, `call` stays undefined and the assertion runs `process.kill(0, 0)`; on POSIX, this targets its own process group and does not throw. This assertion path was not tested separately.
- **Conclusion:** `src/ai/cli-runner.ts` kills the process correctly on timeout and cancellation; the failure is caused by test timing (a CPU-load-sensitive race).
- **Recommended fix (not implemented):** Wait until the call log appears (polling) before the timeout/cancellation, assert that `call` is defined, and increase the timeout. This test may be flaky in CI for the same reason.

### Recorded (not rerun in this session)

- Android Emulator (Pixel_8a AVD) received the correct response from the mock through `10.0.2.2:<port>` and `adb reverse` + `localhost`; iOS Simulator (iPhone 17) received the correct response through `localhost:<port>`. This verifies network access only.
- The local UI was manually tried in a browser (create collection, generate body from model, start server, request list).
- Mockoon CLI 9.10.0 and Mockoon's own `EnvironmentSchema` validation accepted the same file.
- With real Copilot CLI 1.0.27, a valid response was received for one synthetic model in ~12 seconds.
- License scan (production tree, 234 packages): all have permissive licenses; the only exception is `@jmespath-community/jmespath` (MPL-2.0, used without modification).

## 7. Unverified / open items

None of these have been tried; they must not be reported as "working."

- **Mockoon desktop:** Opening and editing files in both directions was not manually tested (desktop is not installed).
- **Physical devices:** Android (`adb reverse`) and iOS (LAN binding) were not tested.
- **CORS in WebView:** Tested at HTTP level only.
- **In-app network settings:** Debug `network_security_config` (Android) and `NSAllowsLocalNetworking` (iOS) were not tested with an app project.
- **Windows and Linux:** Not tested. The CI matrix is configured only for `ubuntu-latest` and `macos-latest` (Node 22, 24) and has **never been run** (the project is not a git repository).
- **Team codebase scan:** `mockbrew generate --list` was not run on real models, and the reported `issues` list was not reviewed. Use of Moshi, generic wrappers, and sealed classes is therefore unknown.
- **MCP flow with Kiro/Copilot chat:** Tested only at the protocol level with an SDK client.
- **OpenAPI export:** Not tested with an external OpenAPI validator.
- **`@mockoon/commons-server` stability:** No stable API guarantee for general use; protected by exact pinning and integration tests.
- **`npm audit`:** The `@faker-js/faker` (code execution) and `joi` (DoS) advisories come through Mockoon packages; `npm audit fix` would downgrade Mockoon and **must not be run**. The Faker risk is disabled by safe mode.

### Deferred (with acceptance criteria in the ROADMAP M5 table)

- UI for request-based response rules (rules work in the file; edit them with Mockoon desktop).
- Sealed class / polymorphism and inheritance (reported explicitly).
- Single binary or Docker distribution (Docker is not available on this machine).

### Before release

- Product renamed to **MockBrew** (user decision 2026-11-08; the earlier name was taken on npm and GitHub). `mockbrew` was free on npm and Homebrew on 2026-11-08; GitHub was not verified. Reserve the npm name before publishing.
- **The project is not a git repository:** no `.git`, no remote. The `git+ssh://<server>/<org>/<repo>.git` installation path in the README cannot be used until a repository is created.
- Company open-source tool approval is needed before corporate use (the MPL-2.0 dependency was noted).

## 8. Decisions pending from the user

**Update 2026-11-08 (user response):** The following four questions were answered. (1) Continue using the Mockoon engine because it is MIT-licensed and free. (2) If Node is missing, the installer should install it; installation and updates should be easy for end users (M13). (3) Postman-like export/import was added to the plan (M12). (4) Support all installed AI CLIs (M11). Additional decisions: the project is personal and open source (MIT, GitHub); intended use is LLMs through MCP during development and the dashboard during testing; conditional responses based on headers/parameters/body/order (M7-M8); update body when the model changes (M9). Details: [Roadmap - v1 plan](ROADMAP.md#v1-plan-m6-m17), [Architecture - v1 designs](ARCHITECTURE.md#v1-designs-proposal).

Remaining open question: language for open-source documentation (English was proposed). The proposal set was approved on 2026-11-08 and added to the plan as M14-M17.

The text below reflects the status before 2026-11-08 and is preserved as history.

1. **Mockoon engine.** The user said, "Mockoon is paid and unsuitable." The product uses Mockoon's MIT-licensed engine packages as a library (Recorded: Mockoon's repository and packages are MIT-licensed; Mockoon's built-in AI assistant is tied to paid Cloud plans). I could not find an explicit approval or objection to this change in the accessible session records. Does the user knowingly approve the scope and license status?
2. **Automatic Node.js installation.** The user asked for "a setup that installs it first if it isn't there, then continues"; the tool only checks and reports an error. If bootstrap is desired, design, approval, and security (checksum, user directory, no `sudo`) should be handled separately.
3. **Postman-like JSON export/import.** Is collection import/export through the UI/API as a single file or bundle required, or is file/git-based sharing sufficient?
4. **Kiro CLI provider.** Is one required, or are Copilot CLI + MCP sufficient?

## 9. Code map

Single package, separate directories. Detailed table: [Development guide - Module boundaries](DEVELOPMENT.md#module-boundaries).

| Directory | Responsibility | Mockoon dependency |
|---|---|---|
| `src/parser/` | tree-sitter AST -> language-independent IR; `kotlin/{gson,kotlinx,moshi}.ts`, `swift/`; `host.ts` + `worker.ts` in a separate child process | no |
| `src/schema/` | IR -> JSON Schema, naming/date settings, Ajv validation | no |
| `src/generator/` | Deterministic local generator (field-name heuristics, variants, seed) | no |
| `src/core/` | Domain types, `ProjectService`, conflict checking, model service, schema diff, OpenAPI, safe paths | no |
| `src/store/` | Mockoon environment + sidecar, atomic writes, file watching | **yes** |
| `src/runtime/` | Derived environment, safe mode, running the engine, masked logs | **yes** |
| `src/control-api/` | Fastify, loopback only, UI assets | no |
| `src/mcp/` | MCP tools | no |
| `src/ai/` | Provider interface, process runner (`cli-runner.ts`), Copilot provider, prompt | no |
| `src/cli/` | Commands (`main.ts` entry point) | no |
| `ui/` | React + Vite interface; imports pure type files such as `src/core/view.ts` | no |
| `test/` | Vitest; `fixtures/` contains synthetic Kotlin/Swift models; tests run on `dist/` | - |

Only `store/` and `runtime/` depend directly on Mockoon packages.

**Important mechanics**

- The engine selects the first matching route and does not report conflicts itself; conflict checks happen in `core/` before entering the runtime.
- Inactive collections remain in the file; the runtime creates a derived environment by removing their routes.
- Changes are reflected without restart through `MockoonServer.updateEnvironment()`; the runtime restarts only if the port/host changes.
- Since the engine's 404 is not JSON for unmatched requests, a catch-all route is added for every method except OPTIONS; it is omitted if the proxy is enabled.
- Bodies are stored as raw strings (to preserve the precision of 64-bit numbers).
- At runtime, `src/parser/host.ts` finds `dist/parser/worker.js`; therefore, before `npm test`, `test/global-setup.ts` compiles with `tsc`.

## 10. Runtime and commands

| Command | Purpose | Run today |
|---|---|---|
| `npm install` / `npm ci` | Dependencies; `prepare` also builds | No (`node_modules` exists) |
| `npm run build` | Server (tsc -> `dist/`) and UI (Vite -> `dist/ui`) | Yes |
| `npm run lint` | Server and UI type check | Yes |
| `npm test` | Vitest (compiles `dist/` with `tsc` first) | Yes |
| `npm run dev:ui` | Vite dev server; connects to the `ui` command with `MOCKBREW_API=http://127.0.0.1:<ui-port>` | No |
| `npm run notice` | Generates `NOTICE.md` | No |
| `node dist/cli/main.js --help` | CLI | `--version` yes |

Requirement: Node.js >= 22.12 (`engines`). CI matrix uses Node 22 and 24; Node 25.9 was used locally. Package manager is npm + `package-lock.json`.

For usage examples, see the [README](../README.md#usage).

**Notes**

- Vitest emits a deprecation warning for `DEP0060` (`util._extend`); it is unrelated to the failure.
- `.agent-work/` contains artifacts from previous agent sessions and is in `.gitignore`; it is not needed to continue.
- `dist/` and `node_modules/` are in `.gitignore`.

## 11. Working rules for Claude Code

Derived from rules written in the existing documents and decision record.

1. **Priority:** First ask the user about the decisions in [section 8](#8-decisions-pending-from-the-user); they may affect the architecture.
2. **Accuracy:** Use "Verified" only for tests that were run or checks performed manually. After new verification, update the ROADMAP "Results" section and the [manual verification matrix](DEVELOPMENT.md#manual-verification-matrix). Do not document nonexistent commands as if they worked.
3. **Dependencies:** Use exact versions. Keep `@mockoon/commons` and `@mockoon/commons-server` on the same version; update them together ([Mockoon update procedure](DEVELOPMENT.md#dependency-rules)). Do not run `npm audit fix`. Do not upgrade `web-tree-sitter` 0.24.7 and `tree-sitter-wasms` 0.1.13 to 0.27 (incompatible with the grammars).
4. **Do not change security:** Control API stays on loopback; LAN only by explicit choice; safe mode is the default; log masking and body logging disabled; no telemetry; AI preview/approval/hash required; no shell or unrestricted file tools in MCP.
5. **Do not execute code:** User model code, imported JSON, or prompts are never run as shell commands; the parser does not compile source code and stays in a separate process.
6. **Test data:** Fixtures must be synthetic; customer or production model code must not be copied into fixtures.
7. **Brand:** The name "Mockoon" is not used in the product name, UI, or icons; it is identified as a dependency and license.
8. **Scope discipline:** Do not add features from the next phase to the core flow before the current milestone's exit criteria are met (ROADMAP "Phase transition rule").
9. **Documentation:** Docs are English (user decision 2026-11-08).
10. **Process:** When work is done, run lint, build, and tests, and report the results as they are.

## 12. Recommended first steps

1. Read this document and the "Results" sections of the [Roadmap](ROADMAP.md); remeasure the status with `npm run lint && npm run build && npm test`.
2. Fix the two flaky tests in `test/ai.test.ts` (wait for the call log file, assert that `call` is defined, increase the timeout), then run the full suite several times to verify stability.
3. Clarify the questions in [section 8](#8-decisions-pending-from-the-user) with the user; based on the answers, plan Node bootstrap, collection import/export, or a Kiro provider.
4. Turn the project into a git repository (with user approval) and run CI for the first time; record Linux and Node 22 results.
5. Run `mockbrew generate --list` on real team models (Android Gson, KMP Kotlinx, Swift Codable) and update parser coverage based on the `issues` list.
6. Close open verification items in order: Mockoon desktop, physical devices, WebView CORS, in-app cleartext/ATS, MCP with Kiro/Copilot chat.
7. Before release: npm scope ownership, package name, license approval.

## 13. Sources

- [README](../README.md): installation and usage.
- [Product requirements](PRODUCT_REQUIREMENTS.md), [Roadmap](ROADMAP.md), [Architecture](ARCHITECTURE.md), [Development guide](DEVELOPMENT.md), [NOTICE](../NOTICE.md).
