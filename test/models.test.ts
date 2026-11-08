import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { generateJson, generateValue } from '../src/generator/index.js';
import { extractModels, shutdownParser } from '../src/parser/index.js';
import { buildSchema, listTypes, validateValue } from '../src/schema/index.js';
import { def, fixture, rootDef, roundTrip, schemaFor } from './helpers.js';

afterAll(() => shutdownParser());

const gson = () => [fixture('kotlin', 'GsonModels.kt')];
const kotlinx = () => [fixture('kotlin', 'KotlinxModels.kt')];
const generic = () => [fixture('kotlin', 'Generic.kt')];
const swift = () => [fixture('swift', 'Codable.swift')];
const swiftGeneric = () => [fixture('swift', 'Generic.swift')];

describe('Kotlin Gson adapter', () => {
  it('maps annotations, nullability, defaults and transient fields', async () => {
    const { schema, issues } = await schemaFor(gson(), 'UserDto');
    const user = rootDef(schema);
    expect(Object.keys(user.properties)).toEqual(['user_id', 'full_name', 'email', 'tags', 'scores', 'status', 'created_at', 'address']);
    expect(user.properties.user_id).toMatchObject({ type: 'integer', format: 'int64' });
    expect(user.properties.full_name['x-alternateNames']).toEqual(['name', 'fullName']);
    expect(user.properties.email.type).toEqual(['string', 'null']);
    expect(user.properties.created_at).toMatchObject({ type: 'string', format: 'date-time' });
    expect(user.properties.scores).toMatchObject({ type: 'object', additionalProperties: { type: 'integer' } });
    expect(user.required).toEqual(['user_id', 'full_name', 'scores', 'status', 'created_at', 'address']);
    expect(def(schema, 'Status').enum).toEqual(['active', 'gone']);
    expect(issues.filter((i) => i.severity !== 'info')).toEqual([]);
  });

  it('supports nested types and plain classes with annotated properties', async () => {
    const extract = await extractModels(gson());
    const names = listTypes(extract.declarations).map((t) => t.name);
    expect(names).toContain('UserDto.Settings');
    const { schema } = buildSchema(extract, 'LegacyBean');
    expect(Object.keys(rootDef(schema).properties)).toEqual(['a_b', 'counter']);
  });

  it('applies snake_case naming only to properties without explicit names', async () => {
    const { schema } = await schemaFor(gson(), 'UserDto', { naming: 'snake_case' });
    expect(Object.keys(def(schema, 'Address').properties)).toEqual(['street', 'postal_code', 'geo']);
    expect(Object.keys(rootDef(schema).properties)).toContain('user_id');
  });

  it('applies the date format setting', async () => {
    const seconds = await roundTrip(gson(), 'UserDto', { dateFormat: 'epoch-seconds' });
    expect(rootDef(seconds.schema).properties.created_at).toMatchObject({ type: 'integer', 'x-date': 'epoch-seconds' });
    const value = seconds.value as { created_at: number };
    expect(value.created_at).toBeGreaterThan(1_600_000_000);
    expect(value.created_at).toBeLessThan(1_900_000_000);
    expect(seconds.validation.valid).toBe(true);

    const millis = await roundTrip(gson(), 'UserDto', { dateFormat: 'epoch-millis' });
    expect((millis.value as { created_at: number }).created_at).toBeGreaterThan(1_600_000_000_000);
  });
});

