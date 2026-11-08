import { promises as fs } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectService } from '../src/core/service.js';
import { REQUEST_ID_HEADER, RESPONSE_HEADER } from '../src/runtime/environment.js';
import { DynamicLayer } from '../src/runtime/dynamic.js';
import { FrontServer } from '../src/runtime/front.js';
import { MultipartInspector } from '../src/runtime/multipart.js';

let dir: string;
const open: ProjectService[] = [];
const closers: (() => Promise<void>)[] = [];

const freePort = () => new Promise<number>((resolve, reject) => {
  const server = net.createServer();
  server.listen(0, '127.0.0.1', () => { const { port } = server.address() as net.AddressInfo; server.close(() => resolve(port)); });
  server.on('error', reject);
});

async function project(): Promise<{ service: ProjectService; base: () => string; collection: string }> {
  const service = await ProjectService.init(dir, 'Dyn', { port: await freePort() });
  open.push(service);
  const collection = await service.createCollection('Main');
  return { service, collection, base: () => service.runtime.status().url as string };
}

async function dynamicScenario(service: ProjectService, collection: string, method: 'GET' | 'POST', route: string, body: string, extra: { headers?: { key: string; value: string }[]; statusCode?: number } = {}) {
  const endpointId = await service.createEndpoint(collection, { method, path: route, scenarios: [{ name: 'Main', body: '{}', ...extra }] });
  const scenarioId = service.findEndpoint(endpointId).scenarios[0]!.id;
  await service.setScenarioDynamic(endpointId, scenarioId, true);
  await service.updateScenario(endpointId, scenarioId, { body });
  return { endpointId, scenarioId };
}

beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mockbrew-dyn-')); });
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  for (const s of open.splice(0)) await s.close();
  await fs.rm(dir, { recursive: true, force: true });
});

