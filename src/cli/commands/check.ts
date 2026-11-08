import { parseArgs } from 'node:util';
import { StudioError } from '../../core/errors.js';
import type { ModelCheck } from '../../core/view.js';
import { type Io, openProject } from '../common.js';

export const checkHelp = `mock-studio check [--project <path>]

Re-reads the source files of every model linked to an endpoint and reports changes since the model was
linked (added, removed or retyped properties, new required fields, enum changes) and saved bodies that no
longer match. Useful in CI: the exit code is 1 when something drifted.

Options:
  -p, --project <path>  Project folder or file (default: ./ or ./mocks)
      --root <dir>      Folder the model files are read from (default: the project folder)
      --strict          Also fail when a model cannot be re-read (moved file, pasted code)
      --json            Print the result as JSON`;

function describe(check: ModelCheck): string[] {
  const head = `${check.status === 'ok' ? 'ok         ' : check.status === 'drift' ? 'DRIFT      ' : 'unavailable'} ${check.method} ${check.path}  [${check.collection}]  ${check.rootType}`;
  const lines = [head];
  if (check.reason) lines.push(`    ${check.reason}`);
  for (const change of check.changes) lines.push(`    ${change.breaking ? 'breaking' : 'ok      '} ${change.message}`);
  for (const violation of check.violations) {
    lines.push(`    scenario "${violation.scenario}" no longer matches the model:`);
    for (const error of violation.errors.slice(0, 5)) lines.push(`      ${error.path} ${error.message}`);
  }
  return lines;
}

export async function checkCommand(argv: string[], io: Io): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: { project: { type: 'string', short: 'p' }, root: { type: 'string' }, strict: { type: 'boolean' }, json: { type: 'boolean' } },
  });
  const service = await openProject(values.project, { root: values.root });
  try {
    const checks = await service.checkModels();
    if (values.json) io.out(JSON.stringify(checks, null, 2));
    else if (checks.length === 0) io.out('No endpoint is linked to a model.');
    else for (const check of checks) for (const line of describe(check)) io.out(line);
    const drift = checks.filter((c) => c.status === 'drift').length;
    const unavailable = checks.filter((c) => c.status === 'unavailable').length;
    if (!values.json) io.out(`${checks.length} model link(s): ${checks.length - drift - unavailable} ok, ${drift} drifted, ${unavailable} unavailable.`);
    if (drift > 0 || (values.strict && unavailable > 0)) throw new StudioError('CONFLICT', 'Model check failed.');
  } finally {
    await service.close();
  }
}
