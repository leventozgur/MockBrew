import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { updateModelBody } from '../src/core/model-update.js';
import { ProjectService } from '../src/core/service.js';
import { shutdownParser } from '../src/parser/index.js';
import { validateBody } from '../src/schema/index.js';

afterAll(() => shutdownParser());

describe('model body updates', () => {
  it('merges nested arrays, preserves raw integers and produces valid JSON', () => {
    const old = { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' }, removed: { type: 'string' }, state: { type: 'string', enum: ['OLD', 'OK'] }, note: { type: ['string', 'null'] }, items: { type: 'array', items: { type: 'object', properties: { price: { type: 'number' }, label: { type: 'string' } } } } } };
    const next = { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' }, state: { type: 'string', enum: ['NEW'] }, note: { type: 'string' }, email: { type: 'string' }, items: { type: 'array', items: { type: 'object', properties: { price: { type: 'string' }, label: { type: 'string' }, count: { type: 'integer' } }, required: ['price', 'label', 'count'] } } }, required: ['id', 'name', 'state', 'note', 'email', 'items'] };
    const raw = '{"id":9223372036854775807,"name":"Manual","removed":"x","state":"OLD","note":null,"items":[{"price":2,"label":"one"},{"price":3,"label":"two"}]}';
    const result = updateModelBody(old, next, raw, { seed: 42 });
    expect(result).toEqual(updateModelBody(old, next, raw, { seed: 42 }));
    expect(result.body).toContain('9223372036854775807');
    const value = JSON.parse(result.body);
    expect(value).toMatchObject({ name: 'Manual', state: 'NEW', items: [{ label: 'one' }, { label: 'two' }] });
    expect(value).not.toHaveProperty('removed');
    expect(value.email).toContain('@example.com');
    expect(result.changes).toEqual(expect.arrayContaining([{ kind: 'removed', path: '$.removed' }, { kind: 'regenerated', path: '$.state' }, { kind: 'regenerated', path: '$.note' }, { kind: 'added', path: '$.items[1].count' }]));
    expect(validateBody(next, result.body).valid).toBe(true);
  });
  it('keeps the indentation style of a pretty-printed body', () => {
    const old = { type: 'object', properties: { id: { type: 'integer' } } };
    const next = { type: 'object', properties: { id: { type: 'integer' }, tags: { type: 'array', items: { type: 'string' } } }, required: ['id', 'tags'] };
    const result = updateModelBody(old, next, '{\n    "id": 9007199254740993\n}', { seed: 1 });
    expect(result.body.startsWith('{\n    "id": 9007199254740993,\n    "tags": ')).toBe(true);
    expect(result.body.endsWith('\n}')).toBe(true);
    expect(updateModelBody(old, next, '{"id":1}').body).not.toContain('\n');
  });
  it('optionally fills new optional fields', () => {
    const old = { type: 'object', properties: {} };
    const next = { type: 'object', properties: { email: { type: 'string' } } };
    expect(JSON.parse(updateModelBody(old, next, '{}').body)).toEqual({});
    expect(JSON.parse(updateModelBody(old, next, '{}', { fillOptional: true }).body)).toHaveProperty('email');
  });
  it('previews and applies only selected success bodies, rejecting stale hashes', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'model-update-'));
    const modelFile = path.join(dir, 'M.kt');
    await fs.writeFile(modelFile, 'data class M(val name: String)');
    const service = await ProjectService.init(path.join(dir, 'mocks'), 'Shop', { root: dir });
    try {
      const built = await service.models.schema({ paths: ['M.kt'] }, 'M');
      const created = await service.upsertScenario({ collection: 'A', method: 'GET', path: '/a', scenarioName: 'empty', body: '' });
      await service.upsertScenario({ collection: 'A', method: 'GET', path: '/a', scenarioName: 'ok', body: '{"name":"manual"}' });
      await service.setEndpointModel(created.endpointId, { rootType: 'M', settings: built.settings, sources: built.sources, schema: built.schema });
      await service.upsertScenario({ collection: 'A', method: 'GET', path: '/a', scenarioName: 'error', statusCode: 500, body: '{"error":"x"}' });

      await fs.writeFile(modelFile, 'data class M(val name: String, val email: String)');
      const preview = await service.previewModelUpdate();
      const endpoint = preview.endpoints[0]!;
      expect(endpoint.scenarios).toHaveLength(2);
      expect(endpoint.scenarios.find((s) => s.scenario === 'empty')?.skipped).toBeTruthy();
      const selected = [{ endpointId: endpoint.endpointId, scenarioIds: [endpoint.scenarios.find((s) => s.scenario === 'ok')!.scenarioId] }];
      await expect(service.applyModelUpdate(selected, 'bad')).rejects.toThrow();
      await fs.writeFile(modelFile, 'data class M(val name: String, val email: String, val age: Int)');
      await expect(service.applyModelUpdate(selected, preview.hash)).rejects.toMatchObject({ code: 'STALE' });
      await fs.writeFile(modelFile, 'data class M(val name: String, val email: String)');
      const fresh = await service.previewModelUpdate();
      await service.applyModelUpdate(selected, fresh.hash);
      const saved = service.findEndpoint(endpoint.endpointId);
      expect(JSON.parse(saved.scenarios.find((s) => s.name === 'ok')!.body)).toMatchObject({ name: 'manual', email: expect.any(String) });
      expect(saved.scenarios.find((s) => s.name === 'error')!.body).toBe('{"error":"x"}');
      expect(saved.scenarios.find((s) => s.name === 'empty')!.body).toBe('');
      await expect(service.applyModelUpdate(selected, fresh.hash)).rejects.toThrow();
      await fs.writeFile(modelFile, 'data class M(val name: String, val email: String, val age: Int)');
      const cli = path.resolve('dist/cli/main.js');
      const args = [cli, 'check', '-p', path.join(dir, 'mocks'), '--root', dir, '--fix'];
      const before = spawnSync('node', args, { encoding: 'utf8' });
      expect(before.status).toBe(1);
      expect(before.stdout).toContain('added $.age');
      const applied = spawnSync('node', [...args, '--yes'], { encoding: 'utf8' });
      expect(applied.status).toBe(1);
    } finally { await service.close(); await fs.rm(dir, { recursive: true, force: true }); }
  });
});