describe('dynamic values', () => {
  it('serves tokens literally until a scenario is made dynamic', async () => {
    const { service, collection, base } = await project();
    const endpointId = await service.createEndpoint(collection, { method: 'GET', path: '/plain', scenarios: [{ body: '{"id":"{{uuid}}","q":"{{request.query.x}}"}' }] });
    await service.start();
    const res = await fetch(`${base()}/plain?x=1`);
    expect(await res.text()).toBe('{"id":"{{uuid}}","q":"{{request.query.x}}"}');
    expect(res.headers.has(RESPONSE_HEADER)).toBe(false);
    expect(service.findEndpoint(endpointId).scenarios[0]!.dynamic).toBeUndefined();
  });

  it('fills every allowlisted token, escaping values inside JSON strings', async () => {
    const { service, collection, base } = await project();
    await service.setVariables({ site: 'example.test' });
    await dynamicScenario(service, collection, 'POST', '/users/:id', JSON.stringify({
      id: '{{uuid}}', again: '{{uuid}}', now: '{{now}}', epoch: '{{now:epoch}}', millis: '{{now:epochMillis}}',
      param: '{{request.params.id}}', query: '{{request.query.q}}', header: '{{request.header.x-trace}}',
      name: '{{request.body.$.name}}', nested: '{{request.body.$.items[1].v}}', site: '{{vars.site}}', missing: '{{request.query.nope}}',
    }).replace('"epoch":"{{now:epoch}}"', '"epoch":"{{now:epoch}}"'), { headers: [{ key: 'X-Echo', value: 'id-{{request.params.id}}-{{vars.site}}' }] });
    await service.start();
    const quote = 'a"b\\c';
    const res = await fetch(`${base()}/users/42?q=${encodeURIComponent(quote)}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Trace': 'abc' }, body: JSON.stringify({ name: 'Ada "Q"\n', items: [{ v: 1 }, { v: 'two' }] }) });
    const text = await res.text();
    const body = JSON.parse(text);
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.again).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.again).not.toBe(body.id);
    expect(new Date(body.now).toISOString()).toBe(body.now);
    expect(Number(body.epoch)).toBeGreaterThan(1_700_000_000);
    expect(Number(body.millis)).toBeGreaterThan(1_700_000_000_000);
    expect(body).toMatchObject({ param: '42', query: quote, header: 'abc', name: 'Ada "Q"\n', nested: 'two', site: 'example.test', missing: '' });
    expect(res.headers.get('x-echo')).toBe('id-42-example.test');
    expect(Number(res.headers.get('content-length'))).toBe(Buffer.byteLength(text));
    expect(res.headers.has(RESPONSE_HEADER)).toBe(false);
  });

  it('inserts whole JSON values with the json form and null for missing ones', async () => {
    const { service, collection, base } = await project();
    await dynamicScenario(service, collection, 'POST', '/echo', '{"item": {{json request.body.$.item}}, "list": {{json request.body.$.list}}, "gone": {{json request.body.$.gone}}, "str": "{{json request.body.$.item}}"}');
    await service.start();
    const res = await fetch(`${base()}/echo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ item: { a: [1, 'x"y'] }, list: [true, null] }) });
    const text = await res.text();
    expect(text).toBe('{"item": {"a":[1,"x\\"y"]}, "list": [true,null], "gone": null, "str": "{{json request.body.$.item}}"}');
    // A request with an unparsable body still gets an answer; the missing values are empty.
    const bad = await fetch(`${base()}/echo`, { method: 'POST', body: 'not json' });
    expect(await bad.text()).toBe('{"item": null, "list": null, "gone": null, "str": "{{json request.body.$.item}}"}');
  });

  it('never runs engine templating, helpers or unknown tokens in dynamic bodies', async () => {
    const { service, collection, base } = await project();
    const text = JSON.stringify({
      faker: "{{faker 'person.firstName'}}", each: '{{#each items}}x{{/each}}', lookup: "{{lookup request.query 'x'}}", raw: '{{{request.query.x}}}',
      set: "{{setVar 'a' 'b'}}", oops: '{{request.query}}', ok: '{{request.query.x}}',
    });
    await dynamicScenario(service, collection, 'GET', '/hostile', text, { headers: [{ key: 'X-Faker', value: "{{faker 'person.firstName'}}" }] });
    await service.start();
    const res = await fetch(`${base()}/hostile?x=1`);
    expect(await res.json()).toEqual({
      faker: "{{faker 'person.firstName'}}", each: '{{#each items}}x{{/each}}', lookup: "{{lookup request.query 'x'}}", raw: '{{{request.query.x}}}',
      set: "{{setVar 'a' 'b'}}", oops: '{{request.query}}', ok: '1',
    });
    expect(res.headers.get('x-faker')).toBe("{{faker 'person.firstName'}}");
    const reports = service.validateTokens();
    expect(reports).toHaveLength(1);
    expect(reports[0]!.unknownTokens).toEqual(expect.arrayContaining(["{{faker 'person.firstName'}}", '{{#each items}}', '{{{request.query.x}}}', "{{setVar 'a' 'b'}}"]));
    expect(reports[0]!.unknownTokens).not.toContain('{{request.query.x}}');
    const log = service.runtime.logs().at(-1)!;
    expect(log.dynamic?.unknownTokens).toContain("{{faker 'person.firstName'}}");
  });

  it('also fills forced X-Mock-Scenario answers and keeps preflight and the catch-all intact', async () => {
    const { service, collection, base } = await project();
    const { endpointId } = await dynamicScenario(service, collection, 'GET', '/forced/:id', '{"id":"{{request.params.id}}"}');
    await service.createScenario(endpointId, { name: 'Other', body: '{"other":"{{request.params.id}}"}' });
    await service.start();
    expect(await (await fetch(`${base()}/forced/7`)).json()).toEqual({ id: '7' });
    const other = await fetch(`${base()}/forced/7`, { headers: { 'X-Mock-Scenario': 'Other' } });
    expect(await other.json()).toEqual({ other: '{{request.params.id}}' });
    const forced = await fetch(`${base()}/forced/8`, { headers: { 'X-Mock-Scenario': 'Main' } });
    expect(await forced.json()).toEqual({ id: '8' });
    const preflight = await fetch(`${base()}/forced/7`, { method: 'OPTIONS', headers: { Origin: 'http://x.test', 'Access-Control-Request-Method': 'GET' } });
    expect(preflight.status).toBeLessThan(300);
    expect(preflight.headers.has(RESPONSE_HEADER)).toBe(false);
    const missing = await fetch(`${base()}/nothing`);
    expect(missing.status).toBe(404);
    expect((await missing.json()).error).toBe('no_mock_matched');
    expect(missing.headers.has(RESPONSE_HEADER)).toBe(false);
  });

  it('serves a response above the buffer cap unchanged (with a warning)', async () => {
    const { service, collection } = await project();
    const { endpointId, scenarioId } = await dynamicScenario(service, collection, 'GET', '/big', '{}');
    // Bodies saved by this tool stay below the cap; an edited or imported file can exceed it.
    await service.close();
    const file = path.join(dir, 'dyn.environment.json');
    const environment = JSON.parse(await fs.readFile(file, 'utf8'));
    environment.routes.find((r: { uuid: string }) => r.uuid === endpointId).responses.find((r: { uuid: string }) => r.uuid === scenarioId).body = JSON.stringify({ pad: 'x'.repeat(5.3 * 1024 * 1024), t: '{{uuid}}' });
    await fs.writeFile(file, JSON.stringify(environment));
    const reopened = await ProjectService.open(dir);
    open.push(reopened);
    const warnings: string[] = [];
    reopened.runtime.on('warning', (w: { message: string }) => warnings.push(w.message));
    await reopened.start();
    const text = await (await fetch(`${reopened.runtime.status().url}/big`)).text();
    expect(text.endsWith('"t":"{{uuid}}"}')).toBe(true);
    expect(warnings.join()).toContain('larger than 5 MB');
    expect(reopened.view().runtimeNotice).toContain('larger than 5 MB');
    expect(reopened.runtime.status().notes?.join()).toContain('larger than 5 MB');
    await (await fetch(`${reopened.runtime.status().url}/big`)).arrayBuffer();
    expect(warnings).toHaveLength(1);
  });

  it('ignores a forged private header from a backend or client', async () => {
    const { service, collection, base } = await project();
    await service.createEndpoint(collection, { method: 'GET', path: '/plain', scenarios: [{ body: '{"v":"{{uuid}}"}' }] });
    await service.start();
    const res = await fetch(`${base()}/plain`, { headers: { [RESPONSE_HEADER]: 'a:b', [REQUEST_ID_HEADER]: '1' } });
    expect(await res.text()).toBe('{"v":"{{uuid}}"}');
  });
});

