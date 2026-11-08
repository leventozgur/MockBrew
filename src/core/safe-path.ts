import { constants, promises as fs } from 'node:fs';
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

export const MAX_RESPONSE_FILE_BYTES = 50 * 1024 * 1024;

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.pdf': 'application/pdf', '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.csv': 'text/csv; charset=utf-8',
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.xml': 'application/xml',
  '.zip': 'application/zip', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
};

/** Content type for a served file, chosen by extension only (file contents are never sniffed). */
export function contentTypeForFile(file: string): string {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

export interface ResponseFile {
  path: string;
  size: number;
  contentType: string;
}

/**
 * Resolves a response file given relative to the project folder. The file must be a regular file of
 * at most 50 MB, inside `root`, and no path component may be a symbolic link.
 */
export async function resolveResponseFile(projectDir: string, root: string, relative: string): Promise<ResponseFile> {
  if (typeof relative !== 'string' || relative.trim() === '' || relative.length > 500 || relative.includes('\0')) throw invalid('The file path is not valid.');
  const normalized = relative.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) throw invalid('Use a path relative to the project folder.');
  const realBase = await fs.realpath(projectDir);
  const realRoot = await fs.realpath(root);
  const candidate = path.resolve(realBase, normalized);
  if (!isInside(realRoot, candidate)) {
    throw new StudioError('FORBIDDEN', `"${relative}" is outside the allowed folder. Start with --root <folder> to allow a wider folder.`);
  }
  let real: string;
  try {
    real = await fs.realpath(candidate);
  } catch {
    throw new StudioError('NOT_FOUND', `File "${relative}" was not found.`);
  }
  if (real !== candidate) throw new StudioError('FORBIDDEN', 'Symbolic links are not served.');
  const info = await fs.lstat(candidate);
  if (!info.isFile()) throw invalid('The path is not a regular file.');
  if (info.size > MAX_RESPONSE_FILE_BYTES) throw invalid('The file is larger than 50 MB.');
  return { path: candidate, size: info.size, contentType: contentTypeForFile(candidate) };
}

/** Opens a resolved file without following a final symbolic link; the caller streams from the handle. */
export async function openResponseFile(file: ResponseFile): Promise<import('node:fs/promises').FileHandle> {
  const handle = await fs.open(file.path, constants.O_RDONLY | constants.O_NOFOLLOW);
  const info = await handle.stat();
  if (!info.isFile() || info.size > MAX_RESPONSE_FILE_BYTES) {
    await handle.close();
    throw invalid('The file is no longer valid.');
  }
  return handle;
}
