import { parseArgs } from 'node:util';
import { type Io, UsageError, openProject } from '../common.js';

export const profilesHelp = `mockbrew profiles list [--project <path>] [--json]

Lists the test profiles stored in the project (for example "Session expired" or "Slow network").
Start the mocks with a profile using "mockbrew serve --profile <name>".

Options:
  -p, --project <path>  Project folder or file (default: ./ or ./mocks)
      --json            Print the profiles as JSON`;

export async function profilesCommand(argv: string[], io: Io): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { project: { type: 'string', short: 'p' }, json: { type: 'boolean' } },
  });
  const [action = 'list'] = positionals;
  if (action !== 'list') throw new UsageError(`Unknown profiles action "${action}". Run "mockbrew profiles --help".`);
  const service = await openProject(values.project, { watch: false });
  try {
    const { profiles, activeProfileId } = service.listProfiles();
    if (values.json) {
      io.out(JSON.stringify({ profiles, activeProfileId }, null, 2));
      return;
    }
    if (profiles.length === 0) {
      io.out('No profiles. Create one in the UI or with the MCP tool save_profile.');
      return;
    }
    for (const profile of profiles) {
      const network = [
        profile.network?.latencyMs ? `+${profile.network.latencyMs} ms` : '',
        profile.network?.timeoutEndpoints ? `timeout: ${profile.network.timeoutEndpoints === 'all' ? 'all endpoints' : `${profile.network.timeoutEndpoints.length} endpoint(s)`}` : '',
      ].filter(Boolean);
      const marker = profile.id === activeProfileId ? '*' : ' ';
      io.out(`${marker} ${profile.name}  (${Object.keys(profile.endpoints).length} endpoint(s)${network.length ? `, ${network.join(', ')}` : ''})`);
      if (profile.description) io.out(`    ${profile.description}`);
      if (profile.staleReferences.length) io.out(`    warning: ${profile.staleReferences.length} reference(s) to deleted endpoints or scenarios are ignored`);
    }
  } finally {
    await service.close();
  }
}