describe('request model validation', () => {
  const schema = { type: 'object', required: ['name'], properties: { name: { type: 'string' }, age: { type: 'integer' } } };
  const link = { rootType: 'NewUser', settings: { naming: 'identity', dateFormat: 'iso8601' } as never, sources: [], schema };

  it('answers valid bodies normally and invalid ones with the generated 422 scenario', async () => {
    const { service, collection, base } = await project();
    const endpointId = await service.createEndpoint(collection, { method: 'POST', path: '/users', scenarios: [{ name: 'Created', statusCode: 201, body: '{"ok":true}' }] });
    await service.setRequestModel(endpointId, link);
    const endpoint = service.findEndpoint(endpointId);
    expect(endpoint.requestModel?.rootType).toBe('NewUser');
    const invalidScenario = endpoint.scenarios.find((s) => s.id === endpoint.invalidRequestScenarioId)!;
    expect(invalidScenario).toMatchObject({ name: 'Invalid request (422)', statusCode: 422, dynamic: true, active: false });
    await service.start();
    const post = (body: string) => fetch(`${base()}/users`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://web.test' }, body });
    const ok = await post('{"name":"Ada"}');
    expect(ok.status).toBe(201);
    expect(await ok.json()).toEqual({ ok: true });
    const bad = await post('{"age":"x"}');
    expect(bad.status).toBe(422);
    expect(bad.headers.get('access-control-allow-origin')).toBe('*');
    expect(bad.headers.get('content-type')).toContain('application/json');
    const errors = (await bad.json()).errors as { path: string; message: string }[];
    expect(errors.map((e) => `${e.path} ${e.message}`)).toEqual(expect.arrayContaining(['$ missing required property "name"', '$.age must be integer']));
    const broken = await post('{nope');
    expect(broken.status).toBe(422);
    expect((await broken.json()).errors[0].keyword).toBe('json');
    expect((await post('')).status).toBe(422);
    const logs = service.runtime.logs();
    expect(logs).toHaveLength(4);
    expect(logs[0]!.requestValidation).toEqual({ model: 'NewUser', valid: true });
    expect(logs[1]).toMatchObject({ status: 422, scenario: 'Invalid request (422)', matched: true, requestValidation: { model: 'NewUser', valid: false } });
    expect(logs[1]!.requestValidation!.errors!.length).toBeGreaterThan(0);
    expect(logs.some((l) => l.requestHeaders.some((h) => h.key === REQUEST_ID_HEADER))).toBe(false);
  });

  it('uses a chosen invalid-request scenario, supports unlinking and keeps the response model', async () => {
    const { service, collection, base } = await project();
    const endpointId = await service.createEndpoint(collection, { method: 'PUT', path: '/users/:id', scenarios: [{ name: 'Ok', body: '{"ok":1}' }, { name: 'Bad', statusCode: 400, body: '{"bad":"{{request.params.id}}"}' }] });
    const bad = service.findEndpoint(endpointId).scenarios[1]!;
    await service.setScenarioDynamic(endpointId, bad.id, true);
    await service.setRequestModel(endpointId, link, bad.id);
    expect(service.findEndpoint(endpointId).scenarios).toHaveLength(2);
    await expect(service.setRequestModel(endpointId, link, 'missing')).rejects.toThrow();
    await service.start();
    const res = await fetch(`${base()}/users/9`, { method: 'PUT', body: '{}' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ bad: '9' });
    await service.setRequestModel(endpointId, null);
    expect(service.findEndpoint(endpointId).requestModel).toBeUndefined();
    expect((await fetch(`${base()}/users/9`, { method: 'PUT', body: '{}' })).status).toBe(200);
    const get = await service.createEndpoint(collection, { method: 'GET', path: '/g' });
    await expect(service.setRequestModel(get, link)).rejects.toThrow();
  });
});

describe('file responses', () => {
  async function fileScenario(service: ProjectService, collection: string, route: string) {
    const endpointId = await service.createEndpoint(collection, { method: 'GET', path: route, scenarios: [{ name: 'File', body: '{}' }] });
    return { endpointId, scenarioId: service.findEndpoint(endpointId).scenarios[0]!.id };
  }

  it('streams a project file with a content type from its extension', async () => {
    const { service, collection, base } = await project();
    const data = Buffer.alloc(3 * 1024 * 1024 + 17, 7);
    await fs.mkdir(path.join(dir, 'assets'));
    await fs.writeFile(path.join(dir, 'assets', 'logo.png'), data);
    await fs.writeFile(path.join(dir, 'assets', 'doc.pdf'), '%PDF-1.4');
    const { endpointId, scenarioId } = await fileScenario(service, collection, '/logo');
    await service.setScenarioFile(endpointId, scenarioId, 'assets/logo.png');
    expect(service.findEndpoint(endpointId).scenarios[0]!.bodyFile).toBe('assets/logo.png');
    const pdf = await fileScenario(service, collection, '/doc');
    await service.setScenarioFile(pdf.endpointId, pdf.scenarioId, './assets/doc.pdf');
    await service.start();
    const res = await fetch(`${base()}/logo`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('content-length')).toBe(String(data.length));
    expect(res.headers.has(RESPONSE_HEADER)).toBe(false);
    expect(Buffer.from(await res.arrayBuffer()).equals(data)).toBe(true);
    const doc = await fetch(`${base()}/doc`);
    expect(doc.headers.get('content-type')).toBe('application/pdf');
    expect(await doc.text()).toBe('%PDF-1.4');
    await service.setScenarioFile(endpointId, scenarioId, null);
    expect(service.findEndpoint(endpointId).scenarios[0]!.bodyFile).toBeUndefined();
    expect((await (await fetch(`${base()}/logo`)).text())).toBe('{}');
  });

  it('rejects escapes, absolute paths, symbolic links, directories and large files', async () => {
    const { service, collection, base } = await project();
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'mockbrew-outside-'));
    closers.push(() => fs.rm(outside, { recursive: true, force: true }));
    await fs.writeFile(path.join(outside, 'secret.txt'), 'top secret');
    await fs.writeFile(path.join(dir, 'ok.txt'), 'fine');
    await fs.mkdir(path.join(dir, 'folder'));
    await fs.symlink(path.join(outside, 'secret.txt'), path.join(dir, 'link.txt'));
    await fs.symlink(outside, path.join(dir, 'linked-dir'));
    await fs.writeFile(path.join(dir, 'huge.bin'), '');
    await fs.truncate(path.join(dir, 'huge.bin'), 51 * 1024 * 1024);
    const { endpointId, scenarioId } = await fileScenario(service, collection, '/f');
    for (const bad of ['../x', `../${path.basename(outside)}/secret.txt`, path.join(outside, 'secret.txt'), 'link.txt', 'linked-dir/secret.txt', 'folder', 'huge.bin', 'missing.txt', '', 'a\0b']) {
      await expect(service.setScenarioFile(endpointId, scenarioId, bad), bad).rejects.toThrow();
    }
    expect(service.findEndpoint(endpointId).scenarios[0]!.bodyFile).toBeUndefined();
    // A file that becomes a symbolic link after it was accepted is refused at request time.
    await service.setScenarioFile(endpointId, scenarioId, 'ok.txt');
    await service.start();
    expect(await (await fetch(`${base()}/f`)).text()).toBe('fine');
    await fs.rm(path.join(dir, 'ok.txt'));
    await fs.symlink(path.join(outside, 'secret.txt'), path.join(dir, 'ok.txt'));
    const res = await fetch(`${base()}/f`);
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('top secret');
  });

  it('never lets the engine read files for imported file bodies', async () => {
    const { service, collection } = await project();
    const endpointId = await service.createEndpoint(collection, { method: 'GET', path: '/hosts', scenarios: [{ body: '{}' }] });
    const file = path.join(dir, 'dyn.environment.json');
    await service.close();
    const environment = JSON.parse(await fs.readFile(file, 'utf8'));
    const response = environment.routes.find((r: { uuid: string }) => r.uuid === endpointId).responses[0];
    response.bodyType = 'FILE';
    response.filePath = '/etc/hosts';
    await fs.writeFile(file, JSON.stringify(environment));
    const reopened = await ProjectService.open(dir);
    open.push(reopened);
    await reopened.start();
    const res = await fetch(`${reopened.runtime.status().url}/hosts`);
    expect(res.status).toBe(501);
    expect(await res.text()).not.toContain('localhost');
    expect(reopened.view().safeModeNotes.join()).toContain('engine file bodies');
  });
});

