import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as sea from 'node:sea';

export const isSea = sea.isSea;
export function seaVersion(): string { return sea.getAsset('version', 'utf8'); }

export function cacheDir(platform = process.platform, env = process.env, home = os.homedir()): string {
  if (platform === 'win32') return path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'mockbrew', 'Cache');
  if (platform === 'darwin') return path.join(home, 'Library', 'Caches', 'mockbrew');
  return path.join(env.XDG_CACHE_HOME && path.isAbsolute(env.XDG_CACHE_HOME) ? env.XDG_CACHE_HOME : path.join(home, '.cache'), 'mockbrew');
}

type AssetReader = (name: string) => string | ArrayBuffer;
const digest = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');

/** Publish a complete, verified extraction atomically. Concurrent publishers use separate staging directories. */
export function extractSeaAssets(readAsset: AssetReader, cache = cacheDir()): string {
  const version = String(readAsset('version'));
  if (!/^[\w.-]+$/.test(version) || version === '.' || version === '..') throw new Error('Invalid SEA version.');
  const manifestText = String(readAsset('manifest'));
  const manifest = JSON.parse(manifestText) as Record<string, string>;
  const fingerprint = digest(manifestText);
  const parent = path.join(cache, version);
  const root = path.join(parent, fingerprint);
  const marker = path.join(root, '.complete');
  if (existsSync(marker) && readFileSync(marker, 'utf8') === fingerprint) return root;
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const staging = path.join(parent, `.extract-${randomUUID()}`);
  mkdirSync(staging, { mode: 0o700 });
  try {
    for (const [name, hash] of Object.entries(manifest)) {
      if (!name.split('/').every((part) => /^[\w.-]+$/.test(part) && part !== '.' && part !== '..') || name === '.complete' || !/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid SEA asset name or hash.');
      const asset = readAsset(name);
      const bytes = typeof asset === 'string' ? Buffer.from(asset) : Buffer.from(asset);
      if (digest(bytes) !== hash) throw new Error(`Invalid SEA asset: ${name}`);
      const file = path.join(staging, name);
      mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      writeFileSync(file, bytes, { mode: 0o600, flag: 'wx' });
    }
    writeFileSync(path.join(staging, '.complete'), fingerprint, { mode: 0o600, flag: 'wx' });
    try { renameSync(staging, root); } catch (error) {
      if (!existsSync(marker) || readFileSync(marker, 'utf8') !== fingerprint) throw error;
    }
  } finally { rmSync(staging, { recursive: true, force: true }); }
  return root;
}

export function seaAssetDir(): string {
  return extractSeaAssets((name) => name === 'version' || name === 'manifest' ? sea.getAsset(name, 'utf8') : sea.getAsset(name));
}
