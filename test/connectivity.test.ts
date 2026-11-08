import { createHash, X509Certificate } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import qrcode from 'qrcode-generator';
import { expect, it } from 'vitest';
import { certificatePaths, createCertificates } from '../src/core/certs.js';
import { lanAddresses } from '../src/core/snippets.js';
import { ProjectService } from '../src/core/service.js';
import { startControlApi } from '../src/control-api/server.js';

it('encodes a known URL matrix', () => {
  const qr = qrcode(0, 'M'); qr.addData('http://10.0.2.2:3000/'); qr.make();
  const count = qr.getModuleCount();
  const matrix = Array.from({ length: count }, (_, r) => Array.from({ length: count }, (_, c) => qr.isDark(r, c) ? '1' : '0').join('')).join('');
  expect(count).toBe(25);
  expect(createHash('sha256').update(matrix).digest('hex')).toBe('1b161070ef82e481e62019f66c0aae6f43eb83feacc4de4b5f3639d5a0cbc8dc');
  expect(qr.createSvgTag()).toContain('<svg');
});

it('creates project certificates outside the project and serves HTTPS with the CA trusted', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mockbrew-certs-test-'));
  const previousHome = process.env.HOME;
  process.env.HOME = root;
  const project = path.join(root, 'project');
  const listener = net.createServer();
  await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const port = (listener.address() as net.AddressInfo).port;
  await new Promise<void>((resolve, reject) => listener.close((err) => err ? reject(err) : resolve()));
  const service = await ProjectService.init(project, 'Certificates', { port });
  const api = await startControlApi({ service });
  try {
    expect(service.model().settings.https?.enabled).toBe(false);
    const before = await service.start();
    expect(before.url).toMatch(/^http:/);
    expect((await fetch(`http://127.0.0.1:${port}/`)).status).toBe(404);
    const projectFiles = await readdir(project);
    createCertificates(project, root);
    const paths = certificatePaths(project, root);
    const ca = await readFile(paths.ca);
    const cert = new X509Certificate(await readFile(paths.cert));
    const authority = new X509Certificate(ca);
    expect(cert.subjectAltName).toContain('DNS:localhost');
    for (const ip of ['127.0.0.1', '0:0:0:0:0:0:0:1', '10.0.2.2', ...lanAddresses()]) expect(cert.subjectAltName).toContain(ip);
    expect((Date.parse(cert.validTo) - Date.parse(cert.validFrom)) / 86400000).toBeLessThanOrEqual(825);
    expect((Date.parse(authority.validTo) - Date.parse(authority.validFrom)) / 86400000).toBe(3650);
    if (process.platform !== 'win32') for (const key of [paths.key, paths.caKey]) expect((await stat(key)).mode & 0o777).toBe(0o600);
    expect(await readdir(project)).toEqual(projectFiles);
    const headers = { Authorization: `Bearer ${api.token}` };
    const caResponse = await fetch(`${api.url}/api/certs/ca`, { headers });
    expect(await caResponse.text()).toBe(ca.toString());
    expect((await fetch(`${api.url}/api/certs/key`, { headers })).status).toBe(404);
    await service.updateSettings({ https: { enabled: true } });
    const started = service.runtime.status();
    expect(started.url).toMatch(/^https:/);
    const status = await new Promise<number>((resolve, reject) => {
      const req = https.get(`https://localhost:${port}/`, { ca }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
      req.on('error', reject);
    });
    expect(status).toBe(404);
  } finally {
    await api.close(); await service.close();
    if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
