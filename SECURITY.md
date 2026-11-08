# Security Policy

## Supported versions

The latest version is supported with security updates.

## Reporting a vulnerability

Please report vulnerabilities privately through [GitHub Security Advisories](../../security/advisories/new). Do not open a public issue for an undisclosed vulnerability.

## Scope and security notes

MockBrew is a local development tool. Its Control API binds to loopback by default. The mock listener also binds to loopback by default; LAN access is available only when the user explicitly enables it. The tool has no telemetry. See [Architecture and Security](docs/ARCHITECTURE.md#security-defaults) for the security model and limitations.
