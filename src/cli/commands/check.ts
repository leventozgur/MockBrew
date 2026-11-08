import { parseArgs } from 'node:util';
import { StudioError } from '../../core/errors.js';
import type { ModelCheck } from '../../core/view.js';
import { type Io, openProject } from '../common.js';

export const checkHelp = `mockbrew check [--project <path>]

Re-reads the source files of every model linked to an endpoint and reports changes since the model was
linked (added, removed or retyped properties, new required fields, enum changes) and saved bodies that no
longer match. Useful in CI: the exit code is 1 when something drifted.

Options:
  -p, --project <path>  Project folder or file (default: ./ or ./mocks)
      --root <dir>      Folder the model files are read from (default: the project folder)
      --strict          Also fail when a model cannot be re-read (moved file, pasted code)
      --json            Print the result as JSON
      --fix             Preview body updates
      --yes             Apply the preview (requires --fix)

Exit codes: 0 when clean or successfully applied; 1 on drift, strict unavailable models, skipped updates, or errors.`;

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
    options: { project: { type: 'string', short: 'p' }, root: { type: 'string' }, strict: { type: 'boolean' }, json: { type: 'boolean' }, fix: { type: 'boolean' }, yes: { type: 'boolean' } },
  });
  const service = await openProject(values.project, { root: values.root });
  try {
    if (values.yes && !values.fix) throw new StudioError('INVALID', '--yes requires --fix.');
    const checks = await service.checkModels();
    if (values.fix) {
      const preview = await service.previewModelUpdate();
      if (values.json) io.out(JSON.stringify(preview, null, 2));
      else for (const endpoint of preview.endpoints) {
        io.out(`${endpoint.method} ${endpoint.path}${endpoint.unavailable ? `: ${endpoint.unavailable}` : ''}`);
        for (const scenario of endpoint.scenarios) io.out(`  ${scenario.scenario}: ${scenario.skipped ?? (scenario.changes.map((c) => `${c.kind} ${c.path}`).join(', ') || 'unchanged')}`);
      }
      const selection = preview.endpoints.filter((e) => checks.some((c) => c.endpointId === e.endpointId && c.status === 'drift')).map((e) => ({ endpointId: e.endpointId, scenarioIds: e.scenarios.filter((s) => s.body !== undefined && !s.skipped).map((s) => s.scenarioId) })).filter((e) => e.scenarioIds.length > 0);
      if (values.yes && selection.length) await service.applyModelUpdate(selection, preview.hash);
      const remaining = values.yes ? await service.checkModels() : checks;
      const skipped = preview.endpoints.some((e) => checks.some((c) => c.endpointId === e.endpointId && c.status === 'drift') && e.scenarios.some((s) => s.skipped));
      if (skipped || remaining.some((c) => c.status === 'drift' || (values.strict && c.status === 'unavailable'))) throw new StudioError('CONFLICT', 'Model check failed.');
      return;
    }
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
