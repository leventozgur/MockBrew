import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { type Io, UsageError, openProject } from '../common.js';

export const certsHelp = `mockbrew certs create|show|delete [--project <path>]

Create requires interactive confirmation. Certificates are stored outside the project.`;

export async function certsCommand(argv: string[], io: Io): Promise<void> {
  const [action, ...rest] = argv;
  if (!['create', 'show', 'delete'].includes(action ?? '')) throw new UsageError('Choose certs create, show or delete.');
  const { values } = parseArgs({ args: rest, options: { project: { type: 'string', short: 'p' } } });
  const service = await openProject(values.project);
  try {
    if (action === 'create') {
      if (!stdin.isTTY || !stdout.isTTY) throw new UsageError('Certificate creation requires an interactive terminal.');
      const rl = createInterface({ input: stdin, output: stdout });
      let answer: string;
      try { answer = await rl.question('Create a local CA and server certificate for this project? [y/N] '); } finally { rl.close(); }
      if (!/^y(es)?$/i.test(answer.trim())) { io.out('Cancelled.'); return; }
      await service.createCerts();
    } else if (action === 'delete') {
      service.deleteCerts();
      io.out('Certificates deleted.');
      return;
    }
    const status = service.certStatus();
    io.out(status.exists ? `CA: ${status.caPath}\nValid until: ${status.validTo}\nSubject alternative names: ${status.subjectAltName}` : 'No certificates found.');
  } finally { await service.close(); }
}
