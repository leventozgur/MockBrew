import { type ChildProcess, spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StudioError } from '../src/core/errors.js';
import { ProjectService } from '../src/core/service.js';

let dir: string;
const open: ProjectService[] = [];

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

async function newProject(options: { watch?: boolean } = {}): Promise<ProjectService> {
  const service = await ProjectService.init(dir, 'Orders API', { port: await freePort(), ...options });
  open.push(service);
  return service;
}

const get = (service: ProjectService, p: string, init?: RequestInit) => fetch(`${service.runtime.status().url}${p}`, init);

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mockbrew-'));
});

afterEach(async () => {
  for (const s of open.splice(0)) await s.close();
  await fs.rm(dir, { recursive: true, force: true });
});

describe('project files', () => {
  it('creates a pretty, portable pair of files and reopens them', async () => {
    const service = await newProject();
    const collection = await service.createCollection('Users');
    const endpoint = await service.createEndpoint(collection, {
      method: 'GET',
      path: '/users/:id',
      description: 'Fetch a user',
      scenarios: [{ name: 'Success', body: '{"id":1}' }, { name: 'Not found', statusCode: 404, body: '{"error":"nope"}' }],
    });
    const files = (await fs.readdir(dir)).sort();
    expect(files).toEqual(['orders-api.environment.json', 'orders-api.studio.json']);

    const envText = await fs.readFile(path.join(dir, 'orders-api.environment.json'), 'utf8');
    const studioText = await fs.readFile(path.join(dir, 'orders-api.studio.json'), 'utf8');
    expect(envText).toContain('\n  "routes"');
    expect(envText.endsWith('\n')).toBe(true);
    for (const text of [envText, studioText]) {
      expect(text).not.toContain(dir);
      expect(text).not.toContain(os.userInfo().username);
    }
    expect(JSON.parse(studioText)).toMatchObject({ schemaVersion: 2, environmentFile: 'orders-api.environment.json' });

    const reopened = await ProjectService.open(dir);
    open.push(reopened);
    const view = reopened.view();
    expect(view.project.collections).toHaveLength(1);
    expect(view.project.collections[0]?.endpoints[0]).toMatchObject({ id: endpoint, method: 'GET', path: '/users/:id', description: 'Fetch a user' });
    expect(view.project.collections[0]?.endpoints[0]?.scenarios.map((s) => [s.name, s.statusCode, s.active])).toEqual([
      ['Success', 200, true],
      ['Not found', 404, false],
    ]);
    expect(view.project.settings).toMatchObject({ host: '127.0.0.1', cors: { enabled: true, mode: 'wildcard' } });
  });

  it('keeps ids stable across saves so diffs stay small', async () => {
    const service = await newProject();
    const collection = await service.createCollection('A');
    await service.createEndpoint(collection, { method: 'GET', path: '/a' });
    const before = await fs.readFile(path.join(dir, 'orders-api.environment.json'), 'utf8');
    await service.setCollectionActive(collection, false);
    await service.setCollectionActive(collection, true);
    expect(await fs.readFile(path.join(dir, 'orders-api.environment.json'), 'utf8')).toBe(before);
  });

  it('rejects unknown future studio versions and corrupt files', async () => {
    const service = await newProject();
    await service.close();
    const studioPath = path.join(dir, 'orders-api.studio.json');
    const studio = JSON.parse(await fs.readFile(studioPath, 'utf8'));
    await fs.writeFile(studioPath, JSON.stringify({ ...studio, schemaVersion: 99 }));
    await expect(ProjectService.open(dir)).rejects.toMatchObject({ code: 'UNSUPPORTED_VERSION' });
    await fs.writeFile(studioPath, '{ not json');
    await expect(ProjectService.open(dir)).rejects.toMatchObject({ code: 'INVALID' });
    await fs.writeFile(studioPath, JSON.stringify({ ...studio, environmentFile: '../evil.json' }));
    await expect(ProjectService.open(dir)).rejects.toMatchObject({ code: 'INVALID' });
  });

  it('opens a plain environment file without a sidecar', async () => {
    const service = await newProject();
    const collection = await service.createCollection('Users');
    await service.createEndpoint(collection, { method: 'GET', path: '/users' });
    await service.close();
    await fs.rm(path.join(dir, 'orders-api.studio.json'));
    const plain = await ProjectService.open(path.join(dir, 'orders-api.environment.json'));
    open.push(plain);
    expect(plain.view().project.collections[0]?.endpoints).toHaveLength(1);
    await plain.createCollection('More');
    expect(await fs.readdir(dir)).toContain('orders-api.studio.json');
  });
});

