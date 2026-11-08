import { type ChildProcess, fork } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExtractOptions, ExtractResult, Issue, Language, SourceFile } from './ir.js';
import type { WorkerRequest, WorkerResponse } from './worker.js';

const REQUEST_TIMEOUT_MS = 30_000;
export const MAX_FILE_BYTES = 1_000_000;
export const MAX_FILES = 500;

interface Pending {
  resolve: (r: ExtractResult) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

function resolveWorkerPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const sibling = path.join(here, 'worker.js');
  if (existsSync(sibling)) return sibling;
  const built = path.resolve(here, '..', '..', 'dist', 'parser', 'worker.js');
  if (existsSync(built)) return built;
  throw new Error('Parser worker not found. Run "npm run build" first.');
}

export function languageOf(fileName: string): Language | undefined {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.kt') || lower.endsWith('.kts')) return 'kotlin';
  if (lower.endsWith('.swift')) return 'swift';
  return undefined;
}

/**
 * Runs tree-sitter in a child process. Source code is only parsed, never executed, and a crash of the
 * WASM runtime cannot take the main process down.
 */
export class ParserHost {
  private child: ChildProcess | undefined;
  private ready: Promise<void> | undefined;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private stderr = '';

  private start(): Promise<void> {
    if (this.ready) return this.ready;
    const child = fork(resolveWorkerPath(), [], {
      execArgv: ['--liftoff-only'],
      serialization: 'json',
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    this.child = child;
    child.stderr?.on('data', (chunk: Buffer) => {
      this.stderr = (this.stderr + chunk.toString()).slice(-2000);
    });
    this.ready = new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.on('message', (message: WorkerResponse | { ready: true }) => {
        if ('ready' in message) {
          resolve();
          return;
        }
        const entry = this.pending.get(message.id);
        if (!entry) return;
        this.pending.delete(message.id);
        clearTimeout(entry.timer);
        if (message.ok) entry.resolve(message.result);
        else entry.reject(new Error(message.error));
        this.refreshChannel();
      });
      child.once('exit', (code, signal) => {
        const reason = `Parser process exited (${signal ?? code})${this.stderr ? `: ${this.stderr.trim().split('\n')[0]}` : ''}`;
        this.child = undefined;
        this.ready = undefined;
        reject(new Error(reason));
        for (const [id, entry] of this.pending) {
          clearTimeout(entry.timer);
          entry.reject(new Error(reason));
          this.pending.delete(id);
        }
      });
    });
    child.unref();
    this.refreshChannel();
    return this.ready;
  }

  private refreshChannel(): void {
    const channel = this.child?.channel;
    if (!channel) return;
    if (this.pending.size > 0) channel.ref();
    else channel.unref();
  }

  async extract(language: Language, files: SourceFile[], options?: ExtractOptions): Promise<ExtractResult> {
    const limitIssues: Issue[] = [];
    const accepted: SourceFile[] = [];
    for (const file of files) {
      if (accepted.length >= MAX_FILES) {
        limitIssues.push({ severity: 'warning', code: 'too-many-files', message: `Only the first ${MAX_FILES} files are parsed.` });
        break;
      }
      if (Buffer.byteLength(file.content) > MAX_FILE_BYTES) {
        limitIssues.push({ severity: 'warning', code: 'file-too-large', message: `${file.name} exceeds ${MAX_FILE_BYTES} bytes and is skipped.`, file: file.name });
        continue;
      }
      accepted.push(file);
    }
    if (accepted.length === 0) return { declarations: [], aliases: [], issues: limitIssues };

    await this.start();
    const child = this.child;
    if (!child) throw new Error('Parser process is not running.');
    const id = this.nextId++;
    const result = await new Promise<ExtractResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Parsing timed out after ${REQUEST_TIMEOUT_MS / 1000}s.`));
        this.refreshChannel();
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.refreshChannel();
      child.send({ id, language, files: accepted, options } satisfies WorkerRequest);
    });
    result.issues.unshift(...limitIssues);
    return result;
  }

  close(): void {
    this.child?.kill();
    this.child = undefined;
    this.ready = undefined;
  }
}
