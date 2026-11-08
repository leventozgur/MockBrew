import type { AliasDecl, ExtractResult, Issue, ScalarKind, TypeDecl, TypeRef } from '../parser/ir.js';
import { applyNaming } from './naming.js';
import { parseTypeExpression } from './type-expression.js';
import {
  type GenerationSettings,
  JSON_SCHEMA_DRAFT,
  type JsonSchema,
  type TypeSummary,
  normalizeSettings,
} from './types.js';

export interface SchemaResult {
  schema: JsonSchema;
  issues: Issue[];
  rootType: string;
  settings: GenerationSettings;
}

export function listTypes(declarations: TypeDecl[]): TypeSummary[] {
  return declarations.map((d) => ({
    name: d.qualifiedName,
    kind: d.kind,
    language: d.language,
    file: d.file,
    line: d.line,
    typeParams: d.typeParams,
    fieldCount: d.kind === 'class' ? d.fields.length : d.enumCases.length,
    ...(d.unsupported ? { unsupported: d.unsupported.code } : {}),
  }));
}

export function hasErrors(issues: Issue[]): boolean {
  return issues.some((i) => i.severity === 'error');
}

interface Scope {
  params: Map<string, TypeRef>;
  owner?: TypeDecl;
}

const ANY: TypeRef = { kind: 'scalar', scalar: 'any', source: 'Any' };
const INT32_RANGE = { minimum: -2147483648, maximum: 2147483647 };

export function buildSchema(
  extract: ExtractResult,
  rootExpression: string,
  settingsInput?: Partial<GenerationSettings>,
): SchemaResult {
  const settings = normalizeSettings(settingsInput);
  const builder = new SchemaBuilder(extract.declarations, extract.aliases, settings);
  const rootRef = parseTypeExpression(rootExpression);
  const root = builder.schemaFor(rootRef, { params: new Map() });
  const schema: JsonSchema = { $schema: JSON_SCHEMA_DRAFT, ...root, $defs: builder.defs };
  const relevantIssues = extract.issues.filter((i) => !i.type || builder.used.has(i.type));
  return { schema, issues: [...relevantIssues, ...builder.issues], rootType: rootExpression.trim(), settings };
}

class SchemaBuilder {
  readonly defs: Record<string, JsonSchema> = {};
  readonly issues: Issue[] = [];
  readonly used = new Set<string>();

  constructor(
    private readonly declarations: TypeDecl[],
    private readonly aliases: AliasDecl[],
    private readonly settings: GenerationSettings,
  ) {}

  schemaFor(ref: TypeRef, scope: Scope, depth = 0): JsonSchema {
    if (depth > 20) return {};
    switch (ref.kind) {
      case 'scalar':
        return this.nullable(this.scalarSchema(ref.scalar), ref.nullable);
      case 'list':
        return this.nullable({ type: 'array', items: this.schemaFor(this.close(ref.item, scope), scope, depth + 1) }, ref.nullable);
      case 'map':
        return this.nullable(
          { type: 'object', additionalProperties: this.schemaFor(this.close(ref.value, scope), scope, depth + 1) },
          ref.nullable,
        );
      case 'unsupported':
        this.issues.push({
          severity: 'warning',
          code: 'unsupported-type',
          message: `Type "${ref.text}" is not supported and is treated as any.`,
          type: scope.owner?.qualifiedName,
        });
        return {};
      case 'named':
        return this.named(ref, scope, depth);
    }
  }

  /** Substitutes generic parameters of the current scope. */
  private close(ref: TypeRef, scope: Scope): TypeRef {
    switch (ref.kind) {
      case 'named': {
        const bound = ref.args.length === 0 ? scope.params.get(ref.name) : undefined;
        if (bound) return ref.nullable ? { ...bound, nullable: true } : bound;
        return { ...ref, args: ref.args.map((a) => this.close(a, scope)) };
      }
      case 'list':
        return { ...ref, item: this.close(ref.item, scope) };
      case 'map':
        return { ...ref, value: this.close(ref.value, scope) };
      default:
        return ref;
    }
  }

