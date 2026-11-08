import { promises as fs } from 'node:fs';
import { parseArgs } from 'node:util';
import { buildOpenApi } from '../../core/openapi.js';
import { exportBundle } from '../../core/import/bundle.js';
import { exportPostman } from '../../core/import/postman-export.js';
import { type Io, UsageError, openProject } from '../common.js';

export const exportHelp = `mockbrew export bundle|postman|openapi [-o <file>] [--collection <name>...] [--project <path>]

Writes an OpenAPI 3.1 document built from the endpoints, scenarios and linked models of a project. Treat it
as a contract proposal for the backend team.

Options:
  -p, --project <path>   Project folder or file (default: ./ or ./mocks)
  -o, --out <file>       Write to a file instead of stdout
      --collection <name> Select a collection (repeatable)
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
      collection: { type: 'string', multiple: true },
    },
  });
  if (!['bundle', 'postman', 'openapi'].includes(positionals[0] ?? '') || positionals.length !== 1) throw new UsageError('Usage: mockbrew export bundle|postman|openapi [options].');
  const service = await openProject(values.project);
  try {
    const project = service.model();
    const bundle = positionals[0] === 'openapi' ? undefined : exportBundle(project, values.collection);
    const selectedProject = values.collection ? { ...project, collections: project.collections.filter((c) => values.collection?.includes(c.name) || values.collection?.includes(c.id)) } : project;
    if (values.collection && selectedProject.collections.length !== values.collection.length) throw new UsageError('Selected collection was not found or repeated.');
    const document = positionals[0] === 'bundle' ? bundle : positionals[0] === 'postman' ? exportPostman(bundle!, project.name, service.view().runtime.url ?? `http://localhost:${project.settings.port}`) : buildOpenApi(selectedProject, {
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
