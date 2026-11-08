import { promises as fs } from 'node:fs';
import { parseArgs } from 'node:util';
import { buildOpenApi } from '../../core/openapi.js';
import { type Io, UsageError, openProject } from '../common.js';

export const exportHelp = `mockbrew export openapi [--project <path>]

Writes an OpenAPI 3.1 document built from the endpoints, scenarios and linked models of a project. Treat it
as a contract proposal for the backend team.

Options:
  -p, --project <path>   Project folder or file (default: ./ or ./mocks)
  -o, --out <file>       Write to a file instead of stdout
      --title <text>     API title (default: the project name)
      --api-version <v>  API version (default 1.0.0)
      --include-inactive Also include collections that are switched off`;

export async function exportCommand(argv: string[], io: Io): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      project: { type: 'string', short: 'p' },
      out: { type: 'string', short: 'o' },
      title: { type: 'string' },
      'api-version': { type: 'string' },
      'include-inactive': { type: 'boolean' },
    },
  });
  if (positionals[0] !== 'openapi' || positionals.length !== 1) throw new UsageError('Usage: mockbrew export openapi [options].');
  const service = await openProject(values.project);
  try {
    const document = buildOpenApi(service.model(), {
      title: values.title,
      version: values['api-version'],
      onlyActive: !values['include-inactive'],
    });
    const text = `${JSON.stringify(document, null, 2)}\n`;
    if (values.out) {
      await fs.writeFile(values.out, text, 'utf8');
      io.out(`Wrote ${values.out}`);
    } else {
      io.out(text.trimEnd());
    }
  } finally {
    await service.close();
  }
}
