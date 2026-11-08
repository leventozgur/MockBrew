# Product Requirements

## Problem

Backend endpoints are not always ready during mobile app development. The team needs to define local endpoints that return JSON matching mobile models, edit responses, run multiple endpoints needed for the same development effort together, and share these definitions with the team without blocking app development.

General-purpose mock tools (Mockoon, WireMock, etc.) solve running mocks, but they do not solve generating correct responses from mobile model code. This product's distinguishing value is generating responses from models; mock execution uses the Mockoon engine.

## Goals

- Provide local HTTP JSON services that Android, iOS, and KMP apps can connect to.
- Generate JSON Schema and schema-compliant sample responses from Kotlin/Swift models.
- Manage endpoints and response scenarios through the UI and CLI.
- Run collections together on a single port.
- Share mock definitions as files that can be committed to git.
- Support core functionality without AI, a cloud account, or a network connection.
- Remain free for enterprise and individual use.

## Main workflows

### Defining endpoints while waiting for the backend

1. The user creates a mock file (project) and a collection.
2. They define the method, path (which may include parameters such as `/users/:id`), status, headers, and body.
3. They activate collections and start them with `serve`; they point the mobile app's debug base URL to the local address.
4. They monitor incoming and unmatched requests in the logs.

### Generating responses from a model

1. The user selects a Kotlin/Swift model file or folder, or pastes code.
2. The tool converts the model to JSON Schema and reports unresolved types and unsupported constructs.
3. The user selects decoder-level settings such as a naming strategy (e.g. snake_case) and date format.
4. The local generator produces meaningful, deterministic data based on field names. Minimal, fully populated, and empty-list variants can also be generated.
5. The response is previewed, edited, and saved to the endpoint as a scenario.

### Generating data that matches the business context with AI

1. The user provides a model and a request in Kiro/Copilot chat through MCP tools (e.g. "three orders, one of them canceled").
2. The AI tool generates data; the tool validates it against the schema and saves it to the endpoint.
3. In a later phase, the same workflow can also be run from the UI through an AI CLI call approved by the user.

### Sharing with the team

1. Mock files are stored in the mobile app repository or a separate repository.
2. Team members pull the files with git; the tool and Mockoon desktop load changes through file watching.
3. Incoming files are validated for version and schema; invalid files produce an explicit error.

## Functional requirements

### Running mocks

- FR-01: A project must support multiple collections, and each collection must support multiple endpoints.
- FR-02: Collections must be individually activatable/deactivatable; active collections must run together on the same port.
- FR-03: An endpoint must include a method, path, status, headers, and body. Path parameters must be supported.
- FR-04: An endpoint must support multiple response scenarios, and the active scenario must be selectable from the UI/CLI.
- FR-05: A duplicate method + path across active collections must be reported as an explicit error both before startup and when a collection is activated while running. The conflicting collection and endpoint must be identified.
- FR-06: A fixed response delay (latency) must be configurable.
- FR-07: Statuses such as 204 with an empty body must be supported; JSON bodies must be parsed and validated before saving.
- FR-08: Bodies must be stored as raw text and served as-is (preserving the precision of 64-bit numbers).
- FR-09: Changes made on a running server must take effect without requiring the user to restart it.
- FR-10: Unmatched requests must return an explanatory JSON response with status 404 and be marked separately in the logs.
- FR-11: The default `Content-Type` must be `application/json; charset=utf-8`.
- FR-12: CORS and OPTIONS preflight must be configurable; an option to reflect the origin must be available for requests that include credentials.
- FR-13: Mocks must be runnable from the CLI with `serve`, without the UI (for CI and UI tests).

### Generation from models