describe('Kotlinx Serialization adapter', () => {
  it('handles SerialName, Transient, enums, lists and type aliases', async () => {
    const { schema, issues } = await schemaFor(kotlinx(), 'Order');
    const order = rootDef(schema);
    expect(Object.keys(order.properties)).toEqual(['id', 'customer_ref', 'totalPrice', 'placedAt', 'items', 'state', 'note']);
    expect(order.required).toEqual(['id', 'customer_ref', 'totalPrice', 'placedAt', 'items']);
    expect(def(schema, 'OrderState').enum).toEqual(['NEW', 'in_progress', 'DONE']);
    expect(order.properties.items).toMatchObject({ type: 'array' });
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);

    const ref = await schemaFor(kotlinx(), 'OrderRef');
    expect(rootDef(ref.schema).properties.orderId).toMatchObject({ type: 'integer', format: 'int64' });
    expect(rootDef(ref.schema).properties.orderIds).toMatchObject({ type: 'array', items: { type: 'integer' } });
  });

  it('applies snake_case to implicit names', async () => {
    const { schema } = await schemaFor(kotlinx(), 'Order', { naming: 'snake_case' });
    expect(Object.keys(rootDef(schema).properties)).toEqual(['id', 'customer_ref', 'total_price', 'placed_at', 'items', 'state', 'note']);
  });
});

describe('Kotlin Moshi support', () => {
  it('reads @Json(name) and @Json(ignore)', async () => {
    const { schema } = await schemaFor([fixture('kotlin', 'MoshiModels.kt')], 'Profile');
    expect(Object.keys(rootDef(schema).properties)).toEqual(['display_name', 'avatar_url']);
  });
});

describe('generics and recursion', () => {
  it('substitutes generic arguments, including nested ones', async () => {
    const { schema, issues } = await schemaFor(generic(), 'BaseResponse<Page<Product>>');
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
    const root = rootDef(schema);
    expect(root.properties.data).toMatchObject({ $ref: expect.stringContaining('Page_Product') });
    expect(def(schema, 'Page_Product').properties.items.items.$ref).toContain('Product');
  });

  it('resolves generics used inside other types', async () => {
    const { schema, value, validation } = await roundTrip(generic(), 'Wrapper');
    expect(validation.errors).toEqual([]);
    expect(schema.$defs).toHaveProperty('BaseResponse_Page_Product');
    expect(JSON.stringify(value)).toContain('"items"');
  });

  it('terminates on recursive types', async () => {
    const { value, validation } = await roundTrip(generic(), 'Tree', undefined, { variant: 'full' });
    expect(JSON.stringify(value).length).toBeLessThan(20_000);
    expect(validation.valid).toBe(true);
  });

  it('accepts list and map root types', async () => {
    const { schema, value } = await roundTrip(generic(), 'List<Product>');
    expect(schema.type).toBe('array');
    expect(Array.isArray(value)).toBe(true);
  });
});

describe('Swift Codable adapter', () => {
  it('maps CodingKeys, optionals, collections and special types', async () => {
    const { schema, issues } = await schemaFor(swift(), 'UserResponse');
    const user = rootDef(schema);
    expect(Object.keys(user.properties)).toEqual(['user_id', 'name', 'nickname', 'tags', 'scores', 'created_at', 'status', 'address', 'website', 'ref', 'balance', 'bigNumber']);
    expect(user.required).not.toContain('nickname');
    expect(user.properties.website).toMatchObject({ type: 'string', format: 'uri' });
    expect(user.properties.ref).toMatchObject({ format: 'uuid' });
    expect(user.properties.bigNumber).toMatchObject({ type: 'integer', format: 'int64' });
    expect(def(schema, 'Status').enum).toEqual(['active', 'gone']);
    const priority = await schemaFor(swift(), 'Priority');
    expect(rootDef(priority.schema)).toMatchObject({ type: 'integer', enum: [1, 2] });
    expect(issues.some((i) => i.code === 'initialized-let')).toBe(true);
    expect(user.properties).not.toHaveProperty('fixed');
  });

  it('applies naming strategy to properties missing from CodingKeys overrides', async () => {
    const { schema } = await schemaFor(swift(), 'UserResponse', { naming: 'snake_case' });
    expect(Object.keys(rootDef(schema).properties)).toContain('big_number');
    expect(Object.keys(rootDef(schema).properties)).toContain('created_at');
  });

  it('supports generic structs and type aliases', async () => {
    const { schema, issues } = await schemaFor(swiftGeneric(), 'Wrapper');
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(schema.$defs).toHaveProperty('BaseResponse_Page_Product');
    const wrapper = rootDef(schema);
    expect(wrapper.properties.alias).toBeDefined();
    const generated = await roundTrip(swiftGeneric(), 'BaseResponse<[Product]>');
    expect(generated.validation.valid).toBe(true);
  });
});

