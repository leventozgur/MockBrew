import { useState } from 'react';
import type { Endpoint, Scenario, ScenarioRule } from '../../../src/core/model';
import type { MutationResponse } from '../../../src/core/view';
import { api } from '../api';
import { useStudio } from '../store';
import { Banner, Field } from './ui';

const targets: Record<string, string> = { header: 'Header', query: 'Query parameter', params: 'Route parameter', body: 'Body', cookie: 'Cookie', request_number: 'Request number', method: 'Method' };
const operators: Record<string, string> = { equals: 'equals', regex: 'matches regex', regex_i: 'matches regex (ignore case)', null: 'is empty/missing', array_includes: 'array contains', empty_array: 'is empty array' };
const placeholders: Record<string, string> = { header: 'Header name', query: 'Query key', params: 'Route param name', body: 'JSON path like $.user.type', cookie: 'Cookie name' };
const blank = (target: ScenarioRule['target'] = 'header'): ScenarioRule => ({ target, modifier: '', operator: 'equals', value: '', invert: false });
const supported = (r: Scenario['rules'][number]) => r.target in targets && r.operator in operators && !r.modifier.includes('{{') && !r.value.includes('{{');
export function ruleSummary(r: Scenario['rules'][number]): string {
  return `${r.target} ${r.modifier} ${r.invert ? 'not ' : ''}${r.operator === 'equals' ? '=' : operators[r.operator] ?? r.operator}${['null', 'empty_array'].includes(r.operator) ? '' : ` ${r.value}`}`.replace(/\s+/g, ' ').trim();
}
function validate(r: Scenario['rules'][number]): string | undefined {
  if (r.modifier.length > 1024 || (r.target in placeholders && !r.modifier.trim())) return 'A valid modifier is required (maximum 1024 characters).';
  if (r.value.length > 4096) return 'Value must be at most 4096 characters.';
  if (r.modifier.includes('{{') || r.value.includes('{{')) return 'Template expressions are not allowed.';
  if (r.operator === 'regex' || r.operator === 'regex_i') {
    if (r.value.length > 512) return 'Regular expression is too long.';
    try { new RegExp(r.value, r.operator === 'regex_i' ? 'i' : undefined); } catch { return 'Invalid regular expression.'; }
  } else if (r.target === 'request_number' && (r.operator !== 'equals' || !/^[1-9][0-9]*$/.test(r.value))) return 'Request number must be a positive integer or regular expression.';
  return undefined;
}
export function ConditionsEditor({ endpoint, scenario }: { endpoint: Endpoint; scenario: Scenario }) {
  const { act } = useStudio();
  const [rules, setRules] = useState(scenario.rules);
  const [operator, setOperator] = useState(scenario.rulesOperator);
  const [error, setError] = useState('');
  const unsupported = scenario.rules.some((r) => !supported(r));
  const disabled = endpoint.readOnly || unsupported;
  const dirty = JSON.stringify([rules, operator]) !== JSON.stringify([scenario.rules, scenario.rulesOperator]);
  const update = (i: number, patch: Partial<ScenarioRule>) => setRules((old) => old.map((r, n) => n === i ? { ...r, ...patch } : r));
  const add = (rule: ScenarioRule) => setRules((old) => [...old, rule]);
  const save = async () => {
    setError('');
    await act(async () => {
      try { return await api<MutationResponse>('PUT', `/api/endpoints/${endpoint.id}/scenarios/${scenario.id}/rules`, { rules, rulesOperator: operator }); }
      catch (e) { setError(e instanceof Error ? e.message : String(e)); throw e; }
    });
  };
  return <section className="stack conditions">
    <h3>Conditions</h3>
    {unsupported && <Banner tone="warn">Imported unsupported or unsafe conditions are read-only. They are preserved. In safe mode, a scenario with unsafe conditions has all its conditions ignored.</Banner>}
    <Field label="Combine conditions"><select value={operator} disabled={disabled} onChange={(e) => setOperator(e.target.value as 'AND' | 'OR')}><option value="AND">All conditions (AND)</option><option value="OR">Any condition (OR)</option></select></Field>
    {rules.map((rule, i) => <div className="condition-row stack" key={i}>
      {unsupported ? <code>{ruleSummary(rule)}</code> : <>
        <div className="row">
          <Field label={`Condition ${i + 1} target`}><select value={rule.target} disabled={disabled} onChange={(e) => update(i, { target: e.target.value as ScenarioRule['target'], modifier: '' })}>{Object.entries(targets).map(([v, label]) => <option value={v} key={v}>{label}</option>)}</select></Field>
          {rule.target in placeholders && <Field label={`Condition ${i + 1} modifier`}><input value={rule.modifier} placeholder={placeholders[rule.target]} disabled={disabled} onChange={(e) => update(i, { modifier: e.target.value })} /></Field>}
          <Field label={`Condition ${i + 1} operator`}><select value={rule.operator} disabled={disabled} onChange={(e) => update(i, { operator: e.target.value as ScenarioRule['operator'] })}>{Object.entries(operators).map(([v, label]) => <option value={v} key={v}>{label}</option>)}</select></Field>
          {!['null', 'empty_array'].includes(rule.operator) && <Field label={`Condition ${i + 1} value`}><input value={rule.value} disabled={disabled} onChange={(e) => update(i, { value: e.target.value })} /></Field>}
          <label className="inline"><input type="checkbox" checked={rule.invert} disabled={disabled} onChange={(e) => update(i, { invert: e.target.checked })} /> Not</label>
          <button className="button" disabled={disabled} onClick={() => setRules(rules.filter((_, n) => n !== i))} aria-label={`Remove condition ${i + 1}`}>Remove</button>
        </div>
        {validate(rule) && <span className="condition-error" role="alert">{validate(rule)}</span>}
      </>}
    </div>)}
    <div className="row"><button className="button" disabled={disabled || rules.length >= 20} onClick={() => add(blank())}>Add condition</button>
      <label className="inline">Quick preset <select aria-label="Quick preset" value="" disabled={disabled || rules.length >= 20} onChange={(e) => { const v = e.target.value; if (v === 'missing') add({ ...blank(), modifier: 'Authorization', operator: 'null' }); if (v === 'query') add(blank('query')); if (v === 'body') add(blank('body')); if (v === 'nth') add({ ...blank('request_number'), value: '1' }); }}><option value="">Choose…</option><option value="missing">Missing Authorization header → this scenario</option><option value="query">Query param equals ...</option><option value="body">Body field equals ...</option><option value="nth">Nth request</option></select></label>
    </div>
    {error && <div className="condition-error" role="alert">{error}</div>}
    <div className="row"><button className="button button-primary" disabled={disabled || !dirty || rules.length > 20 || rules.some((r) => Boolean(validate(r)))} onClick={() => void save()}>Save conditions</button><button className="button" disabled={!dirty} onClick={() => { setRules(scenario.rules); setOperator(scenario.rulesOperator); setError(''); }}>Cancel conditions</button></div>
  </section>;
}
