import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ProjectService } from '../../core/service.js';
import { guarded, text } from '../server.js';

export function registerModelTools(server: McpServer, service: ProjectService): void {
  const id = z.string().min(1).max(200);
  server.registerTool('preview_model_update', { description: 'Preview updates to model-linked success scenarios.', inputSchema: { endpointId: id.optional(), fillOptional: z.boolean().optional() }, annotations: { readOnlyHint: true, openWorldHint: false } }, guarded(async (args) => text(await service.previewModelUpdate(args.endpointId, args.fillOptional))));
  server.registerTool('apply_model_update', { description: 'Apply selected scenarios from a matching model update preview.', inputSchema: { selection: z.array(z.object({ endpointId: id, scenarioIds: z.array(id).min(1) })).min(1), previewHash: z.string().min(1) }, annotations: { readOnlyHint: false, openWorldHint: false } }, guarded(async (args) => { await service.applyModelUpdate(args.selection, args.previewHash); return text({ updated: true }); }));
}