describe('validation and conflicts', () => {
  it('rejects broken JSON, invalid paths and out of range values', async () => {
    const service = await newProject();
    const collection = await service.createCollection('Users');
    await expect(service.createEndpoint(collection, { method: 'GET', path: '/x', scenarios: [{ body: '{oops' }] })).rejects.toMatchObject({ code: 'INVALID' });
    await expect(service.createEndpoint(collection, { method: 'GET', path: '/a b' })).rejects.toBeInstanceOf(StudioError);
    await expect(service.createEndpoint(collection, { method: 'GET', path: '/a/{*splat}' })).rejects.toBeInstanceOf(StudioError);
    await expect(service.createEndpoint(collection, { method: 'TRACE' as never, path: '/a' })).rejects.toBeInstanceOf(StudioError);
    await expect(service.createEndpoint(collection, { method: 'GET', path: '/a', scenarios: [{ statusCode: 99 }] })).rejects.toBeInstanceOf(StudioError);
    await expect(service.createEndpoint(collection, { method: 'GET', path: '/a', scenarios: [{ latencyMs: -1 }] })).rejects.toBeInstanceOf(StudioError);
    expect(service.view().project.collections[0]?.endpoints).toHaveLength(0);
    // an empty body is fine (204) and non JSON content types are not parsed
    await service.createEndpoint(collection, { method: 'DELETE', path: '/a', scenarios: [{ statusCode: 204, body: '' }] });
    await service.createEndpoint(collection, { method: 'GET', path: '/text', scenarios: [{ body: 'plain', headers: [{ key: 'Content-Type', value: 'text/plain' }] }] });
  });

  it('reports duplicate routes between active collections and refuses them', async () => {
    const service = await newProject();
    const a = await service.createCollection('A');
    const b = await service.createCollection('B');
    await service.createEndpoint(a, { method: 'GET', path: '/users/:id' });
    await expect(service.createEndpoint(b, { method: 'GET', path: '/users/:userId' })).rejects.toMatchObject({ code: 'CONFLICT' });
    await service.createEndpoint(b, { method: 'POST', path: '/users/:id' });
    // inactive collections may hold the same route; activating it is refused
    await service.setCollectionActive(b, false);
    const dup = await service.createEndpoint(b, { method: 'GET', path: '/users/:id' });
    await expect(service.setCollectionActive(b, true)).rejects.toMatchObject({ code: 'CONFLICT', message: expect.stringContaining('A') });
    expect(dup).toBeTruthy();
  });

  it('warns about shadowed routes', async () => {
    const service = await newProject();
    const a = await service.createCollection('A');
    await service.createEndpoint(a, { method: 'GET', path: '/users/:id' });
    await service.createEndpoint(a, { method: 'GET', path: '/users/me' });
    const conflicts = service.view().conflicts;
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ kind: 'shadowed', severity: 'warning', path: '/users/me' });
  });

  it('moves endpoints between collections and deletes collections with their routes', async () => {
    const service = await newProject();
    const a = await service.createCollection('A');
    const b = await service.createCollection('B');
    const e = await service.createEndpoint(a, { method: 'GET', path: '/x' });
    await service.updateEndpoint(e, { collectionId: b, path: '/y' });
    let collections = service.view().project.collections;
    expect(collections[0]?.endpoints).toHaveLength(0);
    expect(collections[1]?.endpoints[0]).toMatchObject({ path: '/y' });
    await service.deleteCollection(b);
    collections = service.view().project.collections;
    expect(collections.map((c) => c.name)).toEqual(['A']);
    const env = JSON.parse(await fs.readFile(path.join(dir, 'orders-api.environment.json'), 'utf8'));
    expect(env.routes).toHaveLength(0);
  });

  it('keeps one active scenario and requires at least one', async () => {
    const service = await newProject();
    const a = await service.createCollection('A');
    const e = await service.createEndpoint(a, { method: 'GET', path: '/x', scenarios: [{ name: 'One' }, { name: 'Two' }] });
    const [one, two] = service.findEndpoint(e).scenarios;
    await service.setActiveScenario(e, two!.id);
    expect(service.findEndpoint(e).scenarios.map((s) => s.active)).toEqual([false, true]);
    await service.deleteScenario(e, two!.id);
    expect(service.findEndpoint(e).scenarios.map((s) => [s.id, s.active])).toEqual([[one!.id, true]]);
    await expect(service.deleteScenario(e, one!.id)).rejects.toMatchObject({ code: 'INVALID' });
    await expect(service.createScenario(e, { name: 'one' })).rejects.toMatchObject({ code: 'INVALID' });
  });
});

