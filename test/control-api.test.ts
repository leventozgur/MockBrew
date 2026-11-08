import { promises as fs } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type ControlApi, startControlApi } from '../src/control-api/server.js';
import { ProjectService } from '../src/core/service.js';
import { shutdownParser } from '../src/parser/index.js';

let dir: string;
let service: ProjectService;
let api: ControlApi;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mockbrew-api-'));
  await fs.cp(path.join(import.meta.dirname, 'fixtures'), path.join(dir, 'fixtures'), { recursive: true });
  service = await ProjectService.init(dir, 'API Test', { port: 38999 });
  api = await startControlApi({ service, uiDir: path.join(dir, 'no-ui') });
});

afterEach(async () => {
  await api.close();
  await service.close();
  await fs.rm(dir, { recursive: true, force: true });
});

afterAll(() => shutdownParser());

function call(pathname: string, init: { method?: string; body?: unknown; headers?: Record<string, string>; token?: string | null } = {}) {
  const headers: Record<string, string> = { ...init.headers };
  if (init.token !== null) headers.Authorization = `Bearer ${init.token ?? api.token}`;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  return fetch(`${api.url}${pathname}`, { method: init.method ?? 'GET', headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
}

/** fetch cannot override Host, so use http directly. */
function rawRequest(options: { host: string; path: string; headers?: Record<string, string> }): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: api.port, path: options.path, headers: { Host: options.host, ...options.headers } }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('control API security', () => {
  it('listens on loopback only', () => {
    expect(api.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(api.launchUrl).toContain('#token=');
  });

  it('requires the session token', async () => {
    expect((await call('/api/project', { token: null })).status).toBe(401);
    expect((await call('/api/project', { token: 'wrong' })).status).toBe(401);
    expect((await call('/api/project')).status).toBe(200);
    expect((await call('/api/models/update/preview', { token: null })).status).toBe(401);
    expect((await call('/api/models/update/apply', { method: 'POST', token: null, body: {} })).status).toBe(401);
    expect((await call('/api/models/update/preview')).status).toBe(200);
    expect((await call('/api/models/update/apply', { method: 'POST', body: { selection: [{ endpointId: 'x', scenarioIds: ['y'] }], previewHash: 'bad' } })).status).toBe(400);
  });

  it('rejects unexpected Host headers (DNS rebinding)', async () => {
    const good = await rawRequest({ host: `127.0.0.1:${api.port}`, path: '/api/project', headers: { Authorization: `Bearer ${api.token}` } });
    expect(good.status).toBe(200);
    const alias = await rawRequest({ host: `localhost:${api.port}`, path: '/api/project', headers: { Authorization: `Bearer ${api.token}` } });
    expect(alias.status).toBe(200);
    const rebound = await rawRequest({ host: `evil.example:${api.port}`, path: '/api/project', headers: { Authorization: `Bearer ${api.token}` } });
    expect(rebound.status).toBe(403);
    const wrongPort = await rawRequest({ host: '127.0.0.1:1', path: '/api/project', headers: { Authorization: `Bearer ${api.token}` } });
    expect(wrongPort.status).toBe(403);
  });

  it('rejects foreign origins even with a valid token', async () => {
    expect((await call('/api/project', { headers: { Origin: 'https://evil.example' } })).status).toBe(403);
    expect((await call('/api/project', { headers: { Origin: api.url } })).status).toBe(200);
  });

  it('expires the token', async () => {
    const short = await startControlApi({ service, tokenTtlMs: 1, uiDir: path.join(dir, 'no-ui') });
    await new Promise((r) => setTimeout(r, 20));
    const res = await fetch(`${short.url}/api/project`, { headers: { Authorization: `Bearer ${short.token}` } });
    expect(res.status).toBe(401);
    await short.close();
  });

  it('does not serve CORS headers and sets protective headers', async () => {
    const res = await call('/api/project');
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

describe('control API workflows', () => {
  it('manages collections, endpoints and scenarios', async () => {
    let res = await call('/api/collections', { method: 'POST', body: { name: 'Users' } });
    const { id: collectionId } = await res.json();
    res = await call(`/api/collections/${collectionId}/endpoints`, {
      method: 'POST',
      body: { method: 'get', path: '/users/:id', scenarios: [{ name: 'Success', body: '{"id":1}' }] },
    });
    expect(res.status).toBe(200);
    const created = await res.json();
    const endpointId = created.id as string;

    res = await call(`/api/endpoints/${endpointId}/scenarios`, { method: 'POST', body: { name: 'Empty', body: '{}' } });
    const { id: scenarioId } = await res.json();
    res = await call(`/api/endpoints/${endpointId}/active-scenario`, { method: 'PUT', body: { scenarioId } });
    const view = (await res.json()).view;
    expect(view.project.collections[0].endpoints[0].scenarios.find((s: { id: string }) => s.id === scenarioId).active).toBe(true);

    res = await call(`/api/endpoints/${endpointId}/scenarios/${scenarioId}`, { method: 'PATCH', body: { body: '{broken' } });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('INVALID');

    res = await call(`/api/collections/${collectionId}`, { method: 'PATCH', body: { active: false } });
    expect((await res.json()).view.project.collections[0].active).toBe(false);
    res = await call(`/api/collections/${collectionId}`, { method: 'DELETE' });
    expect((await res.json()).view.project.collections).toHaveLength(0);
  });

  it('reports conflicts as 409 errors', async () => {
    const a = (await (await call('/api/collections', { method: 'POST', body: { name: 'A' } })).json()).id;
    const b = (await (await call('/api/collections', { method: 'POST', body: { name: 'B' } })).json()).id;
    await call(`/api/collections/${a}/endpoints`, { method: 'POST', body: { method: 'GET', path: '/x' } });
    const res = await call(`/api/collections/${b}/endpoints`, { method: 'POST', body: { method: 'GET', path: '/x' } });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('CONFLICT');
  });

  it('parses models, generates bodies and saves them as validated scenarios', async () => {
    const source = await fs.readFile(path.join(dir, 'fixtures/kotlin/KotlinxModels.kt'), 'utf8');
    let res = await call('/api/models/parse', { method: 'POST', body: { files: [{ name: 'KotlinxModels.kt', content: source }] } });
    const parsed = await res.json();
    expect(parsed.types.map((t: { name: string }) => t.name)).toContain('Order');

    res = await call('/api/models/generate', {
      method: 'POST',
      body: { files: [{ name: 'KotlinxModels.kt', content: source }], rootType: 'Order', settings: { naming: 'snake_case' }, variant: 'full', seed: 1 },
    });
    const generated = await res.json();
    expect(generated.validation.valid).toBe(true);
    expect(JSON.parse(generated.body)).toHaveProperty('total_price');

    const collection = (await (await call('/api/collections', { method: 'POST', body: { name: 'Orders' } })).json()).id;
    const endpoint = (await (await call(`/api/collections/${collection}/endpoints`, { method: 'POST', body: { method: 'GET', path: '/orders/:id', scenarios: [{ name: 'Success', body: generated.body }] } })).json()).id;
    res = await call(`/api/endpoints/${endpoint}/model`, {
      method: 'PUT',
      body: { rootType: generated.rootType, settings: generated.settings, sources: ['/Users/someone/secret/KotlinxModels.kt', 'good/Order.kt', '../evil.kt'], schema: generated.schema },
    });
    expect(res.status).toBe(200);
    const link = (await res.json()).view.project.collections[0].endpoints[0].model;
    expect(link.sources).toEqual(['good/Order.kt']);
    expect(JSON.stringify(link.schema)).not.toContain('x-source');

    // editing the body so it violates the model is reported as a warning in the view
    await call(`/api/endpoints/${endpoint}/scenarios/${(await (await call('/api/project')).json()).project.collections[0].endpoints[0].scenarios[0].id}`, {
      method: 'PATCH',
      body: { body: '{"id":"not a number"}' },
    });
    const after = await (await call('/api/project')).json();
    expect(Object.values(after.violations).flat().length).toBeGreaterThan(0);

    const studio = await fs.readFile(path.join(dir, 'api-test.studio.json'), 'utf8');
    expect(studio).not.toContain('/Users/someone');
  });

  it('reads model files only inside the access root', async () => {
    let res = await call('/api/models/parse', { method: 'POST', body: { paths: ['fixtures/kotlin/GsonModels.kt'] } });
    expect(res.status).toBe(200);
    expect((await res.json()).sources).toEqual(['fixtures/kotlin/GsonModels.kt']);
    res = await call('/api/models/parse', { method: 'POST', body: { paths: ['fixtures/kotlin'] } });
    expect((await res.json()).types.length).toBeGreaterThan(5);
    res = await call('/api/models/parse', { method: 'POST', body: { paths: ['../../etc/passwd'] } });
    expect([403, 404]).toContain(res.status);
    res = await call('/api/models/parse', { method: 'POST', body: { paths: ['/etc/hosts'] } });
    expect([403, 404]).toContain(res.status);
    await fs.symlink('/etc', path.join(dir, 'link'));
    res = await call('/api/models/parse', { method: 'POST', body: { paths: ['link/hosts'] } });
    expect(res.status).toBe(403);
  });

  it('starts and stops the mock server and exposes logs', async () => {
    const a = (await (await call('/api/collections', { method: 'POST', body: { name: 'A' } })).json()).id;
    await call(`/api/collections/${a}/endpoints`, { method: 'POST', body: { method: 'GET', path: '/ping', scenarios: [{ body: '{"pong":true}' }] } });
    let res = await call('/api/runtime/start', { method: 'POST' });
    const started = (await res.json()).view.runtime;
    expect(started.state).toBe('running');
    await fetch(`${started.url}/ping`);
    await fetch(`${started.url}/missing`);
    const poll = await (await call('/api/poll?revision=0&after=0')).json();
    expect(poll.view).toBeDefined();
    expect(poll.logs.map((l: { path: string; matched: boolean }) => [l.path, l.matched])).toEqual([['/ping', true], ['/missing', false]]);
    const again = await (await call(`/api/poll?revision=${poll.revision}&after=${poll.logs.at(-1).id}`)).json();
    expect(again.view).toBeUndefined();
    expect(again.logs).toEqual([]);
    res = await call('/api/runtime/stop', { method: 'POST' });
    expect((await res.json()).view.runtime.state).toBe('stopped');
  });

  it('provides connection snippets', async () => {
    const res = await (await call('/api/snippets')).json();
    const ids = res.snippets.map((s: { id: string }) => s.id);
    expect(ids).toEqual(expect.arrayContaining(['android-emulator', 'android-device', 'ios-simulator', 'android-cleartext', 'ios-ats']));
    expect(res.snippets.find((s: { id: string }) => s.id === 'android-emulator').code).toContain('10.0.2.2:38999');
  });
});

it('manages profiles through authenticated control routes', async () => {
  const endpoint = await service.createEndpoint('root', { method: 'GET', path: '/profile' });
  const scenario = service.findEndpoint(endpoint).scenarios[0]!.id;
  expect((await call('/api/profiles', { token: null })).status).toBe(401);
  const created = await (await call('/api/profiles', { method: 'POST', body: { name: 'Test', endpoints: { [endpoint]: { scenarioId: scenario } } } })).json() as { id: string };
  expect((await call(`/api/profiles/${created.id}/activate`, { method: 'POST' })).status).toBe(200);
  expect(await (await call('/api/profiles')).json()).toMatchObject({ activeProfileId: created.id });
  expect((await call('/api/profiles/deactivate', { method: 'POST' })).status).toBe(200);
  expect((await call(`/api/profiles/${created.id}`, { method: 'DELETE' })).status).toBe(200);
});
