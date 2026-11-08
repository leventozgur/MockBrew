import { promises as fs } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectService } from '../src/core/service.js';
import { buildRuntimeEnvironment } from '../src/runtime/environment.js';
import { ProjectDocument } from '../src/store/document.js';

let dir: string;
let service: ProjectService;

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

/** A project whose Mockoon file (as if pulled from git) uses features that run helper code. */
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mockbrew-safe-'));
  service = await ProjectService.init(dir, 'Safe', { port: await freePort() });
  const c = await service.createCollection('Shared');
  await service.createEndpoint(c, { method: 'GET', path: '/templated', scenarios: [{ body: '{"v":"plain"}' }] });
  await service.createEndpoint(c, { method: 'GET', path: '/bucket', scenarios: [{ body: '{"v":"plain"}' }] });
  await service.close();

  const envPath = path.join(dir, 'safe.environment.json');
  const env = JSON.parse(await fs.readFile(envPath, 'utf8'));
  const templated = env.routes[0].responses[0];
  templated.body = '{"method":"{{method}}","name":"{{faker \'person.firstName\'}}"}';
  templated.disableTemplating = false;
  templated.headers.push({ key: 'X-Evil', value: "{{faker 'helpers.fake' '{{person.firstName}}'}}" });
  templated.callbacks = [{ uuid: '00000000-0000-4000-8000-000000000001', latency: 0 }];
  templated.rules = [{ target: 'templating', modifier: '{{method}}', value: 'GET', invert: false, operator: 'equals' }];
  env.data = [{ uuid: '00000000-0000-4000-8000-000000000002', id: 'abc123', name: 'bucket', documentation: '', value: "{{faker 'person.firstName'}}" }];
  env.callbacks = [{ uuid: '00000000-0000-4000-8000-000000000001', id: 'cb1', name: 'cb', documentation: '', method: 'get', uri: 'http://127.0.0.1:1/', headers: [], bodyType: 'INLINE', body: '', filePath: '', sendFileAsBody: false, databucketID: '' }];
  const bucketResponse = env.routes[1].responses[0];
  bucketResponse.bodyType = 'DATABUCKET';
  bucketResponse.databucketID = 'abc123';
  await fs.writeFile(envPath, JSON.stringify(env, null, 2));
  service = await ProjectService.open(dir);
});

afterEach(async () => {
  await service.close();
  await fs.rm(dir, { recursive: true, force: true });
});

describe('safe mode (default)', () => {
  it('serves template syntax as written and does not run helpers, buckets or callbacks', async () => {
    expect(service.model().settings.allowTemplating).toBe(false);
    await service.start();
    const base = service.runtime.status().url;
    const res = await fetch(`${base}/templated`);
    expect(await res.text()).toBe('{"method":"{{method}}","name":"{{faker \'person.firstName\'}}"}');
    expect(res.headers.get('x-evil')).toBe("{{faker 'helpers.fake' '{{person.firstName}}'}}");

    const bucket = await fetch(`${base}/bucket`);
    expect(bucket.status).toBe(501);
    expect(await bucket.json()).toMatchObject({ error: 'templating_disabled' });
  });

  it('reports what was switched off and leaves the file untouched', async () => {
    const notes = service.view().safeModeNotes.join(' | ');
    expect(notes).toContain('templating is off in 1 response');
    expect(notes).toContain('1 data bucket');
    expect(notes).toContain('1 callback');
    expect(notes).toContain('header value');
    expect(notes).toContain('response rule');
    expect(notes).toContain('answer 501');
    const env = JSON.parse(await fs.readFile(path.join(dir, 'safe.environment.json'), 'utf8'));
    expect(env.routes[0].responses[0].disableTemplating).toBe(false);
    expect(env.data).toHaveLength(1);
  });

  it('removes callbacks and data from the runtime environment', async () => {
    const document = ProjectDocument.fromParts(JSON.parse(await fs.readFile(path.join(dir, 'safe.environment.json'), 'utf8')), undefined, 'safe.environment.json');
    const { environment } = buildRuntimeEnvironment(document);
    expect(environment.data).toEqual([]);
    expect(environment.callbacks).toEqual([]);
    // the tool's own catch-all 404 routes are the only ones that keep templating
    const served = environment.routes.filter((r) => r.endpoint !== '{*splat}').flatMap((r) => r.responses);
    expect(served.length).toBeGreaterThan(0);
    expect(served.every((r) => r.disableTemplating && r.callbacks.length === 0)).toBe(true);
  });

  it('runs templating only after the project explicitly allows it', async () => {
    await service.updateSettings({ allowTemplating: true });
    expect(service.view().safeModeNotes).toEqual([]);
    await service.start();
    const base = service.runtime.status().url;
    const body = await (await fetch(`${base}/templated`)).json();
    expect(body.method).toBe('GET');
    expect(body.name).not.toContain('{{');
  });
});
