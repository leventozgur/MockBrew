import { parseArgs } from 'node:util';
import { connectionSnippets } from '../../core/snippets.js';
import { type Io, parsePort } from '../common.js';

export const snippetsHelp = `mock-studio snippets [--port <n>]

Prints debug-only network setup for Android Emulator, Android devices, iOS Simulator and iOS devices.

Options:
  --port <n>   Mock server port (default 3000)`;

export function snippetsCommand(argv: string[], io: Io): void {
  const { values } = parseArgs({ args: argv, options: { port: { type: 'string' } } });
  for (const snippet of connectionSnippets(parsePort(values.port) ?? 3000)) {
    io.out(`## ${snippet.title}${snippet.location ? `  (${snippet.location})` : ''}`);
    io.out(snippet.description);
    io.out('');
    io.out(snippet.code);
    io.out('');
  }
}
