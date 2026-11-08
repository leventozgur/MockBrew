import { test, expect } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('connection screen shows base URLs and QR codes', async ({ page }) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mockbrew-connect-e2e-'));
  const init = spawnSync(process.execPath, ['dist/cli/main.js', 'init', dir], { encoding: 'utf8' });
  expect(init.status, init.stderr).toBe(0);
  const child = spawn(process.execPath, ['dist/cli/main.js', 'ui', '-p', dir], { stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const url = await new Promise<string>((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error(`Timed out: ${output}`)), 30000);
      child.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString();
        const match = output.match(/Studio UI: (http:\/\/127\.0\.0\.1:\d+\/#token=\S+)/);
        if (match) { clearTimeout(timer); resolve(match[1]!); }
      });
      child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString(); });
      child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`UI exited (${code}): ${output}`)); });
    });
    await page.goto(url);
    await page.getByRole('button', { name: 'Connect app' }).click();
    await expect(page.getByText(/^http:\/\/10\.0\.2\.2:\d+\/$/).first()).toBeVisible();
    await expect(page.getByRole('img', { name: 'QR code for Android Emulator' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'QR code for iOS Simulator' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'QR code for Android device (adb reverse)' })).toBeVisible();
  } finally {
    child.kill('SIGTERM');
    if (child.exitCode === null && child.signalCode === null) await once(child, 'exit');
    await rm(dir, { recursive: true, force: true });
  }
});
