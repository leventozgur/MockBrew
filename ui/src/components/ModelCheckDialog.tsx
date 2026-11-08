import { useEffect, useState } from 'react';
import type { ModelCheck, ModelUpdatePreview, MutationResponse } from '../../../src/core/view';
import { ApiError, api } from '../api';
import { useStudio } from '../store';
import { Badge, Banner, Dialog, MethodBadge } from './ui';
import { ModelUpdatePreview as ScenarioPreview } from './ModelUpdatePreview';

export function ModelCheckDialog({ onClose, onChecks }: { onClose(): void; onChecks(checks: ModelCheck[]): void }) {
  const { view, act } = useStudio();
  const [checks, setChecks] = useState<ModelCheck[] | null>(null);
  const [preview, setPreview] = useState<ModelUpdatePreview | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [fillOptional, setFillOptional] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = async () => {
    setError(null); setBusy(true);
    try { const result = await api<ModelCheck[]>('GET', '/api/models/check'); setChecks(result); onChecks(result); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  useEffect(() => { void load(); }, []);

  const review = async (optional = fillOptional) => {
    setBusy(true); setError(null); setPreview(null); setSelected([]);
    try {
      const result = await api<ModelUpdatePreview>('GET', `/api/models/update/preview?fillOptional=${optional}`);
      const affected = result.endpoints.filter((endpoint) => checks?.some((check) => check.endpointId === endpoint.endpointId && check.status === 'drift'));
      setPreview({ ...result, endpoints: affected });
      setSelected(affected.flatMap((endpoint) => endpoint.scenarios.filter((s) => s.body !== undefined && !s.skipped).map((s) => s.scenarioId)));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const apply = async () => {
    if (!preview) return;
    setBusy(true); setError(null); setNotice(null);
    const selection = preview.endpoints.map((endpoint) => ({ endpointId: endpoint.endpointId, scenarioIds: endpoint.scenarios.filter((s) => selected.includes(s.scenarioId)).map((s) => s.scenarioId) })).filter((e) => e.scenarioIds.length > 0);
    try {
      const result = await api<MutationResponse>('POST', '/api/models/update/apply', { selection, previewHash: preview.hash });
      await act(async () => result);
      setPreview(null); setNotice('Selected scenarios updated.'); await load();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'STALE') { setNotice('The preview changed. Review the refreshed preview before applying.'); await review(); }
      else setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };
  const endpoints = view?.project.collections.flatMap((c) => c.endpoints) ?? [];
  return <Dialog title="Check linked models" onClose={onClose} wide><div className="stack">
    {error && <Banner tone="error">{error}</Banner>}{notice && <Banner tone="info">{notice}</Banner>}
    {!checks && !error && <span className="muted">Reading the model files…</span>}
    {checks?.length === 0 && <p className="muted">No endpoint is linked to a model yet. Generate a response from a model first.</p>}
    {checks?.map((check) => <section key={check.endpointId} className="snippet stack">
      <div className="row"><MethodBadge method={check.method} /><code>{check.path}</code><span className="muted">{check.collection} · {check.rootType}</span><span className="grow" /><Badge tone={check.status === 'ok' ? 'ok' : check.status === 'drift' ? 'warn' : 'neutral'}>{check.status === 'ok' ? 'up to date' : check.status === 'drift' ? 'changed' : 'cannot check'}</Badge></div>
      {check.reason && <span className="muted small">{check.reason}</span>}
      {check.changes.length > 0 && <ul className="issues">{check.changes.map((change, i) => <li key={i}><Badge tone={change.breaking ? 'error' : 'neutral'}>{change.breaking ? 'breaking' : 'compatible'}</Badge> {change.message}</li>)}</ul>}
      {check.violations.map((violation) => <Banner key={violation.scenarioId} tone="warn">Scenario “{violation.scenario}” no longer matches the model: {violation.errors.slice(0, 3).map((e) => `${e.path} ${e.message}`).join('; ')}</Banner>)}
    </section>)}
    {checks && checks.some((c) => c.status === 'drift') && <div className="row"><label className="inline"><input type="checkbox" checked={fillOptional} disabled={busy} onChange={(e) => { setFillOptional(e.target.checked); setPreview(null); }} /> Fill new optional fields</label><button className="button" disabled={busy} onClick={() => void review()}>Preview update</button></div>}
    {preview && <div className="stack"><h3>Update preview</h3><p className="muted small">Applying any scenario also updates its endpoint’s saved model. Unselected scenarios keep their current bodies and may need editing.</p>{preview.endpoints.map((entry) => {
      const endpoint = endpoints.find((e) => e.id === entry.endpointId);
      return <section key={entry.endpointId} className="snippet stack"><strong>{entry.method} {entry.path} · {entry.collection}</strong>
        {entry.unavailable && <Banner tone="warn">{entry.unavailable}</Banner>}
        {entry.scenarios.map((scenario) => <div className="stack" key={scenario.scenarioId}>
          {scenario.skipped || scenario.body === undefined ? <span>{scenario.scenario}: skipped — {scenario.skipped ?? 'No proposed body.'}</span> : <><label className="inline"><input type="checkbox" checked={selected.includes(scenario.scenarioId)} onChange={(e) => setSelected((previous) => e.target.checked ? [...previous, scenario.scenarioId] : previous.filter((id) => id !== scenario.scenarioId))} /> {scenario.scenario}</label><ScenarioPreview before={endpoint?.scenarios.find((s) => s.id === scenario.scenarioId)?.body ?? ''} after={scenario.body} changes={scenario.changes} /></>}
        </div>)}
        {endpoint?.scenarios.filter((s) => s.statusCode < 200 || s.statusCode >= 300).map((s) => <span key={s.id}>{s.name}: skipped — HTTP {s.statusCode} is not a 2xx response.</span>)}
      </section>;
    })}<button className="button button-primary" disabled={busy || selected.length === 0} onClick={() => void apply()}>Apply selected</button></div>}
    <div className="row-end"><button className="button" disabled={busy} onClick={() => { setPreview(null); setNotice(null); void load(); }}>Check again</button><button className="button button-primary" onClick={onClose}>Close</button></div>
  </div></Dialog>;
}
