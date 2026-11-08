import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer, type Server } from 'node:http';
import net from 'node:net';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { ProjectService } from '../src/core/service.js';
import { startControlApi, type ControlApi } from '../src/control-api/server.js';
import { createMcpServer } from '../src/mcp/server.js';

let dir: string;
let service: ProjectService;
let backend: Server;
let api: ControlApi | undefined;
let client: Client | undefined;
async function port() { return new Promise<number>((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)); }); }); }
afterEach(async () => { await client?.close(); client = undefined; await api?.close(); api = undefined; await service?.close(); if (backend?.listening) await new Promise<void>((resolve) => backend.close(() => resolve())); if (dir) await fs.rm(dir, { recursive: true, force: true }); });

it('captures proxy responses and saves reviewed scenarios through control API and MCP', async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mockbrew-record-'));
  backend = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Set-Cookie', 'session=secret');
    res.setHeader('Authorization', 'secret');
    res.setHeader('Connection', 'x-hop');
    res.setHeader('X-Hop', 'remove');
    res.end(req.url?.startsWith('/big') ? JSON.stringify({ value: 'x'.repeat(1_000_100) }) : JSON.stringify({ token: 'synthetic', ok: true }));
  });
  await new Promise<void>((resolve) => backend.listen(0, '127.0.0.1', resolve));
  service = await ProjectService.init(dir, 'Synthetic', { port: await port() });
  await service.updateSettings({ proxy: { enabled: true, host: `http://127.0.0.1:${(backend.address() as net.AddressInfo).port}` } });
  await service.start();
  api = await startControlApi({ service });
  const request = (url: string, data?: unknown, auth = true) => fetch(`${api!.url}${url}`, { method: data === undefined ? 'GET' : 'POST', headers: { ...(auth ? { Authorization: `Bearer ${api!.token}` } : {}), 'Content-Type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  expect((await request('/api/recordings', undefined, false)).status).toBe(401);
  expect((await fetch(`${api.url}/api/recordings`, { headers: { Authorization: `Bearer ${api.token}`, Origin: 'http://evil.example' } })).status).toBe(403);
  expect((await request('/api/recording/start', {})).status).toBe(200);
  const base = service.runtime.status().url;
  await (await fetch(`${base}/users/123?x=1`)).text();
  await (await fetch(`${base}/users/456`)).text();
  await (await fetch(`${base}/big`)).text();
  const list = await (await request('/api/recordings')).json() as any;
  expect(list.recordings).toHaveLength(3);
  expect(list.recordings[0]).toMatchObject({ path: '/users/123', query: 'x=1', truncated: false });
  expect(list.recordings[0].warnings.join()).toMatch(/sensitive/i);
  expect(list.recordings[0].headers.map((h: any) => h.key.toLowerCase())).not.toEqual(expect.arrayContaining(['set-cookie', 'authorization', 'connection', 'x-hop']));
  expect(list.recordings[2].truncated).toBe(true);
  expect((await request('/api/recordings/preview', { ids: [list.recordings[2].id], collection: 'Captured' })).status).toBe(400);
  const preview = await (await request('/api/recordings/preview', { ids: list.recordings.slice(0, 2).map((r: any) => r.id), collection: 'Captured', pathOverrides: { '/users/123': '/users/:id', '/users/456': '/users/:id' } })).json() as any;
  expect(preview.bundle.collections[0].endpoints[0].scenarios).toHaveLength(2);
  expect((await request('/api/recordings/save', { previewHash: 'bad', onConflict: 'replace' })).status).toBe(400);
  expect((await request('/api/recordings/save', { previewHash: preview.hash, onConflict: 'skip' })).status).toBe(200);
  await new Promise<void>((resolve) => backend.close(() => resolve()));
  expect(await (await fetch(`${base}/users/789`)).json()).toEqual({ token: 'synthetic', ok: true });
  const saved = await fs.readFile(service.projectFile, 'utf8');
  expect(saved).not.toContain('session=secret');
  const [ct, st] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test', version: '1' });
  const server = createMcpServer(service, '1');
  await server.connect(st); await client.connect(ct);
  const call = async (name: string, args: Record<string, unknown> = {}) => client!.callTool({ name, arguments: args }) as Promise<any>;
  const exported = (await call('export_bundle')).content[0].text;
  const controlPreview = await (await request('/api/import/preview', { content: exported, format: 'bundle' })).json() as any;
  expect((await request('/api/import/apply', { previewHash: 'bad', onConflict: 'skip' })).status).toBe(400);
  expect((await request('/api/import/apply', { previewHash: controlPreview.hash, onConflict: 'skip' })).status).toBe(200);
  const imported = JSON.parse((await call('preview_import', { content: exported, format: 'bundle' })).content[0].text);
  expect(imported.conflicts).toHaveLength(1);
  expect((await call('apply_import', { previewHash: 'wrong', onConflict: 'skip' })).isError).toBe(true);
  expect((await call('apply_import', { previewHash: imported.hash, onConflict: 'skip' })).isError).not.toBe(true);
  expect((await call('list_recordings')).isError).not.toBe(true);
  for (const format of ['bundle', 'postman', 'openapi']) {
    const response = await request(`/api/export?format=${format}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toContain('attachment');
  }
});
