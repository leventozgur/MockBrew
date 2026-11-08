import { test, expect } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

async function freePort(): Promise<number> {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

test('dashboard scenarios, live switching, request log and local generation', async ({ page }) => {
  await access('dist/ui/index.html').catch(() => { throw new Error('dist/ui is missing; run npm run build before npm run test:e2e'); });
  const dir = await mkdtemp(join(tmpdir(), 'mock-studio-e2e-'));
  const mockPort = await freePort();
  const uiPort = await freePort();
  const init = spawnSync(process.execPath, ['dist/cli/main.js', 'init', dir, '--port', String(mockPort)], { encoding: 'utf8' });
  expect(init.status, init.stderr).toBe(0);
  const child = spawn(process.execPath, ['dist/cli/main.js', 'ui', '-p', dir, '--port', String(uiPort)], { stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const url = await new Promise<string>((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error('Timed out waiting for CLI launch URL')), 30000);
      child.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString();
        const match = output.match(/Studio UI: (http:\/\/127\.0\.0\.1:\d+\/#token=\S+)/);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
      child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString(); });
      child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`UI exited (${code}): ${output}`)); });
    });
    await page.route('**/*', (route) => {
      const hostname = new URL(route.request().url()).hostname;
      return hostname === '127.0.0.1' || hostname === 'localhost' ? route.continue() : route.abort();
    });
    await page.goto(url);
    await expect(page.getByText('No endpoints yet', { exact: true })).toBeVisible();
    await page.getByPlaceholder('New collection').fill('Users');
    await page.getByPlaceholder('New collection').press('Enter');
    await page.getByTitle('Add endpoint').click();
    const dialog = page.getByRole('dialog', { name: 'New endpoint in Users' });
    await dialog.getByLabel('Path').fill('/users/:id');
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    const body = page.getByRole('textbox', { name: 'Body', exact: true });
    await body.fill('{"id": 42}');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await body.fill('{ invalid');
    await expect(page.getByText('Not valid JSON:', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await page.reload();
    await expect(body).toHaveValue('{"id": 42}');
    await page.getByPlaceholder('New scenario').fill('Failure');
    await page.getByRole('button', { name: 'Add', exact: true }).last().click();
    await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Failure');
    await page.getByRole('textbox', { name: 'Status', exact: true }).fill('500');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('button', { name: 'Serve this scenario' }).click();
    await page.getByRole('button', { name: 'Start server' }).click();
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
    expect((await fetch(`http://127.0.0.1:${mockPort}/users/42`)).status).toBe(500);
    await page.getByRole('button', { name: /Success 200/ }).click();
    await page.getByRole('button', { name: 'Serve this scenario' }).click();
    await expect.poll(async () => (await fetch(`http://127.0.0.1:${mockPort}/users/42`)).status).toBe(200);
    await page.getByRole('button', { name: 'Requests', exact: true }).click();
    await expect(page.getByRole('row').filter({ hasText: '/users/42' }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Endpoints', exact: true }).click();
    await page.getByRole('button', { name: 'Generate from model…' }).click();
    const generate = page.getByRole('dialog', { name: 'Generate a response from a model' });
    await generate.getByPlaceholder('Paste the model classes here. The code is parsed, never executed.').fill('data class User(val id: Int, val name: String)');
    await generate.getByRole('button', { name: 'Read models' }).click();
    await generate.getByRole('button', { name: 'Generate', exact: true }).click();
    await expect(generate.getByText('matches the model')).toBeVisible();
    await generate.getByRole('button', { name: 'Use this body' }).click();
    const generated = JSON.parse(await body.inputValue());
    expect(generated).toHaveProperty('id');
    expect(generated).toHaveProperty('name');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await page.reload();
    expect(JSON.parse(await body.inputValue())).toEqual(generated);
  } finally {
    child.kill('SIGTERM');
    if (child.exitCode === null && child.signalCode === null) await once(child, 'exit');
    await rm(dir, { recursive: true, force: true });
  }
});
