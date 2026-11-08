import { type Node, type Tree, childrenOfType, firstChildOfType, lineOf, stringLiteralValue } from '../ast.js';
import { swiftScalar } from '../builtins.js';
import type { AliasDecl, EnumCaseDecl, ExtractResult, FieldDecl, Issue, TypeDecl, TypeRef } from '../ir.js';

interface Ctx {
  file: string;
  declarations: TypeDecl[];
  aliases: AliasDecl[];
  issues: Issue[];
}

const TYPE_NODES = [
  'user_type',
  'optional_type',
  'array_type',
  'dictionary_type',
  'tuple_type',
  'function_type',
  'metatype',
  'opaque_type',
  'existential_type',
  'protocol_composition_type',
];

const KNOWN_PROTOCOLS = new Set(['Codable', 'Decodable', 'Encodable', 'Equatable', 'Hashable', 'Identifiable', 'Sendable', 'Comparable']);

export function extractSwift(tree: Tree, file: string): ExtractResult {
  const ctx: Ctx = { file, declarations: [], aliases: [], issues: [] };
  reportSyntaxErrors(tree.rootNode, ctx);
  visitMembers(tree.rootNode, [], ctx);
  return { declarations: ctx.declarations, aliases: ctx.aliases, issues: ctx.issues };
}

function reportSyntaxErrors(root: Node, ctx: Ctx): void {
  if (!root.hasError) return;
  const stack: Node[] = [root];
  while (stack.length) {
    const n = stack.pop() as Node;
    if (n.type === 'ERROR' || n.isMissing) {
      ctx.issues.push({
        severity: 'warning',
        code: 'syntax-error',
        message: `Syntax error near "${n.text.slice(0, 40).replace(/\s+/g, ' ')}"; parts of the file may be skipped.`,
        file: ctx.file,
        line: lineOf(n),
      });
      return;
    }
    for (const c of n.children) if (c.hasError || c.isMissing) stack.push(c);
  }
}

function visitMembers(parent: Node, outer: string[], ctx: Ctx): void {
  for (const child of parent.namedChildren) {
    if (child.type === 'class_declaration') extractDeclaration(child, outer, ctx);
    else if (child.type === 'typealias_declaration') extractAlias(child, ctx);
  }
}

function declarationKind(node: Node): string {
  const kind = node.childForFieldName('declaration_kind');
  if (kind) return kind.text;
  return node.children.find((c) => !c.isNamed && ['struct', 'class', 'enum', 'extension', 'actor'].includes(c.type))?.type ?? '';
}

function extractAlias(node: Node, ctx: Ctx): void {
  const name = (node.childForFieldName('name') ?? firstChildOfType(node, 'type_identifier'))?.text;
  const typeNode = node.childForFieldName('value') ?? node.namedChildren.find((c) => TYPE_NODES.includes(c.type));
  if (!name || !typeNode) return;
  ctx.aliases.push({ name, typeParams: typeParamsOf(node), type: parseType(typeNode), language: 'swift', file: ctx.file });
}

function typeParamsOf(node: Node): string[] {
  const params = firstChildOfType(node, 'type_parameters');
  if (!params) return [];
  return childrenOfType(params, 'type_parameter')
    .map((p) => firstChildOfType(p, 'type_identifier')?.text)
    .filter((t): t is string => !!t);
}

function inheritedTypes(node: Node): string[] {
  return childrenOfType(node, 'inheritance_specifier').map((s) => (s.childForFieldName('inherits_from') ?? s.namedChildren[0])?.text ?? '');
}

function extractDeclaration(node: Node, outer: string[], ctx: Ctx): void {
  const kind = declarationKind(node);
  if (kind === 'extension') return;
  const name = node.childForFieldName('name')?.text;
  if (!name || name === 'CodingKeys') return;
  const qualifiedName = [...outer, name].join('.');
  const body = node.childForFieldName('body');
  const decl: TypeDecl = {
    kind: kind === 'enum' ? 'enum' : 'class',
    name,
    qualifiedName,
    typeParams: typeParamsOf(node),
    fields: [],
    enumCases: [],
    language: 'swift',
    file: ctx.file,
    line: lineOf(node),
  };
  ctx.declarations.push(decl);
  if (!body) return;

  if (decl.kind === 'enum') {
    fillEnum(decl, node, body, ctx);
  } else {
    fillClass(decl, node, body, ctx);
  }
  visitMembers(body, [...outer, name], ctx);
}

interface EnumEntry {
  name: string;
  raw?: Node;
  associated: boolean;
}

function readEnumEntries(body: Node): EnumEntry[] {
  const entries: EnumEntry[] = [];
  for (const entry of childrenOfType(body, 'enum_entry')) {
    let current: EnumEntry | undefined;
    for (const c of entry.namedChildren) {
      if (c.type === 'simple_identifier') {
        current = { name: c.text, associated: false };
        entries.push(current);
      } else if (c.type === 'enum_type_parameters' && current) {
        current.associated = true;
      } else if (current && isRawValue(entry, c)) {
        current.raw = c;
      }
    }
  }
  return entries;
}