describe('unsupported constructs are reported, not skipped silently', () => {
  it('reports Kotlin issues', async () => {
    const extract = await extractModels([fixture('kotlin', 'Unsupported.kt')]);
    const codes = new Set(extract.issues.map((i) => i.code));
    for (const code of ['custom-serializer', 'delegated-property', 'computed-property']) {
      expect(codes, code).toContain(code);
    }
    const { issues, schema } = buildSchema(extract, 'Strange');
    expect(issues.some((i) => i.code === 'unresolved-type' && i.message.includes('NotDeclaredAnywhere'))).toBe(true);
    expect(issues.every((i) => i.severity !== 'error')).toBe(true);
    expect(Object.keys(rootDef(schema).properties)).toEqual(['ok', 'custom', 'shape', 'missing']);
    expect(def(schema, 'Shape').oneOf).toHaveLength(1);
  });

  it('reports Swift issues', async () => {
    const extract = await extractModels([fixture('swift', 'Unsupported.swift')]);
    const codes = new Set(extract.issues.map((i) => i.code));
    for (const code of ['enum-associated-values', 'enum-without-raw-value', 'custom-decoder', 'property-wrapper']) {
      expect(codes, code).toContain(code);
    }
    const { issues } = buildSchema(extract, 'Wrapped');
    expect(issues.some((i) => i.code === 'unsupported-type')).toBe(true);
    expect(issues.some((i) => i.code === 'unresolved-type')).toBe(true);
  });

  it('fails for an unknown root type', async () => {
    const { issues } = await schemaFor(gson(), 'DoesNotExist');
    expect(issues.some((i) => i.severity === 'error' && i.code === 'unresolved-type')).toBe(true);
  });

  it('reports syntax errors with a line number', async () => {
    const extract = await extractModels([{ name: 'Broken.kt', content: 'data class A(val a: Int,\n\nclass {{{ ' }]);
    expect(extract.issues.some((i) => i.code === 'syntax-error' && i.line !== undefined)).toBe(true);
  });

  it('ignores files that are not Kotlin or Swift', async () => {
    const extract = await extractModels([{ name: 'readme.md', content: '# x' }]);
    expect(extract.issues.map((i) => i.code)).toEqual(['unsupported-file']);
  });
});

describe('multi file resolution', () => {
  const files = () => [fixture('multi', 'OrderResponse.kt'), fixture('multi', 'Model.kt')];

  it('resolves types declared in other files, including qualified references', async () => {
    const { schema, issues } = await schemaFor(files(), 'OrderResponse');
    expect(issues.filter((i) => i.severity !== 'info')).toEqual([]);
    expect(def(schema, 'Customer').properties.joinedOn).toMatchObject({ type: 'string', format: 'date' });
    expect(schema.$defs).toHaveProperty('Line');
  });

  it('warns about types that cannot be resolved', async () => {
    const { issues } = await schemaFor([fixture('multi', 'OrderResponse.kt')], 'OrderResponse');
    expect(issues.filter((i) => i.code === 'unresolved-type').map((i) => i.message).join('\n')).toContain('Customer');
  });
});

