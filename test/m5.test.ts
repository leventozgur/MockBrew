import { createServer, type Server } from 'node:http';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { diffSchemas } from '../src/core/schema-diff.js';
import { buildOpenApi, toOpenApiPath } from '../src/core/openapi.js';
import { ProjectService } from '../src/core/service.js';
import { extractModels, shutdownParser } from '../src/parser/index.js';
import { buildSchema } from '../src/schema/index.js';

afterAll(() => shutdownParser());

const V1 = `package demo
enum class State { NEW, DONE }
data class Item(val sku: String, val price: Double)
data class Order(
    val id: Long,
    val state: State,
    val note: String?,
    val items: List<Item>,
    val total: Double,
    val createdAt: Instant
)
`;

const V2 = `package demo
enum class State { NEW, CANCELLED }
data class Item(val sku: String, val price: String)
data class Order(
    val id: Long,
    val state: State,
    val note: String,
    val lines: List<Item>,
    val currency: String,
    val createdAt: Instant,
    val items: List<Item>? = null
)
`;

async function schemaOf(source: string, type = 'Order', settings = {}) {
  const extract = await extractModels([{ name: 'M.kt', content: source }]);
  return buildSchema(extract, type, settings).schema;
}

describe('schema diff', () => {
  it('finds nothing when the models are the same', async () => {
    expect(diffSchemas(await schemaOf(V1), await schemaOf(V1))).toEqual([]);
  });

  it('describes added, removed, retyped and tightened properties', async () => {
    const changes = diffSchemas(await schemaOf(V1), await schemaOf(V2));
    const byPath = (p: string) => changes.filter((c) => c.path === p);
    expect(byPath('$.total')[0]).toMatchObject({ kind: 'property-removed', breaking: true });
    expect(byPath('$.lines')[0]).toMatchObject({ kind: 'property-added', breaking: true });
    expect(byPath('$.currency')[0]).toMatchObject({ kind: 'property-added', breaking: true });
    expect(byPath('$.note').map((c) => c.kind)).toEqual(expect.arrayContaining(['nullable-changed', 'required-changed']));
    expect(byPath('$.note').every((c) => c.breaking)).toBe(true);
    expect(byPath('$.items[].price')[0]).toMatchObject({ kind: 'type-changed', breaking: true });
    const state = byPath('$.state');
    expect(state.map((c) => [c.breaking, c.message])).toEqual(
      expect.arrayContaining([[true, expect.stringContaining('"DONE"')], [false, expect.stringContaining('"CANCELLED"')]]),
    );
    expect(byPath('$.items').find((c) => c.kind === 'nullable-changed')).toMatchObject({ breaking: false });
  });

  it('notices changed naming and date settings', async () => {
    const snake = diffSchemas(await schemaOf(V1), await schemaOf(V1, 'Order', { naming: 'snake_case' }));
    expect(snake.map((c) => c.path)).toEqual(expect.arrayContaining(['$.createdAt', '$.created_at']));
    const epoch = diffSchemas(await schemaOf(V1), await schemaOf(V1, 'Order', { dateFormat: 'epoch-millis' }));
    expect(epoch.some((c) => c.path === '$.createdAt' && c.breaking)).toBe(true);
  });

  it('terminates on recursive types', async () => {
    const tree = 'data class Tree(val name: String, val kids: List<Tree>, val parent: Tree?)';
    const a = await schemaOf(tree, 'Tree');
    const b = await schemaOf(tree.replace('val name: String', 'val name: String, val depth: Int'), 'Tree');
    expect(diffSchemas(a, a)).toEqual([]);
    expect(diffSchemas(a, b).map((c) => c.path)).toContain('$.depth');
  });
});

