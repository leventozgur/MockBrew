import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { afterEach, expect, it } from 'vitest';
import { FrontServer } from '../src/runtime/front.js';
import { ProjectService } from '../src/core/service.js';

const fronts: FrontServer[] = [];
const servers: http.Server[] = [];
const services: ProjectService[] = [];
const dirs: string[] = [];
const listen = (server: net.Server, host = '127.0.0.1') => new Promise<number>((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, host, () => resolve((server.address() as net.AddressInfo).port));
});
const freePort = async () => { const server = net.createServer(); const port = await listen(server); await new Promise<void>((resolve) => server.close(() => resolve())); return port; };
const close = (server: http.Server) => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); });

afterEach(async () => {
  for (const front of fronts.splice(0)) await front.close();
  for (const service of services.splice(0)) await service.close();
  for (const server of servers.splice(0)) await close(server);
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

it('streams a large request and response, preserves headers and supports keep-alive', async () => {
  let received = 0;
  let firstChunkBeforeEnd = false;
  const backend = http.createServer((req, res) => {
    expect(req.method).toBe('POST');
    expect(req.url).toBe('/large?q=1');
    expect(req.headers.host).toBe('original.example');
    expect(req.headers['x-forwarded-for']).toBeUndefined();
    res.writeHead(201, { 'Set-Cookie': ['a=1', 'b=2'], 'Content-Type': 'application/octet-stream' });
    req.on('data', (chunk: Buffer) => { received += chunk.length; res.write(chunk); });
    req.on('end', () => res.end());
  });
  servers.push(backend);
  const enginePort = await listen(backend);
  const port = await freePort();
  const front = new FrontServer({ host: '127.0.0.1', port, enginePort }); fronts.push(front); await front.listen();
  const chunk = Buffer.alloc(64 * 1024, 97);
  const agent = new http.Agent({ keepAlive: true });
  try {
    const result = await new Promise<{ body: Buffer; cookies: string[] | undefined }>((resolve, reject) => {
      const request = http.request({ host: '127.0.0.1', port, path: '/large?q=1', method: 'POST', headers: { Host: 'original.example' }, agent }, (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (data: Buffer) => { firstChunkBeforeEnd ||= received < chunk.length * 80; chunks.push(data); });
        response.on('end', () => resolve({ body: Buffer.concat(chunks), cookies: response.headers['set-cookie'] }));
        response.on('error', reject);
      });
      request.on('error', reject);
      let sent = 0;
      const write = () => {
        while (sent < 80) { sent++; if (!request.write(chunk)) { request.once('drain', write); return; } }
        request.end();
      };
      write();
    });
    expect(result.body).toEqual(Buffer.alloc(chunk.length * 80, 97));
    expect(received).toBe(result.body.length);
    expect(firstChunkBeforeEnd).toBe(true);
    expect(result.cookies).toEqual(['a=1', 'b=2']);
    expect(Object.values(agent.freeSockets).flat().length).toBe(1);
  } finally { agent.destroy(); }
});

it('runs request and bounded response hooks while streaming unknown-size responses unchanged', async () => {
  let hits = 0; let responses = 0;
  const backend = http.createServer((req, res) => {
    hits++;
    if (req.url === '/stream') { res.write('one'); res.end('two'); return; }
    res.writeHead(200, { 'Content-Length': '3', 'Set-Cookie': ['x=1', 'y=2'] }); res.end('old');
  });
  servers.push(backend); const enginePort = await listen(backend); const port = await freePort();
  const front = new FrontServer({ host: '127.0.0.1', port, enginePort, hooks: {
    onRequest: ({ request }) => request.url === '/short' ? { status: 418, body: 'short' } : undefined,
    onResponse: (_ctx, response) => { responses++; expect(response.body.toString()).toBe('old'); return { status: 202, headers: { 'Content-Type': 'text/plain' }, body: 'new' }; },
  } }); fronts.push(front); await front.listen();
  const base = `http://127.0.0.1:${port}`;
  const short = await fetch(`${base}/short`); expect(short.status).toBe(418); expect(await short.text()).toBe('short'); expect(hits).toBe(0);
  const replaced = await fetch(`${base}/replace`); expect(replaced.status).toBe(202); expect(await replaced.text()).toBe('new');
  const streamed = await fetch(`${base}/stream`); expect(await streamed.text()).toBe('onetwo'); expect(responses).toBe(1);
});

it('keeps the engine loopback-only and closes both listeners and active sockets', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mockbrew-front-')); dirs.push(dir);
  const port = await freePort();
  const service = await ProjectService.init(dir, 'Front', { port, overrides: { host: '0.0.0.0' } }); services.push(service);
  await service.start();
  const engine = (service.runtime as unknown as { enginePort: number }).enginePort;
  expect(engine).toBeGreaterThan(0); expect(engine).not.toBe(port);
  const address = Object.values(os.networkInterfaces()).flatMap((v) => v ?? []).find((v) => v.family === 'IPv4' && !v.internal)?.address;
  if (address) {
    const publicStatus = await new Promise<number>((resolve, reject) => {
      http.get({ host: address, port, path: '/' }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode ?? 0)); }).on('error', reject);
    });
    expect(publicStatus).toBe(404);
    await expect(new Promise<void>((resolve, reject) => {
      const socket = net.connect(engine, address, () => { socket.destroy(); resolve(); });
      socket.on('error', reject);
    })).rejects.toThrow();
  }
  const socket = net.connect(port, '127.0.0.1');
  await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); });
  const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()));
  await service.stop(); await closed;
  for (const p of [port, engine]) {
    const check = net.createServer();
    await new Promise<void>((resolve, reject) => { check.once('error', reject); check.listen(p, '127.0.0.1', () => resolve()); });
    await new Promise<void>((resolve) => check.close(() => resolve()));
  }
});

it('preserves bounded responses through no-op hooks and bypasses the hook for oversized bodies', async () => {
  let calls = 0;
  const backend = http.createServer((req, res) => {
    const body = req.url === '/large' ? '123456' : 'small';
    res.writeHead(203, { 'Content-Length': String(body.length), 'Set-Cookie': ['a=1', 'b=2'] }); res.end(body);
  });
  servers.push(backend); const enginePort = await listen(backend); const port = await freePort();
  const front = new FrontServer({ host: '127.0.0.1', port, enginePort, maxBufferedResponseBytes: 5, hooks: { onRequest: () => undefined, onResponse: () => { calls++; return undefined; } } });
  fronts.push(front); await front.listen();
  for (const [route, body] of [['/small', 'small'], ['/large', '123456']]) {
    const response = await fetch(`http://127.0.0.1:${port}${route}`);
    expect(response.status).toBe(203); expect(response.headers.getSetCookie()).toEqual(['a=1', 'b=2']); expect(await response.text()).toBe(body);
  }
  expect(calls).toBe(1);
});
