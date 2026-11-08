import type { Header } from '../../src/core/model';

export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'] as const;

/** Returns the JSON syntax error of a text, or undefined when it parses or is empty. */
export function jsonError(text: string): string | undefined {
  if (text.trim() === '') return undefined;
  try {
    JSON.parse(text);
    return undefined;
  } catch (error) {
    return (error as Error).message;
  }
}

/** Pretty prints JSON without touching the digits: big numbers keep their exact text. */
export function prettyJson(text: string): string {
  if (jsonError(text) !== undefined || text.trim() === '') return text;
  let out = '';
  let indent = 0;
  let inString = false;
  let escaped = false;
  const pad = () => '  '.repeat(indent);
  const compact = text.trim();
  for (let i = 0; i < compact.length; i++) {
    const ch = compact[i] as string;
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (/\s/.test(ch)) continue;
    switch (ch) {
      case '"':
        inString = true;
        out += ch;
        break;
      case '{':
      case '[': {
        const close = ch === '{' ? '}' : ']';
        if (compact[nextNonSpace(compact, i + 1)] === close) {
          out += ch + close;
          i = nextNonSpace(compact, i + 1);
        } else {
          indent++;
          out += `${ch}\n${pad()}`;
        }
        break;
      }
      case '}':
      case ']':
        indent--;
        out += `\n${pad()}${ch}`;
        break;
      case ',':
        out += `,\n${pad()}`;
        break;
      case ':':
        out += ': ';
        break;
      default:
        out += ch;
    }
  }
  return out;
}

function nextNonSpace(text: string, from: number): number {
  let i = from;
  while (i < text.length && /\s/.test(text[i] as string)) i++;
  return i;
}

export function headersToText(headers: Header[]): string {
  return headers.map((h) => `${h.key}: ${h.value}`).join('\n');
}

export function textToHeaders(text: string): Header[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const colon = line.indexOf(':');
      return colon < 0 ? { key: line, value: '' } : { key: line.slice(0, colon).trim(), value: line.slice(colon + 1).trim() };
    });
}

export function statusTone(code: number): 'ok' | 'warn' | 'error' {
  if (code >= 500) return 'error';
  if (code >= 400) return 'warn';
  return 'ok';
}

export function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour12: false });
}
