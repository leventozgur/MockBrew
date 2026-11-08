import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectService } from '../src/core/service.js';
import { parseBundle, MAX_IMPORT_BYTES } from '../src/core/import/bundle.js';
import { exportPostman } from '../src/core/import/postman-export.js';

const dirs: string[] = [];
const services: ProjectService[] = [];
async function project() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mockbrew-transfer-'));
  dirs.push(dir);
  const service = await ProjectService.init(dir, 'Synthetic');
  services.push(service);
  return service;
}
afterEach(async () => {
  for (const s of services.splice(0)) await s.close();
  for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true });
});

describe('bundle transfer', () => {
  it('round trips scenarios, rules and modes with fresh IDs', async () => {
    const source = await project();
    const collection = await source.createCollection('Example');
    const endpoint = await source.createEndpoint(collection, { method: 'GET', path: '/items/:id', scenarios: [{ name: 'OK', body: '{"id":1}' }, { name: 'Missing', statusCode: 404, body: '{}' }] });
    const scenarios = source.findEndpoint(endpoint).scenarios;
    await source.setScenarioRules(endpoint, scenarios[1]!.id, [{ target: 'query', modifier: 'missing', value: 'yes', operator: 'equals', invert: false }], 'AND');
    const bundle = source.exportBundle();
    const target = await project();
    const content = JSON.stringify(bundle);
    await target.applyBundle(content, target.previewBundle(content).hash, 'skip');
    expect(target.exportBundle().collections).toEqual(bundle.collections);
    expect(target.model().collections[0]!.endpoints[0]!.id).not.toBe(endpoint);
    const postman = exportPostman(bundle, 'Example', 'http://localhost:3000') as any;
    expect(postman.item[0].item[0].response).toHaveLength(2);
  });
  it('transfers dynamic templates, file links, request models and variables', async () => {
    const source = await project();
    const c = await source.createCollection('Example');
    const id = await source.createEndpoint(c, { method: 'POST', path: '/items', scenarios: [{ name: 'OK', body: '{}' }, { name: 'Invalid', statusCode: 422, body: '{}' }] });
    const [ok, invalid] = source.findEndpoint(id).scenarios;
    await source.setScenarioDynamic(id, ok!.id, true);
    await source.updateScenario(id, ok!.id, { body: '{"item":{{json request.body.$.item}}}' });
    await fs.writeFile(path.join(path.dirname(source.projectFile), 'sample.txt'), 'example');
    await source.setScenarioFile(id, invalid!.id, 'sample.txt');
    await source.setRequestModel(id, { rootType: 'Item', settings: { naming: 'identity', dateFormat: 'iso8601' }, sources: [], schema: { type: 'object' } }, invalid!.id);
    await source.setVariables({ shared: 'source', added: 'yes' });
    const content = JSON.stringify(source.exportBundle());
    const target = await project();
    await target.setVariables({ shared: 'target' });
    const preview = target.previewBundle(content);
    expect(preview.warnings).toEqual([expect.stringContaining('File missing: sample.txt')]);
    await target.applyBundle(content, preview.hash, 'skip');
    expect(target.listVariables()).toEqual({ shared: 'target', added: 'yes' });
    expect(target.exportBundle().collections).toEqual(source.exportBundle().collections);
    const ep = target.model().collections[0]!.endpoints[0]!;
    expect(ep.invalidRequestScenarioId).toBe(ep.scenarios[1]!.id);
    const postman = exportPostman(target.exportBundle(), 'Example', 'http://localhost') as any;
    expect(postman.item[0].item[0].response[0].description).toContain('dynamic');
    expect(postman.item[0].item[0].response[1].body).toBeUndefined();
    expect(postman.item[0].item[0].response[1].description).toContain('file');
    const second = await project();
    await second.setVariables({ shared: 'target' });
    await second.applyBundle(content, second.previewBundle(content).hash, 'skip', 'overwrite');
    expect(second.listVariables().shared).toBe('source');
    const third = await project();
    await third.applyBundle(content, third.previewBundle(content).hash, 'skip', 'skip');
    expect(third.listVariables()).toEqual({});
    const bad = source.exportBundle();
    bad.collections[0]!.endpoints[0]!.scenarios[0]!.dynamic = false;
    expect(() => parseBundle(JSON.stringify(bad))).toThrow(/valid JSON/);
  });
  it('rejects malformed, oversized and templated rules without changing the project', async () => {
    const target = await project();
    const before = JSON.stringify(target.model());
    expect(() => target.previewBundle('{')).toThrow();
    expect(() => parseBundle(' '.repeat(MAX_IMPORT_BYTES + 1))).toThrow();
    const bad = { format: 'mockbrew/bundle', version: 1, exportedAt: new Date().toISOString(), collections: [{ name: 'Test', endpoints: [{ method: 'GET', path: '/test', description: '', responseMode: 'rules', scenarios: [{ name: 'OK', statusCode: 200, headers: [], body: '{}', latencyMs: 0, rules: [{ target: 'query', modifier: 'x', value: '{{unsafe}}', operator: 'equals', invert: false }], rulesOperator: 'AND', default: true }] }] }] };
    expect(() => target.previewBundle(JSON.stringify(bad))).toThrow();
    expect(JSON.stringify(target.model())).toBe(before);
  });
  it('skips or replaces collisions and rejects a stale preview', async () => {
    const source = await project();
    const c = await source.createCollection('Example');
    await source.createEndpoint(c, { method: 'GET', path: '/items', scenarios: [{ name: 'New', body: '{}' }] });
    const content = JSON.stringify(source.exportBundle());
    const target = await project();
    const tc = await target.createCollection('Example');
    await target.createEndpoint(tc, { method: 'GET', path: '/items', scenarios: [{ name: 'Old', body: '{}' }] });
    let preview = target.previewBundle(content);
    expect(preview.conflicts).toHaveLength(1);
    await target.applyBundle(content, preview.hash, 'skip');
    expect(target.model().collections[0]!.endpoints[0]!.scenarios[0]!.name).toBe('Old');
    await expect(target.applyBundle(content, preview.hash, 'replace')).rejects.toThrow(/stale/i);
    preview = target.previewBundle(content);
    await target.applyBundle(content, preview.hash, 'replace');
    expect(target.model().collections[0]!.endpoints[0]!.scenarios[0]!.name).toBe('New');
  });
});
