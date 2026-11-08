import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { claudeProvider, codexProvider, geminiProvider, detectProviders, detectUnsupportedProviders, findExecutable, parseProviderOutput } from '../src/ai/registry.js';
import { runCli } from '../src/ai/cli-runner.js';

let dir = '';
const originalPath = process.env.PATH;
afterEach(async () => { process.env.PATH = originalPath; if (dir) await fs.rm(dir, { recursive: true, force: true }); });

describe('AI provider registry', () => {
  it('detects only supported executables with version, and never sends a prompt', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mockbrew-registry-'));
    const record = path.join(dir, 'calls');
    await fs.writeFile(path.join(dir, 'claude'), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${record}'\nprintf 'fake 1.0\\n'\n`, { mode: 0o755 });
    process.env.PATH = dir;
    expect(await findExecutable('missing')).toBeUndefined();
    const providers = await detectProviders(['auto']);
    expect(providers.map((p) => p.info)).toMatchObject([{ id: 'claude', version: 'fake 1.0', isolation: 'limited' }]);
    expect(await fs.readFile(record, 'utf8')).toBe('--version\n');
    expect(await detectProviders(['codex'])).toEqual([]);
  });

  it('passes the prompt once and runs Claude with documented restrictions in an empty cwd', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mockbrew-registry-'));
    const executable = path.join(dir, 'fake');
    await fs.writeFile(executable, '#!/bin/sh\n/bin/pwd\n/bin/ls -A\n', { mode: 0o755 });
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
      await fs.writeFile(path.join(dir, name), '#!/bin/sh\nif [ "$1" = "--version" ]; then printf "fake 1\\n"; else printf "%s\\n" "--color --extensions none --no-custom-instructions --disable-builtin-mcps --no-ask-user --no-auto-update"; fi\n', { mode: 0o755 });
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
    const executable = path.join(dir, 'codex');
    await fs.writeFile(executable, '#!/bin/sh\nwhile [ "$#" -gt 0 ]; do if [ "$1" = "-o" ]; then shift; printf \'{"file":true}\' > "$1"; fi; shift; done\nprintf \'{"stdout":true}\'\n', { mode: 0o755 });
    const invocation = codexProvider(executable, true).invocation('prompt; $(danger)');
    expect(invocation.args).toEqual(['exec', '--sandbox', 'read-only', '--skip-git-repo-check', '--ephemeral', '--ignore-user-config', '-C', '@WORK_DIR@', '--color', 'never', '-o', '@OUTPUT_FILE@', 'prompt; $(danger)']);
    expect(await runCli(invocation, { timeoutMs: 3000 })).toEqual({ ok: true, stdout: '{"file":true}' });
    await fs.writeFile(executable, '#!/bin/sh\nprintf \'{"stdout":true}\'\n', { mode: 0o755 });
    expect(await runCli(invocation, { timeoutMs: 3000 })).toEqual({ ok: true, stdout: '{"stdout":true}' });
  });

  it('uses Gemini plan mode and parses its JSON response', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mockbrew-registry-'));
    const executable = path.join(dir, 'gemini');
    await fs.writeFile(executable, '#!/bin/sh\nprintf "%s" \'{"response":"{\\"x\\":1}"}\'\n', { mode: 0o755 });
    const invocation = geminiProvider(executable).invocation('prompt; $(danger)');
    expect(invocation.args).toEqual(['-p', 'prompt; $(danger)', '--approval-mode', 'plan', '--output-format', 'json']);
    const result = await runCli(invocation, { timeoutMs: 3000 });
    expect(result.ok && parseProviderOutput(result.stdout)).toEqual({ x: 1 });
  });
});
