import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { invalid } from '../../core/errors.js';
import { convertImport, type ImportFormat } from '../../core/import/detect.js';
import type { ProjectService } from '../../core/service.js';
import { guarded, text } from '../server.js';

const strategy = z.enum(['skip', 'rename', 'replace']);
const readOnly = { readOnlyHint: true, openWorldHint: false };
const mutation = { readOnlyHint: false, openWorldHint: false };

const FORMATS: readonly ImportFormat[] = ['auto', 'bundle', 'postman', 'openapi', 'har', 'curl'];

/** Converts any supported import format into bundle JSON text plus converter warnings. */
export function convertTransfer(content: string, format: string): { bundle: string; warnings: string[] } {
  if (!FORMATS.includes(format as ImportFormat)) throw invalid(`Unknown import format "${format}". Use one of: ${FORMATS.join(', ')}.`);
  if (format === 'bundle') return { bundle: content, warnings: [] };
  const converted = convertImport(content, format as ImportFormat);
  return { bundle: JSON.stringify(converted.bundle), warnings: converted.warnings };
}

export function transferPreviews(service: ProjectService) {
  const previews = new Map<string, string>();
  return {
    async preview(content: string, format: string) {
      const { bundle, warnings } = convertTransfer(content, format);
      const result = service.previewBundle(bundle);
      if (previews.size >= 20) previews.delete(previews.keys().next().value!);
      previews.set(result.hash, bundle);
      return { ...result, warnings: [...warnings, ...((result as { warnings?: string[] }).warnings ?? [])] };
    },
    async apply(hash: string, onConflict: 'skip' | 'rename' | 'replace', variables: 'keep' | 'overwrite' | 'skip' = 'keep') {
      const content = previews.get(hash);
      if (!content) throw invalid('Import preview was not found. Preview again.');
      await service.applyBundle(content, hash, onConflict, variables);
      previews.delete(hash);
    },
  };
}

export function registerTransferTools(server: McpServer, service: ProjectService): void {
  const imports = transferPreviews(service);
  server.registerTool('preview_import', { description: 'Preview an import before applying it.', inputSchema: { content: z.string().max(20_000_000), format: z.enum(['auto', 'bundle', 'postman', 'openapi', 'har', 'curl']).describe('auto detects bundle, Postman v2.1, OpenAPI 3 JSON, HAR 1.2 or a cURL command') }, annotations: readOnly }, guarded(async (a) => text(await imports.preview(a.content, a.format))));
  server.registerTool('apply_import', { description: 'Apply a reviewed import using its preview hash.', inputSchema: { previewHash: z.string().min(1), onConflict: strategy, variables: z.enum(['keep', 'overwrite', 'skip']).optional() }, annotations: mutation }, guarded(async (a) => { await imports.apply(a.previewHash, a.onConflict, a.variables); return text({ applied: true }); }));
  server.registerTool('export_bundle', { description: 'Export project collections as bundle JSON.', inputSchema: { collections: z.array(z.string()).optional() }, annotations: readOnly }, guarded(async (a) => text(JSON.stringify(service.exportBundle(a.collections), null, 2))));
  server.registerTool('start_recording', { description: 'Start transient recording while the proxy is running.', annotations: mutation }, guarded(async () => { service.runtime.startRecording(); return text(service.runtime.listRecordings()); }));
  server.registerTool('stop_recording', { description: 'Stop recording.', annotations: mutation }, guarded(async () => { service.runtime.stopRecording(); return text(service.runtime.listRecordings()); }));
  server.registerTool('list_recordings', { description: 'List transient recorded responses, which may contain sensitive data.', annotations: readOnly }, guarded(async () => text(service.runtime.listRecordings())));
  server.registerTool('preview_recordings', { description: 'Preview recordings as endpoints and scenarios.', inputSchema: { ids: z.array(z.number().int()).min(1).max(500), collection: z.string(), pathOverrides: z.record(z.string(), z.string()).optional() }, annotations: readOnly }, guarded(async (a) => text(service.previewRecordings(a.ids, a.collection, a.pathOverrides))));
  server.registerTool('save_recordings', { description: 'Save reviewed recordings using the preview hash.', inputSchema: { previewHash: z.string().min(1), onConflict: strategy }, annotations: mutation }, guarded(async (a) => { await service.saveRecordings(a.previewHash, a.onConflict); return text({ saved: true }); }));
}