describe('local generator', () => {
  it('is deterministic for the same seed and differs between seeds', async () => {
    const { schema } = await schemaFor(gson(), 'UserDto');
    const a = generateJson(schema, { seed: 'one' });
    expect(generateJson(schema, { seed: 'one' })).toBe(a);
    expect(generateJson(schema, { seed: 'two' })).not.toBe(a);
  });

  it('produces meaningful values from field names', async () => {
    const { schema } = await schemaFor(
      [{ name: 'M.kt', content: 'data class M(val email: String, val firstName: String, val avatarUrl: String, val latitude: Double, val price: Double, val age: Int, val isActive: Boolean, val createdAt: Instant, val phone: String, val currency: String)' }],
      'M',
    );
    const v = generateValue(schema, { seed: 7 }) as Record<string, any>;
    expect(v.email).toMatch(/^[a-z]+\.[a-z]+@example\.com$/);
    expect(v.avatarUrl).toMatch(/^https:\/\//);
    expect(v.latitude).toBeGreaterThanOrEqual(-90);
    expect(v.latitude).toBeLessThanOrEqual(90);
    expect(v.price).toBeGreaterThan(0);
    expect(v.age).toBeGreaterThanOrEqual(18);
    expect(v.isActive).toBe(true);
    expect(v.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(v.phone).toMatch(/^\+1 555/);
    expect(v.currency).toBe('USD');
  });

  it('keeps Long values inside the safe integer range', async () => {
    const { value } = await roundTrip(gson(), 'UserDto');
    const id = (value as { user_id: number }).user_id;
    expect(Number.isSafeInteger(id)).toBe(true);
  });

  it('builds minimal, full and empty-list variants', async () => {
    const { schema } = await schemaFor(gson(), 'UserDto');
    const minimal = generateValue(schema, { variant: 'minimal' }) as Record<string, unknown>;
    const full = generateValue(schema, { variant: 'full' }) as Record<string, any>;
    const empty = generateValue(schema, { variant: 'empty-list' }) as Record<string, any>;
    expect(Object.keys(minimal)).toEqual(['user_id', 'full_name', 'scores', 'status', 'created_at', 'address']);
    expect(Object.keys(full)).toContain('email');
    expect(full.tags).toHaveLength(2);
    expect(full.email).not.toBeNull();
    expect(empty.tags).toEqual([]);
  });

  it.each([
    ['kotlin gson', gson, 'UserDto'],
    ['kotlinx', kotlinx, 'Order'],
    ['swift', swift, 'UserResponse'],
    ['swift generic', swiftGeneric, 'Wrapper'],
    ['kotlin generic', generic, 'Wrapper'],
  ] as const)('generated JSON validates against its schema (%s)', async (_name, files, type) => {
    for (const variant of ['minimal', 'full', 'empty-list'] as const) {
      for (const settings of [{}, { naming: 'snake_case' as const, dateFormat: 'epoch-millis' as const }]) {
        const { validation } = await roundTrip(files(), type, settings, { variant, seed: 3 });
        expect(validation.errors, `${variant} ${JSON.stringify(settings)}`).toEqual([]);
      }
    }
  });

  it('reports schema violations in edited bodies', async () => {
    const { schema } = await schemaFor(gson(), 'UserDto');
    const bad = validateValue(schema, { user_id: 'x' });
    expect(bad.valid).toBe(false);
    expect(bad.errors.some((e) => e.path === '$.user_id')).toBe(true);
    expect(bad.errors.some((e) => e.message.includes('missing required property "full_name"'))).toBe(true);
  });
});

describe('access root helpers', () => {
  it('treats the filesystem root and the home folder (and its parents) as too broad', async () => {
    const os = await import('node:os');
    const { isBroadRoot, commonAncestor } = await import('../src/core/safe-path.js');
    expect(isBroadRoot('/')).toBe(true);
    expect(isBroadRoot(os.homedir())).toBe(true);
    expect(isBroadRoot(path.dirname(os.homedir()))).toBe(true);
    expect(isBroadRoot(path.join(os.homedir(), 'Projects', 'app'))).toBe(false);
    expect(commonAncestor('/a/b/mocks', '/a/b/app/src')).toBe('/a/b');
    expect(commonAncestor('/a/mocks', '/b/app')).toBe('/');
  });
});


describe('polymorphism and inheritance', () => {
  const files = () => [fixture('kotlin', 'SealedModels.kt')];
  it('generates each Kotlinx subtype and applies discriminator, naming and date settings', async () => {
    for (const subtype of ['Created', 'Deleted']) {
      const result = await roundTrip(files(), 'Event', { naming: 'snake_case', dateFormat: 'epoch-millis', classDiscriminator: 'tag' }, { subtype });
      expect(result.validation.errors).toEqual([]);
      expect((result.value as any).tag).toBe(subtype === 'Created' ? 'created' : 'deleted');
      if (subtype === 'Created') expect((result.value as any).created_at).toBeGreaterThan(1_600_000_000_000);
      else expect(Object.keys(result.value as object)).toEqual(['tag']);
    }
    const normal = await roundTrip(files(), 'Event');
    expect((normal.value as any).kind).toBe('created');
    for (const subtype of ['Success', 'Empty']) expect((await roundTrip(files(), 'Result', {}, { subtype })).validation.valid).toBe(true);
    const feed = await roundTrip(files(), 'Feed', {}, { seed: 3 });
    expect(feed.validation.errors).toEqual([]);
    expect(new Set((feed.value as any).events.map((v: any) => v.kind)).size).toBe(2);
  });
  it('reads Moshi sealed generator and configurable adapter discriminator', async () => {
    const moshi = [fixture('kotlin', 'SealedMoshi.kt')];
    const first = await roundTrip(moshi, 'Message', {}, { subtype: 'End' });
    expect(first.value).toEqual({ category: 'End' });
    expect(first.validation.valid).toBe(true);
    const second = await roundTrip(moshi, 'Message', { polymorphism: { discriminator: 'kind' } });
    expect((second.value as any).kind).toBe('Text');
    expect(second.validation.valid).toBe(true);
  });
  it('resolves Gson subtypes from separate files and warns about custom adapters', async () => {
    const sources = [
      { name: 'Base.kt', content: 'sealed class Base' },
      { name: 'Children.kt', content: 'data class Child(val value: String) : Base()\nobject Nothing : Base()' },
    ];
    const result = await roundTrip(sources, 'Base', { polymorphism: { discriminator: 'kind' } }, { subtype: 'Nothing' });
    expect(result.value).toEqual({ kind: 'Nothing' });
    expect(result.validation.valid).toBe(true);
    expect(result.issues.some((i) => i.code === 'custom-polymorphic-adapter')).toBe(true);
  });
  it('reports sealed declarations rejected by the bundled grammar', async () => {
    const result = await extractModels([{ name: 'BrokenGrammar.kt', content: '@Serializable\n@JsonClassDiscriminator("kind")\nsealed class Base { data class Child(val value: String): Base() }' }]);
    expect(result.issues.some((i) => i.code === 'unsupported-sealed-syntax')).toBe(true);
  });
  it('includes inherited fields and warns about Swift Codable behavior', async () => {
    const kotlin = await roundTrip([fixture('kotlin', 'InheritanceModels.kt')], 'Dog', { naming: 'snake_case' });
    expect(kotlin.validation.valid).toBe(true);
    expect(kotlin.value).toHaveProperty('name');
    expect(kotlin.value).toHaveProperty('created_at');
    const swiftInheritance = [fixture('swift', 'Inheritance.swift')];
    const swiftResult = await roundTrip(swiftInheritance, 'Dog');
    expect(swiftResult.validation.valid).toBe(true);
    expect(swiftResult.value).toHaveProperty('name');
    expect(swiftResult.issues.some((i) => i.code === 'swift-codable-inheritance')).toBe(true);
    const parsed = await extractModels(swiftInheritance);
    expect(parsed.issues.some((i) => i.code === 'enum-associated-values')).toBe(true);
    expect(parsed.issues.some((i) => i.code === 'custom-decoder')).toBe(true);
  });
});
