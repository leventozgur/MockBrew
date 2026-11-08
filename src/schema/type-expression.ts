import { isKotlinList, isKotlinMap, kotlinScalar, swiftScalar } from '../parser/builtins.js';
import type { TypeRef } from '../parser/ir.js';

/**
 * Parses a type written by the user, e.g. `BaseResponse<List<User>>`, `[User]`, `[String: Int]?`.
 * Plain names stay unresolved `named` refs; declarations are looked up later.
 */
export function parseTypeExpression(text: string): TypeRef {
  const parser = new TypeParser(text);
  const ref = parser.parseType();
  parser.expectEnd();
  return ref;
}

class TypeParser {
  private pos = 0;

  constructor(private readonly text: string) {}

  private fail(message: string): never {
    throw new Error(`Invalid type "${this.text}": ${message}`);
  }

  private skipSpace(): void {
    while (/\s/.test(this.text[this.pos] ?? '')) this.pos++;
  }

  private peek(): string {
    this.skipSpace();
    return this.text[this.pos] ?? '';
  }

  private eat(ch: string): boolean {
    if (this.peek() === ch) {
      this.pos++;
      return true;
    }
    return false;
  }

  expectEnd(): void {
    if (this.peek() !== '') this.fail(`unexpected "${this.text.slice(this.pos)}"`);
  }

  parseType(): TypeRef {
    let ref = this.parseBase();
    while (this.peek() === '?' || this.peek() === '!') {
      this.pos++;
      ref = { ...ref, nullable: true };
    }
    return ref;
  }

  private parseBase(): TypeRef {
    if (this.eat('[')) {
      const first = this.parseType();
      if (this.eat(':')) {
        const value = this.parseType();
        if (!this.eat(']')) this.fail('missing "]"');
        return { kind: 'map', value };
      }
      if (!this.eat(']')) this.fail('missing "]"');
      return { kind: 'list', item: first };
    }
    this.skipSpace();
    const identMatch = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(this.text.slice(this.pos));
    if (!identMatch) this.fail('type name expected');
    const name = identMatch[0];
    this.pos += name.length;
    const args: TypeRef[] = [];
    if (this.eat('<')) {
      do {
        args.push(this.parseType());
      } while (this.eat(','));
      if (!this.eat('>')) this.fail('missing ">"');
    }
    return resolveBuiltin(name, args);
  }
}

function resolveBuiltin(name: string, args: TypeRef[]): TypeRef {
  const simple = name.split('.').pop() as string;
  if ((isKotlinList(simple) || simple === 'ContiguousArray') && args.length === 1) return { kind: 'list', item: args[0] as TypeRef };
  if ((isKotlinMap(simple) || simple === 'Dictionary') && args.length === 2) return { kind: 'map', value: args[1] as TypeRef };
  if (simple === 'Optional' && args.length === 1) return { ...(args[0] as TypeRef), nullable: true };
  if (args.length === 0) {
    const scalar = kotlinScalar(simple) ?? swiftScalar(simple);
    if (scalar) return { kind: 'scalar', scalar, source: simple };
  }
  return { kind: 'named', name, args };
}
