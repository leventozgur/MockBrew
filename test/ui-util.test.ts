import { describe, expect, it } from 'vitest';
import { headersToText, jsonError, prettyJson, statusTone, textToHeaders } from '../ui/src/util.js';

describe('UI helpers', () => {
  it('formats JSON without touching digits or string contents', () => {
    const input = '{"id":9007199254740993,"text":"a {b} [c], \\"d\\": e","list":[1,2,{"x":[]}],"empty":{},"n":null}';
    const pretty = prettyJson(input);
    expect(pretty).toContain('"id": 9007199254740993');
    expect(pretty).toContain('"text": "a {b} [c], \\"d\\": e"');
    expect(pretty).toContain('"empty": {}');
    expect(pretty).toContain('"x": []');
    expect(JSON.parse(pretty)).toEqual(JSON.parse(input));
    expect(pretty.split('\n').length).toBeGreaterThan(8);
  });

  it('leaves invalid or empty text unchanged', () => {
    expect(prettyJson('{oops')).toBe('{oops');
    expect(prettyJson('')).toBe('');
  });

  it('reports JSON syntax errors but accepts empty bodies', () => {
    expect(jsonError('')).toBeUndefined();
    expect(jsonError('  ')).toBeUndefined();
    expect(jsonError('{"a":1}')).toBeUndefined();
    expect(jsonError('{"a":')).toBeDefined();
  });

  it('round trips headers', () => {
    const headers = [
      { key: 'Content-Type', value: 'application/json; charset=utf-8' },
      { key: 'X-Trace', value: 'a:b:c' },
    ];
    expect(textToHeaders(headersToText(headers))).toEqual(headers);
    expect(textToHeaders('  \n X-Empty \n')).toEqual([{ key: 'X-Empty', value: '' }]);
  });

  it('colours status codes', () => {
    expect([200, 301, 404, 503].map(statusTone)).toEqual(['ok', 'ok', 'warn', 'error']);
  });
});
