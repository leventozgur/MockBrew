import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { parseArgs } from 'node:util';
import { createMcpServer } from '../../mcp/server.js';
import { openProject, packageVersion } from '../common.js';

export const mcpHelp = `mockbrew mcp [--project <path>] [--root <dir>]

Starts the MCP server on stdio for Kiro, GitHub Copilot and other MCP clients. The tools only parse
model code, validate bodies and save scenarios into the project; there is no shell or arbitrary file access.

Options:
  -p, --project <path>  Project folder or file (default: ./ or ./mocks)
      --root <dir>      Folder model files may be read from, e.g. the repository root
                        (default: the project folder). Nothing outside it is read.`;

export async function mcpCommand(argv: string[]): Promise<void> {
  const { values } = parseArgs({ args: argv, options: { project: { type: 'string', short: 'p' }, root: { type: 'string' } } });
  // stdout carries the protocol; diagnostics must go to stderr.
  const service = await openProject(values.project, { watch: true, root: values.root });
  const server = createMcpServer(service, packageVersion());
  const closed = new Promise<void>((resolve) => {
    server.server.onclose = () => resolve();
    process.stdin.once('end', () => resolve());
    process.once('SIGINT', () => resolve());
    process.once('SIGTERM', () => resolve());
  });
  await server.connect(new StdioServerTransport());
  await closed;
  await server.close().catch(() => undefined);
  await service.close();
}
