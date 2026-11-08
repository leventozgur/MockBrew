import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { invalid, notFound } from '../../core/errors.js';
import type { ProjectService } from '../../core/service.js';
import { guarded, text } from '../server.js';

const id = z.string().min(1).max(200);
const name = z.string().min(1).max(100);
const method = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']);
const path = z.string().min(1).max(300);
const description = z.string().max(1000);
const scenario = {
  name: name.optional(),
  statusCode: z.number().int().min(100).max(599).optional(),
  headers: z.array(z.object({ key: z.string().max(8192), value: z.string().max(8192) })).max(50).optional(),
  body: z.string().max(5_000_000).optional(),
  latencyMs: z.number().int().min(0).max(60000).optional(),
};
const readOnly = { readOnlyHint: true, openWorldHint: false };
const mutation = { readOnlyHint: false, openWorldHint: false };
const deletion = { ...mutation, destructiveHint: true };

export function registerProjectTools(server: McpServer, service: ProjectService): void {
  const collection = (collectionId: string) => {
    const found = service.model().collections.find((c) => c.id === collectionId);
    if (!found) throw notFound('Collection', collectionId);
    return found;
  };
  const findScenario = (endpointId: string, scenarioId: string) => {
    const found = service.findEndpoint(endpointId).scenarios.find((s) => s.id === scenarioId);
    if (!found) throw notFound('Scenario', scenarioId);
    return found;
  };
  const status = () => {
    const view = service.view();
    return { ...view.runtime, running: view.runtime.state === 'running', host: view.runtime.state === 'stopped' ? view.project.settings.host : view.runtime.host, port: view.runtime.state === 'stopped' ? view.project.settings.port : view.runtime.port, activeCollections: view.project.collections.filter((c) => c.active).map((c) => ({ id: c.id, name: c.name })), safeModeNotes: view.safeModeNotes, conflicts: view.conflicts, runtimeNotice: view.runtimeNotice };
  };

  server.registerTool('create_collection', { description: 'Create a collection.', inputSchema: { name }, annotations: mutation }, guarded(async (a) => text({ id: await service.createCollection(a.name) })));
  server.registerTool('update_collection', { description: 'Rename a collection.', inputSchema: { collectionId: id, name }, annotations: mutation }, guarded(async (a) => { await service.renameCollection(a.collectionId, a.name); return text({ updated: true }); }));
  server.registerTool('set_collection_active', { description: 'Enable or disable a collection.', inputSchema: { collectionId: id, active: z.boolean() }, annotations: mutation }, guarded(async (a) => { await service.setCollectionActive(a.collectionId, a.active); return text({ updated: true }); }));
  server.registerTool('delete_collection', { description: 'Preview deletion, or delete with confirm true.', inputSchema: { collectionId: id, confirm: z.boolean().optional() }, annotations: deletion }, guarded(async (a) => {
    const target = collection(a.collectionId);
    if (target.virtual) throw invalid('The virtual root collection cannot be deleted.');
    if (!a.confirm) return text({ deleted: false, preview: target });
    await service.deleteCollection(a.collectionId); return text({ deleted: true });
  }));
  server.registerTool('list_endpoints', { description: 'List endpoints, scenarios, active scenario and conflicts; optionally filter by collection.', inputSchema: { collectionId: id.optional() }, annotations: readOnly }, guarded(async (a) => {
    const view = service.view();
    const collections = a.collectionId ? [collection(a.collectionId)] : view.project.collections;
    return text({ endpoints: collections.flatMap((c) => c.endpoints.map((e) => ({ ...e, activeScenario: e.scenarios.find((s) => s.active)?.id }))), conflicts: a.collectionId ? view.conflicts.filter((c) => c.endpointIds.some((endpointId) => collections.some((col) => col.endpoints.some((e) => e.id === endpointId)))) : view.conflicts });
  }));
  server.registerTool('create_endpoint', { description: 'Create an endpoint with a default scenario.', inputSchema: { collectionId: id, method, path, description: description.optional() }, annotations: mutation }, guarded(async (a) => text({ id: await service.createEndpoint(a.collectionId, { method: a.method, path: a.path, description: a.description }) })));
  server.registerTool('update_endpoint', { description: 'Update an endpoint or move it to another collection.', inputSchema: { endpointId: id, method: method.optional(), path: path.optional(), description: description.optional(), collectionId: id.optional() }, annotations: mutation }, guarded(async ({ endpointId, ...patch }) => { await service.updateEndpoint(endpointId, patch); return text({ updated: true }); }));
  server.registerTool('delete_endpoint', { description: 'Preview deletion, or delete with confirm true.', inputSchema: { endpointId: id, confirm: z.boolean().optional() }, annotations: deletion }, guarded(async (a) => { const target = service.findEndpoint(a.endpointId); if (!a.confirm) return text({ deleted: false, preview: target }); await service.deleteEndpoint(a.endpointId); return text({ deleted: true }); }));
  server.registerTool('update_scenario', { description: 'Update a scenario; success bodies must match the linked model.', inputSchema: { endpointId: id, scenarioId: id, ...scenario }, annotations: mutation }, guarded(async ({ endpointId, scenarioId, ...patch }) => { await service.updateValidatedScenario(endpointId, scenarioId, patch); return text({ updated: true }); }));
  server.registerTool('delete_scenario', { description: 'Preview deletion, or delete with confirm true.', inputSchema: { endpointId: id, scenarioId: id, confirm: z.boolean().optional() }, annotations: deletion }, guarded(async (a) => { const target = findScenario(a.endpointId, a.scenarioId); if (!a.confirm) return text({ deleted: false, preview: target }); await service.deleteScenario(a.endpointId, a.scenarioId); return text({ deleted: true }); }));
  server.registerTool('set_active_scenario', { description: 'Select the scenario served by an endpoint.', inputSchema: { endpointId: id, scenarioId: id }, annotations: mutation }, guarded(async (a) => { await service.setActiveScenario(a.endpointId, a.scenarioId); return text({ updated: true }); }));
  server.registerTool('start_server', { description: 'Start the mock server with the existing project host and port.', annotations: mutation }, guarded(async () => { await service.start(); return text(status()); }));
  server.registerTool('stop_server', { description: 'Stop the mock server.', annotations: mutation }, guarded(async () => { await service.stop(); return text(status()); }));
  server.registerTool('server_status', { description: 'Show server state, active collections, safe mode and conflicts.', annotations: readOnly }, guarded(async () => text(status())));
  server.registerTool('get_request_logs', { description: 'Get the latest masked request logs.', inputSchema: { limit: z.number().int().min(1).max(1000).optional() }, annotations: readOnly }, guarded(async (a) => {
    const logs = service.runtime.logs().slice(-(a.limit ?? 100));
    return text({ logs: service.model().settings.logBodies ? logs : logs.map(({ requestBody: _requestBody, responseBody: _responseBody, ...entry }) => entry) });
  }));
  server.registerTool('check_models', { description: 'Check linked models and saved bodies for drift without changing the project.', annotations: readOnly }, guarded(async () => text(await service.checkModels())));
}
