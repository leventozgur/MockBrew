import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** In `args`, this placeholder is replaced with an empty, private configuration folder. */
export const CONFIG_DIR_PLACEHOLDER = '@CONFIG_DIR@';

export interface CliInvocation {
  command: string;
  args: string[];
  /** Sent on stdin; undefined closes stdin immediately. */
  stdin?: string;
}

export interface AiProvider {
  id: string;
  name: string;
  /** Builds a locked-down, non-interactive invocation. The prompt is a single argv element, never a shell string. */
  invocation(prompt: string): CliInvocation;
}

export type RunFailure = 'not-found' | 'timeout' | 'cancelled' | 'exit' | 'too-large' | 'failed';

export type RunResult = { ok: true; stdout: string } | { ok: false; kind: RunFailure; message: string };

export interface RunOptions {
  timeoutMs: number;
  signal?: AbortSignal;
  /** Extra environment variable names to pass through besides the built-in allowlist. */
  extraEnv?: string[];
}

const MAX_OUTPUT_BYTES = 2_000_000;
const KILL_GRACE_MS = 3000;

const ENV_ALLOWLIST = [
  'PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TERM', 'TMPDIR', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME',
  'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'https_proxy', 'http_proxy', 'no_proxy', 'SSL_CERT_FILE', 'NODE_EXTRA_CA_CERTS',
  'SystemRoot', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE',
];
const ENV_PREFIXES = ['COPILOT_', 'GITHUB_', 'GH_'];

/** The child gets an allowlisted environment: unrelated secrets of this process are not handed over. */
export function sanitizedEnv(source: NodeJS.ProcessEnv = process.env, extra: string[] = []): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (ENV_ALLOWLIST.includes(key) || extra.includes(key) || ENV_PREFIXES.some((p) => key.startsWith(p))) env[key] = value;
  }
  return env;
}

/**
 * Runs an AI CLI as a plain process in an empty temporary directory, without a shell.
 * Output is size limited; the process is killed on timeout or cancellation.
 */
export async function runCli(invocation: CliInvocation, options: RunOptions): Promise<RunResult> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mock-studio-ai-'));
  const cwd = path.join(root, 'work');
  const configDir = path.join(root, 'config');
  await fs.mkdir(cwd);
  await fs.mkdir(configDir);
  const args = invocation.args.map((a) => (a === CONFIG_DIR_PLACEHOLDER ? configDir : a));
  try {
    return await new Promise<RunResult>((resolve) => {
      let settled = false;
      let stdout = '';
      let stderr = '';
      let bytes = 0;
      const finish = (result: RunResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
        resolve(result);
      };

      const child = spawn(invocation.command, args, {
        cwd,
        env: sanitizedEnv(process.env, options.extraEnv),
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });

      const stop = (kind: RunFailure, message: string) => {
        finish({ ok: false, kind, message });
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS).unref();
      };
      const onAbort = () => stop('cancelled', 'The request was cancelled.');
      const timer = setTimeout(() => stop('timeout', `The AI CLI did not answer within ${Math.round(options.timeoutMs / 1000)} seconds.`), options.timeoutMs);
      if (options.signal?.aborted) onAbort();
      else options.signal?.addEventListener('abort', onAbort, { once: true });

      child.stdout.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > MAX_OUTPUT_BYTES) return stop('too-large', 'The AI CLI produced too much output.');
        stdout += chunk.toString('utf8');
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString('utf8')).slice(-4000);
      });
      child.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') finish({ ok: false, kind: 'not-found', message: `"${invocation.command}" was not found. Install the CLI and make sure it is on your PATH.` });
        else finish({ ok: false, kind: 'failed', message: error.message });
      });
      child.on('close', (code, signal) => {
        if (code === 0) return finish({ ok: true, stdout });
        const detail = stderr.trim().split('\n').filter(Boolean).slice(-2).join(' ').slice(0, 300);
        finish({ ok: false, kind: 'exit', message: `The AI CLI exited with ${signal ?? `code ${code}`}${detail ? `: ${detail}` : ''}. If it asks you to sign in, authenticate it in a terminal first.` });
      });
      child.stdin.on('error', () => undefined);
      child.stdin.end(invocation.stdin ?? '');
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

/** Finds the JSON value in CLI output that may wrap it in prose or code fences. */
export function extractJson(output: string): unknown {
  const text = output.trim();
  const attempts: string[] = [text];
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fence?.[1]) attempts.push(fence[1].trim());
  const first = text.search(/[[{]/);
  if (first >= 0) {
    const close = text[first] === '{' ? '}' : ']';
    const last = text.lastIndexOf(close);
    if (last > first) attempts.push(text.slice(first, last + 1));
  }
  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate);
    } catch {
      // try the next candidate
    }
  }
  throw new Error('The AI CLI answer does not contain valid JSON.');
}