function isRawValue(entry: Node, child: Node): boolean {
  const raw = entry.childrenForFieldName('raw_value');
  return raw.some((r) => r.id === child.id);
}

function fillEnum(decl: TypeDecl, node: Node, body: Node, ctx: Ctx): void {
  const inherited = inheritedTypes(node);
  const rawType = inherited.find((t) => ['String', 'Int', 'Int8', 'Int16', 'Int32', 'Int64', 'UInt', 'UInt8', 'UInt16', 'UInt32', 'UInt64'].includes(t));
  const entries = readEnumEntries(body);

  if (entries.some((e) => e.associated)) {
    markUnsupported(decl, ctx, 'enum-associated-values', `${decl.qualifiedName} is an enum with associated values; its Codable format is not supported.`);
  } else if (!rawType) {
    markUnsupported(decl, ctx, 'enum-without-raw-value', `${decl.qualifiedName} is an enum without a raw type; its synthesized Codable format is not supported.`);
  }
  if (!rawType) return;

  decl.enumRaw = rawType === 'String' ? 'string' : 'int';
  let nextInt = 0;
  for (const entry of entries) {
    const c: EnumCaseDecl = { name: entry.name };
    if (decl.enumRaw === 'string') {
      const v = entry.raw && entry.raw.type !== 'integer_literal' ? literalString(entry.raw) : undefined;
      c.value = v ?? entry.name;
    } else {
      const parsed = entry.raw ? Number.parseInt(entry.raw.text, 10) : nextInt;
      c.value = Number.isNaN(parsed) ? nextInt : parsed;
      nextInt = (c.value as number) + 1;
    }
    decl.enumCases.push(c);
  }
}

function literalString(node: Node): string | undefined {
  if (node.type === 'line_string_literal' || node.type === 'string_literal') return stringLiteralValue(node);
  return undefined;
}

function markUnsupported(decl: TypeDecl, ctx: Ctx, code: string, message: string): void {
  decl.unsupported = { code, message };
  ctx.issues.push({ severity: 'warning', code, message, file: ctx.file, line: decl.line, type: decl.qualifiedName });
}

function readCodingKeys(body: Node): Map<string, string> | null {
  for (const member of childrenOfType(body, 'class_declaration')) {
    if (member.childForFieldName('name')?.text !== 'CodingKeys') continue;
    const enumBody = member.childForFieldName('body');
    if (!enumBody) continue;
    const keys = new Map<string, string>();
    for (const entry of readEnumEntries(enumBody)) {
      keys.set(entry.name, entry.raw ? (literalString(entry.raw) ?? entry.name) : entry.name);
    }
    return keys;
  }
  return null;
}

function fillClass(decl: TypeDecl, node: Node, body: Node, ctx: Ctx): void {
  const codingKeys = readCodingKeys(body);
  for (const member of body.namedChildren) {
    if (member.type === 'property_declaration') {
      const field = fieldFromProperty(member, decl.qualifiedName, ctx);
      if (!field) continue;
      if (codingKeys) {
        const key = codingKeys.get(field.name);
        if (key === undefined) {
          ctx.issues.push({
            severity: 'info',
            code: 'not-in-coding-keys',
            message: `${decl.qualifiedName}.${field.name} is not listed in CodingKeys and is not decoded.`,
            file: ctx.file,
            line: field.line,
            type: decl.qualifiedName,
            field: field.name,
          });
          continue;
        }
        if (key !== field.name) field.jsonName = key;
      }
      decl.fields.push(field);
    } else if (member.type === 'init_declaration' && isDecoderInit(member)) {
      ctx.issues.push({
        severity: 'warning',
        code: 'custom-decoder',
        message: `${decl.qualifiedName} implements init(from:); the real JSON shape may differ from the stored properties.`,
        file: ctx.file,
        line: lineOf(member),
        type: decl.qualifiedName,
      });
    }
  }
  // By convention a superclass comes first; protocols are indistinguishable without type info.
  const base = declarationKind(node) === 'class' ? inheritedTypes(node)[0] : undefined;
  if (base && !KNOWN_PROTOCOLS.has(base)) {
    ctx.issues.push({
      severity: 'info',
      code: 'inheritance',
      message: `${decl.qualifiedName} may extend ${base}; inherited fields are not included.`,
      file: ctx.file,
      line: decl.line,
      type: decl.qualifiedName,
    });
  }
}

function isDecoderInit(init: Node): boolean {
  return init.namedChildren.some((c) => c.type === 'parameter' && c.childForFieldName('external_name')?.text === 'from');
}

