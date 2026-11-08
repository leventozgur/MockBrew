import { promises as fs } from 'node:fs';
import { parseArgs } from 'node:util';
import { MAX_IMPORT_BYTES } from '../../core/import/bundle.js';
import { type Io, UsageError, openProject } from '../common.js';

export const importHelp = `mockbrew import <file> [--project <path>] [--on-conflict skip|rename|replace] [--dry-run]

Preview or import a MockBrew bundle. Use --dry-run to inspect conflicts without saving.`;

export async function importCommand(argv: string[], io: Io): Promise<void> {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: {
    project: { type: 'string', short: 'p' }, 'on-conflict': { type: 'string' }, 'dry-run': { type: 'boolean' },
  } });
  if (positionals.length !== 1) throw new UsageError('Usage: mockbrew import <file> [options].');
  const strategy = values['on-conflict'] ?? 'skip';
  if (strategy !== 'skip' && strategy !== 'rename' && strategy !== 'replace') throw new UsageError('Invalid conflict strategy.');
  const file = await fs.open(positionals[0]!, 'r');
  let content: string;
  try {
    if ((await file.stat()).size > MAX_IMPORT_BYTES) throw new UsageError('Import exceeds the 20 MB limit.');
    content = await file.readFile('utf8');
  } finally { await file.close(); }
  const service = await openProject(values.project);
  try {
    const preview = service.previewBundle(content);
    if (values['dry-run']) io.out(JSON.stringify(preview, null, 2));
    else { await service.applyBundle(content, preview.hash, strategy); io.out('Bundle imported.'); }
  } finally { await service.close(); }
}
