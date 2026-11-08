import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';

it('doctor checks a project and fails when no project is present', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'mockbrew-doctor-'));
  const cli = path.resolve('dist/cli/main.js');
  const env = { ...process.env, PATH: '', XDG_CACHE_HOME: dir, LOCALAPPDATA: dir, HOME: dir };
  try {
    const missing = spawnSync(process.execPath, [cli, 'doctor'], { cwd: dir, env, encoding: 'utf8' });
    expect(missing.status).toBe(1);
    expect(missing.stdout).toContain('Project and port: FAIL');
    execFileSync(process.execPath, [cli, 'init', dir, '--port', '38992'], { env });
    const result = spawnSync(process.execPath, [cli, 'doctor', '--project', dir], { env, encoding: 'utf8' });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain('Parser worker: PASS');
    expect(result.stdout).toContain('UI assets: PASS');
    expect(result.stdout).toContain('Cache writable: PASS');
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 30000);
