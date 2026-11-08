import { test, expect } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm, access, writeFile } from 'node:fs/promises';
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
  const dir = await mkdtemp(join(tmpdir(), 'mockbrew-e2e-'));
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


test('conditional responses, override and request reasons', async ({ page }) => {
  await access('dist/ui/index.html');
  const dir = await mkdtemp(join(tmpdir(), 'mockbrew-rules-e2e-'));
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
    await page.goto(url);
    await page.getByPlaceholder('New collection').fill('Rules');
    await page.getByPlaceholder('New collection').press('Enter');
    await page.getByTitle('Add endpoint').click();
    const dialog = page.getByRole('dialog', { name: 'New endpoint in Rules' });
    await dialog.getByLabel('Path').fill('/conditional');
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();
    await page.getByPlaceholder('New scenario').fill('Authorized');
    await page.getByRole('button', { name: 'Add', exact: true }).last().click();
    await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Authorized');
    await page.getByRole('textbox', { name: 'Status', exact: true }).fill('201');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('button', { name: 'Add condition' }).click();
    await page.getByLabel('Condition 1 modifier').fill('X-Test');
    await page.getByLabel('Condition 1 value').fill('yes');
    await page.getByRole('button', { name: 'Save conditions' }).click();
    await expect(page.getByRole('button', { name: 'Save conditions' })).toBeDisabled();
    await page.getByRole('button', { name: 'Start server' }).click();
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
    const mockUrl = `http://127.0.0.1:${mockPort}/conditional`;
    expect((await fetch(mockUrl, { headers: { 'X-Test': 'yes' } })).status).toBe(201);
    expect((await fetch(mockUrl)).status).toBe(200);
    expect((await fetch(mockUrl, { headers: { 'X-Mock-Scenario': 'Authorized' } })).status).toBe(201);
    await page.getByRole('button', { name: 'Requests', exact: true }).click();
    await expect(page.getByRole('row').filter({ hasText: '/conditional' }).filter({ hasText: 'forced' })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: '/conditional' }).filter({ hasText: 'rule' })).toBeVisible();
  } finally {
    child.kill('SIGTERM');
    if (child.exitCode === null && child.signalCode === null) await once(child, 'exit');
    await rm(dir, { recursive: true, force: true });
  }
});


test('model drift preview updates selected body and preserves manual values', async ({ page }) => {
  await access('dist/ui/index.html');
  const dir = await mkdtemp(join(tmpdir(), 'mockbrew-model-e2e-'));
  const model = join(dir, 'User.kt');
  const mockPort = await freePort();
  const uiPort = await freePort();
  await writeFile(model, 'data class User(val name: String, val obsolete: String)');
  const init = spawnSync(process.execPath, ['dist/cli/main.js', 'init', dir, '--port', String(mockPort)], { encoding: 'utf8' });
  expect(init.status, init.stderr).toBe(0);
  const child = spawn(process.execPath, ['dist/cli/main.js', 'ui', '-p', dir, '--root', dir, '--port', String(uiPort)], { stdio: ['ignore', 'pipe', 'pipe'] });
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
    await page.goto(url);
    await page.getByPlaceholder('New collection').fill('Models');
    await page.getByPlaceholder('New collection').press('Enter');
    await page.getByTitle('Add endpoint').click();
    const create = page.getByRole('dialog', { name: 'New endpoint in Models' });
    await create.getByLabel('Path').fill('/user');
    await create.getByRole('button', { name: 'Create', exact: true }).click();
    await page.getByRole('button', { name: 'Generate from model…' }).click();
    const generate = page.getByRole('dialog', { name: 'Generate a response from a model' });
    await generate.getByRole('button', { name: 'Project paths' }).click();
    await generate.getByLabel('Files or folders, one per line').fill('User.kt');
    await generate.getByRole('button', { name: 'Read models' }).click();
    await generate.getByRole('button', { name: 'Generate', exact: true }).click();
    await generate.getByRole('button', { name: 'Use this body' }).click();
    await page.getByRole('textbox', { name: 'Body', exact: true }).fill('{"name":"Manual value","obsolete":"old"}');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Start server' }).click();
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
    await writeFile(model, 'data class User(val name: String, val age: Int)');
    await page.getByRole('button', { name: 'Check models' }).click();
    const check = page.getByRole('dialog', { name: 'Check linked models' });
    await expect(check.getByText('changed', { exact: true })).toBeVisible();
    await check.getByRole('button', { name: 'Preview update' }).click();
    await expect(check.getByRole('region', { name: 'Body diff' })).toContainText('age');
    await expect(check.getByRole('region', { name: 'Body diff' })).toContainText('obsolete');
    await check.getByRole('button', { name: 'Apply selected' }).click();
    await expect(check.getByText('Selected scenarios updated.')).toBeVisible();
    const served = await (await fetch(`http://127.0.0.1:${mockPort}/user`)).json();
    expect(served).toHaveProperty('name', 'Manual value');
    expect(served).toHaveProperty('age');
    expect(served).not.toHaveProperty('obsolete');
  } finally {
    child.kill('SIGTERM');
    if (child.exitCode === null && child.signalCode === null) await once(child, 'exit');
    await rm(dir, { recursive: true, force: true });
  }
});

