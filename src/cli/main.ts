#!/usr/bin/env node
import { isSea } from '../core/runtime-env.js';
import { setFlagsFromString } from 'node:v8';
import { StudioError } from '../core/errors.js';
import { shutdownParser } from '../parser/index.js';
import { UsageError, consoleIo, packageVersion } from './common.js';
import { doctorCommand, doctorHelp } from './commands/doctor.js';
import { checkCommand, checkHelp } from './commands/check.js';
import { exportCommand, exportHelp } from './commands/export.js';
import { generateCommand, generateHelp } from './commands/generate.js';
import { initCommand, initHelp } from './commands/init.js';
import { importCommand, importHelp } from './commands/import.js';
import { mcpCommand, mcpHelp } from './commands/mcp.js';
import { profilesCommand, profilesHelp } from './commands/profiles.js';
import { serveCommand, serveHelp } from './commands/serve.js';
import { snippetsCommand, snippetsHelp } from './commands/snippets.js';
import { uiCommand, uiHelp } from './commands/ui.js';

const MIN_NODE = [22, 12];

const mainHelp = `mockbrew - offline mock API studio for Android, iOS and Kotlin Multiplatform

Usage: mockbrew <command> [options]

Commands:
  doctor     Diagnose the installation and project
  init       Create a project
  ui         Start the local web UI
  serve      Run a project's mocks without the UI
  profiles   List test profiles (profiles list)
  generate   Create a JSON body from Kotlin/Swift models
  check      Compare linked models and saved bodies with the current source code
  import     Import a bundle, Postman, OpenAPI, HAR or cURL file
  export     Write a bundle, Postman collection or OpenAPI document
  snippets   Debug network setup for emulators, simulators and devices
  mcp        Start the MCP server (stdio) for Kiro / Copilot

Run "mockbrew <command> --help" for details.`;

const helps: Record<string, string> = {
  doctor: doctorHelp,
  init: initHelp,
  ui: uiHelp,
  serve: serveHelp,
  profiles: profilesHelp,
  generate: generateHelp,
  check: checkHelp,
  export: exportHelp,
  import: importHelp,
  snippets: snippetsHelp,
  mcp: mcpHelp,
};

function checkNode(): void {
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  if (major < MIN_NODE[0]! || (major === MIN_NODE[0] && minor < MIN_NODE[1]!)) {
    throw new UsageError(`Node.js ${MIN_NODE.join('.')} or newer is required (found ${process.versions.node}). Install a current LTS from https://nodejs.org.`);
  }
}

async function run(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  if (!command || command === '--help' || command === '-h' || command === 'help') {
    consoleIo.out(mainHelp);
    return;
  }
  if (command === '--version' || command === '-v') {
    consoleIo.out(packageVersion());
    return;
  }
  if (rest.includes('--help') || rest.includes('-h')) {
    const text = helps[command];
    if (!text) throw new UsageError(`Unknown command "${command}".`);
    consoleIo.out(text);
    return;
  }
  checkNode();
  switch (command) {
    case 'doctor':
      return doctorCommand(rest, consoleIo);
    case 'init':
      return initCommand(rest, consoleIo);
    case 'ui':
      return uiCommand(rest, consoleIo);
    case 'serve':
      return serveCommand(rest, consoleIo);
    case 'profiles':
      return profilesCommand(rest, consoleIo);
    case 'generate':
      return generateCommand(rest, consoleIo);
    case 'check':
      return checkCommand(rest, consoleIo);
    case 'export':
      return exportCommand(rest, consoleIo);
    case 'import':
      return importCommand(rest, consoleIo);
    case 'snippets':
      return snippetsCommand(rest, consoleIo);
    case 'mcp':
      return mcpCommand(rest);
    default:
      throw new UsageError(`Unknown command "${command}". Run "mockbrew --help".`);
  }
}

try {
  if (isSea() && process.env.MOCKBREW_SEA_WORKER === '1' && process.send) {
    setFlagsFromString('--liftoff-only --no-wasm-tier-up --no-wasm-dynamic-tiering');
    await import('../parser/worker.js');
  } else {
    await run(process.argv.slice(2));
  }
  shutdownParser();
} catch (error) {
  shutdownParser();
  if (error instanceof UsageError || error instanceof StudioError) {
    consoleIo.err(`Error: ${error.message}`);
    process.exitCode = error instanceof UsageError ? 2 : 1;
  } else if ((error as { code?: string }).code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION' || (error as { code?: string }).code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE') {
    consoleIo.err(`Error: ${(error as Error).message}`);
    process.exitCode = 2;
  } else {
    consoleIo.err(`Error: ${(error as Error).message}`);
    if (process.env.MOCKBREW_DEBUG) consoleIo.err((error as Error).stack ?? '');
    process.exitCode = 1;
  }
}
