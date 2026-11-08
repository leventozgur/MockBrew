# Node SEA feasibility spike (M6), round 2

Date: 2026-11-08. Host: macOS arm64. **Recommendation: promising prototype, not release-ready; M6 remains open.** The executable passed the requested vertical slice with a watcher workaround, but ordinary `serve` failed in this sandbox and the full npm suite did not pass. The same-host results do not establish distribution or another machine's behavior.

## Build

Node v23.9.0 from `/opt/homebrew/bin/node`, Rolldown 1.2.16 and `postject@1.0.0-alpha.6` were used. The 67 MiB executable is an ad-hoc signed prototype, not a notarized release. From the repository root:

```sh
npm run build
npm_config_cache=/private/tmp/mock-studio-npm-cache /opt/homebrew/bin/node scripts/sea/build.mjs
```

The build bundles the compiled CLI and worker, generates the SEA blob, copies Node, removes its signature, injects with the documented SEA fuse and `NODE_SEA` Mach-O segment, and ad-hoc signs. `codesign --verify --verbose=2 scripts/sea/out/mock-studio` passed. The first injector attempt could not write the default npm cache; the temporary cache solved that. The installed `/usr/local/bin/node` v22.14.0 is a universal binary: postject reported multiple sentinel occurrences. The Node 23 executable is arm64-only. Node 23 is not a release-runtime recommendation; select and pin a supported runtime. See the [Node SEA documentation](https://nodejs.org/download/release/latest-jod/docs/api/single-executable-applications.html).

## Runtime and acceptance

Assets are embedded with SHA-256 manifests and extracted to a versioned user cache, with validated path components and integrity checked on reuse. `XDG_CACHE_HOME=/private/tmp/mock-sea-cache` was used because the sandbox denied writes to the default `~/Library/Caches` location. UI files and both grammar WASMs plus the runtime WASM are embedded. Cache hardening against symlink races, cleanup policy, concurrent extraction and behavior under corrupted or hostile cache state need separate review before release.

| Check | Result |
| --- | --- |
| `--version` | PASS: `0.1.0`. |
| `init /private/tmp/sea-round2-project` | PASS: created project. |
| `generate -m test/fixtures/kotlin/GsonModels.kt --list` | PASS: listed six declarations with the extracted Kotlin grammar. |
| `serve` and curl a synthetic `/users` route | CONDITIONAL PASS: with `CHOKIDAR_USEPOLLING=1`, curl returned HTTP 200 and generated JSON. Without it the process announced the server and route then exited with `EMFILE: too many open files, watch` before curl connected. Cause is not established; do not assume this proves a production defect or normal operation. |
| `ui --no-watch` and curl `/` | PASS: HTTP 200, HTML byte-identical to `dist/ui/index.html`; referenced JS and CSS returned HTTP 200. This is not interactive browser acceptance. |
| MCP stdio `initialize` | PASS: JSON-RPC initialize returned protocol `2025-03-26`, server name and version; stderr was empty during the handshake. Other MCP operations and sustained watcher operation were not established by this check. |

The SEA worker relaunches the executable with IPC, and npm mode retains the existing `fork` and `execArgv`. Node rejects `--liftoff-only` in `NODE_OPTIONS`, so the SEA child sets V8 flags before loading the worker. A diagnostic SEA build enabled `--trace-wasm-compilation-times`, disabled lazy compilation, lowered the tiering budget, and exposed child stdout: setting only `--liftoff-only` at runtime still produced 23 TurboFan compilation records. Explicitly adding `--no-wasm-tier-up --no-wasm-dynamic-tiering` yielded 280 Liftoff and zero TurboFan compilation records for the Kotlin listing. This is evidence for that Node version and workload, not a guarantee for all V8 versions or workloads.

## Repository checks

- `npm run lint`: PASS.
- `npx tsc -p tsconfig.json`: PASS.
- `npm run build`: PASS.
- `npm test`: FAIL: 2 files failed, 7 passed; 8 tests failed, 108 passed; one unhandled `EMFILE` watcher error. The CLI fetch failed `ECONNRESET` and seven MCP tests reported connection closed.
- `npx vitest run test/models.test.ts test/cli.test.ts --configLoader runner`: FAIL: 1 file failed, 1 passed; 1 test failed, 39 passed. CLI serve fetch failed `ECONNRESET`.
- `CHOKIDAR_USEPOLLING=1 npm test`: FAIL: 1 file failed, 8 passed; 7 MCP tests failed with connection closed, 109 passed. Polling resolved the CLI test in this run; the MCP failures are not diagnosed.

The coordinator should run the full suite outside the sandbox. Before release, investigate native watcher and MCP failures; repeat the entire matrix without overrides on a clean macOS machine; verify worker behavior and embedded assets without repository dependencies; harden extraction and update/cleanup; pin a supported Node and injector; validate other architectures and operating systems separately; set up CI, Developer ID signing, notarization, Gatekeeper and distribution checks. Linux and Windows binaries, notarization and release CI were out of scope.
