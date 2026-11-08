import { parseArgs } from 'node:util';
import type { RequestLog } from '../../core/view.js';
import { type Io, UsageError, openProject, parsePort, waitForSignal } from '../common.js';

export const serveHelp = `mock-studio serve [--project <path>]

Runs the active collections of a project on one port, without the UI. Changes to the project files
(git pull, an editor, the UI in another process) are picked up without restarting.

Options:
  -p, --project <path>  Project folder or file (default: ./ or ./mocks)
      --port <n>        Override the port for this run
      --host <address>  Override the listen address for this run (default 127.0.0.1)
      --lan             Listen on all interfaces (0.0.0.0) so physical devices can connect.
                        Anyone on your network can reach the mock while this is on.
      --root <dir>      Folder model files may be read from (default: the project folder)`;

function describe(log: RequestLog): string {
  const target = log.query ? `${log.path}?${log.query}` : log.path;
  const note = log.matched ? (log.scenario ? ` [${log.scenario}]` : '') : '  <- no mock matched';
  return `${log.method} ${target} -> ${log.status}${note}`;
}

export async function serveCommand(argv: string[], io: Io): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      project: { type: 'string', short: 'p' },
      port: { type: 'string' },
      host: { type: 'string' },
      lan: { type: 'boolean' },
      root: { type: 'string' },
    },
  });
  if (values.lan && values.host) throw new UsageError('Use either --lan or --host, not both.');
  const service = await openProject(values.project, {
    watch: true,
    root: values.root,
    overrides: { port: parsePort(values.port), host: values.lan ? '0.0.0.0' : values.host },
  });

  const printState = (prefix: string) => {
    const view = service.view();
    io.out(prefix);
    for (const collection of view.project.collections) {
      io.out(`  ${collection.name}${collection.active ? '' : ' (inactive)'}`);
      for (const endpoint of collection.endpoints) {
        const active = endpoint.scenarios.find((s) => s.active);
        io.out(`    ${endpoint.method.padEnd(6)} ${endpoint.path}${active ? `  [${active.name}: ${active.statusCode}]` : ''}`);
      }
    }
    for (const conflict of view.conflicts) io.err(`  ${conflict.severity}: ${conflict.message}`);
    if (view.loadError) io.err(`  Project files could not be loaded: ${view.loadError}`);
  };

  try {
    const status = await service.start();
    io.out(`Mock server running at ${status.url}  (Ctrl+C to stop)`);
    if (service.view().lan) io.err('LAN access is on: devices on your network can reach this mock server.');
    printState('Serving:');
  } catch (error) {
    await service.close();
    throw error;
  }

  service.runtime.on('log', (log: RequestLog) => io.out(describe(log)));
  service.runtime.on('server-error', (e: { message: string }) => io.err(`Server error: ${e.message}`));
  service.on('changed', (e: { external: boolean }) => {
    if (e.external) printState('Project files changed, reloaded:');
  });

  await waitForSignal();
  io.out('Stopping...');
  await service.close();
}
