import { parseArgs } from 'node:util';
import { ProjectService } from '../../core/service.js';
import { type Io, UsageError, parsePort } from '../common.js';

export const initHelp = `mockbrew init [dir]

Creates an empty project (a Mockoon environment and a studio file) in dir (default: ./mocks).

Options:
  --name <name>   Project name (default: Mock API)
  --port <n>      Mock server port (default: 3000)`;

export async function initCommand(argv: string[], io: Io): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { name: { type: 'string' }, port: { type: 'string' } },
  });
  if (positionals.length > 1) throw new UsageError('init takes at most one folder.');
  const dir = positionals[0] ?? 'mocks';
  const service = await ProjectService.init(dir, values.name ?? 'Mock API', { port: parsePort(values.port) });
  io.out(`Created ${service.projectFile} in ${dir}`);
  io.out(`Next: mockbrew ui --project ${dir}   (or edit the files and run: mockbrew serve --project ${dir})`);
  await service.close();
}
