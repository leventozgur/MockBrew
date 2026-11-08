import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { invalid } from '../../core/errors.js';
import type { ProjectService } from '../../core/service.js';
import { guarded, text } from '../server.js';

export function registerDynamicTools(server: McpServer, service: ProjectService): void {
  server.registerTool('set_variables', {
    description: 'List, set, or delete plaintext project variables. Do not store secrets.',
    inputSchema: { operation: z.enum(['list', 'set', 'delete']), values: z.unknown().optional().describe('Object mapping variable names to string values.'), name: z.string().optional() },
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, guarded(async ({ operation, values, name }) => {
    if (operation === 'set') {
      if (!values) throw invalid('Values are required for set.');
      await service.setVariables(values);
    }
    if (operation === 'delete') {
      if (!name) throw invalid('A name is required for delete.');
      await service.deleteVariable(name);
    }
    return text({ variables: service.listVariables() });
  }));
}
