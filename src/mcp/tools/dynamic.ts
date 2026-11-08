import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { invalid } from '../../core/errors.js';
import type { ModelLink } from '../../core/model.js';
import type { ProjectService } from '../../core/service.js';
import { guarded, text } from '../server.js';

const id = z.string().min(1).max(200);

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

  server.registerTool('set_scenario_dynamic', {
    description: 'Turn allowlisted {{token}} substitution on or off for a scenario body and header values. Off by default.',
    inputSchema: { endpointId: id, scenarioId: id, dynamic: z.boolean() },
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, guarded(async (a) => {
    await service.setScenarioDynamic(a.endpointId, a.scenarioId, a.dynamic);
    return text({ updated: true, unknownTokens: service.validateTokens(a.endpointId, a.scenarioId)[0]?.unknownTokens ?? [] });
  }));

  server.registerTool('set_request_model', {
    description: 'Link a request schema (as returned by get_schema) to a POST/PUT/PATCH endpoint, or unlink it with model null. Non-matching bodies get the invalid-request scenario, created as "Invalid request (422)" unless invalidScenarioId names one.',
    inputSchema: { endpointId: id, model: z.unknown().describe('Model link { rootType, settings, sources, schema } or null.'), invalidScenarioId: id.optional() },
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, guarded(async (a) => {
    if (a.model !== null && (typeof a.model !== 'object' || Array.isArray(a.model))) throw invalid('"model" must be an object or null.');
    await service.setRequestModel(a.endpointId, a.model as ModelLink | null, a.invalidScenarioId);
    const endpoint = service.findEndpoint(a.endpointId);
    return text({ updated: true, requestModel: endpoint.requestModel?.rootType ?? null, invalidRequestScenarioId: endpoint.invalidRequestScenarioId ?? null });
  }));

  server.registerTool('set_scenario_file', {
    description: 'Serve a file from the project folder (inside the access root, no symbolic links, at most 50 MB) as a scenario body, or pass file null to use the inline body again. The content type comes from the file extension.',
    inputSchema: { endpointId: id, scenarioId: id, file: z.string().min(1).max(500).nullable() },
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, guarded(async (a) => {
    await service.setScenarioFile(a.endpointId, a.scenarioId, a.file);
    return text({ updated: true, file: a.file });
  }));

  server.registerTool('validate_tokens', {
    description: 'List tokens in scenario bodies and headers that are not on the allowlist; they are served as written.',
    inputSchema: { endpointId: id.optional(), scenarioId: id.optional() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, guarded(async (a) => text({ scenarios: service.validateTokens(a.endpointId, a.scenarioId) })));
}
