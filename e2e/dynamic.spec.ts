import { test, expect } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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

test('dynamic values, request validation and file responses', async ({ page }) => {
  const dir = await mkdtemp(join(tmpdir(), 'mockbrew-dynamic-e2e-'));
  const mockPort = await freePort();
  const uiPort = await freePort();
  await writeFile(join(dir, 'hello.txt'), 'Hello from a file');
  const init = spawnSync(process.execPath, ['dist/cli/main.js', 'init', dir, '--port', String(mockPort)], { encoding: 'utf8' });
  expect(init.status, init.stderr).toBe(0);
  const child = spawn(process.execPath, ['dist/cli/main.js', 'ui', '-p', dir, '--root', dir, '--port', String(uiPort)], { stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const url = await new Promise<string>((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error('Timed out waiting for UI')), 30000);
      child.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString();
        const match = output.match(/Studio UI: (http:\/\/127\.0\.0\.1:\d+\/#token=\S+)/);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
      child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString(); });
      child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`UI exited (${code}): ${output}`)); });
    });
    await page.goto(url);
    await page.getByPlaceholder('New collection').fill('Users');
    await page.getByPlaceholder('New collection').press('Enter');
    await page.getByTitle('Add endpoint').click();
    const create = page.getByRole('dialog', { name: 'New endpoint in Users' });
    await create.getByLabel('Method').selectOption('POST');
    await create.getByLabel('Path').fill('/users');
    await create.getByRole('button', { name: 'Create', exact: true }).click();
    await page.getByLabel('Dynamic values').check();
    await page.getByRole('textbox', { name: 'Body', exact: true }).fill('{"name":"{{request.body.$.name}}","id":"{{uuid}}","value":"{{vars.x}}"}');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByLabel('Variable name').fill('x');
    await page.getByLabel('Variable value').fill('example');
    await page.getByRole('button', { name: 'Save variable' }).click();
    await expect(page.getByText('example', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Endpoints', exact: true }).click();
    await page.getByRole('button', { name: 'Start server' }).click();
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
    const send = (body: unknown) => fetch(`http://127.0.0.1:${mockPort}/users`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await (await send({ name: 'Ada' })).json();
    expect(result).toMatchObject({ name: 'Ada', value: 'example' });
    expect(result.id).toMatch(/^[0-9a-f-]{36}$/);
    await page.getByRole('button', { name: 'Link request model…' }).click();
    const picker = page.getByRole('dialog', { name: 'Generate a response from a model' });
    await picker.getByPlaceholder('Paste the model classes here. The code is parsed, never executed.').fill('data class User(val name: String, val age: Int)');
    await picker.getByRole('button', { name: 'Read models' }).click();
    await picker.getByRole('button', { name: 'Generate', exact: true }).click();
    await picker.getByRole('button', { name: 'Use this body' }).click();
    await expect(page.getByLabel('Invalid-request scenario')).toContainText('Invalid request (422)');
    expect((await send({ name: 'Ada' })).status).toBe(422);
    await page.getByRole('button', { name: 'Requests', exact: true }).click();
    const invalid = page.getByRole('row').filter({ hasText: '/users' }).filter({ hasText: 'invalid' }).first();
    await expect(invalid).toBeVisible();
    await invalid.click();
    await expect(page.getByText('Request validation: invalid (User)')).toBeVisible();
    await expect(page.getByText(/age/).last()).toBeVisible();
    await page.getByRole('button', { name: 'Endpoints', exact: true }).click();
    await page.getByRole('button', { name: 'Unlink', exact: true }).click();
    await page.getByLabel('Body source').selectOption('file');
    await page.getByLabel('File path').fill('hello.txt');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    const file = await send({ name: 'Ada' });
    expect(file.headers.get('content-type')).toContain('text/plain');
    expect(await file.text()).toBe('Hello from a file');
  } finally {
    child.kill('SIGTERM');
    if (child.exitCode === null && child.signalCode === null) await once(child, 'exit');
    await rm(dir, { recursive: true, force: true });
  }
});
