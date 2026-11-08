import { type Node, childrenOfType, firstChildOfType, stringLiteralValue } from '../ast.js';
import type { KotlinFramework } from '../ir.js';

export interface AnnotationArg {
  name?: string;
  value: Node;
}

export interface Annotation {
  name: string;
  args: AnnotationArg[];
  node: Node;
}

/** What the annotations on one property or enum entry tell about its JSON form. */
export interface JsonAnnotationInfo {
  jsonName?: string;
  alternateNames?: string[];
  transient?: boolean;
  customAdapter?: boolean;
  unresolved?: string;
}

export interface FrameworkAdapter {
  id: Exclude<KotlinFramework, 'auto'>;
  apply(annotation: Annotation, reader: ArgReader, out: JsonAnnotationInfo): void;
}

export class ArgReader {
  constructor(private readonly annotation: Annotation) {}

  /** Named argument, or the positional one at `index` when no name is used. */
  private find(name: string, index: number): Node | undefined {
    const named = this.annotation.args.find((a) => a.name === name);
    if (named) return named.value;
    const positional = this.annotation.args.filter((a) => !a.name);
    return positional[index]?.value;
  }

  string(name: string, index = 0): string | undefined {
    const node = this.find(name, index);
    return node && node.type === 'string_literal' ? stringLiteralValue(node) : undefined;
  }

  hasArg(name: string, index = 0): boolean {
    return this.find(name, index) !== undefined;
  }

  strings(name: string, index = 0): string[] | undefined {
    const node = this.find(name, index);
    if (!node) return undefined;
    const items = node.type === 'collection_literal' ? node.namedChildren : [node];
    const values: string[] = [];
    for (const item of items) {
      const v = item.type === 'string_literal' ? stringLiteralValue(item) : undefined;
      if (v !== undefined) values.push(v);
    }
    return values;
  }

  boolean(name: string): boolean | undefined {
    const node = this.annotation.args.find((a) => a.name === name)?.value;
    if (!node) return undefined;
    if (node.text === 'true') return true;
    if (node.text === 'false') return false;
    return undefined;
  }
}

export function readAnnotations(modifiers: Node | null): Annotation[] {
  if (!modifiers) return [];
  const result: Annotation[] = [];
  for (const annotation of childrenOfType(modifiers, 'annotation')) {
    const invocation = firstChildOfType(annotation, 'constructor_invocation');
    const typeNode = invocation ? firstChildOfType(invocation, 'user_type') : firstChildOfType(annotation, 'user_type');
    if (!typeNode) continue;
    const identifiers = childrenOfType(typeNode, 'type_identifier');
    const name = identifiers[identifiers.length - 1]?.text;
    if (!name) continue;
    const args: AnnotationArg[] = [];
    const valueArgs = invocation ? firstChildOfType(invocation, 'value_arguments') : null;
    if (valueArgs) {
      for (const arg of childrenOfType(valueArgs, 'value_argument')) {
        const named = arg.children.some((c) => c.type === '=');
        const first = arg.children[0];
        const value = arg.namedChildren[arg.namedChildren.length - 1];
        if (!value) continue;
        args.push({ name: named && first ? first.text : undefined, value });
      }
    }
    result.push({ name, args, node: annotation });
  }
  return result;
}
