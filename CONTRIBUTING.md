# Contributing

Thanks for helping improve Mock API Studio. Contributions should preserve the project's local-first behavior and security boundaries.

## Setup and commands

Use Node.js >= 22.12 and npm. Install dependencies with `npm ci`, then use the commands below:

```sh
npm run lint
npm run build
npm test
npm run notice
```

The tests build `dist/` before running. Run the full suite before submitting a pull request.

## Coding and security rules

- Pin every dependency to an exact version. Keep `@mockoon/commons` and `@mockoon/commons-server` on the same version and update them together using the procedure in the Development Guide. Do not run `npm audit fix`.
- Preserve the security invariants: the Control API binds to loopback only; LAN access requires an explicit user choice; safe mode is the default; logs mask secrets and do not log bodies by default; there is no telemetry; AI prompts require preview and hash approval; MCP exposes no shell or arbitrary-file tools.
- Never execute user input. Model source, imported JSON, and prompts are data, not shell commands. Keep the parser in its separate child process.
- Use synthetic fixtures only. Do not copy customer or production model code into tests.
- Keep product name and UI free of the name “Mockoon”; identify it only as a dependency and license.
- Keep documentation in English. Report evidence accurately: planned work remains planned, and unverified behavior remains unverified.

## Pull request checklist

- [ ] The change is scoped and documented; links and headings resolve.
- [ ] Security defaults and local-only behavior are preserved.
- [ ] Tests use synthetic data and cover the changed behavior.
- [ ] `npm run lint`, `npm run build`, and `npm test` pass; results are included in the PR description.
- [ ] If dependency notices changed, `npm run notice` was run and `NOTICE.md` was reviewed.
- [ ] No secrets, customer data, or production model sources are included.