test('profiles switch two endpoints and explain request selection', async ({ page }) => {
  await access('dist/ui/index.html');
  const dir = await mkdtemp(join(tmpdir(), 'mockbrew-profiles-e2e-'));
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
    await page.goto(url);
    await page.getByPlaceholder('New collection').fill('Profile fixtures');
    await page.getByPlaceholder('New collection').press('Enter');
    for (const path of ['/first', '/second']) {
      await page.getByTitle('Add endpoint').click();
      const dialog = page.getByRole('dialog', { name: 'New endpoint in Profile fixtures' });
      await dialog.getByLabel('Path').fill(path);
      await dialog.getByRole('button', { name: 'Create', exact: true }).click();
      await expect(dialog).not.toBeVisible();
      await expect(page.getByLabel('Path', { exact: true })).toHaveValue(path);
      await page.getByPlaceholder('New scenario').fill('Unauthorized');
      await page.getByRole('button', { name: 'Add', exact: true }).last().click();
      await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Unauthorized');
      await page.getByRole('textbox', { name: 'Status', exact: true }).fill('401');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    }
    await page.getByRole('button', { name: 'Start server' }).click();
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Profiles', exact: true }).click();
    await page.getByRole('button', { name: 'Create profile' }).click();
    const editor = page.getByRole('dialog', { name: 'Create profile' });
    await editor.getByLabel('Name', { exact: true }).fill('Session expired');
    await editor.getByRole('button', { name: 'All endpoints → first 401 scenario' }).click();
    await expect(editor.getByLabel('Scenario for GET /first')).toContainText('Unauthorized (401)');
    await editor.getByRole('button', { name: 'Save profile' }).click();
    await expect(editor).not.toBeVisible();
    await page.getByRole('button', { name: 'Activate', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Turn off' })).toBeVisible();
    for (const path of ['/first', '/second']) expect((await fetch(`http://127.0.0.1:${mockPort}${path}`)).status).toBe(401);
    await page.getByRole('button', { name: 'Requests', exact: true }).click();
    for (const path of ['/first', '/second']) await expect(page.getByRole('row').filter({ hasText: path }).filter({ hasText: 'profile: Session expired' })).toBeVisible();
    await page.getByRole('button', { name: 'Turn off' }).click();
    await expect(page.getByRole('button', { name: 'Turn off' })).not.toBeVisible();
    for (const path of ['/first', '/second']) expect((await fetch(`http://127.0.0.1:${mockPort}${path}`)).status).toBe(200);
  } finally {
    child.kill('SIGTERM');
    if (child.exitCode === null && child.signalCode === null) await once(child, 'exit');
    await rm(dir, { recursive: true, force: true });
  }
});