- FR-20: For Kotlin input, Gson `@SerializedName` (including alternate names) and Kotlinx `@Serializable`/`@SerialName` must be considered.
- FR-21: For Swift input, `Codable`, `CodingKeys`, Optional fields, and enums with raw values must be handled.
- FR-22: Simple generic wrappers (such as `BaseResponse<T>`) must be supported through type substitution.
- FR-23: Naming strategy (as-is, snake_case) and date format (ISO 8601, epoch seconds/milliseconds) must be selectable as generation settings.
- FR-24: With multiple file or folder inputs, types defined in other files must be resolved; unresolved types must be reported as warnings.
- FR-25: The local generator must produce meaningful values based on field names (email, name, phone, URL, price, date, etc.) and return the same output for the same input.
- FR-26: Minimal (required fields only), fully populated, and empty-list variants must be generatable.
- FR-27: A generated or manually edited body must be validated against its associated model schema; violations must be shown as warnings.

### AI integration

- FR-30: The tool must provide an MCP server that clients such as Kiro/Copilot can call (model parsing, body validation, endpoint saving).
- FR-31: Optional AI CLI generation from the UI; the prompt is optional, and if none is provided, semantic data is generated from field names.
- FR-32: If AI is unavailable or disabled, the local generator must support all workflows.

### v1 requirements (2026-11-08, planned)

