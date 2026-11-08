import { promises as fs } from 'node:fs';
import { parseArgs } from 'node:util';
import { MAX_IMPORT_BYTES, parseBundle } from '../../core/import/bundle.js';
import { convertImport, type ImportFormat } from '../../core/import/detect.js';
import { type Io, UsageError, openProject } from '../common.js';

export const importHelp = `mockbrew import <file> [--project <path>] [--format auto|bundle|postman|openapi|har|curl] [--collection <name>] [--on-conflict skip|rename|replace] [--dry-run]

Preview or import a bundle, Postman collection, OpenAPI document, HAR, or cURL command. Use --dry-run to inspect conflicts without saving.`;

export async function importCommand(argv: string[], io: Io): Promise<void> {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: {
    project: { type: 'string', short: 'p' }, format: { type: 'string' }, collection: { type: 'string' }, 'on-conflict': { type: 'string' }, 'dry-run': { type: 'boolean' },
  } });
  if (positionals.length !== 1) throw new UsageError('Usage: mockbrew import <file> [options].');
  const strategy = values['on-conflict'] ?? 'skip';
  if (strategy !== 'skip' && strategy !== 'rename' && strategy !== 'replace') throw new UsageError('Invalid conflict strategy.');
  const format = values.format ?? 'auto';
  if (!['auto', 'bundle', 'postman', 'openapi', 'har', 'curl'].includes(format)) throw new UsageError('Invalid import format.');
  const file = await fs.open(positionals[0]!, 'r');
  let content: string;
  try {
    if ((await file.stat()).size > MAX_IMPORT_BYTES) throw new UsageError('Import exceeds the 20 MB limit.');
    content = await file.readFile('utf8');
  } finally { await file.close(); }
  const converted = convertImport(content, format as ImportFormat);
  if (values.collection) {
    const endpoints = converted.bundle.collections.flatMap((c) => c.endpoints);
    converted.bundle = parseBundle(JSON.stringify({ ...converted.bundle, collections: [{ name: values.collection, endpoints }] }));
  }
  const bundleContent = JSON.stringify(converted.bundle);
  const service = await openProject(values.project);
  try {
    const preview = service.previewBundle(bundleContent);
    io.out(JSON.stringify({ collections: preview.bundle.collections.map((c) => ({ name: c.name, endpoints: c.endpoints.length })), conflicts: preview.conflicts, newCollections: preview.newCollections, warnings: converted.warnings }, null, 2));
    if (!values['dry-run']) { await service.applyBundle(bundleContent, preview.hash, strategy); io.out('Import completed.'); }
  } finally { await service.close(); }
}
