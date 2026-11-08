import { execFile } from 'node:child_process';
import { parseArgs } from 'node:util';
import { AiService } from '../../ai/service.js';
import { detectProviders, detectUnsupportedProviders, providerIds } from '../../ai/registry.js';
import { startControlApi } from '../../control-api/server.js';
import { type Io, UsageError, openProject, parsePort, waitForSignal } from '../common.js';

export const uiHelp = `mockbrew ui [--project <path>]

Starts the local web UI. It listens on 127.0.0.1 only and is protected by a session token that is part
of the printed address.

Options:
  -p, --project <path>  Project folder or file (default: ./ or ./mocks)
      --port <n>        UI port (default: a free port)
      --root <dir>      Folder model files may be read from (default: the project folder)
      --open            Open the UI in the default browser
      --no-watch        Do not watch the project files for outside changes
      --ai <providers>  Offer optional AI generation: auto or a comma-separated provider list (off by default).
                        Nothing is sent without a previewed and confirmed prompt. Isolation varies by
                        provider; the local generator is the fallback.
      --ai-timeout <s>  Seconds to wait for the AI CLI (default 120)`;

function openInBrowser(url: string): void {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  execFile(command, [url], () => undefined);
}

export async function uiCommand(argv: string[], io: Io): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      project: { type: 'string', short: 'p' },
      port: { type: 'string' },
      root: { type: 'string' },
      open: { type: 'boolean' },
      'no-watch': { type: 'boolean' },
      ai: { type: 'string' },
      'ai-timeout': { type: 'string' },
    },
  });
  if (values.port !== undefined && parsePort(values.port) === undefined) throw new UsageError('Invalid --port.');
  const service = await openProject(values.project, { watch: !values['no-watch'], root: values.root });
  const selection = values.ai?.split(',').map((id) => id.trim()) ?? [];
  if (selection.some((id) => ![...providerIds, 'auto'].includes(id))) throw new UsageError(`--ai supports auto or: ${providerIds.join(', ')}.`);
  const timeout = values['ai-timeout'] === undefined ? undefined : Number(values['ai-timeout']);
  if (timeout !== undefined && (!Number.isFinite(timeout) || timeout < 5 || timeout > 900)) throw new UsageError('--ai-timeout must be between 5 and 900 seconds.');
  const ai = values.ai ? new AiService(service.models, await detectProviders(selection), timeout === undefined ? undefined : timeout * 1000, await detectUnsupportedProviders(selection)) : undefined;
  const api = await startControlApi({ service, port: parsePort(values.port), ai });
  io.out(`Studio UI: ${api.launchUrl}`);
  io.out(`Project:   ${service.projectFile}   (Ctrl+C to stop)`);
  if (ai) io.out('AI generation is on. Prompts are shown and need your confirmation before anything is sent.');
  if (values.open) openInBrowser(api.launchUrl);

  await waitForSignal();
  io.out('Stopping...');
  await api.close();
  await service.close();
}
