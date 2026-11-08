import { watch } from 'chokidar';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { StudioError, invalid } from '../core/errors.js';
import { ProjectDocument, hashText } from './document.js';
import { isPlainFileName } from './studio-file.js';

const MAX_PROJECT_FILE_BYTES = 20_000_000;
const STUDIO_SUFFIX = '.studio.json';
const ENVIRONMENT_SUFFIX = '.environment.json';

export interface ProjectLocation {
  dir: string;
  studioPath: string;
  environmentPath: string;
}

export interface FileHashes {
  environment: string | undefined;
  studio: string | undefined;
}

export interface LoadedProject {
  document: ProjectDocument;
  location: ProjectLocation;
  hashes: FileHashes;
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function readJson(file: string): Promise<{ raw: unknown; text: string }> {
  const stat = await fs.stat(file);
  if (stat.size > MAX_PROJECT_FILE_BYTES) throw invalid(`${path.basename(file)} is too large.`);
  const text = await fs.readFile(file, 'utf8');
  try {
    return { raw: JSON.parse(text), text };
  } catch (error) {
    throw invalid(`${path.basename(file)} is not valid JSON: ${(error as Error).message}`);
  }
}

function baseName(file: string): string {
  const name = path.basename(file);
  if (name.endsWith(STUDIO_SUFFIX)) return name.slice(0, -STUDIO_SUFFIX.length);
  if (name.endsWith(ENVIRONMENT_SUFFIX)) return name.slice(0, -ENVIRONMENT_SUFFIX.length);
  return name.replace(/\.json$/i, '');
}

/**
 * Finds the project files for a path: a *.studio.json, a Mockoon environment file,
 * or a folder containing exactly one of them.
 */
export async function locateProject(input: string): Promise<ProjectLocation> {
  const target = path.resolve(input);
  let stat;
  try {
    stat = await fs.stat(target);
  } catch {
    throw new StudioError('NOT_FOUND', `Project path "${input}" was not found. Create one with "mock-studio init".`);
  }

  if (stat.isDirectory()) {
    const names = await fs.readdir(target);
    const studios = names.filter((n) => n.endsWith(STUDIO_SUFFIX)).sort();
    if (studios.length > 1) throw invalid(`"${input}" contains several projects (${studios.join(', ')}); pass one of the files.`);
    if (studios.length === 1) return fromStudio(path.join(target, studios[0] as string));
    const environments = names.filter((n) => n.endsWith(ENVIRONMENT_SUFFIX)).sort();
    if (environments.length > 1) throw invalid(`"${input}" contains several environments (${environments.join(', ')}); pass one of the files.`);
    if (environments.length === 1) return fromEnvironment(path.join(target, environments[0] as string));
    throw new StudioError('NOT_FOUND', `No project found in "${input}". Create one with "mock-studio init".`);
  }
  return target.endsWith(STUDIO_SUFFIX) ? fromStudio(target) : fromEnvironment(target);
}

function fromEnvironment(environmentPath: string): ProjectLocation {
  const dir = path.dirname(environmentPath);
  return { dir, environmentPath, studioPath: path.join(dir, `${baseName(environmentPath)}${STUDIO_SUFFIX}`) };
}

async function fromStudio(studioPath: string): Promise<ProjectLocation> {
  const { raw } = await readJson(studioPath);
  const file = (raw as { environmentFile?: unknown } | null)?.environmentFile;
  const dir = path.dirname(studioPath);
  if (typeof file !== 'string' || !isPlainFileName(file)) throw invalid(`${path.basename(studioPath)} has no valid "environmentFile".`);
  return { dir, studioPath, environmentPath: path.join(dir, file) };
}

export async function loadProject(location: ProjectLocation): Promise<LoadedProject> {
  const environment = await readJson(location.environmentPath);
  const hasStudio = await exists(location.studioPath);
  const studio = hasStudio ? await readJson(location.studioPath) : undefined;
  const document = ProjectDocument.fromParts(environment.raw, studio?.raw, path.basename(location.environmentPath));
  return {
    document,
    location,
    hashes: { environment: hashText(environment.text), studio: studio ? hashText(studio.text) : undefined },
  };
}

export async function currentHashes(location: ProjectLocation): Promise<FileHashes> {
  const read = async (file: string): Promise<string | undefined> => {
    try {
      return hashText(await fs.readFile(file, 'utf8'));
    } catch {
      return undefined;
    }
  };
  return { environment: await read(location.environmentPath), studio: await read(location.studioPath) };
}

async function writeAtomic(file: string, text: string): Promise<void> {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  const handle = await fs.open(tmp, 'w', 0o644);
  try {
    await handle.writeFile(text, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fs.rename(tmp, file);
  } catch (error) {
    await fs.rm(tmp, { force: true });
    throw error;
  }
}

/** Writes changed files atomically (temporary file + rename) and returns the new hashes. */
export async function saveProject(location: ProjectLocation, document: ProjectDocument, previous: FileHashes): Promise<FileHashes> {
  const { environment, studio } = document.serialize();
  const hashes: FileHashes = { environment: hashText(environment), studio: hashText(studio) };
  if (hashes.environment !== previous.environment) await writeAtomic(location.environmentPath, environment);
  if (hashes.studio !== previous.studio) await writeAtomic(location.studioPath, studio);
  return hashes;
}

export async function createProjectFiles(dir: string, name: string, port = 3000): Promise<ProjectLocation> {
  const fileBase = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'mock-api';
  const location: ProjectLocation = {
    dir: path.resolve(dir),
    environmentPath: path.join(path.resolve(dir), `${fileBase}${ENVIRONMENT_SUFFIX}`),
    studioPath: path.join(path.resolve(dir), `${fileBase}${STUDIO_SUFFIX}`),
  };
  if ((await exists(location.environmentPath)) || (await exists(location.studioPath))) {
    throw new StudioError('CONFLICT', `A project named "${fileBase}" already exists in ${dir}.`);
  }
  await fs.mkdir(location.dir, { recursive: true });
  const document = ProjectDocument.create(name, path.basename(location.environmentPath), port);
  await saveProject(location, document, { environment: undefined, studio: undefined });
  return location;
}

export interface Watcher {
  close(): Promise<void>;
}

/** Calls `onChange` (debounced) when the project files change on disk. */
export function watchProject(location: ProjectLocation, onChange: () => void): Watcher {
  const watcher = watch([location.environmentPath, location.studioPath], {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 25 },
  });
  let timer: NodeJS.Timeout | undefined;
  const trigger = () => {
    clearTimeout(timer);
    timer = setTimeout(onChange, 100);
  };
  watcher.on('add', trigger).on('change', trigger).on('unlink', trigger);
  return {
    async close() {
      clearTimeout(timer);
      await watcher.close();
    },
  };
}
