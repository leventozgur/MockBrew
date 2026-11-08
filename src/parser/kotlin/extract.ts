import {
  type Node,
  type Tree,
  childrenOfType,
  firstChildOfType,
  hasToken,
  lineOf,
} from '../ast.js';
import { isKotlinList, isKotlinMap, kotlinPrimitiveArray, kotlinScalar } from '../builtins.js';
import type {
  AliasDecl,
  EnumCaseDecl,
  ExtractOptions,
  ExtractResult,
  FieldDecl,
  Issue,
  KotlinFramework,
  TypeDecl,
  TypeRef,
} from '../ir.js';
import { ArgReader, type FrameworkAdapter, type JsonAnnotationInfo, readAnnotations } from './annotations.js';
import { gsonAdapter } from './gson.js';
import { kotlinxAdapter } from './kotlinx.js';
import { moshiAdapter } from './moshi.js';

interface Ctx {
  file: string;
  adapters: FrameworkAdapter[];
  declarations: TypeDecl[];
  aliases: AliasDecl[];
  issues: Issue[];
  framework: KotlinFramework;
  packageName?: string;
}

const TYPE_NODES = ['user_type', 'nullable_type', 'function_type', 'parenthesized_type', 'not_nullable_type'];

function adaptersFor(framework: KotlinFramework): FrameworkAdapter[] {
  switch (framework) {
    case 'gson':
      return [gsonAdapter];
    case 'kotlinx':
      return [kotlinxAdapter];
    case 'moshi':
      return [moshiAdapter];
    default:
      return [gsonAdapter, kotlinxAdapter, moshiAdapter];
  }
}

export function extractKotlin(tree: Tree, file: string, options: ExtractOptions = {}): ExtractResult {
  const ctx: Ctx = {
    file,
    adapters: adaptersFor(options.framework ?? 'auto'),
    declarations: [],
    aliases: [],
    issues: [],
    packageName: firstChildOfType(tree.rootNode, 'package_header')?.namedChildren.find((n) => n.type === 'identifier')?.text,
    framework: options.framework && options.framework !== 'auto' ? options.framework : tree.rootNode.text.includes('kotlinx.serialization') ? 'kotlinx' : tree.rootNode.text.includes('moshi') ? 'moshi' : 'gson',
  };
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
    if (child.type === 'class_declaration' || child.type === 'object_declaration') extractClass(child, outer, ctx);
    else if (child.type === 'type_alias') extractAlias(child, ctx);
    else if (child.type === 'prefix_expression' && child.text.includes('sealed')) {
      ctx.issues.push({ severity: 'warning', code: 'unsupported-sealed-syntax', message: 'A sealed declaration could not be parsed by the Kotlin grammar; its subtypes may be missing.', file: ctx.file, line: lineOf(child) });
    }
  }
}

function extractAlias(node: Node, ctx: Ctx): void {
  const name = firstChildOfType(node, 'type_identifier')?.text;
  const typeNode = firstChildOfType(node, ...TYPE_NODES);
  if (!name || !typeNode) return;
  ctx.aliases.push({
    name,
    typeParams: typeParamsOf(node),
    type: parseType(typeNode),
    language: 'kotlin',
    file: ctx.file,
  });
}

function typeParamsOf(node: Node): string[] {
  const params = firstChildOfType(node, 'type_parameters');
  if (!params) return [];
  return childrenOfType(params, 'type_parameter')
    .map((p) => firstChildOfType(p, 'type_identifier')?.text)
    .filter((t): t is string => !!t);
}