Source: user decisions, 2026-11-08. Milestones and acceptance criteria are in [Roadmap - v1 plan](ROADMAP.md#v1-plan-m6-m17); not yet implemented.

- FR-40: Scenario selection must support conditions: header, query, route parameter, body field, cookie, and request order; operators for equals, regex, empty/missing, and array contains; AND/OR combinations; and negation. The default scenario is returned when nothing matches. (M7)
- FR-41: The endpoint mode must be selectable: rules-based, fixed scenario, sequential, or random. (M7)
- FR-42: A client must be able to force scenario selection with the `X-Mock-Scenario` header (can be disabled in project settings). (M7)
- FR-43: The request log must show which scenario was selected and why. (M7)
- FR-44: Named test profiles must be able to change scenarios across many endpoints in one operation; profiles must be shareable through git. (M8)
- FR-45: Network conditions such as latency jitter, timeouts, and rate-based errors must be simulatable. (M8)
- FR-46: When a model changes, associated 2xx bodies must be updatable to match the new model while preserving existing values, with preview and confirmation (CLI, MCP, UI). (M9)
- FR-47: MCP, UI, and CLI must expose all management operations (endpoint, scenario, rule, profile, collection, server, log, model check, import/export) through narrow, validated tools. (M10)
- FR-48: AI CLIs installed on the machine (Claude Code, Codex, Copilot, Gemini, Kiro CLI) must be detectable and selectable. (M11)
- FR-49: Collections must support export/import as a single-file package; importing Postman v2.1, OpenAPI 3.x, HAR, and cURL, and exporting Postman v2.1 must be supported. (M12)
- FR-50: Installation on a machine without Node.js must be possible with a single command, and `mock-studio update` must support updates and rollback. (M13)
- FR-51: Real backend responses received through a proxy must be saveable as scenarios, with preview and sensitive header removal. (M12)
- FR-52: Responses must support allowlisted, non-executable dynamic values and project variables. (M14)
- FR-53: Request bodies must be validated against the associated request model; a 400/422 scenario must be returned when validation fails. (M14)
- FR-54: File/binary responses must be servable, and multipart upload requests must be accepted. (M14)
- FR-55: Schemas and samples must be generatable from models with sealed classes/polymorphism and inheritance. (M15)
- FR-56: The dashboard must show a base URL and QR code for device connectivity; optional local HTTPS must be available. (M16)
- FR-57: WebSocket/SSE and GraphQL will be supported if needed. (M17)

## Initial parser scope

- Kotlin: data class, basic scalar types, nullable fields, fields with default values, nested types, `List`/`Set`/`Map<String, T>`, enums, simple generics, `@Serializable`, `@SerialName`, `@Transient`, Gson `@SerializedName`.
- Swift: `Codable` struct, `CodingKeys`, basic scalar types, Optional fields, nested types, arrays, dictionaries, enums with raw values, simple generics.
- Mappings for known types: `Date`, `Instant`, `kotlinx.datetime`, `UUID`, `URL`, `BigDecimal`, `Long`/`Int64`.
- To be reported as unsupported: custom serializers/`init(from:)`, sealed classes / polymorphism, property wrappers, computed properties, inherited fields (in the first version).
- In Swift, account for `let` fields with initial values not being decoded.
- The parser must not compile or execute source code. Unsupported constructs must not be silently skipped.
- Moshi (`@Json(name=)`) usage will be checked in team codebases during M0; if common, it will be included in the initial scope.

## Offline, security, and privacy

- The management UI/API listens only on loopback. The mock listener binds to `127.0.0.1` by default; LAN access is enabled only through an explicit user choice.
- Model generation and mock execution require no network connection.
- No data is sent to AI without a user action and visible confirmation.
- Authorization, cookie, and API key headers are masked in request logs; body logging is off by default.
- User model code, imported JSON, and prompts are never executed as shell commands.
- No telemetry.

## License and cost

- The tool and all runtime dependencies are free and open source licensed.
- Mockoon package MIT license texts are preserved in distribution; the "Mockoon" brand is not used in the product name or logo.
- No paid service or AI CLI is bundled. AI use is covered by the user's own license.
- This is a personal open source project (MIT); it is not affiliated with any company and will be published on GitHub (user decision, 2026-11-08). The repository contains no company or customer code, names, or data.

## MVP acceptance criteria

- Schema-compliant JSON is generated from one Kotlin Gson, one Kotlinx Serialization, and one Swift Codable model (including a generic wrapper).
- Naming strategy and date format settings are correctly reflected in generated JSON.
- A project, multiple collections, and endpoints can be created in the UI; multiple scenarios can be stored per endpoint.
- Active collections run on a single port; conflicting method/path pairs produce an explicit error.
- Body/status/header/scenario changes take effect without a restart; invalid JSON cannot be saved.
- Android Emulator (`10.0.2.2`) and iOS Simulator (`localhost`) receive the correct response.
- Routes and responses are preserved when the mock file is opened in Mockoon desktop.
- The `serve` command runs the same file without the UI.
- All these workflows work without AI or a network connection.

## Out of MVP scope

- Online team synchronization, account system.
- Stateful CRUD backend behavior (Mockoon's data bucket features are preserved in the file but are not managed in the UI).
- UI for request-based response rules, proxying, and templating (can be used with the same file through Mockoon desktop). UI for rules is planned for v1 (FR-40).
- Sealed classes/polymorphism, custom serializers, and inheritance support. Sealed classes and inheritance are planned for v1 (FR-55); custom serializers remain out of scope.
- AI CLI calls from the UI (after MCP).
- Bootstrap that installs its own Node.js, single binary, or Docker distribution. Node installation and updates are planned for v1 (FR-50).
- LAN access enabled by default.

## Implementation notes

How requirements are interpreted in the implementation; evidence is in the [Roadmap](ROADMAP.md) file.

- FR-05: Path parameter names are ignored in duplicate checks (`/users/:id` and `/users/:userId` are the same route). A later static route shadowed by an earlier parameterized route (`/users/:id` and `/users/me`) is reported as a warning, not an error.
- FR-12: CORS is configured in `wildcard` (`*`) or `reflect` (request origin, `Allow-Credentials: true`, `Vary: Origin`) mode.
- FR-27: The model associated with an endpoint validates only the bodies of 2xx scenarios; 4xx/5xx error responses have their own shape and are not checked against the success response model. Violations appear as warnings in the UI and as errors in `save_scenario` and `check`.
- FR-31: AI CLI generation from the UI is launched with `mock-studio ui --ai copilot`; the prompt is optional; every submission requires preview and confirmation.
- Scope addition: Moshi `@Json(name, ignore)` is included in the initial parser scope; typealias and recursive types are supported.
- Scope addition (security): Mockoon templating, data buckets, callbacks, and CRUD/WebSocket routes are not run by default (safe mode); they can be explicitly enabled in project settings.
- Added in M5: proxy unmatched requests to the real backend (starts disabled), model change check (`check`), OpenAPI export.
