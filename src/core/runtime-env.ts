import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as sea from 'node:sea';

export const isSea = sea.isSea;

export function seaVersion(): string {
  return sea.getAsset('version', 'utf8');
}

/** Materialize embedded assets using only validated names and verified bytes. */
export function seaAssetDir(): string {
  const manifest = JSON.parse(sea.getAsset('manifest', 'utf8')) as Record<string, string>;
  const version = seaVersion();
  if (!/^[\w.-]+$/.test(version) || version === '.' || version === '..') throw new Error('Invalid SEA version.');
  const cache = process.env.XDG_CACHE_HOME || path.join(os.homedir(), 'Library', 'Caches');
  const root = path.join(cache, 'mock-api-studio', version);
  for (const [name, hash] of Object.entries(manifest)) {
    if (!name.split('/').every((part) => /^[\w.-]+$/.test(part) && part !== '.' && part !== '..')) throw new Error('Invalid SEA asset name.');
    const bytes = Buffer.from(sea.getAsset(name));
    const checksum = (data: Buffer): string => createHash('sha256').update(data).digest('hex');
    if (checksum(bytes) !== hash) throw new Error(`Invalid SEA asset: ${name}`);
    const file = path.join(root, name);
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    if (existsSync(file) && checksum(readFileSync(file)) === hash) continue;
    const tmp = `${file}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
    writeFileSync(tmp, bytes, { mode: 0o600, flag: 'wx' });
    renameSync(tmp, file);
  }
  return root;
}