function extractClass(node: Node, outer: string[], ctx: Ctx): void {
  const name = firstChildOfType(node, 'type_identifier')?.text;
  if (!name) return;
  if (hasToken(node, 'interface') && !firstChildOfType(node, 'modifiers')?.text.includes('sealed')) return;
  const qualifiedName = [...outer, name].join('.');
  const modifiers = firstChildOfType(node, 'modifiers');
  const classModifiers = modifiers ? childrenOfType(modifiers, 'class_modifier').map((m) => m.text) : [];
  const enumBody = firstChildOfType(node, 'enum_class_body');
  const classAnnotations = collectJsonInfo(modifiers, ctx);

  const decl: TypeDecl = {
    kind: enumBody ? 'enum' : 'class',
    name,
    qualifiedName,
    typeParams: typeParamsOf(node),
    fields: [],
    enumCases: [],
    language: 'kotlin',
    file: ctx.file,
    line: lineOf(node),
  };
  ctx.declarations.push(decl);

  if (classAnnotations.customAdapter) {
    ctx.issues.push({
      severity: 'warning',
      code: 'custom-serializer',
      message: `${qualifiedName} uses a custom serializer/adapter; the generated shape may differ from the real JSON.`,
      file: ctx.file,
      line: decl.line,
      type: qualifiedName,
    });
  }

  decl.sealed = classModifiers.includes('sealed');
  decl.object = node.type === 'object_declaration';
  decl.serialName = classAnnotations.jsonName;
  decl.packageName = ctx.packageName;
  decl.polymorphismFramework = ctx.framework;
  for (const annotation of readAnnotations(modifiers)) {
    const reader = new ArgReader(annotation);
    if (annotation.name === 'JsonClassDiscriminator') decl.discriminator = reader.string('discriminator');
    if (annotation.name === 'JsonClass') {
      const generator = reader.string('generator');
      if (generator?.startsWith('sealed:')) decl.discriminator = generator.slice('sealed:'.length);
    }
  }
  decl.parentNames = childrenOfType(node, 'delegation_specifier').map((spec) => {
    const invocation = firstChildOfType(spec, 'constructor_invocation');
    return firstChildOfType(invocation ?? spec, 'user_type')?.text ?? '';
  }).filter(Boolean);

  if (enumBody) {
    decl.enumCases = extractEnumCases(enumBody, ctx);
    visitMembers(enumBody, [...outer, name], ctx);
    return;
  }

  const ctor = firstChildOfType(node, 'primary_constructor');
  if (ctor) {
    for (const param of childrenOfType(ctor, 'class_parameter')) {
      const field = fieldFromParameter(param, qualifiedName, ctx);
      if (field) decl.fields.push(field);
    }
  }

  const body = firstChildOfType(node, 'class_body');
  if (body) {
    for (const member of body.namedChildren) {
      if (member.type === 'property_declaration') {
        const field = fieldFromProperty(member, qualifiedName, ctx);
        if (field) decl.fields.push(field);
      }
    }
    visitMembers(body, [...outer, name], ctx);
  }
}

function collectJsonInfo(modifiers: Node | null, ctx: Ctx): JsonAnnotationInfo {
  const info: JsonAnnotationInfo = {};
  for (const annotation of readAnnotations(modifiers)) {
    const reader = new ArgReader(annotation);
    for (const adapter of ctx.adapters) adapter.apply(annotation, reader, info);
  }
  return info;
}

function fieldFromParameter(param: Node, owner: string, ctx: Ctx): FieldDecl | null {
  const binding = firstChildOfType(param, 'binding_pattern_kind');
  if (!binding) return null;
  const nameNode = firstChildOfType(param, 'simple_identifier');
  const typeNode = firstChildOfType(param, ...TYPE_NODES);
  if (!nameNode || !typeNode) return null;
  return buildField(
    nameNode.text,
    parseType(typeNode),
    param.children.some((c) => c.type === '='),
    collectJsonInfo(firstChildOfType(param, 'modifiers'), ctx),
    lineOf(param),
    owner,
    ctx,
  );
}

function fieldFromProperty(prop: Node, owner: string, ctx: Ctx): FieldDecl | null {
  if (!firstChildOfType(prop, 'binding_pattern_kind')) return null;
  const variable = firstChildOfType(prop, 'variable_declaration');
  const nameNode = variable ? firstChildOfType(variable, 'simple_identifier') : null;
  if (!variable || !nameNode) return null;
  const hasInitializer = prop.children.some((c) => c.type === '=');
  const name = nameNode.text;
  const line = lineOf(prop);

  if (firstChildOfType(prop, 'property_delegate')) {
    ctx.issues.push({
      severity: 'info',
      code: 'delegated-property',
      message: `${owner}.${name} uses a property delegate and is skipped.`,
      file: ctx.file,
      line,
      type: owner,
      field: name,
    });
    return null;
  }
  if (firstChildOfType(prop, 'getter') && !hasInitializer) {
    ctx.issues.push({
      severity: 'info',
      code: 'computed-property',
      message: `${owner}.${name} is a computed property and is skipped.`,
      file: ctx.file,
      line,
      type: owner,
      field: name,
    });
    return null;
  }

  const typeNode = firstChildOfType(variable, ...TYPE_NODES);
  let type: TypeRef;
  if (typeNode) {
    type = parseType(typeNode);
  } else {
    const inferred = inferFromInitializer(prop);
    if (!inferred) {
      ctx.issues.push({
        severity: 'warning',
        code: 'unresolved-type',
        message: `Cannot infer the type of ${owner}.${name}; it is treated as any.`,
        file: ctx.file,
        line,
        type: owner,
        field: name,
      });
    }
    type = inferred ?? { kind: 'scalar', scalar: 'any', source: 'Any' };
  }
  return buildField(name, type, hasInitializer, collectJsonInfo(firstChildOfType(prop, 'modifiers'), ctx), line, owner, ctx);
}

