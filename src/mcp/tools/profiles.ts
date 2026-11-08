import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { notFound } from '../../core/errors.js';
import type { ProjectService } from '../../core/service.js';
import { guarded, text } from '../server.js';

const id = z.string().min(1).max(200);
const mutation = { readOnlyHint: false, openWorldHint: false };

export function registerProfileTools(server: McpServer, service: ProjectService): void {
  server.registerTool('list_profiles', { description: 'List profiles, their active state and stale references.', annotations: { readOnlyHint: true, openWorldHint: false } }, guarded(async () => text(service.listProfiles())));
  server.registerTool('save_profile', { description: 'Create or replace a profile with endpoint scenario selections.', inputSchema: {
    profileId: id.optional(), name: z.string().min(1).max(100), description: z.string().max(1000).optional(),
    endpoints: z.record(id, z.object({ scenarioId: id, mode: z.literal('fixed').optional() })),
    network: z.object({ latencyMs: z.number().int().min(0).max(60000).optional(), timeoutEndpoints: z.union([z.literal('all'), z.array(id).max(1000)]).optional(), timeoutMs: z.number().int().min(1).max(600000).optional() }).optional(),
  }, annotations: mutation }, guarded(async ({ profileId, ...input }) => text({ id: await service.saveProfile(input, profileId) })));
  server.registerTool('delete_profile', { description: 'Preview deletion, or delete with confirm true.', inputSchema: { profileId: id, confirm: z.boolean().optional() }, annotations: { ...mutation, destructiveHint: true } }, guarded(async ({ profileId, confirm }) => {
    const profile = service.listProfiles().profiles.find((p) => p.id === profileId);
    if (!profile) throw notFound('Profile', profileId);
    if (!confirm) return text({ deleted: false, preview: profile });
    await service.deleteProfile(profileId); return text({ deleted: true });
  }));
  server.registerTool('activate_profile', { description: 'Activate a profile.', inputSchema: { profileId: id }, annotations: mutation }, guarded(async ({ profileId }) => { await service.activateProfile(profileId); return text({ activated: true }); }));
  server.registerTool('deactivate_profile', { description: 'Restore the project scenario selections.', annotations: mutation }, guarded(async () => { await service.deactivateProfile(); return text({ deactivated: true }); }));
}
