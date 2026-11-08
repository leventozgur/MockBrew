import { useEffect, useState } from 'react';
import type { MutationResponse, Recording } from '../../../src/core/view';
import { api, downloadExport } from '../api';
import { useStudio } from '../store';
import { Banner, Dialog, Field, MethodBadge } from './ui';

type Strategy = 'skip' | 'rename' | 'replace';
type Preview = { hash: string; bundle: { collections: { name: string; endpoints: { method: string; path: string; scenarios: { name: string; statusCode: number }[] }[] }[] }; newCollections: string[]; conflicts: { collection: string; method: string; path: string; existingCollection: string }[]; warnings: (string | { id: number; warning: string })[] };
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

function Review({ preview, strategy, setStrategy }: { preview: Preview; strategy: Strategy; setStrategy(value: Strategy): void }) {
  return <div className="stack">
    <h3>Preview</h3>
    {preview.bundle.collections.map((c) => <section key={c.name}><strong>{c.name}</strong> {preview.newCollections.includes(c.name) && <span className="muted small">(new collection)</span>}
      <ul className="issues">{c.endpoints.map((e) => <li key={`${e.method} ${e.path}`}>{e.method} {e.path} — {e.scenarios.map((s) => `${s.name} (${s.statusCode})`).join(', ')}</li>)}</ul></section>)}
    <h4>Conflicts</h4>
    {preview.conflicts.length ? <ul className="issues">{preview.conflicts.map((c, i) => <li key={i}>{c.method} {c.path} in {c.collection} conflicts with {c.existingCollection}</li>)}</ul> : <p className="muted small">No conflicts.</p>}
    <h4>Warnings</h4>
    {preview.warnings.length ? <ul className="issues">{preview.warnings.map((w, i) => <li key={i}>{typeof w === 'string' ? w : `Recording ${w.id}: ${w.warning}`}</li>)}</ul> : <p className="muted small">No warnings.</p>}
    <Field label="Conflict strategy"><select value={strategy} onChange={(e) => setStrategy(e.target.value as Strategy)}><option value="skip">Skip</option><option value="rename">Import into a new collection</option><option value="replace">Replace</option></select></Field>
    {strategy === 'rename' && <p className="muted small">A new collection with conflicting routes is inactive until you enable it.</p>}
  </div>;
}

export function ImportDialog({ onClose, onApplied }: { onClose(): void; onApplied(id: string | null): void }) {
  const { view, applyView } = useStudio();
  const [content, setContent] = useState(''); const [format, setFormat] = useState('auto');
  const [preview, setPreview] = useState<Preview | null>(null); const [strategy, setStrategy] = useState<Strategy>('skip'); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const invalidate = () => { setPreview(null); setError(''); };
  const runPreview = async () => { setBusy(true); setError(''); setPreview(null); try { if (new TextEncoder().encode(content).length > 20_000_000) throw new Error('Import exceeds the 20 MB limit.'); setPreview(await api<Preview>('POST', '/api/import/preview', { content, format })); } catch (e) { setError(errorText(e)); } finally { setBusy(false); } };
  const apply = async () => { if (!preview || !view) return; setBusy(true); setError(''); try {
    const before = new Set(view.project.collections.flatMap((c) => c.endpoints.map((e) => e.id)));
    const result = await api<MutationResponse>('POST', '/api/import/apply', { previewHash: preview.hash, onConflict: strategy }); applyView(result.view);
    const endpoints = result.view.project.collections.flatMap((c) => c.endpoints);
    const first = endpoints.find((e) => !before.has(e.id)) ?? endpoints.find((e) => preview.bundle.collections.some((c) => c.endpoints.some((item) => item.method === e.method && item.path === e.path)));
    onApplied(first?.id ?? null); onClose();
  } catch (e) { setError(errorText(e)); } finally { setBusy(false); } };
  return <Dialog title="Import" onClose={onClose} wide><div className="stack">
    <Field label="File" hint="Maximum 20 MB"><input type="file" onChange={(e) => { invalidate(); const file = e.target.files?.[0]; if (!file) return; if (file.size > 20_000_000) { setError('Import exceeds the 20 MB limit.'); return; } const reader = new FileReader(); reader.onload = () => setContent(String(reader.result ?? '')); reader.onerror = () => setError('Could not read file.'); reader.readAsText(file); }} /></Field>
    <Field label="Paste content"><textarea className="code" rows={8} value={content} onChange={(e) => { setContent(e.target.value); invalidate(); }} /></Field>
    <Field label="Format"><select value={format} onChange={(e) => { setFormat(e.target.value); invalidate(); }}><option value="auto">Auto</option><option value="bundle">MockBrew bundle</option><option value="postman">Postman v2.1</option><option value="openapi">OpenAPI 3 JSON</option><option value="har">HAR</option><option value="curl">cURL</option></select></Field>
    {error && <Banner tone="error">{error}</Banner>}
    <div><button className="button" disabled={!content || busy} onClick={() => void runPreview()}>Preview</button></div>
    {preview && <><Review preview={preview} strategy={strategy} setStrategy={setStrategy} /><div className="row-end"><button className="button button-primary" disabled={busy} onClick={() => void apply()}>Apply import</button></div></>}
  </div></Dialog>;
}

