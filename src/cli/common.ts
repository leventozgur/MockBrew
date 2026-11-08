import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { isSea, seaVersion } from '../core/runtime-env.js';
import { StudioError } from '../core/errors.js';
import { ProjectService, type ServiceOptions } from '../core/service.js';
import type { Issue } from '../parser/ir.js';

export class UsageError extends Error {}

export function formatIssue(issue: Issue): string {
  const where = issue.file ? ` (${issue.file}${issue.line ? `:${issue.line}` : ''})` : '';
  return `[${issue.severity}] ${issue.code}: ${issue.message}${where}`;
}

/** Opens the project named by --project, falling back to ./ and then ./mocks. */
export async function openProject(argument: string | undefined, options: ServiceOptions = {}): Promise<ProjectService> {
  if (argument) return ProjectService.open(argument, options);
  try {
    return await ProjectService.open('.', options);
  } catch (error) {
    if (error instanceof StudioError && error.code === 'NOT_FOUND' && existsSync(path.resolve('mocks'))) {
      return ProjectService.open('mocks', options);
    }
    throw error;
  }
}

export function parsePort(value: string | undefined, name = '--port'): number | undefined {
  if (value === undefined) return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new UsageError(`${name} must be an integer between 1 and 65535.`);
  return port;
}

export interface Io {
  out(message: string): void;
  err(message: string): void;
}

export const consoleIo: Io = {
  out: (m) => process.stdout.write(`${m}\n`),
  err: (m) => process.stderr.write(`${m}\n`),
};

/** Resolves when the process receives SIGINT or SIGTERM. */
export function waitForSignal(): Promise<void> {
  return new Promise((resolve) => {
    const handler = () => resolve();
    process.once('SIGINT', handler);
    process.once('SIGTERM', handler);
  });
}

export function packageVersion(): string {
  if (isSea()) return seaVersion();
  const file = new URL('../../package.json', import.meta.url);
  return (JSON.parse(readFileSync(file, 'utf8')) as { version: string }).version;
}
