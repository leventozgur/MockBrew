# Changelog

This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- **0.1.0 (not yet released):** Kotlin (Gson, Kotlinx Serialization, Moshi) and Swift Codable parsing, JSON Schema generation, and deterministic sample generation, including Kotlin polymorphism and inheritance support.
- Local mock runtime, dashboard, CLI, project files, collections, scenarios, conditional rules, forced scenario selection with `X-Mock-Scenario`, test profiles, fixed latency and timeout simulation, and model drift preview and updates.
- MCP server with narrow tools for project editing, profiles, server control, logs, model updates, import/export, and recording; `mockbrew://guide` resource and client setup command.
- Optional AI CLI provider support with prompt preview and hash approval, provider registry, and local generation fallback.
- Import from MockBrew bundle, Postman v2.1, OpenAPI JSON, HAR, and cURL; export bundle, Postman, and OpenAPI; dashboard/MCP recording of unmatched proxied responses.
- Dashboard device connection screen with base URLs and QR codes; optional local CA and HTTPS certificate management; `doctor` diagnostics and single-binary release tooling.
- Playwright Chromium end-to-end suite and release workflow scaffolding.

### Changed

- Product and CLI renamed to **MockBrew** / `mockbrew`.
- Dashboard and CLI documentation now describes the expanded conditional response, profile, model-update, MCP, provider, import/export, recording, device, and diagnostics workflows.

### Security

- Kept safe mode enabled by default; the Control API remains loopback-only and mock listener LAN binding remains opt-in.
- Kept logs masked, telemetry absent, and MCP tools restricted from shell and arbitrary-file access.
- AI output remains subject to preview and hash-based approval; provider-specific isolation limits are disclosed.
- HTTPS private keys are stored outside the project with restrictive permissions; only the public CA is downloadable through the Control API.
- Import and recording flows apply size limits and remove sensitive/hop-by-hop response headers; sensitive-looking recorded body keys are warned about.

The 0.1.0 version has not been released.
