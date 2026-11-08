import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { claudeProvider, codexProvider, geminiProvider, detectProviders, detectUnsupportedProviders, findExecutable, parseProviderOutput } from '../src/ai/registry.js';
import { fakeExecutable } from './fake-executable.js';
import { runCli } from '../src/ai/cli-runner.js';

let dir = '';
const originalPath = process.env.PATH;
afterEach(async () => { process.env.PATH = originalPath; if (dir) await fs.rm(dir, { recursive: true, force: true }); });

describe('AI provider registry', () => {
  it('detects only supported executables with version, and never sends a prompt', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mockbrew-registry-'));
    const record = path.join(dir, 'calls');
    await fakeExecutable(path.join(dir, 'claude'), `require('node:fs').appendFileSync(${JSON.stringify(record)}, process.argv.slice(2).join(' ') + '\\n'); console.log('fake 1.0');`);
    process.env.PATH = dir;
    expect(await findExecutable('missing')).toBeUndefined();
    const providers = await detectProviders(['auto']);
    expect(providers.map((p) => p.info)).toMatchObject([{ id: 'claude', version: 'fake 1.0', isolation: 'limited' }]);
    expect(await fs.readFile(record, 'utf8')).toBe('--version\n');
    expect(await detectProviders(['codex'])).toEqual([]);
  });

  it('passes the prompt once and runs Claude with documented restrictions in an empty cwd', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mockbrew-registry-'));
    const executable = await fakeExecutable(path.join(dir, 'fake'), `console.log(process.cwd()); if (require('node:fs').readdirSync('.').length) console.log('not empty');`);
    const invocation = claudeProvider(executable).invocation('prompt; $(danger)');
    expect(invocation.args.filter((a) => a === 'prompt; $(danger)')).toHaveLength(1);
    expect(invocation.args).toEqual(expect.arrayContaining(['--print', '--tools', '', '--safe-mode', '--strict-mcp-config', '--no-session-persistence', '--permission-prompts', 'none']));
    const result = await runCli(invocation, { timeoutMs: 3000 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.stdout.trim().split('\n')).toHaveLength(1);
  });

  it('parses JSON, fenced output and known result envelopes', () => {
    expect(parseProviderOutput('{"x":1}')).toEqual({ x: 1 });
    expect(parseProviderOutput('```json\n{"x":1}\n```')).toEqual({ x: 1 });
    expect(parseProviderOutput(JSON.stringify({ type: 'result', result: '{"x":1}' }))).toEqual({ x: 1 });
    expect(parseProviderOutput(JSON.stringify({ response: '{"x":1}', stats: {} }))).toEqual({ x: 1 });
    expect(parseProviderOutput(JSON.stringify({ response: '{"x":1}' }))).toEqual({ x: 1 });
  });

  it('detects selectable providers and reports unsupported Kiro', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mockbrew-registry-'));
    for (const name of ['copilot', 'codex', 'gemini', 'kiro-cli']) {
      await fakeExecutable(path.join(dir, name), `console.log(process.argv[2] === '--version' ? 'fake 1' : '--color --extensions none --no-custom-instructions --disable-builtin-mcps --no-ask-user --no-auto-update');`);
    }
    process.env.PATH = dir;
    const providers = await detectProviders(['auto']);
    expect(providers.map((p) => [p.info.id, p.info.isolation])).toEqual([['copilot', 'full'], ['codex', 'limited'], ['gemini', 'limited']]);
    const copilot = providers[0].provider.invocation('prompt');
    expect(copilot.args).toEqual(expect.arrayContaining(['--config-dir', '--available-tools=none', '--deny-tool=shell', '--deny-tool=write', '--no-custom-instructions', '--disable-builtin-mcps', '--no-ask-user', '--no-auto-update', '-p', 'prompt']));
    expect(providers[1].provider.invocation('prompt').args).toContain('--color');
    expect(providers[2].provider.invocation('prompt').args).toContain('--extensions');
    expect(await detectUnsupportedProviders(['auto'])).toMatchObject([{ id: 'kiro', note: expect.stringContaining('Not supported yet') }]);
  });

  it('runs Codex with one prompt and reads its output file, falling back to stdout', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mockbrew-registry-'));
    const executable = await fakeExecutable(path.join(dir, 'codex'), `const i = process.argv.indexOf('-o'); if (i >= 0) require('node:fs').writeFileSync(process.argv[i + 1], '{"file":true}'); process.stdout.write('{"stdout":true}');`);
    const invocation = codexProvider(executable, true).invocation('prompt; $(danger)');
    expect(invocation.args).toEqual(['exec', '--sandbox', 'read-only', '--skip-git-repo-check', '--ephemeral', '--ignore-user-config', '-C', '@WORK_DIR@', '--color', 'never', '-o', '@OUTPUT_FILE@', 'prompt; $(danger)']);
    expect(await runCli(invocation, { timeoutMs: 3000 })).toEqual({ ok: true, stdout: '{"file":true}' });
    await fakeExecutable(path.join(dir, 'codex'), `process.stdout.write('{"stdout":true}');`);
    expect(await runCli(invocation, { timeoutMs: 3000 })).toEqual({ ok: true, stdout: '{"stdout":true}' });
  });

  it('uses Gemini plan mode and parses its JSON response', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mockbrew-registry-'));
    const executable = await fakeExecutable(path.join(dir, 'gemini'), `console.log(JSON.stringify({ response: JSON.stringify({ x: 1 }) }));`);
    const invocation = geminiProvider(executable).invocation('prompt; $(danger)');
    expect(invocation.args).toEqual(['-p', 'prompt; $(danger)', '--approval-mode', 'plan', '--output-format', 'json']);
    const result = await runCli(invocation, { timeoutMs: 3000 });
    expect(result.ok && parseProviderOutput(result.stdout)).toEqual({ x: 1 });
  });
});