function inferFromInitializer(prop: Node): TypeRef | null {
  const eq = prop.children.findIndex((c) => c.type === '=');
  const init = eq >= 0 ? prop.children[eq + 1] : undefined;
  if (!init) return null;
  const text = init.text;
  switch (init.type) {
    case 'string_literal':
      return { kind: 'scalar', scalar: 'string', source: 'String' };
    case 'boolean_literal':
      return { kind: 'scalar', scalar: 'boolean', source: 'Boolean' };
    case 'integer_literal':
      return /[lL]$/.test(text)
        ? { kind: 'scalar', scalar: 'int64', source: 'Long' }
        : { kind: 'scalar', scalar: 'int32', source: 'Int' };
    case 'real_literal':
      return { kind: 'scalar', scalar: 'double', source: 'Double' };
    default:
      return null;
  }
}

function buildField(
  name: string,
  type: TypeRef,
  hasDefault: boolean,
  info: JsonAnnotationInfo,
  line: number,
  owner: string,
  ctx: Ctx,
): FieldDecl | null {
  if (info.transient) return null;
  if (info.unresolved) {
    ctx.issues.push({
      severity: 'warning',
      code: 'unresolved-annotation',
      message: `@${info.unresolved} on ${owner}.${name} does not use a string literal; the property name is used instead.`,
      file: ctx.file,
      line,
      type: owner,
      field: name,
    });
  }
  let fieldType = type;
  if (info.customAdapter) {
    ctx.issues.push({
      severity: 'warning',
      code: 'custom-serializer',
      message: `${owner}.${name} uses a custom adapter; its JSON shape is unknown and treated as any.`,
      file: ctx.file,
      line,
      type: owner,
      field: name,
    });
    fieldType = { kind: 'scalar', scalar: 'any', source: 'Any', nullable: type.nullable };
  }
  const field: FieldDecl = { name, type: fieldType, hasDefault, line };
  if (info.jsonName) field.jsonName = info.jsonName;
  if (info.alternateNames) field.alternateNames = info.alternateNames;
  return field;
}

function extractEnumCases(body: Node, ctx: Ctx): EnumCaseDecl[] {
  const cases: EnumCaseDecl[] = [];
  for (const entry of childrenOfType(body, 'enum_entry')) {
    const name = firstChildOfType(entry, 'simple_identifier')?.text;
    if (!name) continue;
    const info = collectJsonInfo(firstChildOfType(entry, 'modifiers'), ctx);
    const decl: EnumCaseDecl = { name };
    if (info.jsonName !== undefined) decl.value = info.jsonName;
    cases.push(decl);
  }
  return cases;
}

export function parseType(node: Node): TypeRef {
  switch (node.type) {
    case 'nullable_type': {
      const inner = node.namedChildren.find((c) => TYPE_NODES.includes(c.type));
      return inner ? { ...parseType(inner), nullable: true } : { kind: 'unsupported', text: node.text, nullable: true };
    }
    case 'parenthesized_type':
    case 'not_nullable_type': {
      const inner = node.namedChildren.find((c) => TYPE_NODES.includes(c.type));
      return inner ? parseType(inner) : { kind: 'unsupported', text: node.text };
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
  const args: TypeRef[] = argsNode
    ? childrenOfType(argsNode, 'type_projection').map((p) => {
        const inner = p.namedChildren.find((c) => TYPE_NODES.includes(c.type));
        return inner ? parseType(inner) : ({ kind: 'scalar', scalar: 'any', source: '*' } as TypeRef);
      })
    : [];
  const simple = identifiers[identifiers.length - 1] ?? node.text;

  const arrayScalar = kotlinPrimitiveArray(simple);
  if (arrayScalar) return { kind: 'list', item: { kind: 'scalar', scalar: arrayScalar, source: simple } };
  if (isKotlinList(simple) && args.length === 1) return { kind: 'list', item: args[0] as TypeRef };
  if (isKotlinMap(simple) && args.length === 2) return { kind: 'map', value: args[1] as TypeRef };
  const scalar = args.length === 0 ? kotlinScalar(simple) : undefined;
  if (scalar) return { kind: 'scalar', scalar, source: simple };
  return { kind: 'named', name: identifiers.join('.') || simple, args };
}
