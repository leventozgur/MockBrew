import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { ProjectService } from '../src/core/service.js';

it('validates, persists and deletes project variables without changing schema version', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mockbrew-variables-'));
  let service: ProjectService | undefined;
  try {
    service = await ProjectService.init(dir, 'Variables');
    await service.setVariables(JSON.parse('{"base":"hello","_count":"1","__proto__":"own"}'));
    await expect(service.setVariables({ 'bad-name': 'x' })).rejects.toThrow();
    await expect(service.setVariables({ big: 'é'.repeat(1025) })).rejects.toThrow();
    await expect(service.setVariables(Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`v${i}`, 'x'])))).rejects.toThrow();
    const stored = JSON.parse(await fs.readFile(service.projectFile, 'utf8'));
    expect(stored.schemaVersion).toBe(2);
    expect(stored.variables).toEqual(JSON.parse('{"base":"hello","_count":"1","__proto__":"own"}'));
    await service.close();
    service = await ProjectService.open(dir);
    expect(service.listVariables()).toEqual(JSON.parse('{"base":"hello","_count":"1","__proto__":"own"}'));
    await service.deleteVariable('base');
    expect(service.listVariables()).toEqual(JSON.parse('{"_count":"1","__proto__":"own"}'));
  } finally {
    await service?.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
