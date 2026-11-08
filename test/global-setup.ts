import { execFileSync } from 'node:child_process';

// Parser and CLI tests run against the compiled output (the parser lives in a child process).
export default function setup(): void {
  execFileSync('npx', ['tsc', '-p', 'tsconfig.json'], { stdio: 'inherit' });
}
