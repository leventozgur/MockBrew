import { promises as fs } from 'node:fs';
import path from 'node:path';

/** A synthetic executable using the same node shim shape as npm on Windows. */
export async function fakeExecutable(file: string, code: string): Promise<string> {
  if (process.platform !== 'win32') {
    await fs.writeFile(file, `#!${process.execPath}\n${code}\n`, { mode: 0o755 });
    return file;
  }
  const js = `${file}.cjs`;
  await fs.writeFile(js, code);
  const shim = `${file}.cmd`;
  await fs.writeFile(shim, `@ECHO off\r\nSETLOCAL\r\nSET "_prog=node"\r\n"%_prog%" "%dp0%\\${path.basename(js)}" %*\r\n`);
  return shim;
}