describe('model drift in a project', () => {
  let dir: string;
  let service: ProjectService;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mockbrew-m5-'));
    await fs.mkdir(path.join(dir, 'app'));
    await fs.writeFile(path.join(dir, 'app/Order.kt'), V1);
    service = await ProjectService.init(path.join(dir, 'mocks'), 'Shop', { port: 38555, root: dir });
    const schema = await service.models.schema({ paths: ['app/Order.kt'] }, 'Order');
    await service.upsertScenario({
      collection: 'Orders',
      method: 'GET',
      path: '/orders/:id',
      scenarioName: 'Success',
      body: JSON.stringify({ id: 1, state: 'DONE', note: null, items: [{ sku: 'A', price: 1.5 }], total: 1.5, createdAt: '2024-01-01T00:00:00Z' }),
      model: { rootType: 'Order', settings: schema.settings, sources: schema.sources, schema: schema.schema },
    });
  });

  afterEach(async () => {
    await service.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('reports ok while the model is unchanged', async () => {
    const [check] = await service.checkModels();
    expect(check).toMatchObject({ status: 'ok', rootType: 'Order', changes: [], violations: [] });
  });

  it('reports changes and the bodies that no longer fit after the model was edited', async () => {
    await fs.writeFile(path.join(dir, 'app/Order.kt'), V2);
    const [check] = await service.checkModels();
    expect(check?.status).toBe('drift');
    expect(check?.changes.some((c) => c.path === '$.total' && c.breaking)).toBe(true);
    expect(check?.violations[0]?.scenario).toBe('Success');
    expect(check?.violations[0]?.errors.map((e) => e.message).join(' ')).toContain('lines');

    // accepting the change stores the new schema; the stale body is still reported
    await service.refreshModel(check?.endpointId as string);
    const [after] = await service.checkModels();
    expect(after?.changes).toEqual([]);
    expect(after?.status).toBe('drift');
    expect(after?.violations).toHaveLength(1);
  });

  it('cannot check pasted models or missing files', async () => {
    await fs.rm(path.join(dir, 'app/Order.kt'));
    const [missing] = await service.checkModels();
    expect(missing?.status).toBe('unavailable');
    const pasted = await service.models.schema({ files: [{ name: 'P.kt', content: 'data class P(val a: Int)' }] }, 'P');
    await service.upsertScenario({ collection: 'Misc', method: 'GET', path: '/p', body: '{"a":1}', model: { rootType: 'P', settings: pasted.settings, sources: [], schema: pasted.schema } });
    const checks = await service.checkModels();
    expect(checks.find((c) => c.rootType === 'P')).toMatchObject({ status: 'unavailable', reason: expect.stringContaining('pasted') });
  });

  it('fails the check command on drift and succeeds when nothing changed', async () => {
    const cli = path.resolve('dist/cli/main.js');
    const run = () => spawnSync(process.execPath, [cli, 'check', '-p', path.join(dir, 'mocks'), '--root', dir], { encoding: 'utf8' });
    const clean = run();
    expect(clean.status).toBe(0);
    expect(clean.stdout).toContain('1 ok, 0 drifted');
    await fs.writeFile(path.join(dir, 'app/Order.kt'), V2);
    const drifted = run();
    expect(drifted.status).toBe(1);
    expect(drifted.stdout).toContain('DRIFT');
    expect(drifted.stdout).toContain('$.total was removed');
  });
});

describe('OpenAPI export', () => {
  let dir: string;
  let service: ProjectService;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mockbrew-oas-'));
    await fs.mkdir(path.join(dir, 'app'));
    await fs.writeFile(path.join(dir, 'app/Order.kt'), V1);
    service = await ProjectService.init(path.join(dir, 'mocks'), 'Shop API', { port: 38556, root: dir });
  });

  afterEach(async () => {
    await service.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('converts path parameters', () => {
    expect(toOpenApiPath('/users/:id/orders/:orderId')).toBe('/users/{id}/orders/{orderId}');
  });

  it('turns endpoints, scenarios and models into a 3.1 document', async () => {
    const built = await service.models.schema({ paths: ['app/Order.kt'] }, 'List<Order>');
    const ok = JSON.stringify([{ id: 1, state: 'NEW', note: null, items: [], total: 2, createdAt: '2024-01-01T00:00:00Z' }]);
    await service.upsertScenario({
      collection: 'Orders', method: 'GET', path: '/orders', scenarioName: 'Success', body: ok,
      description: 'List orders', model: { rootType: 'List<Order>', settings: built.settings, sources: built.sources, schema: built.schema },
    });
    await service.upsertScenario({ collection: 'Orders', method: 'GET', path: '/orders', scenarioName: 'Server error', statusCode: 500, body: '{"error":"boom"}', makeActive: false });
    await service.upsertScenario({ collection: 'Orders', method: 'DELETE', path: '/orders/:id', scenarioName: 'Gone', statusCode: 204, body: '' });
    const off = await service.createCollection('Hidden');
    await service.createEndpoint(off, { method: 'GET', path: '/secret' });
    await service.setCollectionActive(off, false);

    const doc = buildOpenApi(service.model()) as any;
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info).toMatchObject({ title: 'Shop API', version: '1.0.0' });
    expect(Object.keys(doc.paths).sort()).toEqual(['/orders', '/orders/{id}']);
    const list = doc.paths['/orders'].get;
    expect(list).toMatchObject({ summary: 'List orders', tags: ['Orders'] });
    expect(Object.keys(list.responses)).toEqual(['200', '500']);
    expect(list.responses['200'].content['application/json'].schema).toEqual({ type: 'array', items: { $ref: '#/components/schemas/Order' } });
    expect(list.responses['200'].content['application/json'].examples.Success.value).toHaveLength(1);
    expect(list.responses['500'].content['application/json'].schema).toBeUndefined();
    expect(doc.components.schemas.Order.properties.items.items.$ref).toBe('#/components/schemas/Item');
    expect(JSON.stringify(doc)).not.toContain('$defs');
    expect(JSON.stringify(doc)).not.toContain('x-source');
    expect(doc.paths['/orders/{id}'].delete.parameters).toEqual([{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }]);
    expect(doc.paths['/orders/{id}'].delete.responses['204']).toEqual({ description: 'Gone' });
    const all = buildOpenApi(service.model(), { onlyActive: false }) as any;
    expect(Object.keys(all.paths)).toContain('/secret');
  });

  it('keeps different types that share a name apart', async () => {
    const a = await service.models.schema({ files: [{ name: 'A.kt', content: 'data class Box(val v: Int)' }] }, 'Box');
    const b = await service.models.schema({ files: [{ name: 'B.kt', content: 'data class Box(val v: String)' }] }, 'Box');
    await service.upsertScenario({ collection: 'X', method: 'GET', path: '/a', body: '{"v":1}', model: { rootType: 'Box', settings: a.settings, sources: [], schema: a.schema } });
    await service.upsertScenario({ collection: 'X', method: 'GET', path: '/b', body: '{"v":"s"}', model: { rootType: 'Box', settings: b.settings, sources: [], schema: b.schema } });
    const doc = buildOpenApi(service.model()) as any;
    expect(Object.keys(doc.components.schemas).sort()).toEqual(['Box', 'Box_2']);
    expect(doc.paths['/b'].get.responses['200'].content['application/json'].schema.$ref).toBe('#/components/schemas/Box_2');
  });

  it('is written by the export command', async () => {
    const cli = path.resolve('dist/cli/main.js');
    const out = path.join(dir, 'openapi.json');
    const run = spawnSync(process.execPath, [cli, 'export', 'openapi', '-p', path.join(dir, 'mocks'), '-o', out, '--title', 'Contract'], { encoding: 'utf8' });
    expect(run.status).toBe(0);
    expect(JSON.parse(await fs.readFile(out, 'utf8')).info.title).toBe('Contract');
  });
});