describe('multipart uploads', () => {
  const boundary = 'XyZ-boundary';
  const payload = Buffer.concat([
    Buffer.from(`preamble\r\n--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\nSECRET-VALUE\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="cat \\"1\\".png"\r\nContent-Type: image/png\r\n\r\n`),
    Buffer.alloc(5000, 0x41), Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="empty"\r\n\r\n\r\n--${boundary}--\r\n`),
  ]);

  it('reads only part metadata, whatever the chunk boundaries are', () => {
    for (const size of [1, 3, 7, 64, payload.length]) {
      const inspector = new MultipartInspector(boundary);
      for (let i = 0; i < payload.length; i += size) inspector.write(payload.subarray(i, i + size));
      const summary = inspector.end();
      expect(summary.parts).toEqual([
        { name: 'title', size: 12 },
        { name: 'photo', fileName: 'cat "1".png', contentType: 'image/png', size: 5000 },
        { name: 'empty', size: 0 },
      ]);
      expect(JSON.stringify(summary)).not.toContain('SECRET-VALUE');
    }
    const capped = new MultipartInspector(boundary, 100);
    capped.write(payload);
    expect(capped.end().truncated).toBe(true);
  });

  it('logs metadata without content and still delivers the original stream to the engine', async () => {
    const { service, collection, base } = await project();
    await service.createEndpoint(collection, { method: 'POST', path: '/upload', scenarios: [{ statusCode: 201, body: '{"stored":true}' }] });
    await service.start();
    const res = await fetch(`${base()}/upload?token=abc`, { method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, [REQUEST_ID_HEADER]: '99' }, body: payload });
    expect(res.status).toBe(201);
    const entry = service.runtime.logs().at(-1)!;
    expect(entry.multipart).toEqual({ totalBytes: payload.length, parts: [
      { name: 'title', size: 12 }, { name: 'photo', fileName: 'cat "1".png', contentType: 'image/png', size: 5000 }, { name: 'empty', size: 0 },
    ] });
    expect(JSON.stringify(entry)).not.toContain('SECRET-VALUE');
    expect(entry.requestHeaders.some((h) => h.key === REQUEST_ID_HEADER)).toBe(false);
    // An unmatched multipart request is logged too.
    await fetch(`${base()}/elsewhere`, { method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` }, body: payload });
    expect(service.runtime.logs().at(-1)!.multipart?.parts).toHaveLength(3);
  });

  it('forwards the exact bytes, adds the request id only for the engine and strips forged ones', async () => {
    const seen: { body: Buffer; id: string | string[] | undefined }[] = [];
    const backend = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => { seen.push({ body: Buffer.concat(chunks), id: req.headers[REQUEST_ID_HEADER] }); res.end('ok'); });
    });
    await new Promise<void>((resolve) => backend.listen(0, '127.0.0.1', resolve));
    closers.push(() => new Promise((resolve) => { backend.closeAllConnections(); backend.close(() => resolve()); }));
    const enginePort = (backend.address() as net.AddressInfo).port;
    const port = await freePort();
    const entry = { uuid: 'r1', method: 'post', pattern: '/upload' };
    const layer = new DynamicLayer({
      current: () => ({ routes: [entry], routeMeta: new Map(), environment: { proxyMode: false }, scenarioMeta: new Map(), globalHeaders: [], variables: {}, responseKey: '' }) as never,
      projectDir: dir, root: () => dir, recordDirect: () => undefined, warn: () => undefined,
    });
    const front = new FrontServer({ host: '127.0.0.1', port, enginePort, hooks: layer.hooks, privateRequestHeader: REQUEST_ID_HEADER, privateResponseHeader: RESPONSE_HEADER });
    await front.listen();
    closers.push(() => front.close());
    const post = (headers: Record<string, string>) => fetch(`http://127.0.0.1:${port}/upload`, { method: 'POST', headers, body: payload });
    expect((await post({ 'Content-Type': `multipart/form-data; boundary=${boundary}`, [REQUEST_ID_HEADER]: '5' })).status).toBe(200);
    expect(seen[0]!.body.equals(payload)).toBe(true);
    expect(seen[0]!.id).toMatch(/^\d+$/);
    expect(seen[0]!.id).not.toBe('5');
    await post({ 'Content-Type': 'application/octet-stream', [REQUEST_ID_HEADER]: '5' });
    expect(seen[1]!.id).toBeUndefined();
  });
});


