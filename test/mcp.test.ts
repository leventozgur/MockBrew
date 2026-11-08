import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectService } from '../src/core/service.js';

const cli = path.resolve('dist/cli/main.js');
let dir: string;
let client: Client;

async function connect(extraArgs: string[] = []): Promise<void> {
  const transport = new StdioClientTransport({ command: 'node', args: [cli, 'mcp', '-p', path.join(dir, 'mocks'), '--root', dir, ...extraArgs], cwd: dir, stderr: 'ignore' });
  client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(transport);
}

async function call(name: string, args: Record<string, unknown> = {}) {
  const result = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { type: string; text: string }[] };
  const text = result.content[0]?.text ?? '';
  return { isError: result.isError === true, text, json: () => JSON.parse(text) };
}

async function studioText(): Promise<string> {
  return fs.readFile(path.join(dir, 'mocks/shop.studio.json'), 'utf8');
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mock-studio-mcp-'));
  await fs.cp(path.resolve('test/fixtures'), path.join(dir, 'models'), { recursive: true });
  const service = await ProjectService.init(path.join(dir, 'mocks'), 'Shop', { port: 38777 });
  await service.close();
  await connect();
});

afterEach(async () => {
  await client.close();
  await fs.rm(dir, { recursive: true, force: true });
});

describe('MCP server', () => {
  it('offers only narrow tools: no shell and no arbitrary file access', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['generate_sample', 'get_schema', 'list_collections', 'parse_model', 'save_scenario', 'validate_body']);
    expect(client.getInstructions()).toContain('parse_model');
    const save = tools.find((t) => t.name === 'save_scenario');
    expect(save?.annotations?.destructiveHint).toBe(false);
  });

  it('turns "use this model" into a validated scenario saved to the project file', async () => {
    const parsed = (await call('parse_model', { paths: ['models/kotlin/Generic.kt'] })).json();
    expect(parsed.types.map((t: { name: string }) => t.name)).toEqual(expect.arrayContaining(['BaseResponse', 'Product']));

    const schema = (await call('get_schema', { paths: ['models/kotlin/Generic.kt'], type: 'BaseResponse<Product>', naming: 'snake_case' })).json();
    expect(schema.schema.$defs).toHaveProperty('BaseResponse_Product');

    const sample = (await call('generate_sample', { paths: ['models/kotlin/Generic.kt'], type: 'BaseResponse<Product>', seed: 1 })).json();
    expect(sample.body.data).toHaveProperty('title');

    const body = JSON.stringify({ data: { id: 5, title: 'Blue mug', price: 12.5, tags: ['kitchen'] }, code: 0, message: null });
    const saved = await call('save_scenario', {
      collection: 'Catalog',
      method: 'GET',
      path: '/products/:id',
      scenarioName: 'Success',
      body,
      type: 'BaseResponse<Product>',
      paths: ['models/kotlin/Generic.kt'],
    });
    expect(saved.isError).toBe(false);
    expect(saved.json()).toMatchObject({ saved: true, created: true, validatedAgainst: 'BaseResponse<Product>' });

    const studio = JSON.parse(await studioText());
    const link = Object.values(studio.endpoints)[0] as { model: { rootType: string; sources: string[] } };
    expect(link.model.rootType).toBe('BaseResponse<Product>');
    // recorded relative to the project folder (mocks/), which sits next to models/
    expect(link.model.sources).toEqual(['../models/kotlin/Generic.kt']);
    const env = JSON.parse(await fs.readFile(path.join(dir, 'mocks/shop.environment.json'), 'utf8'));
    expect(env.routes[0].responses[0].body).toBe(body);

    const listing = (await call('list_collections')).json();
    expect(listing.collections[0]).toMatchObject({ name: 'Catalog', endpoints: [{ method: 'GET', path: '/products/:id', model: 'BaseResponse<Product>' }] });
  });

  it('refuses bodies that are not JSON or do not match the model, saving nothing', async () => {
    const before = await studioText();
    const common = { collection: 'Catalog', method: 'GET', path: '/products/:id', type: 'Product', paths: ['models/kotlin/Generic.kt'] };
    const syntax = await call('save_scenario', { ...common, body: '{oops' });
    expect(syntax.isError).toBe(true);
    expect(syntax.text).toContain('does not match');
    const shape = await call('save_scenario', { ...common, body: '{"id":"x","title":3}' });
    expect(shape.isError).toBe(true);
    expect(shape.text).toContain('$.id');
    expect(await studioText()).toBe(before);
    expect((await call('list_collections')).json().collections).toEqual([]);
  });

  it('keeps an endpoint that is linked to a model consistent with it', async () => {
    const good = JSON.stringify({ id: 1, title: 'a', price: 1, tags: [] });
    await call('save_scenario', { collection: 'C', method: 'GET', path: '/p', body: good, type: 'Product', paths: ['models/kotlin/Generic.kt'], scenarioName: 'Ok' });
    const bad = await call('save_scenario', { collection: 'C', method: 'GET', path: '/p', body: '{"id":"nope"}', scenarioName: 'Broken' });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain('Product');
    const endpointId = (await call('list_collections')).json().collections[0].endpoints[0].id;
    expect((await call('validate_body', { endpointId, body: good })).json().valid).toBe(true);
    expect((await call('validate_body', { endpointId, body: '{"id":"nope"}' })).json().valid).toBe(false);
  });

  it('accepts pasted source and rejects invalid JSON for unlinked endpoints', async () => {
    const source = 'data class Ping(val ok: Boolean)';
    const saved = await call('save_scenario', { collection: 'Health', method: 'GET', path: '/ping', body: '{"ok":true}', type: 'Ping', files: [{ name: 'Ping.kt', content: source }] });
    expect(saved.isError).toBe(false);
    const plain = await call('save_scenario', { collection: 'Health', method: 'POST', path: '/echo', body: '{broken' });
    expect(plain.isError).toBe(true);
    expect(plain.text).toContain('not valid JSON');
  });

  it('cannot read files outside the root', async () => {
    const escape = await call('parse_model', { paths: ['../../../etc/hosts'] });
    expect(escape.isError).toBe(true);
    expect(escape.text).toMatch(/outside|not found/i);
    const absolute = await call('parse_model', { paths: ['/etc/hosts'] });
    expect(absolute.isError).toBe(true);
    await fs.symlink('/etc', path.join(dir, 'models', 'etc-link'));
    const link = await call('parse_model', { paths: ['models/etc-link/hosts'] });
    expect(link.isError).toBe(true);
  });

  it('reports unsupported constructs to the AI client', async () => {
    const parsed = (await call('parse_model', { paths: ['models/kotlin/Unsupported.kt'] })).json();
    expect(parsed.issues.map((i: { code: string }) => i.code)).toContain('sealed-class');
  });
});
