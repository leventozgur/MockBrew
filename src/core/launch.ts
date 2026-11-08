import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/** Resolve npm's Windows node shim without ever interpreting batch commands. */
export function resolveLaunch(executablePath: string, platform: NodeJS.Platform = process.platform): { command: string; args: string[] } {
  if (platform !== 'win32') return { command: executablePath, args: [] };
  const ext = path.extname(executablePath).toLowerCase();
  if (!ext || ext === '.exe') return { command: executablePath, args: [] };
  const refuse = () => { throw new Error(`${path.basename(executablePath)} is a batch file that MockBrew cannot run safely; install the CLI's native executable`); };
  if (ext !== '.cmd' && ext !== '.bat') return refuse();
  try {
    const text = readFileSync(executablePath, 'utf8');
    // cmd-shim emits either a direct node invocation or a %_prog% invocation.
    const lines = text.split(/\r?\n/);
    const calls = lines.map((line) => /(?:^|&\s*)"(%_prog%|%dp0%\\node(?:\.exe)?|[A-Za-z]:\\[^"\r\n]*\\node\.exe)"\s+"%dp0%\\([^"%\r\n]+\.(?:js|cjs|mjs))"\s+%\*\s*$/i.exec(line)).filter((m): m is RegExpExecArray => m !== null);
    if (!/^@ECHO off\s*$/im.test(text) || calls.length === 0 || !(/^[A-Za-z]:\\.*\\node\.exe$/i.test(calls[0]![1]!) || /(?:SET\s+"?_prog=(?:node|%dp0%\\node(?:\.exe)?)"?\s*$|"%dp0%\\node(?:\.exe)?")/im.test(text))) return refuse();
    const targets = new Set(calls.map((m) => m[2]!.toLowerCase()));
    if (targets.size !== 1 || /[&|<>^]/.test(calls[0]![2]!)) return refuse();
    const target = path.resolve(path.dirname(executablePath), ...calls[0]![2]!.split('\\'));
    if (!statSync(target).isFile()) return refuse();
    const runner = calls[0]![1]!;
    const command = /^[A-Za-z]:\\.*\\node\.exe$/i.test(runner) ? runner : process.execPath;
    return { command, args: [target] };
  } catch { return refuse(); }
}
