import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { StudioError, invalid } from './errors.js';

export const MAX_MODEL_FILE_BYTES = 1_000_000;
export const MAX_MODEL_FILES = 500;
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'build', 'dist', 'Pods', 'DerivedData', '.git', '.gradle', '.build', '.idea']);

/** Resolves `target` and rejects it unless it is inside `root` (symlinks are followed). */
export async function resolveInside(root: string, target: string): Promise<string> {
  const realRoot = await fs.realpath(root);
  const candidate = path.resolve(realRoot, target);
  let real: string;
  try {
    real = await fs.realpath(candidate);
  } catch {
    throw new StudioError('NOT_FOUND', `File or folder "${target}" was not found.`);
  }
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
    throw new StudioError('FORBIDDEN', `"${target}" is outside the allowed folder. Start with --root <folder> to allow a wider folder, e.g. the repository root.`);
  }
  return real;
}

export function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

export interface LoadedSource {
  name: string;
  content: string;
}

async function collect(directory: string, out: string[]): Promise<void> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (out.length >= MAX_MODEL_FILES) return;
    if (entry.isSymbolicLink()) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) await collect(full, out);
    } else if (/\.(kt|kts|swift)$/i.test(entry.name)) {
      out.push(full);
    }
  }
}

/**
 * Reads .kt/.kts/.swift files below `root`. Entries may be files or folders (searched recursively).
 * Names are returned relative to `root` with forward slashes.
 */
export async function loadSources(root: string, entries: string[]): Promise<LoadedSource[]> {
  if (entries.length === 0) throw invalid('No model files were given.');
  const realRoot = await fs.realpath(root);
  const files: string[] = [];
  for (const entry of entries) {
    const resolved = await resolveInside(root, entry);
    const stat = await fs.stat(resolved);
    if (stat.isDirectory()) await collect(resolved, files);
    else files.push(resolved);
  }
  const unique = [...new Set(files)].slice(0, MAX_MODEL_FILES);
  if (unique.length === 0) throw invalid('No .kt or .swift files were found in the given paths.');
  const sources: LoadedSource[] = [];
  for (const file of unique) {
    const stat = await fs.stat(file);
    if (stat.size > MAX_MODEL_FILE_BYTES) continue;
    sources.push({
      name: path.relative(realRoot, file).split(path.sep).join('/'),
      content: await fs.readFile(file, 'utf8'),
    });
  }
  return sources;
}

/** True for the filesystem root, the home folder and its parents: too broad to be an access root worth recording. */
export function isBroadRoot(dir: string): boolean {
  const resolved = path.resolve(dir);
  if (resolved === path.parse(resolved).root) return true;
  const home = path.resolve(os.homedir());
  return home === resolved || home.startsWith(resolved + path.sep);
}

/** Closest folder that contains both paths. */
export function commonAncestor(a: string, b: string): string {
  const left = path.resolve(a).split(path.sep);
  const right = path.resolve(b).split(path.sep);
  let i = 0;
  while (i < left.length && i < right.length && left[i] === right[i]) i++;
  return left.slice(0, i).join(path.sep) || path.sep;
}
