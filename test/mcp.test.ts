import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectService } from '../src/core/service.js';

const cli = path.resolve('dist/cli/main.js');
let dir: string;
let client: Client;

async function connect(extraArgs: string[] = []): Promise<void> {
  const transport = new StdioClientTransport({ command: 'node', args: [cli, 'mcp', '-p', path.join(dir, 'mocks'), '--root', dir, ...extraArgs], cwd: dir, stderr: 'ignore', env: { ...getDefaultEnvironment(), ...(process.env.CHOKIDAR_USEPOLLING ? { CHOKIDAR_USEPOLLING: process.env.CHOKIDAR_USEPOLLING } : {}) } });
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
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mockbrew-mcp-'));
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
    expect(tools.map((t) => t.name).sort()).toEqual(['activate_profile', 'apply_import', 'apply_model_update', 'check_models', 'create_collection', 'create_endpoint', 'deactivate_profile', 'delete_collection', 'delete_endpoint', 'delete_profile', 'delete_scenario', 'export_bundle', 'generate_sample', 'get_request_logs', 'get_schema', 'list_collections', 'list_endpoints', 'list_profiles', 'list_recordings', 'parse_model', 'preview_import', 'preview_model_update', 'preview_recordings', 'reorder_scenarios', 'reset_request_counters', 'save_profile', 'save_recordings', 'save_scenario', 'server_status', 'set_active_scenario', 'set_collection_active', 'set_endpoint_mode', 'set_request_model', 'set_scenario_dynamic', 'set_scenario_file', 'set_scenario_rules', 'set_variables', 'start_recording', 'start_server', 'stop_recording', 'stop_server', 'update_collection', 'update_endpoint', 'update_scenario', 'validate_body', 'validate_tokens']);
    expect(client.getInstructions()).toContain('parse_model');
    expect(tools.find((t) => t.name === 'preview_model_update')?.annotations?.readOnlyHint).toBe(true);
    // MCP clients (e.g. Codex with approval "never") treat write tools without destructiveHint as destructive.
    const implicit = tools.filter((t) => t.annotations?.readOnlyHint !== true && typeof t.annotations?.destructiveHint !== 'boolean').map((t) => t.name);
    expect(implicit.filter((name) => !['apply_import', 'save_recordings', 'start_recording', 'stop_recording'].includes(name))).toEqual([]);
    const destructive = tools.filter((t) => t.annotations?.destructiveHint === true).map((t) => t.name).sort();
    expect(destructive).toEqual(expect.arrayContaining(['apply_model_update', 'delete_collection', 'delete_endpoint', 'delete_profile', 'delete_scenario']));
    expect(destructive).not.toContain('save_profile');
    expect((await call('preview_model_update')).json().endpoints).toEqual([]);
    expect((await call('apply_model_update', { selection: [{ endpointId: 'x', scenarioIds: ['y'] }], previewHash: 'invalid' })).isError).toBe(true);
    const save = tools.find((t) => t.name === 'save_scenario');
    expect(save?.annotations?.destructiveHint).toBe(false);
  });

  it('manages plaintext variables', async () => {
    expect((await call('set_variables', { operation: 'set', values: { base: 'example' } })).json().variables).toEqual({ base: 'example' });
    expect((await call('set_variables', { operation: 'list' })).json().variables).toEqual({ base: 'example' });
    expect((await call('set_variables', { operation: 'delete', name: 'base' })).json().variables).toEqual({});
    expect((await call('set_variables', { operation: 'set', values: { 'bad-name': 'x' } })).isError).toBe(true);
    expect((await call('set_variables', { operation: 'set', values: JSON.parse('{"__proto__":"value"}') })).json().variables).toEqual(JSON.parse('{"__proto__":"value"}'));
  });

  it('configures dynamic scenarios, request models and files with narrow tools', async () => {
    const collectionId = (await call('create_collection', { name: 'Users' })).json().id;
    const endpointId = (await call('create_endpoint', { collectionId, method: 'POST', path: '/users' })).json().id;
    const scenarioId = (await call('list_endpoints')).json().endpoints[0].scenarios[0].id;
    await call('update_scenario', { endpointId, scenarioId, body: '{"name":"{{request.body.$.name}}","id":"{{uuid}}","x":"{{nope}}"}' });
    expect((await call('set_scenario_dynamic', { endpointId, scenarioId, dynamic: true })).json()).toEqual({ updated: true, unknownTokens: ['{{nope}}'] });
    expect((await call('validate_tokens', {})).json().scenarios).toHaveLength(1);
    const model = { rootType: 'NewUser', settings: { naming: 'identity', dateFormat: 'iso8601' }, sources: [], schema: { type: 'object', required: ['name'] } };
    expect((await call('set_request_model', { endpointId, model })).json().requestModel).toBe('NewUser');
    expect((await call('set_request_model', { endpointId, model: 'oops' })).isError).toBe(true);
    expect((await call('set_scenario_file', { endpointId, scenarioId, file: '../outside.png' })).isError).toBe(true);
    await fs.writeFile(path.join(dir, 'mocks', 'logo.png'), 'png');
    expect((await call('set_scenario_file', { endpointId, scenarioId, file: 'logo.png' })).json().file).toBe('logo.png');
    expect((await client.readResource({ uri: 'mockbrew://guide' })).contents[0]?.text).toContain('{{request.body.$.name}}');
  });

  it('lists and reads the guide and prompts over stdio', async () => {
    expect((await client.listResources()).resources.map((r) => r.uri)).toContain('mockbrew://guide');
    const guide = await client.readResource({ uri: 'mockbrew://guide' });
    expect(guide.contents[0]).toMatchObject({ mimeType: 'text/markdown', text: expect.stringContaining('preview_model_update') });
    expect((await client.listPrompts()).prompts.map((p) => p.name).sort()).toEqual(['add_error_scenarios', 'mock_endpoint_from_model']);
    const endpoint = await client.getPrompt({ name: 'mock_endpoint_from_model', arguments: { modelType: 'User', method: 'GET', path: '/users' } });
    expect(endpoint.messages[0]?.content).toMatchObject({ text: expect.stringContaining('save_scenario') });
    const errors = await client.getPrompt({ name: 'add_error_scenarios', arguments: { endpointId: 'endpoint-1' } });
    expect(errors.messages[0]?.content).toMatchObject({ text: expect.stringContaining('endpoint-1') });
  });

  it('manages profiles and previews deletion', async () => {
    const saved = (await call('save_scenario', { collection: 'Auth', method: 'GET', path: '/auth', scenarioName: 'Expired', statusCode: 401, body: '{}' })).json();
    const id = (await call('save_profile', { name: 'Expired', endpoints: { [saved.endpointId]: { scenarioId: saved.scenarioId } } })).json().id;
    expect((await call('activate_profile', { profileId: id })).isError).toBe(false);
    expect((await call('list_profiles')).json().activeProfileId).toBe(id);
    expect((await call('delete_profile', { profileId: id })).json().deleted).toBe(false);
    expect((await call('deactivate_profile')).isError).toBe(false);
    expect((await call('delete_profile', { profileId: id, confirm: true })).json().deleted).toBe(true);
  });

  it('previews and applies a model update with the approved hash', async () => {
    await fs.writeFile(path.join(dir, 'models/Update.kt'), 'data class Update(val name: String)');
    const saved = (await call('save_scenario', { collection: 'Updates', method: 'GET', path: '/update', scenarioName: 'Success', body: '{"name":"manual"}', paths: ['models/Update.kt'], type: 'Update' })).json();
    await fs.writeFile(path.join(dir, 'models/Update.kt'), 'data class Update(val name: String, val email: String)');
    const preview = (await call('preview_model_update', { endpointId: saved.endpointId })).json();
    const proposal = preview.endpoints[0].scenarios[0];
    expect(proposal.changes).toEqual(expect.arrayContaining([{ kind: 'added', path: '$.email' }]));
    const selection = [{ endpointId: saved.endpointId, scenarioIds: [proposal.scenarioId] }];
    expect((await call('apply_model_update', { selection, previewHash: 'wrong' })).isError).toBe(true);
    expect((await call('apply_model_update', { selection, previewHash: preview.hash })).isError).toBe(false);
    const endpoint = (await call('list_endpoints')).json().endpoints.find((e: { id: string }) => e.id === saved.endpointId);
    expect(JSON.parse(endpoint.scenarios[0].body)).toMatchObject({ name: 'manual', email: expect.any(String) });
  });

  it('manages collections, endpoints and scenarios with previews, validation and conflicts', async () => {
    const collectionId = (await call('create_collection', { name: 'One' })).json().id;
    const secondId = (await call('create_collection', { name: 'Two' })).json().id;
    expect((await call('update_collection', { collectionId, name: 'Renamed' })).isError).toBe(false);
    expect((await call('set_collection_active', { collectionId, active: false })).isError).toBe(false);
    const endpointId = (await call('create_endpoint', { collectionId, method: 'GET', path: '/one' })).json().id;
    expect((await call('update_endpoint', { endpointId, path: '/moved', description: 'Test', collectionId: secondId })).isError).toBe(false);
    const conflict = await call('create_endpoint', { collectionId: secondId, method: 'GET', path: '/moved' });
    expect(conflict.isError).toBe(true);
    expect(conflict.text).toMatch(/conflict|duplicate/i);
    const saved = (await call('save_scenario', { collection: 'Two', method: 'GET', path: '/moved', scenarioName: 'Other', body: '{"ok":true}' })).json();
    const listing = (await call('list_endpoints', { collectionId: secondId })).json();
    expect(listing.endpoints[0].activeScenario).toBe(saved.scenarioId);
    const firstScenario = listing.endpoints[0].scenarios.find((s: { id: string }) => s.id !== saved.scenarioId).id;
    expect((await call('update_scenario', { endpointId, scenarioId: firstScenario, name: 'Edited', statusCode: 201, headers: [{ key: 'X-Test', value: 'yes' }], body: '{"ok":false}', latencyMs: 1 })).isError).toBe(false);
    expect((await call('update_scenario', { endpointId, scenarioId: firstScenario, body: '{bad' })).isError).toBe(true);
    expect((await call('set_active_scenario', { endpointId, scenarioId: firstScenario })).isError).toBe(false);
    const before = await studioText();
    expect((await call('delete_scenario', { endpointId, scenarioId: saved.scenarioId })).json().deleted).toBe(false);
    expect((await call('delete_endpoint', { endpointId })).json().deleted).toBe(false);
    expect((await call('delete_collection', { collectionId: secondId })).json().deleted).toBe(false);
    expect(await studioText()).toBe(before);
    expect((await call('delete_scenario', { endpointId, scenarioId: saved.scenarioId, confirm: true })).json().deleted).toBe(true);
    expect((await call('delete_endpoint', { endpointId, confirm: true })).json().deleted).toBe(true);
    expect((await call('delete_collection', { collectionId: secondId, confirm: true })).json().deleted).toBe(true);
    expect((await call('check_models')).json()).toEqual([]);
  });

  it('manages conditional response tools', async () => {
    const collectionId = (await call('create_collection', { name: 'Rules' })).json().id;
    const endpointId = (await call('create_endpoint', { collectionId, method: 'GET', path: '/rules' })).json().id;
    const saved = (await call('save_scenario', { collection: 'Rules', method: 'GET', path: '/rules', scenarioName: 'Other', body: '{}' })).json();
    const rules = [{ target: 'query', modifier: 'page', value: '99', operator: 'equals', invert: false }];
    expect((await call('set_scenario_rules', { endpointId, scenarioId: saved.scenarioId, rules, rulesOperator: 'AND' })).json()).toMatchObject({ rules, rulesOperator: 'AND' });
    const listing = (await call('list_endpoints')).json().endpoints[0];
    expect(listing.responseMode).toBe('rules');
    expect(listing.scenarios.find((s: { id: string }) => s.id === saved.scenarioId).rules).toEqual(rules);
    expect((await call('reorder_scenarios', { endpointId, scenarioIds: listing.scenarios.map((s: { id: string }) => s.id).reverse() })).isError).toBe(false);
    expect((await call('set_endpoint_mode', { endpointId, responseMode: 'sequential' })).json().responseMode).toBe('sequential');
    expect((await call('reset_request_counters')).json().reset).toBe(true);
    expect((await call('set_scenario_rules', { endpointId, scenarioId: saved.scenarioId, rules: [{ ...rules[0], operator: 'regex', value: '[' }], rulesOperator: 'AND' })).isError).toBe(true);
  });

  it('validates updated success bodies against the linked model and resulting status', async () => {
    const saved = (await call('save_scenario', { collection: 'C', method: 'GET', path: '/p', body: '{"id":1,"title":"a","price":1,"tags":[]}', type: 'Product', paths: ['models/kotlin/Generic.kt'] })).json();
    const invalid = await call('update_scenario', { endpointId: saved.endpointId, scenarioId: saved.scenarioId, body: '{"id":"wrong"}' });
    expect(invalid.isError).toBe(true);
    expect(invalid.text).toContain('Product');
    expect((await call('update_scenario', { endpointId: saved.endpointId, scenarioId: saved.scenarioId, statusCode: 404, body: '{"error":true}' })).isError).toBe(false);
    expect((await call('update_scenario', { endpointId: saved.endpointId, scenarioId: saved.scenarioId, statusCode: 200 })).isError).toBe(true);
    expect((await call('check_models')).json()[0].status).toBe('ok');
  });

  it('starts and stops the runtime and returns masked logs from real requests', async () => {
    await call('save_scenario', { collection: 'C', method: 'GET', path: '/ping', body: '{"ok":true}' });
    expect((await call('server_status')).json()).toMatchObject({ running: false, host: '127.0.0.1', port: 38777 });
    const started = (await call('start_server')).json();
    expect(started).toMatchObject({ running: true, host: '127.0.0.1', port: 38777 });
    expect(started.activeCollections).toHaveLength(1);
    const response = await fetch('http://127.0.0.1:38777/ping?token=secret', { headers: { authorization: 'secret' } });
    expect(response.status).toBe(200);
    let logs: any[] = [];
    for (let i = 0; i < 30 && logs.length === 0; i++) {
      logs = (await call('get_request_logs', { limit: 1 })).json().logs;
      if (!logs.length) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(logs).toHaveLength(1);
    expect(JSON.stringify(logs)).not.toContain('secret');
    expect(logs[0]).not.toHaveProperty('requestBody');
    expect(logs[0]).not.toHaveProperty('responseBody');
    expect((await call('stop_server')).json().running).toBe(false);
  });

  it('imports an OpenAPI document through preview_import and apply_import', async () => {
    const content = await fs.readFile(new URL('./fixtures/import/openapi.json', import.meta.url), 'utf8');
    const before = await studioText();
    const preview = (await call('preview_import', { content, format: 'auto' })).json();
    expect(preview.hash).toBeTruthy();
    expect(Array.isArray(preview.warnings)).toBe(true);
    expect(await studioText()).toBe(before);
    expect((await call('preview_import', { content, format: 'yaml' })).isError).toBe(true);
    expect((await call('apply_import', { previewHash: preview.hash, onConflict: 'skip' })).isError).toBe(false);
    const endpoints = (await call('list_endpoints')).json().endpoints;
    expect(endpoints.length).toBeGreaterThan(0);
  });

  it('turns "use this model" into a validated scenario saved to the project file', async () => {
    const parsed = (await call('parse_model', { paths: ['models/kotlin/Generic.kt'] })).json();
    expect(parsed.types.map((t: { name: string }) => t.name)).toEqual(expect.arrayContaining(['BaseResponse', 'Product']));

    const schema = (await call('get_schema', { paths: ['models/kotlin/Generic.kt'], type: 'BaseResponse<Product>', naming: 'snake_case' })).json();
    expect(schema.schema.$defs).toHaveProperty('BaseResponse_Product');

    const sample = (await call('generate_sample', { paths: ['models/kotlin/Generic.kt'], type: 'BaseResponse<Product>', seed: 1 })).json();
    expect(sample.body.data).toHaveProperty('title');
    const sealed = (await call('generate_sample', { files: [{ name: 'Shape.kt', content: 'sealed class Shape\ndata class Circle(val radius: Int) : Shape()\nobject Empty : Shape()' }], type: 'Shape', subtype: 'Empty' })).json();
    expect(sealed.body).toEqual({ type: 'Empty' });

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
    expect(parsed.issues.map((i: { code: string }) => i.code)).toContain('custom-serializer');
  });
});