describe('front response follow-ups', () => {
  it('returns GET headers for HEAD and logs substituted and file bodies', async () => {
    const { service, collection, base } = await project();
    await service.updateSettings({ logBodies: true });
    await dynamicScenario(service, collection, 'GET', '/hello', '{"value":"{{request.query.x}}"}');
    await fs.writeFile(path.join(dir, 'hello.txt'), 'file content');
    const id = await service.createEndpoint(collection, { method: 'GET', path: '/file', scenarios: [{ body: '{}' }] });
    await service.setScenarioFile(id, service.findEndpoint(id).scenarios[0]!.id, 'hello.txt');
    await service.start();
    for (const route of ['/hello?x=hello', '/file']) {
      const get = await fetch(base() + route); const body = await get.text();
      const head = await fetch(base() + route, { method: 'HEAD' });
      expect(head.headers.get('content-type')).toBe(get.headers.get('content-type'));
      expect(head.headers.get('content-length')).toBe(String(Buffer.byteLength(body)));
      expect(await head.text()).toBe('');
    }
    expect(service.runtime.logs().filter((entry) => entry.path === '/hello').map((entry) => entry.responseBody)).toEqual(['{"value":"hello"}', '{"value":"hello"}']);
    expect(service.runtime.logs().filter((entry) => entry.path === '/file').map((entry) => entry.responseBody)).toEqual(['[file hello.txt, 12 bytes]', '[file hello.txt, 12 bytes]']);
  });

  it.each(['text/html', 'application/xml', 'text/xml', 'text/plain'])('escapes inserted values for %s', async (contentType) => {
    const { service, collection, base } = await project();
    await dynamicScenario(service, collection, 'GET', '/text', 'value={{request.query.x}}', { headers: [{ key: 'Content-Type', value: contentType }] });
    await service.start();
    const value = `<a x="b">&'`;
    const response = await fetch(`${base()}/text?x=${encodeURIComponent(value)}`);
    expect(await response.text()).toBe(contentType === 'text/plain' ? `value=${value}` : 'value=&lt;a x=&quot;b&quot;&gt;&amp;&apos;');
  });
});