  private named(ref: Extract<TypeRef, { kind: 'named' }>, scope: Scope, depth: number): JsonSchema {
    const decl = this.findDecl(ref.name, scope.owner);
    if (decl) {
      const args = ref.args.map((a) => this.close(a, scope));
      return this.nullable(this.instantiate(decl, args), ref.nullable);
    }
    const alias = this.aliases.find((a) => a.name === ref.name.split('.').pop());
    if (alias) {
      const params = new Map<string, TypeRef>();
      alias.typeParams.forEach((p, i) => params.set(p, ref.args[i] ? this.close(ref.args[i] as TypeRef, scope) : ANY));
      const target = this.close(alias.type, { params, owner: scope.owner });
      const resolved = ref.nullable ? { ...target, nullable: true } : target;
      return this.schemaFor(resolved, scope, depth + 1);
    }
    this.issues.push({
      severity: scope.owner ? 'warning' : 'error',
      code: 'unresolved-type',
      message: `Type "${ref.name}" was not found in the provided sources${scope.owner ? ` (used by ${scope.owner.qualifiedName})` : ''}; add the file that declares it.`,
      type: scope.owner?.qualifiedName,
    });
    return { 'x-unresolved': ref.name };
  }

  private findDecl(name: string, owner: TypeDecl | undefined): TypeDecl | undefined {
    const preferred = (candidates: TypeDecl[]): TypeDecl | undefined => {
      if (candidates.length === 0) return undefined;
      const sameLanguage = owner ? candidates.filter((c) => c.language === owner.language) : candidates;
      const pool = sameLanguage.length > 0 ? sameLanguage : candidates;
      if (pool.length > 1) {
        this.issues.push({
          severity: 'info',
          code: 'ambiguous-type',
          message: `Type "${name}" is declared more than once (${pool.map((c) => `${c.file}:${c.line}`).join(', ')}); the first one is used.`,
          type: owner?.qualifiedName,
        });
      }
      return pool[0];
    };

    if (owner) {
      const parts = owner.qualifiedName.split('.');
      for (let i = parts.length; i > 0; i--) {
        const scoped = `${parts.slice(0, i).join('.')}.${name}`;
        const hit = this.declarations.filter((d) => d.qualifiedName === scoped && (d.language === owner.language));
        if (hit.length > 0) return preferred(hit);
      }
    }
    const exact = this.declarations.filter((d) => d.qualifiedName === name);
    if (exact.length > 0) return preferred(exact);
    // Fully qualified reference including the package, e.g. com.example.User.
    const packaged = this.declarations.filter((d) => name.endsWith(`.${d.qualifiedName}`));
    if (packaged.length > 0) {
      const longest = Math.max(...packaged.map((d) => d.qualifiedName.length));
      return preferred(packaged.filter((d) => d.qualifiedName.length === longest));
    }
    const simple = name.split('.').pop();
    return preferred(this.declarations.filter((d) => d.name === simple));
  }

  private instantiate(decl: TypeDecl, args: TypeRef[]): JsonSchema {
    this.used.add(decl.qualifiedName);
    const key = this.defKey(decl, args);
    if (!(key in this.defs)) {
      this.defs[key] = {};
      this.defs[key] = this.buildDecl(decl, args);
    }
    return { $ref: `#/$defs/${key}` };
  }

  private defKey(decl: TypeDecl, args: TypeRef[]): string {
    const base = decl.qualifiedName.replace(/[^A-Za-z0-9]+/g, '_');
    if (args.length === 0) return base;
    return `${base}_${args.map((a) => this.refKey(a)).join('_')}`;
  }

