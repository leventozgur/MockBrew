import { useEffect, useMemo, useState } from 'react';
import type { Endpoint, ModelLink, Scenario } from '../../../src/core/model';
import type { MutationResponse } from '../../../src/core/view';
import type { ValidationIssue } from '../../../src/schema/types';
import { api } from '../api';
import { useStudio } from '../store';
import { headersToText, jsonError, prettyJson, textToHeaders } from '../util';
import { GenerateDialog, type GenerateResult } from './GenerateDialog';
import { Badge, Banner, Field } from './ui';

interface Draft {
  name: string;
  statusCode: string;
  latencyMs: string;
  headers: string;
  body: string;
}

function toDraft(scenario: Scenario): Draft {
  return {
    name: scenario.name,
    statusCode: String(scenario.statusCode),
    latencyMs: String(scenario.latencyMs),
    headers: headersToText(scenario.headers),
    body: scenario.body,
  };
}

function isJson(headers: string): boolean {
  const line = headers.split('\n').find((l) => l.trim().toLowerCase().startsWith('content-type'));
  return !line || line.toLowerCase().includes('json');
}

export function ScenarioEditor({ endpoint, scenario, violations }: { endpoint: Endpoint; scenario: Scenario; violations: ValidationIssue[] }) {
  const { act } = useStudio();
  const serverDraft = useMemo(() => toDraft(scenario), [scenario]);
  const serverKey = JSON.stringify(serverDraft);
  const [draft, setDraft] = useState<Draft>(serverDraft);
  const [pendingLink, setPendingLink] = useState<ModelLink | null>(null);
  const [baseKey, setBaseKey] = useState(serverKey);
  const [generating, setGenerating] = useState(false);

  const dirty = JSON.stringify(draft) !== baseKey || pendingLink !== null;
  const diskChanged = serverKey !== baseKey;

  useEffect(() => {
    // Without local edits the editor simply follows the saved state.
    if (!dirty && diskChanged) {
      setDraft(serverDraft);
      setBaseKey(serverKey);
    }
  }, [dirty, diskChanged, serverDraft, serverKey]);

  const syntaxError = isJson(draft.headers) ? jsonError(draft.body) : undefined;
  const statusValid = /^\d{3}$/.test(draft.statusCode);
  const latencyValid = /^\d+$/.test(draft.latencyMs);
  const canSave = dirty && !syntaxError && statusValid && latencyValid && draft.name.trim() !== '' && !endpoint.readOnly;
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const save = async () => {
    const result = await act(() =>
      api<MutationResponse>('PATCH', `/api/endpoints/${endpoint.id}/scenarios/${scenario.id}`, {
        name: draft.name,
        statusCode: Number(draft.statusCode),
        latencyMs: Number(draft.latencyMs),
        headers: textToHeaders(draft.headers),
        body: draft.body,
      }),
    );
    if (!result) return;
    if (pendingLink) await act(() => api<MutationResponse>('PUT', `/api/endpoints/${endpoint.id}/model`, pendingLink));
    setPendingLink(null);
    setBaseKey(JSON.stringify(draft));
  };

  const onGenerated = (result: GenerateResult) => {
    set({ body: result.body });
    setPendingLink(result.link);
  };

  return (
    <div className="stack scenario-editor">
      {diskChanged && dirty && (
        <Banner tone="warn">
          This scenario changed on disk while you were editing.{' '}
          <button className="link" onClick={() => { setDraft(serverDraft); setBaseKey(serverKey); setPendingLink(null); }}>
            Load the disk version
          </button>{' '}
          or save to overwrite it.
        </Banner>
      )}
      <div className="row">
        <Field label="Name">
          <input value={draft.name} onChange={(e) => set({ name: e.target.value })} disabled={endpoint.readOnly} />
        </Field>
        <Field label="Status">
          <input value={draft.statusCode} onChange={(e) => set({ statusCode: e.target.value })} size={5} className={statusValid ? '' : 'invalid'} disabled={endpoint.readOnly} />
        </Field>
        <Field label="Latency (ms)">
          <input value={draft.latencyMs} onChange={(e) => set({ latencyMs: e.target.value })} size={6} className={latencyValid ? '' : 'invalid'} disabled={endpoint.readOnly} />
        </Field>
      </div>
      <Field label="Headers" hint="One per line, Name: value">
        <textarea className="code" rows={3} value={draft.headers} onChange={(e) => set({ headers: e.target.value })} spellCheck={false} disabled={endpoint.readOnly} />
      </Field>
      <Field label="Body">
        <textarea className={`code${syntaxError ? ' invalid' : ''}`} rows={14} value={draft.body} onChange={(e) => set({ body: e.target.value })} spellCheck={false} disabled={endpoint.readOnly} />
      </Field>
      {syntaxError && <Banner tone="error">Not valid JSON: {syntaxError}. It cannot be saved.</Banner>}
      {violations.length > 0 && (
        <Banner tone="warn">
          Differs from {endpoint.model?.rootType ?? 'the model'}:
          <ul className="issues">
            {violations.slice(0, 8).map((v, i) => (
              <li key={i}>
                <code>{v.path}</code> {v.message}
              </li>
            ))}
          </ul>
        </Banner>
      )}
      <div className="row">
        <button className="button button-primary" disabled={!canSave} onClick={() => void save()}>
          Save
        </button>
        <button className="button" disabled={!dirty} onClick={() => { setDraft(serverDraft); setBaseKey(serverKey); setPendingLink(null); }}>
          Revert
        </button>
        <button className="button" disabled={Boolean(syntaxError) || draft.body.trim() === ''} onClick={() => set({ body: prettyJson(draft.body) })}>
          Format JSON
        </button>
        <button className="button" disabled={endpoint.readOnly} onClick={() => setGenerating(true)}>
          Generate from model…
        </button>
        {pendingLink && <Badge tone="accent">model {pendingLink.rootType} will be linked on save</Badge>}
        {dirty && <span className="muted">unsaved changes</span>}
      </div>
      {generating && <GenerateDialog onClose={() => setGenerating(false)} onResult={onGenerated} />}
    </div>
  );
}