export function ExportDialog({ onClose }: { onClose(): void }) {
  const { view } = useStudio(); const [format, setFormat] = useState('bundle'); const [collection, setCollection] = useState(''); const [chosen, setChosen] = useState<string[]>([]); const [error, setError] = useState('');
  return <Dialog title="Export" onClose={onClose}><div className="stack">
    <Field label="Format"><select value={format} onChange={(e) => setFormat(e.target.value)}><option value="bundle">MockBrew bundle</option><option value="postman">Postman collection</option><option value="openapi">OpenAPI</option></select></Field>
    {format === 'bundle' ? <fieldset><legend>Collections</legend><p className="muted small">Select collections, or leave all unchecked to export all.</p>{view?.project.collections.map((c) => <label key={c.id} className="row"><input type="checkbox" checked={chosen.includes(c.id)} onChange={(e) => setChosen(e.target.checked ? [...chosen, c.id] : chosen.filter((id) => id !== c.id))} /> {c.name}</label>)}</fieldset> : <Field label="Collection"><select value={collection} onChange={(e) => setCollection(e.target.value)}><option value="">All collections</option>{view?.project.collections.map((c) => <option value={c.id} key={c.id}>{c.name}</option>)}</select></Field>}
    {error && <Banner tone="error">{error}</Banner>}<div><button className="button button-primary" onClick={() => void downloadExport(format, format === 'bundle' ? chosen : collection ? [collection] : []).catch((e: unknown) => setError(errorText(e)))}>Download</button></div>
  </div></Dialog>;
}

type RecordingList = { recording: boolean; recordings: Recording[] };
export function RecordingPanel() {
  const { view, applyView } = useStudio(); const [data, setData] = useState<RecordingList>({ recording: false, recordings: [] }); const [selected, setSelected] = useState<number[]>([]); const [paths, setPaths] = useState<Record<string, string>>({}); const [collection, setCollection] = useState(''); const [preview, setPreview] = useState<Preview | null>(null); const [strategy, setStrategy] = useState<Strategy>('skip'); const [error, setError] = useState('');
  useEffect(() => { let active = true; const poll = async () => { try { const result = await api<RecordingList>('GET', '/api/recordings'); if (active) setData(result); } catch (e) { if (active) setError(errorText(e)); } }; void poll(); const timer = window.setInterval(poll, 1000); return () => { active = false; window.clearInterval(timer); }; }, []);
  const command = async (path: string) => { setError(''); try { setData(await api<RecordingList>('POST', path)); } catch (e) { setError(errorText(e)); } };
  const review = async () => { setError(''); setPreview(null); try { setPreview(await api<Preview>('POST', '/api/recordings/preview', { ids: selected, collection, pathOverrides: paths })); } catch (e) { setError(errorText(e)); } };
  const save = async () => { if (!preview) return; setError(''); try { const result = await api<MutationResponse>('POST', '/api/recordings/save', { previewHash: preview.hash, onConflict: strategy }); applyView(result.view); setPreview(null); setSelected([]); } catch (e) { setError(errorText(e)); } };
  return <div className="detail stack"><h2>Recording</h2><p>Recording requires a running server and proxy fallback enabled in Settings. Unmatched requests and responses are captured in memory for review.</p>
    <div><button className="button" onClick={() => void command(data.recording ? '/api/recording/stop' : '/api/recording/start')}>{data.recording ? 'Stop recording' : 'Start recording'}</button></div>
    {error && <Banner tone="error">{error}</Banner>}
    {data.recordings.length === 0 && <p className="muted">No recordings yet.</p>}
    {data.recordings.map((r) => <div className="profile-card stack" key={r.id}>
      <label title={r.truncated ? 'Truncated recordings cannot be saved.' : undefined}><input type="checkbox" disabled={r.truncated} checked={selected.includes(r.id)} onChange={(e) => { setSelected(e.target.checked ? [...selected, r.id] : selected.filter((id) => id !== r.id)); setPreview(null); }} /> <MethodBadge method={r.method} /> {r.path} — {r.status} — {new TextEncoder().encode(r.body).length} bytes {r.truncated && '— Truncated; cannot be saved'}</label>
      <Field label={`Path pattern for recording ${r.id}`} hint="For example, /users/:id"><input value={paths[String(r.id)] ?? r.path} disabled={r.truncated} onChange={(e) => { setPaths({ ...paths, [r.id]: e.target.value }); setPreview(null); }} /></Field>
      {r.warnings.map((w, i) => <div key={i} className="small">Warning: {w}</div>)}
    </div>)}
    <Field label="Target collection"><select value={collection} onChange={(e) => { setCollection(e.target.value); setPreview(null); }}><option value="">Select a collection</option>{view?.project.collections.filter((c) => !c.virtual).map((c) => <option value={c.id} key={c.id}>{c.name}</option>)}</select></Field>
    <div><button className="button" disabled={!selected.length || !collection} onClick={() => void review()}>Preview recordings</button></div>
    {preview && <><Review preview={preview} strategy={strategy} setStrategy={setStrategy} /><div><button className="button button-primary" onClick={() => void save()}>Save recordings</button></div></>}
  </div>;
}