function fieldFromProperty(prop: Node, owner: string, ctx: Ctx): FieldDecl | null {
  const modifiers = firstChildOfType(prop, 'modifiers');
  const modifierTexts = modifiers ? modifiers.namedChildren.map((m) => m.text) : [];
  const nameNode = prop.childForFieldName('name')?.childForFieldName('bound_identifier');
  if (!nameNode) return null;
  const name = nameNode.text;
  const line = lineOf(prop);

  if (modifierTexts.some((t) => t === 'static' || t === 'class')) return null;
  if (prop.childForFieldName('computed_value')) {
    ctx.issues.push({ severity: 'info', code: 'computed-property', message: `${owner}.${name} is a computed property and is skipped.`, file: ctx.file, line, type: owner, field: name });
    return null;
  }
  if (modifierTexts.includes('lazy')) {
    ctx.issues.push({ severity: 'info', code: 'lazy-property', message: `${owner}.${name} is lazy and is skipped.`, file: ctx.file, line, type: owner, field: name });
    return null;
  }

  const binding = firstChildOfType(prop, 'value_binding_pattern')?.text.trim();
  const initializer = prop.childForFieldName('value');
  if (binding === 'let' && initializer) {
    ctx.issues.push({
      severity: 'info',
      code: 'initialized-let',
      message: `${owner}.${name} is a let constant with an initial value; Codable does not decode it.`,
      file: ctx.file,
      line,
      type: owner,
      field: name,
    });
    return null;
  }
  const wrappers = modifiers ? modifiers.namedChildren.filter((m) => m.type === 'attribute') : [];
  if (wrappers.length > 0) {
    ctx.issues.push({
      severity: 'warning',
      code: 'property-wrapper',
      message: `${owner}.${name} uses ${wrappers.map((w) => w.text).join(', ')}; a wrapper may change how the value is decoded.`,
      file: ctx.file,
      line,
      type: owner,
      field: name,
    });
  }

  const annotation = firstChildOfType(prop, 'type_annotation');
  const typeNode = annotation?.namedChildren.find((c) => TYPE_NODES.includes(c.type));
  let type: TypeRef;
  if (typeNode) {
    type = parseType(typeNode);
  } else {
    const inferred = initializer ? inferFromInitializer(initializer) : null;
    if (!inferred) {
      ctx.issues.push({ severity: 'warning', code: 'unresolved-type', message: `Cannot infer the type of ${owner}.${name}; it is treated as any.`, file: ctx.file, line, type: owner, field: name });
    }
    type = inferred ?? { kind: 'scalar', scalar: 'any', source: 'Any' };
  }
  return { name, type, hasDefault: !!initializer, line };
}

function inferFromInitializer(node: Node): TypeRef | null {
  switch (node.type) {
    case 'line_string_literal':
      return { kind: 'scalar', scalar: 'string', source: 'String' };
    case 'boolean_literal':
      return { kind: 'scalar', scalar: 'boolean', source: 'Bool' };
    case 'integer_literal':
      return { kind: 'scalar', scalar: 'int64', source: 'Int' };
    case 'real_literal':
      return { kind: 'scalar', scalar: 'double', source: 'Double' };
    default:
      return null;
  }
}

export function parseType(node: Node): TypeRef {
  switch (node.type) {
    case 'optional_type': {
      const inner = node.childForFieldName('wrapped') ?? node.namedChildren.find((c) => TYPE_NODES.includes(c.type));
      return inner ? { ...parseType(inner), nullable: true } : { kind: 'unsupported', text: node.text, nullable: true };
    }
    case 'array_type': {
      const inner = node.namedChildren.find((c) => TYPE_NODES.includes(c.type));
      return inner ? { kind: 'list', item: parseType(inner) } : { kind: 'unsupported', text: node.text };
    }
    case 'dictionary_type': {
      const parts = node.namedChildren.filter((c) => TYPE_NODES.includes(c.type));
      const value = parts[1];
      return value ? { kind: 'map', value: parseType(value) } : { kind: 'unsupported', text: node.text };
    }
    case 'user_type':
      return parseUserType(node);
    default:
      return { kind: 'unsupported', text: node.text };
  }
}

function parseUserType(node: Node): TypeRef {
  const identifiers = childrenOfType(node, 'type_identifier').map((i) => i.text);
  const argsNode = firstChildOfType(node, 'type_arguments');
  const args = argsNode ? argsNode.namedChildren.filter((c) => TYPE_NODES.includes(c.type)).map(parseType) : [];
  const simple = identifiers[identifiers.length - 1] ?? node.text;

  if ((simple === 'Array' || simple === 'Set' || simple === 'ContiguousArray') && args.length === 1) return { kind: 'list', item: args[0] as TypeRef };
  if (simple === 'Dictionary' && args.length === 2) return { kind: 'map', value: args[1] as TypeRef };
  if (simple === 'Optional' && args.length === 1) return { ...(args[0] as TypeRef), nullable: true };
  if (simple === 'Any' || simple === 'AnyHashable') return { kind: 'scalar', scalar: 'any', source: simple };
  const scalar = args.length === 0 ? swiftScalar(simple) : undefined;
  if (scalar) return { kind: 'scalar', scalar, source: simple };
  return { kind: 'named', name: identifiers.join('.') || simple, args };
}
