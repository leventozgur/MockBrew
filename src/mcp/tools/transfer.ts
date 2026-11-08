import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { invalid } from '../../core/errors.js';
import type { ProjectService } from '../../core/service.js';
import { guarded, text } from '../server.js';

const strategy = z.enum(['skip', 'rename', 'replace']);
const readOnly = { readOnlyHint: true, openWorldHint: false };
const mutation = { readOnlyHint: false, openWorldHint: false };

/** Optional converter integration: import/index.js may export convertImport(content, format). */
export async function convertTransfer(content: string, format: string): Promise<string> {
  if (format === 'bundle') return content;
  const modulePath = '../../core/import/index.js';
  let module: { convertImport?: (content: string, format: string) => unknown };
  try { module = await import(modulePath) as typeof module; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND' && (error as Error).message.includes('/core/import/index.js')) throw invalid('Import format is not available.');
    throw error;
  }
  if (typeof module.convertImport !== 'function') throw invalid('Import format is not available.');
  const converted = await module.convertImport(content, format);
  return typeof converted === 'string' ? converted : JSON.stringify(converted);
}

export function transferPreviews(service: ProjectService) {
  const previews = new Map<string, string>();
  return {
    async preview(content: string, format: string) {
      const bundle = await convertTransfer(content, format);
      const result = service.previewBundle(bundle);
      if (previews.size >= 20) previews.delete(previews.keys().next().value!);
      previews.set(result.hash, bundle);
      return result;
    },
    async apply(hash: string, onConflict: 'skip' | 'rename' | 'replace') {
      const content = previews.get(hash);
      if (!content) throw invalid('Import preview was not found. Preview again.');
      await service.applyBundle(content, hash, onConflict);
      previews.delete(hash);
    },
  };
}

export function registerTransferTools(server: McpServer, service: ProjectService): void {
  const imports = transferPreviews(service);
  server.registerTool('preview_import', { description: 'Preview an import before applying it.', inputSchema: { content: z.string().max(20_000_000), format: z.string().min(1) }, annotations: readOnly }, guarded(async (a) => text(await imports.preview(a.content, a.format))));
  server.registerTool('apply_import', { description: 'Apply a reviewed import using its preview hash.', inputSchema: { previewHash: z.string().min(1), onConflict: strategy }, annotations: mutation }, guarded(async (a) => { await imports.apply(a.previewHash, a.onConflict); return text({ applied: true }); }));
  server.registerTool('export_bundle', { description: 'Export project collections as bundle JSON.', inputSchema: { collections: z.array(z.string()).optional() }, annotations: readOnly }, guarded(async (a) => text(JSON.stringify(service.exportBundle(a.collections), null, 2))));
  server.registerTool('start_recording', { description: 'Start transient recording while the proxy is running.', annotations: mutation }, guarded(async () => { service.runtime.startRecording(); return text(service.runtime.listRecordings()); }));
  server.registerTool('stop_recording', { description: 'Stop recording.', annotations: mutation }, guarded(async () => { service.runtime.stopRecording(); return text(service.runtime.listRecordings()); }));
  server.registerTool('list_recordings', { description: 'List transient recorded responses, which may contain sensitive data.', annotations: readOnly }, guarded(async () => text(service.runtime.listRecordings())));
  server.registerTool('preview_recordings', { description: 'Preview recordings as endpoints and scenarios.', inputSchema: { ids: z.array(z.number().int()).min(1).max(500), collection: z.string(), pathOverrides: z.record(z.string(), z.string()).optional() }, annotations: readOnly }, guarded(async (a) => text(service.previewRecordings(a.ids, a.collection, a.pathOverrides))));
  server.registerTool('save_recordings', { description: 'Save reviewed recordings using the preview hash.', inputSchema: { previewHash: z.string().min(1), onConflict: strategy }, annotations: mutation }, guarded(async (a) => { await service.saveRecordings(a.previewHash, a.onConflict); return text({ saved: true }); }));
}
