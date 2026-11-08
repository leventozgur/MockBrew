import { useEffect, useMemo, useRef, useState } from 'react';
import type { Endpoint, ModelLink, Scenario } from '../../../src/core/model';
import type { MutationResponse, TokenReport } from '../../../src/core/view';
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
  dynamic: boolean;
  file: string;
  source: 'inline' | 'file';
}

function toDraft(scenario: Scenario): Draft {
  return {
    name: scenario.name,
    statusCode: String(scenario.statusCode),
    latencyMs: String(scenario.latencyMs),
    headers: headersToText(scenario.headers),
    body: scenario.body,
    dynamic: scenario.dynamic === true,
    file: scenario.bodyFile ?? '',
    source: scenario.bodyFile ? 'file' : 'inline',
  };
}

function isJson(headers: string): boolean {
  const line = headers.split('\n').find((l) => l.trim().toLowerCase().startsWith('content-type'));
  return !line || line.toLowerCase().includes('json');
}

const fileTypes: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon',
  pdf: 'application/pdf', json: 'application/json; charset=utf-8', txt: 'text/plain; charset=utf-8', csv: 'text/csv; charset=utf-8',
  html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', xml: 'application/xml',
  zip: 'application/zip', mp4: 'video/mp4', mp3: 'audio/mpeg', wav: 'audio/wav',
};

