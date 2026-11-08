import { execFile } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { locateProject } from '../../store/files.js';
import { StudioError } from '../../core/errors.js';
import { isSea } from '../../core/runtime-env.js';
import { UsageError } from '../common.js';

export async function installMcp(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: {
    project: { type: 'string', short: 'p' }, root: { type: 'string' }, scope: { type: 'string' }, yes: { type: 'boolean' }, print: { type: 'boolean' },
  } });
  const client = positionals[0];
  if (positionals.length !== 1 || !client || !['claude', 'codex', 'gemini', 'copilot', 'kiro'].includes(client)) throw new UsageError('Choose a client: claude, codex, gemini, copilot or kiro.');
  if (values.scope && !['user', 'project'].includes(values.scope)) throw new UsageError('--scope must be user or project.');
  if (values.scope === 'project' && (client === 'codex' || client === 'copilot')) throw new UsageError(`${client} mcp add does not support project scope.`);
  let defaultProject = '.';
  if (!values.project) {
    try { await locateProject('.'); } catch (error) {
      if (!(error instanceof StudioError) || error.code !== 'NOT_FOUND') throw error;
      if (existsSync('mocks')) defaultProject = 'mocks';
    }
  }
  const project = path.resolve(values.project ?? defaultProject);
  const projectDir = existsSync(project) && statSync(project).isFile() ? path.dirname(project) : project;
  const root = path.resolve(values.root ?? projectDir);
  const command = process.execPath;
  const serverArgs = [...(isSea() ? [] : [path.resolve(process.argv[1]!)]), 'mcp', '-p', project, '--root', root];
  const snippet = JSON.stringify({ mcpServers: { mockbrew: { command, args: serverArgs } } }, null, 2);
  if (client === 'kiro') {
    console.log(`Kiro config location is not known offline; generic mcpServers snippet:\n${snippet}`);
    return;
  }
  // Local help checked: Claude Code 2.1.318, codex-cli 0.163.0, Gemini 0.64.0, Copilot CLI 1.0.85.
  const prefix = client === 'claude' ? ['mcp', 'add', ...(values.scope ? ['--scope', values.scope] : []), 'mockbrew', '--']
    : client === 'gemini' ? ['mcp', 'add', ...(values.scope ? ['-s', values.scope] : []), 'mockbrew']
      : ['mcp', 'add', 'mockbrew', '--'];
  const args = [...prefix, command, ...serverArgs];
  console.log([client, ...args].map((part) => JSON.stringify(part)).join(' '));
  if (values.print) return;
  if (!values.yes) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw new UsageError('Confirmation requires an interactive TTY; use --yes to proceed.');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question('Run this command? [y/N] ');
    rl.close();
    if (!/^y(es)?$/i.test(answer.trim())) throw new UsageError('Installation cancelled.');
  }
  await new Promise<void>((resolve, reject) => {
    const child = execFile(client, args, (error) => {
      if (error && (error as NodeJS.ErrnoException).code === 'ENOENT') reject(new Error(`${client} CLI not found on PATH. Configuration snippet:\n${snippet}`));
      else if (error) reject(error);
      else resolve();
    });
    child.stdout?.pipe(process.stdout);
    child.stderr?.pipe(process.stderr);
  });
}
