import type Parser from 'web-tree-sitter';

export type Node = Parser.SyntaxNode;
export type Tree = Parser.Tree;

export function firstChildOfType(node: Node, ...types: string[]): Node | null {
  for (const c of node.children) {
    if (types.includes(c.type)) return c;
  }
  return null;
}

export function childrenOfType(node: Node, ...types: string[]): Node[] {
  return node.children.filter((c) => types.includes(c.type));
}

export function hasToken(node: Node, token: string): boolean {
  return node.children.some((c) => !c.isNamed && c.type === token);
}

export function lineOf(node: Node): number {
  return node.startPosition.row + 1;
}

/** Content of a plain string literal node, or undefined when it uses interpolation. */
export function stringLiteralValue(node: Node): string | undefined {
  const text = node.text;
  if (text.includes('$') || text.includes('\\(')) return undefined;
  if (text.startsWith('"""')) return text.slice(3, -3);
  if (text.startsWith('"') && text.endsWith('"')) return unescapeString(text.slice(1, -1));
  return undefined;
}

function unescapeString(s: string): string {
  return s.replace(/\\(["\\nrt$'])/g, (_m, c: string) => ({ n: '\n', r: '\r', t: '\t' })[c] ?? c);
}