export function ScenarioEditor({ endpoint, scenario, violations }: { endpoint: Endpoint; scenario: Scenario; violations: ValidationIssue[] }) {
  const { act, applyView } = useStudio();
  const serverDraft = useMemo(() => toDraft(scenario), [scenario]);
  const serverKey = JSON.stringify(serverDraft);
  const [draft, setDraft] = useState<Draft>(serverDraft);
  const [pendingLink, setPendingLink] = useState<ModelLink | null>(null);
  const [baseKey, setBaseKey] = useState(serverKey);
  const [generating, setGenerating] = useState(false);
  const bodyInput = useRef<HTMLTextAreaElement>(null);
  const [fileError, setFileError] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  useEffect(() => {
    if (!scenario.dynamic) { setWarnings([]); return; }
    void api<TokenReport[]>('GET', `/api/tokens/validate?endpointId=${encodeURIComponent(endpoint.id)}&scenarioId=${encodeURIComponent(scenario.id)}`)
      .then((reports) => setWarnings(reports.flatMap((report) => report.unknownTokens))).catch(() => setWarnings([]));
  }, [endpoint.id, scenario.id, scenario.dynamic, scenario.body, scenario.headers]);

  const dirty = JSON.stringify(draft) !== baseKey || pendingLink !== null;
  const diskChanged = serverKey !== baseKey;

  useEffect(() => {
    // Without local edits the editor simply follows the saved state.
    if (!dirty && diskChanged) {
      setDraft(serverDraft);
      setBaseKey(serverKey);
    }
  }, [dirty, diskChanged, serverDraft, serverKey]);

  const syntaxError = draft.source === 'inline' && isJson(draft.headers) ? jsonError(draft.dynamic ? draft.body.replace(/\{\{\s*json\s+(?:request\.body\.(?:\$\.)?[A-Za-z_][A-Za-z0-9_]*(?:(?:\.[A-Za-z_][A-Za-z0-9_]*)|(?:\[\d+\]))*|validation\.errors)\s*\}\}/g, 'null') : draft.body) : undefined;
  const statusValid = /^\d{3}$/.test(draft.statusCode);
  const latencyValid = /^\d+$/.test(draft.latencyMs);
  const canSave = dirty && !syntaxError && statusValid && latencyValid && draft.name.trim() !== '' && !endpoint.readOnly;
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const save = async () => {
    setFileError('');
    if (draft.source === 'file' && !draft.file.trim()) { setFileError('Enter a file path.'); return; }
    let savedHeaders = draft.headers;
    if (draft.source === 'file' || scenario.bodyFile) {
      try {
        const result = await api<MutationResponse>('PUT', `/api/endpoints/${endpoint.id}/scenarios/${scenario.id}/file`, { file: draft.source === 'file' ? draft.file : null });
        applyView(result.view);
        if (draft.source === 'file') {
          const updated = result.view.project.collections.flatMap((c) => c.endpoints).find((e) => e.id === endpoint.id)?.scenarios.find((s) => s.id === scenario.id);
          const contentType = updated?.headers.find((h) => h.key.toLowerCase() === 'content-type');
          if (contentType) savedHeaders = headersToText([contentType, ...textToHeaders(draft.headers).filter((h) => h.key.toLowerCase() !== 'content-type')]);
        }
      } catch (e) { setFileError(e instanceof Error ? e.message : String(e)); return; }
    }
    if (draft.dynamic && !scenario.dynamic) {
      const result = await act(() => api<MutationResponse>('PUT', `/api/endpoints/${endpoint.id}/scenarios/${scenario.id}/dynamic`, { dynamic: true }));
      if (!result) return;
    }
    const result = await act(() =>
      api<MutationResponse>('PATCH', `/api/endpoints/${endpoint.id}/scenarios/${scenario.id}`, {
        name: draft.name,
        statusCode: Number(draft.statusCode),
        latencyMs: Number(draft.latencyMs),
        headers: textToHeaders(savedHeaders),
        body: draft.body,
      }),
    );
    if (!result) return;
    if (!draft.dynamic && scenario.dynamic) {
      const updated = await act(() => api<MutationResponse>('PUT', `/api/endpoints/${endpoint.id}/scenarios/${scenario.id}/dynamic`, { dynamic: false }));
      if (!updated) return;
    }
    if (pendingLink) await act(() => api<MutationResponse>('PUT', `/api/endpoints/${endpoint.id}/model`, pendingLink));
    setPendingLink(null);
    const savedDraft = { ...draft, headers: savedHeaders, file: draft.source === 'file' ? draft.file.replace(/\\/g, '/').replace(/^\.\//, '') : '' };
    setDraft(savedDraft);
    setBaseKey(JSON.stringify(savedDraft));
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
      <label className="inline"><input type="checkbox" checked={draft.dynamic} onChange={(e) => set({ dynamic: e.target.checked })} disabled={endpoint.readOnly} /> Dynamic values</label>
      <p className="muted small">Fill allowlisted tokens from each request. Unknown tokens remain literal. Save to check for unknown tokens.</p>
      {draft.dynamic && <Field label="Insert token" hint="Replace example names and paths as needed. JSON forms insert whole values outside strings.">
        <select value="" onChange={(e) => { const token = e.target.value; if (!token) return; const input = bodyInput.current; const start = input?.selectionStart ?? draft.body.length; const end = input?.selectionEnd ?? start; set({ body: draft.body.slice(0, start) + token + draft.body.slice(end) }); window.requestAnimationFrame(() => { input?.focus(); input?.setSelectionRange(start + token.length, start + token.length); }); }} disabled={endpoint.readOnly}>
          <option value="">Choose a token…</option>
          {[
            ['{{uuid}}', 'UUID'], ['{{now}}', 'Current ISO date'], ['{{now:epoch}}', 'Epoch seconds'], ['{{now:epochMillis}}', 'Epoch milliseconds'],
            ['{{request.params.id}}', 'Path parameter'], ['{{request.query.name}}', 'Query parameter'], ['{{request.header.X-Example}}', 'Request header'],
            ['{{request.body.$.name}}', 'Request body value'], ['{{vars.name}}', 'Project variable'], ['{{validation.errors}}', 'Validation errors as text'],
            ['{{json request.body.$.item}}', 'Whole JSON body value'], ['{{json validation.errors}}', 'Whole JSON error list'],
          ].map(([token, description]) => <option key={token} value={token}>{token} — {description}</option>)}
        </select>
      </Field>}
      {draft.dynamic && warnings.length > 0 && <Banner tone="warn">Unknown tokens in saved scenario: {warnings.join(', ')}</Banner>}
      <Field label="Body source"><select value={draft.source} onChange={(e) => set({ source: e.target.value as Draft['source'] })} disabled={endpoint.readOnly}><option value="inline">Inline</option><option value="file">File</option></select></Field>
      {draft.source === 'file' && <><Field label="File path" hint="Relative to the project folder. The server checks the path when saved."><input value={draft.file} onChange={(e) => { set({ file: e.target.value }); setFileError(''); }} disabled={endpoint.readOnly} /></Field>{fileError && <Banner tone="error">{fileError}</Banner>}<p className="muted small">Content type: {fileTypes[/\.([^.\/\\]+)$/.exec(draft.file)?.[1]?.toLowerCase() ?? ''] ?? 'application/octet-stream'} (based on extension)</p></>}
      {draft.source === 'inline' && <Field label="Body">
        <textarea ref={bodyInput} className={`code${syntaxError ? ' invalid' : ''}`} rows={14} value={draft.body} onChange={(e) => set({ body: e.target.value })} spellCheck={false} disabled={endpoint.readOnly} />
      </Field>}
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
        <button className="button" disabled={draft.source !== 'inline' || Boolean(syntaxError) || draft.body.trim() === ''} onClick={() => set({ body: prettyJson(draft.body) })}>
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
