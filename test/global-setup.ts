import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

// Parser and CLI tests run against the compiled output (the parser lives in a child process).
// Run the TypeScript compiler through the current Node executable: `npx` is `npx.cmd` on Windows
// and cannot be spawned without a shell.
export default function setup(): void {
  const require = createRequire(import.meta.url);
  const tsc = path.join(path.dirname(require.resolve('typescript/package.json')), 'bin', 'tsc');
  execFileSync(process.execPath, [tsc, '-p', 'tsconfig.json'], { stdio: 'inherit' });
}
