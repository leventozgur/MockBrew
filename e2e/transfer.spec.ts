import { test, expect } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

async function freePort(): Promise<number> {
  const server = createServer().listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) => server.close((e) => e ? reject(e) : resolve())); return port;
}

test('import, export and record a proxied response', async ({ page }) => {
  const dir = await mkdtemp(join(tmpdir(), 'mockbrew-transfer-'));
  const mockPort = await freePort(); const uiPort = await freePort();
  const backend = createHttpServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"recorded":true}'); }).listen(0, '127.0.0.1');
  await once(backend, 'listening'); const backendPort = (backend.address() as { port: number }).port;
  const init = spawnSync(process.execPath, ['dist/cli/main.js', 'init', dir, '--port', String(mockPort)], { encoding: 'utf8' }); expect(init.status, init.stderr).toBe(0);
  const child = spawn(process.execPath, ['dist/cli/main.js', 'ui', '-p', dir, '--port', String(uiPort)], { stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const url = await new Promise<string>((resolve, reject) => { let output = ''; const timer = setTimeout(() => reject(new Error('UI launch timed out')), 30000); child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); const match = output.match(/Studio UI: (http:\/\/127\.0\.0\.1:\d+\/#token=\S+)/); if (match) { clearTimeout(timer); resolve(match[1]); } }); child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString(); }); child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`UI exited ${code}: ${output}`)); }); });
    await page.goto(url);
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Import' });
    await dialog.getByLabel('Paste content').fill(JSON.stringify({ info: { name: 'Imported', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' }, item: [{ name: 'hello', request: { method: 'GET', url: { raw: 'http://example.test/hello', path: ['hello'] } }, response: [{ name: 'Example', code: 200, body: '{"hello":true}', header: [{ key: 'Content-Type', value: 'application/json' }] }] }] }));
    await dialog.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(dialog.getByText('GET /hello', { exact: false })).toBeVisible();
    await dialog.getByRole('button', { name: 'Apply import' }).click();
    await expect(page.getByRole('button', { name: /GET.*\/hello/ })).toBeVisible();
    await page.getByRole('button', { name: 'Start server' }).click();
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
    await expect.poll(async () => (await fetch(`http://127.0.0.1:${mockPort}/hello`)).status).toBe(200);
    expect(await (await fetch(`http://127.0.0.1:${mockPort}/hello`)).json()).toEqual({ hello: true });
    await page.getByPlaceholder('New collection').fill('Extra');
    await page.getByPlaceholder('New collection').press('Enter');
    await expect(page.getByRole('complementary').getByText('Extra', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await page.getByRole('dialog', { name: 'Export' }).getByLabel('Imported').check();
    await page.getByRole('dialog', { name: 'Export' }).getByLabel('Extra').check();
    const downloadPromise = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download' }).click();
    const download = await downloadPromise; const bundle = JSON.parse(await readFile(await download.path(), 'utf8')); expect(bundle.format).toBe('mockbrew/bundle'); expect(bundle.collections.map((c: { name: string }) => c.name)).toEqual(['Imported', 'Extra']);
    await page.getByRole('dialog', { name: 'Export' }).getByRole('button', { name: 'Close' }).click();
    const token = await page.evaluate(() => sessionStorage.getItem('mockbrew-token'));
    const settings = await page.request.patch(`http://127.0.0.1:${uiPort}/api/settings`, { headers: { Authorization: `Bearer ${token}` }, data: { proxy: { enabled: true, host: `http://127.0.0.1:${backendPort}` } } }); expect(settings.ok(), await settings.text()).toBeTruthy();
    await page.getByRole('button', { name: 'Recording', exact: true }).click();
    await page.getByRole('button', { name: 'Start recording' }).click();
    expect(await (await fetch(`http://127.0.0.1:${mockPort}/users/123`)).json()).toEqual({ recorded: true });
    await expect(page.getByText('/users/123', { exact: false }).first()).toBeVisible();
    await page.getByRole('checkbox', { name: /\/users\/123/ }).check();
    await page.getByLabel(/Path pattern for recording/).fill('/users/:id');
    await page.getByLabel('Target collection').selectOption({ label: 'Imported' });
    await page.getByRole('button', { name: 'Preview recordings' }).click();
    await expect(page.getByText('GET /users/:id', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Save recordings' }).click();
    await expect(page.getByRole('button', { name: 'Save recordings' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Stop recording' }).click();
    await new Promise<void>((resolve, reject) => backend.close((e) => e ? reject(e) : resolve()));
    await expect.poll(async () => { try { return await (await fetch(`http://127.0.0.1:${mockPort}/users/123`)).json(); } catch { return null; } }).toEqual({ recorded: true });
  } finally {
    if (backend.listening) await new Promise<void>((resolve) => backend.close(() => resolve()));
    child.kill('SIGTERM'); if (child.exitCode === null && child.signalCode === null) await once(child, 'exit'); await rm(dir, { recursive: true, force: true });
  }
});