describe('mock runtime', () => {
  it('serves routes, applies edits without a restart and reports unmatched requests', async () => {
    const service = await newProject();
    const users = await service.createCollection('Users');
    const e = await service.createEndpoint(users, {
      method: 'GET',
      path: '/users/:id',
      scenarios: [{ name: 'Success', body: '{"id":9007199254740993,"name":"Ava"}' }, { name: 'Server error', statusCode: 500, body: '{"error":"boom"}' }],
    });
    await service.createEndpoint(users, { method: 'DELETE', path: '/users/:id', scenarios: [{ statusCode: 204, body: '' }] });
    const started = await service.start();
    expect(started.state).toBe('running');
    const startedAt = started.startedAt;

    let res = await get(service, '/users/42');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(await res.text()).toBe('{"id":9007199254740993,"name":"Ava"}');

    const scenarios = service.findEndpoint(e).scenarios;
    await service.setActiveScenario(e, scenarios[1]!.id);
    res = await get(service, '/users/42');
    expect(res.status).toBe(500);
    await service.updateScenario(e, scenarios[1]!.id, { body: '{"error":"changed"}', latencyMs: 120 });
    const t0 = Date.now();
    res = await get(service, '/users/42');
    expect(await res.text()).toBe('{"error":"changed"}');
    expect(Date.now() - t0).toBeGreaterThanOrEqual(100);
    expect(service.runtime.status().startedAt).toBe(startedAt);

    res = await get(service, '/users/42', { method: 'DELETE' });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');

    res = await get(service, '/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'no_mock_matched', method: 'GET' });
    const logs = service.runtime.logs();
    expect(logs.at(-1)).toMatchObject({ method: 'GET', path: '/nope', status: 404, matched: false });
    expect(logs.find((l) => l.path === '/users/42')).toMatchObject({ matched: true, endpointId: e });
  });

  it('leaves out inactive collections and picks up new routes live', async () => {
    const service = await newProject();
    const a = await service.createCollection('A');
    await service.createEndpoint(a, { method: 'GET', path: '/a', scenarios: [{ body: '{"a":1}' }] });
    await service.start();
    expect((await get(service, '/a')).status).toBe(200);
    await service.setCollectionActive(a, false);
    expect((await get(service, '/a')).status).toBe(404);
    await service.setCollectionActive(a, true);
    const b = await service.createCollection('B');
    await service.createEndpoint(b, { method: 'GET', path: '/b', scenarios: [{ body: '{"b":2}' }] });
    expect(await (await get(service, '/b')).json()).toEqual({ b: 2 });
  });

  it('handles CORS preflight, wildcard and origin reflection', async () => {
    const service = await newProject();
    const a = await service.createCollection('A');
    await service.createEndpoint(a, { method: 'GET', path: '/a' });
    await service.start();
    const preflight = { method: 'OPTIONS', headers: { Origin: 'http://app.local', 'Access-Control-Request-Method': 'GET' } };
    let res = await get(service, '/a', preflight);
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    res = await get(service, '/a', { headers: { Origin: 'http://app.local' } });
    expect(res.headers.get('access-control-allow-origin')).toBe('*');

    await service.updateSettings({ cors: { mode: 'reflect' } });
    res = await get(service, '/a', { headers: { Origin: 'http://app.local' } });
    expect(res.headers.get('access-control-allow-origin')).toBe('http://app.local');
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
    expect(res.headers.get('vary')).toBe('Origin');

    await service.updateSettings({ cors: { enabled: false } });
    res = await get(service, '/a', { headers: { Origin: 'http://app.local' } });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('masks sensitive headers and does not log bodies by default', async () => {
    const service = await newProject();
    const a = await service.createCollection('A');
    await service.createEndpoint(a, { method: 'POST', path: '/login', scenarios: [{ body: '{"ok":true}' }] });
    await service.start();
    await get(service, '/login?access_token=secret123&page=2', {
      method: 'POST',
      headers: { Authorization: 'Bearer abc', Cookie: 'sid=1', 'X-Api-Key': 'k', 'Content-Type': 'application/json', 'X-Plain': 'visible' },
      body: JSON.stringify({ password: 'hunter2' }),
    });
    const log = service.runtime.logs().at(-1)!;
    const byKey = Object.fromEntries(log.requestHeaders.map((h) => [h.key.toLowerCase(), h.value]));
    expect(byKey.authorization).toBe('***');
    expect(byKey.cookie).toBe('***');
    expect(byKey['x-api-key']).toBe('***');
    expect(byKey['x-plain']).toBe('visible');
    expect(log.query).toBe('access_token=***&page=2');
    expect(log.requestBody).toBeUndefined();
    expect(log.responseBody).toBeUndefined();

    await service.updateSettings({ logBodies: true });
    await get(service, '/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ a: 1 }) });
    expect(service.runtime.logs().at(-1)?.requestBody).toContain('"a"');
  });

  it('reports a port that is already in use', async () => {
    const service = await newProject();
    const blocker = net.createServer();
    const port = service.view().project.settings.port;
    await new Promise<void>((resolve) => blocker.listen(port, '127.0.0.1', resolve));
    try {
      await expect(service.start()).rejects.toThrow(/already in use/);
      expect(service.runtime.status().state).toBe('error');
    } finally {
      blocker.close();
    }
  });

  it('moves the listener when the port setting changes while running', async () => {
    const service = await newProject();
    const a = await service.createCollection('A');
    await service.createEndpoint(a, { method: 'GET', path: '/a', scenarios: [{ body: '{"a":1}' }] });
    await service.start();
    const port = await freePort();
    await service.updateSettings({ port });
    expect(service.runtime.status()).toMatchObject({ state: 'running', port });
    expect((await get(service, '/a')).status).toBe(200);
  });

  it('refuses to start while active collections conflict', async () => {
    const service = await newProject();
    await service.close();
    const envPath = path.join(dir, 'orders-api.environment.json');
    const seed = await ProjectService.open(dir);
    open.push(seed);
    const a = await seed.createCollection('A');
    await seed.createEndpoint(a, { method: 'GET', path: '/x' });
    const env = JSON.parse(await fs.readFile(envPath, 'utf8'));
    // simulate an external edit that duplicates the route in a second collection
    const clone = structuredClone(env.routes[0]);
    clone.uuid = '11111111-1111-4111-8111-111111111111';
    clone.responses[0].uuid = '22222222-2222-4222-8222-222222222222';
    const folder = { uuid: '33333333-3333-4333-8333-333333333333', name: 'B', children: [{ type: 'route', uuid: clone.uuid }] };
    env.routes.push(clone);
    env.folders.push(folder);
    env.rootChildren.push({ type: 'folder', uuid: folder.uuid });
    await fs.writeFile(envPath, JSON.stringify(env, null, 2));
    await seed.reloadFromDisk();
    expect(seed.view().conflicts.some((c) => c.kind === 'duplicate')).toBe(true);
    await expect(seed.start()).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('external changes', () => {
  it('reloads edits made on disk and rejects stale writes', async () => {
    const service = await newProject();
    const a = await service.createCollection('A');
    const e = await service.createEndpoint(a, { method: 'GET', path: '/a', scenarios: [{ body: '{"v":1}' }] });
    await service.start();

    const envPath = path.join(dir, 'orders-api.environment.json');
    const env = JSON.parse(await fs.readFile(envPath, 'utf8'));
    env.routes[0].responses[0].body = '{"v":2}';
    await fs.writeFile(envPath, JSON.stringify(env, null, 2));

    // a write based on the old state is refused and the new state is loaded
    await expect(service.createCollection('B')).rejects.toMatchObject({ code: 'STALE' });
    expect(service.findEndpoint(e).scenarios[0]?.body).toBe('{"v":2}');
    expect(await (await get(service, '/a')).json()).toEqual({ v: 2 });
    await service.createCollection('B');
  });

  it('keeps the last good state when the file becomes invalid', async () => {
    const service = await newProject();
    await service.createCollection('A');
    await fs.writeFile(path.join(dir, 'orders-api.environment.json'), '{ broken');
    await service.reloadFromDisk();
    const view = service.view();
    expect(view.loadError).toContain('not valid JSON');
    expect(view.project.collections).toHaveLength(1);
  });

  it('detects changes through the file watcher', async () => {
    const service = await newProject({ watch: true });
    const a = await service.createCollection('A');
    await service.createEndpoint(a, { method: 'GET', path: '/a', scenarios: [{ body: '{"v":1}' }] });
    const changed = new Promise<void>((resolve) => service.once('changed', (e: { external: boolean }) => e.external && resolve()));
    const envPath = path.join(dir, 'orders-api.environment.json');
    const env = JSON.parse(await fs.readFile(envPath, 'utf8'));
    env.routes[0].responses[0].body = '{"v":3}';
    await fs.writeFile(envPath, JSON.stringify(env, null, 2));
    await changed;
    expect(service.view().project.collections[0]?.endpoints[0]?.scenarios[0]?.body).toBe('{"v":3}');
  });
});

describe('Mockoon CLI compatibility', () => {
  let child: ChildProcess | undefined;
  afterEach(() => {
    child?.kill();
    child = undefined;
  });

  it('runs the environment written by this tool with the Mockoon CLI', async () => {
    const service = await newProject();
    const users = await service.createCollection('Users');
    await service.createEndpoint(users, {
      method: 'GET',
      path: '/users/:id',
      scenarios: [{ name: 'Success', body: '{"id":7}' }, { name: 'Err', statusCode: 500, body: '{"e":1}' }],
    });
    const port = await freePort();
    child = spawn('node', ['node_modules/.bin/mockoon-cli', 'start', '--data', path.join(dir, 'orders-api.environment.json'), '--port', String(port)], { stdio: 'ignore' });
    let response: Response | undefined;
    for (let i = 0; i < 60 && !response; i++) {
      try {
        response = await fetch(`http://127.0.0.1:${port}/users/5`);
      } catch {
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ id: 7 });
  }, 30000);
});

describe('conditional responses', () => {
  it('selects rules, overrides by name and id, validates atomically and resets sequential counters', async () => {
    const service = await newProject();
    const c = await service.createCollection('Rules');
    const id = await service.createEndpoint(c, { method: 'POST', path: '/items/:id', scenarios: [{ name: 'Default', body: '{"case":"default"}' }, { name: 'Special', statusCode: 401, body: '{"case":"special"}' }] });
    const [fallback, special] = service.findEndpoint(id).scenarios;
    const rule = (target: string, modifier: string, value: string, operator = 'equals', invert = false) => ({ target, modifier, value, operator, invert });
    await service.setScenarioRules(id, special!.id, [rule('header', 'Authorization', '', 'null')], 'AND');
    await service.start();
    expect((await get(service, '/items/1', { method: 'POST' })).status).toBe(401);
    expect((await get(service, '/items/1', { method: 'POST', headers: { Authorization: 'ok' } })).status).toBe(200);
    expect((await get(service, '/items/1', { method: 'POST', headers: { 'x-mock-scenario': 'Special', Authorization: 'ok' } })).status).toBe(401);
    expect((await get(service, '/items/1', { method: 'POST', headers: { 'X-MOCK-SCENARIO': special!.id, Authorization: 'ok' } })).status).toBe(401);
    expect(service.runtime.logs().at(-1)).toMatchObject({ scenario: 'Special', scenarioReason: 'forced' });
    await service.updateSettings({ scenarioOverrideHeader: false });
    expect((await get(service, '/items/1', { method: 'POST', headers: { 'x-mock-scenario': 'Special', Authorization: 'ok' } })).status).toBe(200);
    for (const [target, modifier, value, url, headers, body] of [
      ['query', 'page', '99', '/items/1?page=99', {}, undefined],
      ['params', 'id', '42', '/items/42', {}, undefined],
      ['body', '$.type', 'premium', '/items/1', { 'Content-Type': 'application/json' }, '{"type":"premium"}'],
      ['cookie', 'tier', 'gold', '/items/1', { Cookie: 'tier=gold' }, undefined],
    ] as const) {
      await service.setScenarioRules(id, special!.id, [rule(target, modifier, value)], 'AND');
      expect((await get(service, url, { method: 'POST', headers, body })).status).toBe(401);
    }
    await service.setScenarioRules(id, special!.id, [rule('query', 'a', '1'), rule('query', 'b', '2', 'equals', true)], 'AND');
    expect((await get(service, '/items/1?a=1&b=3', { method: 'POST' })).status).toBe(401);
    expect((await get(service, '/items/1?a=1&b=2', { method: 'POST' })).status).toBe(200);
    await service.setScenarioRules(id, special!.id, [rule('query', 'a', '1'), rule('query', 'b', '2')], 'OR');
    expect((await get(service, '/items/1?b=2', { method: 'POST', headers: { Connection: 'close' } })).status).toBe(401);
    const before = await fs.readFile(path.join(dir, 'orders-api.environment.json'), 'utf8');
    await expect(service.setScenarioRules(id, special!.id, [rule('query', 'a', '[', 'regex')], 'AND')).rejects.toThrow(/regular expression/i);
    expect(await fs.readFile(path.join(dir, 'orders-api.environment.json'), 'utf8')).toBe(before);
    await service.reorderScenarios(id, [special!.id, fallback!.id]);
    await service.setEndpointMode(id, 'sequential');
    await service.updateSettings({ scenarioOverrideHeader: true });
    expect(service.view().safeModeNotes.some((note) => note.includes('unavailable for SEQUENTIAL'))).toBe(true);
    await service.resetRequestCounters();
    expect((await get(service, '/items/1', { method: 'POST', headers: { Connection: 'close', 'X-Mock-Scenario': 'Default' } })).status).toBe(401);
    expect((await get(service, '/items/1', { method: 'POST', headers: { Connection: 'close' } })).status).toBe(200);
    await service.resetRequestCounters();
    expect((await get(service, '/items/1', { method: 'POST' })).status).toBe(401);
  });

  it('preserves imported unsafe rules and disables them in safe mode', async () => {
    const service = await newProject();
    const c = await service.createCollection('Imported');
    const id = await service.createEndpoint(c, { method: 'GET', path: '/unsafe', scenarios: [{ name: 'Default', body: '{}' }, { name: 'Unsafe', statusCode: 500, body: '{}' }] });
    const scenarioId = service.findEndpoint(id).scenarios[1]!.id;
    const file = path.join(dir, 'orders-api.environment.json');
    const env = JSON.parse(await fs.readFile(file, 'utf8'));
    env.routes[0].responses[1].rules = [{ target: 'templating', modifier: '{{hostname}}', value: '', operator: 'null', invert: true }];
    await fs.writeFile(file, JSON.stringify(env));
    await service.reloadFromDisk();
    expect(service.findEndpoint(id).scenarios[1]!.rules[0]!.target).toBe('templating');
    await expect(service.setScenarioRules(id, scenarioId, [], 'AND')).rejects.toThrow(/read-only/);
    await service.start();
    expect((await get(service, '/unsafe')).status).toBe(200);
    await service.createCollection('Another');
    expect(JSON.parse(await fs.readFile(file, 'utf8')).routes[0].responses[1].rules[0].target).toBe('templating');
  });

  it('migrates a v1 sidecar in memory and saves v2 on the next change', async () => {
    const service = await newProject();
    await service.close();
    const file = path.join(dir, 'orders-api.studio.json');
    const v1 = JSON.parse(await fs.readFile(file, 'utf8'));
    v1.schemaVersion = 1;
    delete v1.settings.scenarioOverrideHeader;
    v1.extra = { retained: true };
    await fs.writeFile(file, JSON.stringify(v1));
    const migrated = await ProjectService.open(dir);
    open.push(migrated);
    expect(migrated.view().migrated).toBe(true);
    expect(migrated.model().settings.scenarioOverrideHeader).toBe(true);
    expect(JSON.parse(await fs.readFile(file, 'utf8')).schemaVersion).toBe(1);
    await migrated.createCollection('After migration');
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toMatchObject({ schemaVersion: 2, extra: { retained: true } });
  });
});
