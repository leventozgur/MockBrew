import { execFile } from 'node:child_process';
import { constants, promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { type AiProvider, extractJson, sanitizedEnv, OUTPUT_FILE_PLACEHOLDER, WORK_DIR_PLACEHOLDER } from './cli-runner.js';
import { resolveLaunch } from '../core/launch.js';
import { copilotCliProvider } from './copilot.js';

const execFileAsync = promisify(execFile);
export interface ProviderInfo {
  id: string;
  name: string;
  version: string;
  isolation: 'full' | 'limited';
  note?: string;
}

/** Claude Code 2.1.318 --help: --print, --output-format text, --tools "",
 * --safe-mode, --strict-mcp-config, --no-session-persistence and --permission-prompts none.
 * Managed policy settings still apply; --safe-mode does not claim a separate config directory. */
export function claudeProvider(command = 'claude'): AiProvider {
  return {
    id: 'claude', name: 'Claude Code',
    invocation: (prompt) => ({ command, extraEnv: ['ANTHROPIC_API_KEY'], args: ['--print', '--output-format', 'text', '--tools', '', '--safe-mode', '--strict-mcp-config', '--no-session-persistence', '--permission-prompts', 'none', prompt] }),
  };
}

export function codexProvider(command = 'codex', color = false): AiProvider {
  // Only the variables Codex needs to authenticate (API-key login, custom home) are forwarded.
  return { id: 'codex', name: 'Codex CLI', invocation: (prompt) => ({ command, outputFile: true, extraEnv: ['OPENAI_API_KEY', 'CODEX_HOME'], args: ['exec', '--sandbox', 'read-only', '--skip-git-repo-check', '--ephemeral', '--ignore-user-config', '-C', WORK_DIR_PLACEHOLDER, ...(color ? ['--color', 'never'] : []), '-o', OUTPUT_FILE_PLACEHOLDER, prompt] }) };
}

export function geminiProvider(command = 'gemini', extensions = false): AiProvider {
  // Only the variables Gemini CLI documents for API-key and Vertex AI login are forwarded.
  const extraEnv = ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_CLOUD_PROJECT', 'GOOGLE_CLOUD_LOCATION', 'GOOGLE_GENAI_USE_VERTEXAI', 'GOOGLE_APPLICATION_CREDENTIALS'];
  return { id: 'gemini', name: 'Gemini CLI', invocation: (prompt) => ({ command, extraEnv, args: ['-p', prompt, '--approval-mode', 'plan', '--output-format', 'json', ...(extensions ? ['--extensions', 'none'] : [])] }) };
}

const entries = [
  { id: 'claude', name: 'Claude Code', command: 'claude', isolation: 'limited' as const, note: 'Safe mode disables customizations, but managed policy settings still apply; configuration is not isolated.', create: claudeProvider },
  // Copilot CLI 1.0.85 --help documents -p, --available-tools, --deny-tool,
  // --no-ask-user, --no-custom-instructions, --disable-builtin-mcps, --no-auto-update,
  // --no-remote, --no-color, --disallow-temp-dir and --silent, but not --config-dir.
  // --config-dir is still accepted as a hidden flag (verified 2026-11-08 with
  // `copilot --config-dir <empty tmp> --version` on 1.0.85), so isolation stays full.
  { id: 'copilot', name: 'GitHub Copilot CLI', command: 'copilot', isolation: 'full' as const, note: undefined, create: (command: string) => ({ ...copilotCliProvider(command), id: 'copilot' }) },
  // Codex CLI 0.163.0 exec --help: --sandbox read-only, --skip-git-repo-check,
  // --ephemeral and --ignore-user-config do not disable model-generated shell commands.
  { id: 'codex', name: 'Codex CLI', command: 'codex', isolation: 'limited' as const, note: 'Codex can run read-only shell commands on this machine while answering; it cannot write files.', create: codexProvider },
  // Gemini CLI 0.64.0 --help: --prompt, --output-format and --approval-mode plan;
  // the help does not document disabling all tools or isolating configuration.
  { id: 'gemini', name: 'Gemini CLI', command: 'gemini', isolation: 'limited' as const, note: 'Gemini runs in read-only plan mode; tools cannot be fully disabled.', create: geminiProvider },
  { id: 'kiro', name: 'Kiro CLI', command: 'kiro-cli', isolation: 'limited' as const, note: 'Not supported yet: offline CLI documentation was not available.' },
];

export const providerIds = entries.map((entry) => entry.id);

export async function detectUnsupportedProviders(selection: string[]): Promise<{ id: string; name: string; note: string }[]> {
  if (!selection.includes('auto') && !selection.includes('kiro')) return [];
  return await findExecutable('kiro-cli') ? [{ id: 'kiro', name: 'Kiro CLI', note: 'Not supported yet: offline CLI documentation was not available.' }] : [];
}

/** Search PATH without a shell. Empty PATH entries are ignored. */
export async function findExecutable(command: string, env = process.env, platform: NodeJS.Platform = process.platform): Promise<string | undefined> {
  const extensions = platform === 'win32' ? (path.extname(command) ? [''] : (env.PATHEXT || '.EXE;.CMD;.BAT').split(';').filter((ext) => /^\.[a-z0-9]+$/i.test(ext) && ext.toLowerCase() !== '.ps1')) : [''];
  for (const dir of (env.PATH || '').split(platform === 'win32' ? ';' : path.delimiter).filter(Boolean)) {
    for (const ext of extensions) {
      const candidate = path.resolve(dir, command + ext);
      try { await fs.access(candidate, constants.X_OK); if ((await fs.stat(candidate)).isFile()) return candidate; } catch { /* continue */ }
    }
  }
  return undefined;
}

export async function detectProviders(selection: string[]): Promise<{ info: ProviderInfo; provider: AiProvider }[]> {
  const detected = await Promise.all(entries.filter((entry) => selection.includes('auto') || selection.includes(entry.id)).map(async (entry) => {
    const command = await findExecutable(entry.id === 'copilot' ? process.env.MOCKBREW_COPILOT_BIN || entry.command : entry.command);
    if (!command || !('create' in entry) || !entry.create) return undefined;
    try {
      const launch = resolveLaunch(command);
      const { stdout } = await execFileAsync(launch.command, [...launch.args, '--version'], { timeout: 3000, maxBuffer: 16_384, windowsHide: true, env: sanitizedEnv() });
      let help = '';
      if (entry.id === 'codex' || entry.id === 'gemini' || entry.id === 'copilot') {
        try { help = (await execFileAsync(launch.command, [...launch.args, ...(entry.id === 'codex' ? ['exec', '--help'] : ['--help'])], { timeout: 3000, maxBuffer: 128_000, windowsHide: true, env: sanitizedEnv() })).stdout; } catch { /* Optional flags remain disabled. */ }
      }
      let provider = entry.id === 'codex' ? codexProvider(command, /--color\b/.test(help)) : entry.id === 'gemini' ? geminiProvider(command, /--extensions[^\n]*(?:none|no extensions)/i.test(help)) : entry.create(command);
      if (entry.id === 'copilot') {
        const base = provider;
        const optional = ['--no-custom-instructions', '--disable-builtin-mcps', '--no-ask-user', '--no-auto-update'];
        provider = { ...base, invocation: (prompt) => { const invocation = base.invocation(prompt); return { ...invocation, args: invocation.args.filter((arg) => !optional.includes(arg) || help.includes(arg)) }; } };
      }
      return { info: { id: entry.id, name: entry.name, version: stdout.trim().split('\n')[0], isolation: entry.isolation, note: entry.note }, provider };
    } catch { return undefined; }
  }));
  return detected.filter((entry): entry is NonNullable<typeof entry> => entry !== undefined);
}

/** Handle documented JSON result envelopes as well as plain and fenced JSON. */
export function parseProviderOutput(stdout: string): unknown {
  const value = extractJson(stdout);
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const envelope = value as Record<string, unknown>;
    if (typeof envelope.result === 'string' && (envelope.type === 'result' || 'is_error' in envelope)) return extractJson(envelope.result);
    if (typeof envelope.response === 'string') return extractJson(envelope.response);
  }
  return value;
}

export { copilotCliProvider };