it('processes chunked dynamic and file engine responses without a content length', async () => {
  await fs.writeFile(path.join(dir, 'chunk.txt'), 'file bytes');
  const route = { uuid: 'route', method: 'get', pattern: '/:kind' };
  const backend = http.createServer((req, res) => {
    const id = req.url?.startsWith('/file') ? 'file' : 'dynamic';
    res.writeHead(200, { 'Content-Type': 'text/plain', [RESPONSE_HEADER]: `route:${id}` });
    res.write('hello '); res.end('{{request.query.x}}');
  });
  await new Promise<void>((resolve) => backend.listen(0, '127.0.0.1', resolve));
  closers.push(() => new Promise((resolve) => { backend.closeAllConnections(); backend.close(() => resolve()); }));
  const port = await freePort();
  const layer = new DynamicLayer({
    current: () => ({ routes: [route], routeMeta: new Map([['route', { hasDynamic: true }]]), environment: { proxyMode: false }, scenarioMeta: new Map([
      ['dynamic', { routeId: 'route', name: 'Dynamic', dynamic: true }],
      ['file', { routeId: 'route', name: 'File', bodyFile: 'chunk.txt' }],
    ]), globalHeaders: [], variables: {}, responseKey: '' }) as never,
    projectDir: dir, root: () => dir, recordDirect: () => undefined, warn: () => undefined,
  });
  const front = new FrontServer({ host: '127.0.0.1', port, enginePort: (backend.address() as net.AddressInfo).port, hooks: layer.hooks, privateResponseHeader: RESPONSE_HEADER });
  await front.listen(); closers.push(() => front.close());
  expect(await (await fetch(`http://127.0.0.1:${port}/dynamic?x=there`)).text()).toBe('hello there');
  const file = await fetch(`http://127.0.0.1:${port}/file`);
  expect(await file.text()).toBe('file bytes');
  expect(file.headers.get('content-length')).toBe('10');
});
