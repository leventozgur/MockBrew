import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { resolveLaunch } from '../src/core/launch.js';
import { findExecutable } from '../src/ai/registry.js';

it('resolves npm cmd-shim node targets without a shell and refuses unknown batch files', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'mockbrew-shim-'));
  try {
    const target = path.join(dir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, '');
    const shim = path.join(dir, 'codex.cmd');
    writeFileSync(shim, `@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\nIF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n) ELSE (\r\n  SET "_prog=node"\r\n  SET PATHEXT=%PATHEXT:;.JS;=;%\r\n)\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n`);
    expect(resolveLaunch(shim, 'win32')).toEqual({ command: process.execPath, args: [target] });
    expect(resolveLaunch(shim, 'linux')).toEqual({ command: shim, args: [] });
    writeFileSync(shim, '@ECHO off\r\necho unsafe\r\n');
    expect(() => resolveLaunch(shim, 'win32')).toThrow('cannot run safely');
    expect(() => resolveLaunch(path.join(dir, 'other.ps1'), 'win32')).toThrow('cannot run safely');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it('honours Windows PATHEXT ordering and ignores PowerShell', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'mockbrew-path-'));
  try {
    writeFileSync(path.join(dir, 'tool.CMD'), '', { mode: 0o755 });
    writeFileSync(path.join(dir, 'tool.EXE'), '', { mode: 0o755 });
    expect(await findExecutable('tool', { PATH: dir, PATHEXT: '.PS1;.CMD;.EXE' }, 'win32')).toBe(path.join(dir, 'tool.CMD'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
