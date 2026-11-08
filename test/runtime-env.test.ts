import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { cacheDir, extractSeaAssets } from '../src/core/runtime-env.js';

describe('SEA cache', () => {
  it('selects platform cache directories', () => {
    expect(cacheDir('darwin', {}, '/home/user')).toBe(path.join('/home/user', 'Library/Caches/mockbrew'));
    expect(cacheDir('linux', { XDG_CACHE_HOME: '/cache' }, '/home/user')).toBe(path.join('/cache', 'mockbrew'));
    expect(cacheDir('linux', { XDG_CACHE_HOME: 'relative' }, '/home/user')).toBe(path.join('/home/user', '.cache', 'mockbrew'));
    expect(cacheDir('win32', { LOCALAPPDATA: '/local' }, '/home/user')).toBe(path.join('/local', 'mockbrew', 'Cache'));
  });
  it('verifies and publishes assets once, and rejects invalid bytes and paths', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'mockbrew-cache-test-'));
    try {
      const bytes = Buffer.from('asset');
      const hash = createHash('sha256').update(bytes).digest('hex');
      const manifest = JSON.stringify({ 'ui/index.html': hash });
      let reads = 0;
      const reader = (name: string): string | ArrayBuffer => {
        if (name === 'version') return '1.0.0';
        if (name === 'manifest') return manifest;
        reads++;
        return bytes;
      };
      const root = extractSeaAssets(reader, dir);
      expect(readFileSync(path.join(root, 'ui/index.html'), 'utf8')).toBe('asset');
      expect(extractSeaAssets(reader, dir)).toBe(root);
      expect(reads).toBe(1);
      expect(() => extractSeaAssets((name) => name === 'version' ? '2' : name === 'manifest' ? manifest : Buffer.from('bad'), dir)).toThrow('Invalid SEA asset');
      expect(() => extractSeaAssets((name) => name === 'version' ? '3' : JSON.stringify({ '../bad': hash }), dir)).toThrow('Invalid SEA asset');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

it('allows two processes to extract the same version concurrently', async () => {
  const { spawn } = await import('node:child_process');
  const { pathToFileURL } = await import('node:url');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'mockbrew-concurrent-'));
  try {
    const moduleUrl = pathToFileURL(path.resolve('dist/core/runtime-env.js')).href;
    const script = `import { extractSeaAssets } from ${JSON.stringify(moduleUrl)};
      import { createHash } from 'node:crypto';
      const bytes = Buffer.alloc(1024 * 1024, 42);
      const manifest = JSON.stringify({ 'data.bin': createHash('sha256').update(bytes).digest('hex') });
      console.log(extractSeaAssets(n => n === 'version' ? '1' : n === 'manifest' ? manifest : bytes, process.argv[1]));`;
    const run = () => new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', script, dir]);
      let output = ''; let errors = '';
      child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
      child.stderr.on('data', (chunk: Buffer) => { errors += chunk.toString(); });
      child.on('error', reject);
      child.on('close', (code) => code === 0 ? resolve(output.trim()) : reject(new Error(errors)));
    });
    const [first, second] = await Promise.all([run(), run()]);
    expect(first).toBe(second);
    expect(readFileSync(path.join(first!, 'data.bin')).length).toBe(1024 * 1024);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
