import { describe, expect, it } from 'vitest';
import { expandTokens, validateTokens } from '../src/runtime/tokens.js';

describe('allowlisted response tokens', () => {
  it('escapes values in JSON strings and inserts whole JSON values', () => {
    const body = expandTokens('{"id":"{{request.params.id}}","item":{{json request.body.$.item}},"missing":{{json request.body.$.missing}}}', {
      params: { id: 'quote " and newline\n' }, body: { item: { tags: [1, true] } },
    }, true);
    expect(JSON.parse(body)).toEqual({ id: 'quote " and newline\n', item: { tags: [1, true] }, missing: null });
  });

  it('resolves request data, variables, time, UUID and missing values', () => {
    const context = { params: { id: '42' }, query: { q: 'word' }, headers: { 'content-type': 'application/json' }, body: { a: { b: ['zero'] } }, vars: { name: 'value' } };
    expect(expandTokens('{{request.params.id}} {{request.query.q}} {{request.header.Content-Type}} {{request.body.$.a.b[0]}} {{vars.name}} {{vars.absent}}', context)).toBe('42 word application/json zero value ');
    expect(expandTokens('{{uuid}}', context)).toMatch(/^[a-f0-9-]{36}$/);
    expect(Date.parse(expandTokens('{{now}}', context))).not.toBeNaN();
    expect(Number(expandTokens('{{now:epoch}}', context))).toBeGreaterThan(1_000_000_000);
    expect(Number(expandTokens('{{now:epochMillis}}', context))).toBeGreaterThan(1_000_000_000_000);
  });

  it('does not evaluate other template expressions or inherited properties', () => {
    const unsafe = "{{faker 'person.firstName'}} {{#each}} {{lookup}} {{{triple}}} {{setVar}}";
    expect(expandTokens(unsafe, {})).toBe(unsafe);
    expect(validateTokens(unsafe)).toHaveLength(5);
    expect(expandTokens('{{request.body.$.constructor}}', { body: {} })).toBe('');
    expect(expandTokens('{"errors":{{json validation.errors}}}', { validation: { errors: [{ path: '$.id' }] } }, true)).toBe('{"errors":[{"path":"$.id"}]}');
  });

  it('supports hyphenated request names and preserves unsupported whole-value expressions', () => {
    const context = { params: { 'user-id': 'a"b' }, query: { 'sort-order': 'asc' } };
    expect(expandTokens('{"id":"{{request.params.user-id}}","order":"{{request.query.sort-order}}"}', context, true))
      .toBe('{"id":"a\\"b","order":"asc"}');
    expect(expandTokens('{"id":{{request.params.user-id}}}', context, true))
      .toBe('{"id":{{request.params.user-id}}}');
    expect(validateTokens('{{request.params.user-id}} {{request.query.sort-order}}')).toEqual([]);
  });
});
