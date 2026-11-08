import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const cli = path.resolve('dist/cli/main.js');
const fixtures = path.resolve('test/fixtures');
let dir: string;
let child: ChildProcess | undefined;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mockbrew-cli-'));
});

afterEach(async () => {
  child?.kill('SIGKILL');
  child = undefined;
  await fs.rm(dir, { recursive: true, force: true });
});

function run(args: string[]) {
  const result = spawnSync('node', [cli, ...args], { encoding: 'utf8', cwd: dir });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

function startLongRunning(args: string[], readyText: RegExp): Promise<{ output: () => string }> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    child = spawn('node', [cli, ...args], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString();
      if (readyText.test(buffer)) resolve({ output: () => buffer });
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', (c) => (buffer += c.toString()));
    child.once('exit', (code) => reject(new Error(`exited ${code}: ${buffer}`)));
    setTimeout(() => reject(new Error(`timeout: ${buffer}`)), 20000);
  });
}

describe('cli', () => {
  it('prints help and version', () => {
    expect(run(['--help']).out).toContain('Commands:');
    expect(run(['serve', '--help']).out).toContain('--lan');
    expect(run(['--version']).out.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    const unknown = run(['nope']);
    expect(unknown.code).toBe(2);
    expect(unknown.err).toContain('Unknown command');
  });

  it('generates a body from Kotlin models on stdout and keeps warnings on stderr', () => {
    const result = run(['generate', '-m', path.join(fixtures, 'kotlin/GsonModels.kt'), '-t', 'UserDto', '--seed', '5']);
    expect(result.code).toBe(0);
    const body = JSON.parse(result.out);
    expect(body).toHaveProperty('user_id');
    expect(body.created_at).toMatch(/Z$/);
  });

  it('generates generic Swift models, schema output and listings', () => {
    const swift = path.join(fixtures, 'swift/Generic.swift');
    const body = JSON.parse(run(['generate', '-m', swift, '-t', 'BaseResponse<[Product]>', '--variant', 'minimal']).out);
    expect(Array.isArray(body.data)).toBe(true);
    const schema = JSON.parse(run(['generate', '-m', swift, '-t', 'Product', '--schema']).out);
    expect(schema.$schema).toContain('2020-12');
    const list = run(['generate', '-m', path.join(fixtures, 'kotlin/Unsupported.kt'), '--list']);
    expect(list.out).toContain('class Shape');
    expect(list.err).toContain('[warning] sealed-class');
  });

  it('applies naming and date options', () => {
    const result = run(['generate', '-m', path.join(fixtures, 'kotlin/KotlinxModels.kt'), '-t', 'Order', '--naming', 'snake_case', '--date', 'epoch-seconds']);
    const body = JSON.parse(result.out);
    expect(body).toHaveProperty('total_price');
    expect(Number.isInteger(body.placed_at)).toBe(true);
  });

  it('reports problems with exit codes', () => {
    expect(run(['generate']).code).toBe(2);
    const missing = run(['generate', '-m', path.join(fixtures, 'kotlin/GsonModels.kt'), '-t', 'Nope']);
    expect(missing.code).toBe(1);
    expect(missing.err).toContain('Nope');
    const ambiguous = run(['generate', '-m', path.join(fixtures, 'kotlin/GsonModels.kt')]);
    expect(ambiguous.code).toBe(2);
    expect(ambiguous.err).toContain('--type');
    expect(run(['generate', '-m', path.join(fixtures, 'kotlin/GsonModels.kt'), '-t', 'UserDto', '--naming', 'camel']).code).toBe(2);
  });

  it('initializes a project, saves a generated scenario and serves it', async () => {
    const port = await freePort();
    expect(run(['init', 'mocks', '--name', 'Shop', '--port', String(port)]).code).toBe(0);
    const save = run([
      'generate', '-m', path.join(fixtures, 'kotlin/Generic.kt'), '-t', 'BaseResponse<Product>',
      '-p', 'mocks', '--collection', 'Shop', '--method', 'GET', '--path', '/products/:id', '--scenario', 'Success',
    ]);
    expect(save.code).toBe(0);
    expect(save.out).toContain('Created GET /products/:id');

    const studio = JSON.parse(await fs.readFile(path.join(dir, 'mocks/shop.studio.json'), 'utf8'));
    const link = Object.values(studio.endpoints)[0] as { model: { rootType: string; sources: string[] } };
    expect(link.model.rootType).toBe('BaseResponse<Product>');
    expect(JSON.stringify(studio)).not.toContain(dir);
    // the fixtures share no folder with the temporary project, so no (possibly personal) path is recorded
    expect(link.model.sources).toEqual([]);
    expect(save.err).toContain('no source paths are recorded');

    const { output } = await startLongRunning(['serve', '-p', 'mocks'], /Mock server running/);
    const res = await fetch(`http://127.0.0.1:${port}/products/3`);
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveProperty('data.title');
    await fetch(`http://127.0.0.1:${port}/nothing`);
    await new Promise((r) => setTimeout(r, 100));
    expect(output()).toContain('GET /products/3 -> 200 [Success]');
    expect(output()).toContain('GET /nothing -> 404  <- no mock matched');

    const exited = new Promise<number | null>((resolve) => child?.once('exit', (code) => resolve(code)));
    child?.kill('SIGINT');
    expect(await exited).toBe(0);
  });

  it('records model sources relative to the project and re-reads them with --root', async () => {
    await fs.mkdir(path.join(dir, 'repo/app'), { recursive: true });
    await fs.copyFile(path.join(fixtures, 'kotlin/GsonModels.kt'), path.join(dir, 'repo/app/GsonModels.kt'));
    expect(run(['init', 'repo/mocks', '--name', 'Repo']).code).toBe(0);
    const save = run(['generate', '-m', 'repo/app/GsonModels.kt', '-t', 'UserDto', '-p', 'repo/mocks', '--collection', 'Users', '--method', 'GET', '--path', '/users/:id']);
    expect(save.code).toBe(0);
    expect(save.err).toContain('--root repo');

    const studio = JSON.parse(await fs.readFile(path.join(dir, 'repo/mocks/repo.studio.json'), 'utf8'));
    const link = Object.values(studio.endpoints)[0] as { model: { sources: string[] } };
    expect(link.model.sources).toEqual(['../app/GsonModels.kt']);

    // without a wider root the file is outside the allowed folder, and the message says what to do
    const narrow = run(['check', '-p', 'repo/mocks']);
    expect(narrow.out).toContain('unavailable');
    expect(narrow.out).toContain('--root');
    const wide = run(['check', '-p', 'repo/mocks', '--root', 'repo']);
    expect(wide.code).toBe(0);
    expect(wide.out).toContain('1 ok, 0 drifted');
  });

  it('turns LAN access on only with --lan and says so', async () => {
    const port = await freePort();
    run(['init', 'mocks', '--port', String(port)]);
    const { output } = await startLongRunning(['serve', '-p', 'mocks', '--lan'], /Serving:/);
    expect(output()).toContain('LAN access is on');
    expect(output()).toContain('Mock server running at http://localhost:');
  });
});