  private refKey(ref: TypeRef): string {
    switch (ref.kind) {
      case 'scalar':
        return ref.source.replace(/[^A-Za-z0-9]+/g, '');
      case 'list':
        return `List_${this.refKey(ref.item)}`;
      case 'map':
        return `Map_${this.refKey(ref.value)}`;
      case 'named':
        return ref.name.replace(/[^A-Za-z0-9]+/g, '_') + ref.args.map((a) => `_${this.refKey(a)}`).join('');
      case 'unsupported':
        return 'Unsupported';
    }
  }

  private buildDecl(decl: TypeDecl, args: TypeRef[]): JsonSchema {
    const source = { type: decl.qualifiedName, language: decl.language, file: decl.file, line: decl.line };
    if (decl.unsupported) {
      return { title: decl.name, description: decl.unsupported.message, 'x-unsupported': decl.unsupported.code, 'x-source': source };
    }
    if (decl.kind === 'enum') return this.enumSchema(decl, source);

    if (args.length !== decl.typeParams.length) {
      this.issues.push({
        severity: 'warning',
        code: 'generic-arity',
        message: `${decl.qualifiedName} expects ${decl.typeParams.length} type argument(s) but got ${args.length}; missing ones are treated as any.`,
        type: decl.qualifiedName,
      });
    }
    const params = new Map<string, TypeRef>();
    decl.typeParams.forEach((p, i) => params.set(p, args[i] ?? ANY));
    const scope: Scope = { params, owner: decl };

    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];
    for (const field of decl.fields) {
      const key = field.jsonName ?? applyNaming(field.name, this.settings.naming);
      const type = this.close(field.type, scope);
      const property = this.schemaFor(type, scope);
      if (field.alternateNames?.length) property['x-alternateNames'] = field.alternateNames;
      properties[key] = property;
      const optional = field.type.nullable || (decl.language === 'kotlin' && field.hasDefault);
      if (!optional) required.push(key);
    }
    const schema: JsonSchema = { type: 'object', title: decl.name, properties };
    if (required.length > 0) schema.required = required;
    schema['x-source'] = source;
    return schema;
  }

  private enumSchema(decl: TypeDecl, source: object): JsonSchema {
    const values = decl.enumCases.map((c) => c.value ?? c.name);
    const type = decl.enumRaw === 'int' ? 'integer' : 'string';
    return { type, title: decl.name, enum: values, 'x-source': source };
  }

  private nullable(schema: JsonSchema, nullable: boolean | undefined): JsonSchema {
    if (!nullable) return schema;
    if ('$ref' in schema) return { anyOf: [schema, { type: 'null' }] };
    if (Object.keys(schema).length === 0) return schema;
    if (typeof schema.type === 'string') {
      const out: JsonSchema = { ...schema, type: [schema.type, 'null'] };
      if (Array.isArray(schema.enum)) out.enum = [...schema.enum, null];
      return out;
    }
    return { anyOf: [schema, { type: 'null' }] };
  }

  private scalarSchema(scalar: ScalarKind): JsonSchema {
    switch (scalar) {
      case 'string':
        return { type: 'string' };
      case 'boolean':
        return { type: 'boolean' };
      case 'int32':
        return { type: 'integer', format: 'int32', ...INT32_RANGE };
      case 'int64':
        return { type: 'integer', format: 'int64' };
      case 'double':
      case 'decimal':
        return { type: 'number' };
      case 'instant':
        if (this.settings.dateFormat === 'iso8601') return { type: 'string', format: 'date-time' };
        return { type: 'integer', format: 'int64', 'x-date': this.settings.dateFormat };
      case 'localDate':
        return { type: 'string', format: 'date' };
      case 'localTime':
        return { type: 'string', format: 'time' };
      case 'uuid':
        return { type: 'string', format: 'uuid' };
      case 'url':
        return { type: 'string', format: 'uri' };
      case 'base64':
        return { type: 'string', contentEncoding: 'base64' };
      case 'any':
        return {};
    }
  }
}