describe('proxy fallback', () => {
  let dir: string;
  let service: ProjectService;
  let upstream: Server;
  let upstreamPort: number;
  const seen: { url?: string; auth?: string }[] = [];

  async function freePort(): Promise<number> {
    return new Promise((resolve) => {
      const s = net.createServer();
      s.listen(0, '127.0.0.1', () => {
        const { port } = s.address() as net.AddressInfo;
        s.close(() => resolve(port));
      });
    });
  }

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mockbrew-proxy-'));
    seen.length = 0;
    upstream = createServer((req, res) => {
      seen.push({ url: req.url, auth: req.headers.authorization });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ from: 'backend', path: req.url }));
    });
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    upstreamPort = (upstream.address() as net.AddressInfo).port;
    service = await ProjectService.init(dir, 'Proxy', { port: await freePort() });
    const c = await service.createCollection('Mocked');
    await service.createEndpoint(c, { method: 'GET', path: '/mocked', scenarios: [{ body: '{"from":"mock"}' }] });
  });

  afterEach(async () => {
    await service.close();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('is off by default and forwards only unmatched requests when switched on', async () => {
    expect(service.model().settings.proxy).toEqual({ enabled: false, host: '' });
    await service.start();
    const base = service.runtime.status().url;
    expect((await fetch(`${base}/other`)).status).toBe(404);

    await service.updateSettings({ proxy: { enabled: true, host: `http://127.0.0.1:${upstreamPort}` } });
    expect(await (await fetch(`${base}/mocked`)).json()).toEqual({ from: 'mock' });
    expect(await (await fetch(`${base}/other?x=1`, { headers: { Authorization: 'Bearer real' } })).json()).toEqual({ from: 'backend', path: '/other?x=1' });
    expect(seen).toEqual([{ url: '/other?x=1', auth: 'Bearer real' }]);
    const logs = service.runtime.logs();
    expect(logs.find((l) => l.path === '/other' && l.query === 'x=1')).toMatchObject({ proxied: true, matched: false });
    expect(logs.find((l) => l.path === '/mocked')).toMatchObject({ proxied: false, matched: true });

    await service.updateSettings({ proxy: { enabled: false } });
    expect((await fetch(`${base}/other`)).status).toBe(404);
  });

  it('rejects unsafe backend addresses', async () => {
    const { port } = service.model().settings;
    await expect(service.updateSettings({ proxy: { enabled: true, host: '' } })).rejects.toMatchObject({ code: 'INVALID' });
    await expect(service.updateSettings({ proxy: { enabled: true, host: 'ftp://example.com' } })).rejects.toMatchObject({ code: 'INVALID' });
    await expect(service.updateSettings({ proxy: { enabled: true, host: 'https://user:pass@example.com' } })).rejects.toMatchObject({ code: 'INVALID' });
    await expect(service.updateSettings({ proxy: { enabled: true, host: `http://localhost:${port}` } })).rejects.toMatchObject({ message: expect.stringContaining('itself') });
    expect(service.model().settings.proxy.enabled).toBe(false);
  });
});
