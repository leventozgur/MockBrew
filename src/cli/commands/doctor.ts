import { access, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { resolveLaunch } from '../../core/launch.js';
import { detectProviders, findExecutable } from '../../ai/registry.js';
import { cacheDir, isSea, seaAssetDir } from '../../core/runtime-env.js';
import { ParserHost } from '../../parser/host.js';
import { type Io, openProject, packageVersion } from '../common.js';

export const doctorHelp = `mockbrew doctor [--project <path>]

Check the runtime, project, port, assets, parser, cache and available CLI tools.`;

async function checkPort(port: number, host: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen({ port, host, exclusive: true }, () => server.close((error) => error ? reject(error) : resolve()));
  });
}

export async function doctorCommand(argv: string[], io: Io): Promise<void> {
  const { values } = parseArgs({ args: argv, options: { project: { type: 'string', short: 'p' } } });
  io.out(`Version: ${packageVersion()}`);
  io.out(`Runtime: ${isSea() ? 'single binary' : `npm / Node ${process.version}`}`);
  io.out(`OS/arch: ${process.platform}/${process.arch}`);
  let failed = false;
  const check = async (name: string, fn: () => Promise<string>): Promise<void> => {
    try { io.out(`${name}: PASS ${await fn()}`); }
    catch (error) { failed = true; io.out(`${name}: FAIL ${(error as Error).message}`); }
  };
  await check('Project and port', async () => {
    const service = await openProject(values.project, { watch: false });
    try {
      const settings = service.model().settings;
      await checkPort(settings.port, settings.host);
      return `${service.projectFile}; ${settings.host}:${settings.port} available`;
    } finally { await service.close(); }
  });
  await check('UI assets', async () => {
    const dir = isSea() ? path.join(seaAssetDir(), 'ui') : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'ui');
    await access(path.join(dir, 'index.html'), constants.R_OK);
    return dir;
  });
  await check('Parser worker', async () => {
    const parser = new ParserHost();
    try {
      const result = await parser.extract('kotlin', [{ name: 'Doctor.kt', content: 'data class Doctor(val ok: String)' }]);
      if (!result.declarations.some((item) => item.name === 'Doctor')) throw new Error('Expected declaration was not parsed.');
      return 'Kotlin parsed';
    } finally { parser.close(); }
  });
  await check('Cache writable', async () => {
    const dir = cacheDir();
    await mkdir(dir, { recursive: true });
    const tmp = await mkdtemp(path.join(dir, '.doctor-'));
    await rm(tmp, { recursive: true, force: true });
    return dir;
  });
  const providers = await detectProviders(['auto']);
  io.out(`AI CLIs: ${providers.map(({ info }) => `${info.name} ${info.version}`).join(', ') || 'none detected'}`);
  const mcp = (await Promise.all(['kiro-cli', 'copilot', 'claude', 'codex', 'gemini'].map(async (name) => await findExecutable(name).then((found) => { if (!found) return undefined; try { resolveLaunch(found); return name; } catch { return undefined; } })))).filter(Boolean);
  io.out(`MCP client CLIs: ${mcp.join(', ') || 'none detected'}`);
  if (failed) process.exitCode = 1;
}
