import { useState } from 'react';
import type { Profile, ProfileInput } from '../../../src/core/model';
import type { MutationResponse, ProfilesView } from '../../../src/core/view';
import { api } from '../api';
import { useStudio } from '../store';
import { Badge, Banner, Dialog, Field, MethodBadge } from './ui';

function ProfileEditor({ profile, onClose }: { profile?: Profile; onClose(): void }) {
  const { view, refreshProfiles } = useStudio();
  const [id, setId] = useState(profile?.id);
  const [name, setName] = useState(profile?.name ?? '');
  const [description, setDescription] = useState(profile?.description ?? '');
  const [selections, setSelections] = useState<ProfileInput['endpoints']>(profile?.endpoints ?? {});
  const [latency, setLatency] = useState(String(profile?.network?.latencyMs ?? 0));
  const [timeoutMode, setTimeoutMode] = useState<'off' | 'all' | 'selected'>(profile?.network?.timeoutEndpoints === 'all' ? 'all' : Array.isArray(profile?.network?.timeoutEndpoints) ? 'selected' : 'off');
  const [timeoutIds, setTimeoutIds] = useState<string[]>(Array.isArray(profile?.network?.timeoutEndpoints) ? profile.network.timeoutEndpoints : []);
  const [timeoutMs, setTimeoutMs] = useState(String(profile?.network?.timeoutMs ?? 30000));
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!view) return null;
  const collections = view.project.collections;
  const endpoints = collections.flatMap((c) => c.endpoints);
  const template = (kind: '401' | '5xx' | 'slow') => {
    if (kind === 'slow') { setLatency('2000'); return; }
    const next: ProfileInput['endpoints'] = {};
    for (const endpoint of endpoints) {
      const scenario = endpoint.scenarios.find((s) => kind === '401' ? s.statusCode === 401 : s.statusCode >= 500 && s.statusCode < 600);
      if (scenario) next[endpoint.id] = { scenarioId: scenario.id };
    }
    setSelections(next);
  };
  const validate = () => {
    if (!name.trim() || name.trim().length > 100) return 'Name must be 1–100 characters.';
    if (description.length > 1000) return 'Description must be at most 1000 characters.';
    if (!/^\d+$/.test(latency) || Number(latency) > 60000) return 'Extra latency must be an integer from 0 to 60000 ms.';
    if (timeoutMode !== 'off' && (!/^\d+$/.test(timeoutMs) || Number(timeoutMs) < 1 || Number(timeoutMs) > 600000)) return 'Timeout must be an integer from 1 to 600000 ms.';
    if (timeoutMode === 'selected' && timeoutIds.length === 0) return 'Select at least one timeout endpoint.';
    return '';
  };
  const save = async () => {
    const invalid = validate(); if (invalid) { setError(invalid); return; }
    setBusy(true); setError('');
    try {
      const input: ProfileInput = { name: name.trim(), description, endpoints: selections, network: { latencyMs: Number(latency), ...(timeoutMode !== 'off' ? { timeoutEndpoints: timeoutMode === 'all' ? 'all' : timeoutIds, timeoutMs: Number(timeoutMs) } : {}) } };
      await api<MutationResponse>(id ? 'PUT' : 'POST', id ? `/api/profiles/${encodeURIComponent(id)}` : '/api/profiles', input);
      await refreshProfiles(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const capture = async () => {
    if (!name.trim() || name.trim().length > 100) { setError('Enter a name of 1–100 characters before capturing.'); return; }
    setBusy(true); setError('');
    try {
      const result = await api<MutationResponse>('POST', '/api/profiles/capture', { name: name.trim() });
      if (!result.id) throw new Error('Capture did not return a profile ID.');
      setId(result.id);
      const current = await api<ProfilesView>('GET', '/api/profiles');
      const captured = current.profiles.find((p) => p.id === result.id);
      if (!captured) throw new Error('Captured profile could not be loaded.');
      setSelections(captured.endpoints); await refreshProfiles();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const staleEndpoints = Object.keys(selections).filter((key) => !endpoints.some((e) => e.id === key && e.scenarios.some((s) => s.id === selections[key].scenarioId)));
  const staleTimeouts = timeoutIds.filter((key) => !endpoints.some((e) => e.id === key));
  return <Dialog title={id ? 'Edit profile' : 'Create profile'} onClose={onClose} wide><div className="stack">
    <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} /></Field>
    <Field label="Description"><input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} /></Field>
    {!id && <div className="stack"><div className="row"><button className="button" disabled={busy} onClick={() => void capture()}>Start from current selections</button><span className="muted small">Creates the profile immediately; you can then edit it. Otherwise start empty.</span></div>
      <div className="row"><span>Quick templates:</span><button className="button" onClick={() => template('401')}>All endpoints → first 401 scenario</button><button className="button" onClick={() => template('5xx')}>All endpoints → first 5xx scenario</button><button className="button" onClick={() => template('slow')}>Slow network (+2000 ms)</button></div></div>}
    <h3>Network</h3><div className="row"><Field label="Extra latency (ms)"><input type="number" min="0" max="60000" value={latency} onChange={(e) => setLatency(e.target.value)} /></Field><Field label="Timeout simulation"><select value={timeoutMode} onChange={(e) => setTimeoutMode(e.target.value as typeof timeoutMode)}><option value="off">Off</option><option value="all">All endpoints</option><option value="selected">Selected endpoints</option></select></Field>{timeoutMode !== 'off' && <Field label="Timeout (ms)"><input type="number" min="1" max="600000" value={timeoutMs} onChange={(e) => setTimeoutMs(e.target.value)} /></Field>}</div>
    <h3>Endpoint scenarios</h3><Field label="Search endpoints"><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search endpoints" /></Field>
    {(staleEndpoints.length > 0 || staleTimeouts.length > 0) && <Banner tone="warn">This profile has stale references. Remove them before saving. <button className="link" onClick={() => { setSelections(Object.fromEntries(Object.entries(selections).filter(([key]) => !staleEndpoints.includes(key)))); setTimeoutIds(timeoutIds.filter((key) => !staleTimeouts.includes(key))); }}>Remove stale references</button></Banner>}
    {collections.map((collection) => { const shown = collection.endpoints.filter((endpoint) => `${collection.name} ${endpoint.method} ${endpoint.path}`.toLowerCase().includes(search.toLowerCase())); return shown.length ? <div key={collection.id} className="stack"><h4>{collection.name}</h4>{shown.map((endpoint) => <div className="profile-endpoint" key={endpoint.id}><span><MethodBadge method={endpoint.method} /> <code>{endpoint.path}</code></span><label><span className="small muted">Scenario </span><select aria-label={`Scenario for ${endpoint.method} ${endpoint.path}`} value={selections[endpoint.id]?.scenarioId ?? ''} onChange={(e) => { const next = { ...selections }; if (e.target.value) next[endpoint.id] = { scenarioId: e.target.value }; else delete next[endpoint.id]; setSelections(next); }}><option value="">Unchanged</option>{selections[endpoint.id] && !endpoint.scenarios.some((s) => s.id === selections[endpoint.id].scenarioId) && <option value={selections[endpoint.id].scenarioId}>Missing scenario</option>}{endpoint.scenarios.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.statusCode})</option>)}</select></label>{timeoutMode === 'selected' && <label className="inline"><input type="checkbox" checked={timeoutIds.includes(endpoint.id)} onChange={(e) => setTimeoutIds(e.target.checked ? [...timeoutIds, endpoint.id] : timeoutIds.filter((key) => key !== endpoint.id))} /> Timeout</label>}</div>)}</div> : null; })}
    {error && <Banner tone="error">{error}</Banner>}<div className="row-end"><button className="button" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={busy} onClick={() => void save()}>Save profile</button></div>
  </div></Dialog>;
}

export function ProfilesPanel() {
  const { profiles, act, refreshProfiles } = useStudio();
  const [editing, setEditing] = useState<Profile | 'new' | null>(null);
  const change = async (method: string, path: string) => { await act(() => api<MutationResponse>(method, path)); await refreshProfiles(); };
  return <div className="panel stack"><div className="row"><h2>Profiles</h2><span className="grow" /><button className="button button-primary" onClick={() => setEditing('new')}>Create profile</button></div>
    {!profiles ? <p className="muted">Loading profiles…</p> : profiles.profiles.length === 0 ? <p className="muted">No profiles yet. Create one to switch multiple endpoints at once.</p> : profiles.profiles.map((profile) => { const active = profile.id === profiles.activeProfileId; const network = profile.network; return <div key={profile.id} className={`profile-card${active ? ' profile-card-active' : ''}`}><div className="row"><h3>{profile.name}</h3>{active && <Badge tone="accent">Active</Badge>}<span className="grow" /><button className="button" onClick={() => void change('POST', active ? '/api/profiles/deactivate' : `/api/profiles/${encodeURIComponent(profile.id)}/activate`)}>{active ? 'Deactivate' : 'Activate'}</button><button className="button" onClick={() => setEditing(profile)}>Edit</button><button className="button button-danger" onClick={() => { if (window.confirm(`Delete profile “${profile.name}”?`)) void change('DELETE', `/api/profiles/${encodeURIComponent(profile.id)}`); }}>Delete</button></div>{profile.description && <p>{profile.description}</p>}<p className="muted small">{Object.keys(profile.endpoints).length} endpoint(s) · Extra latency: {network?.latencyMs ?? 0} ms · Timeout: {network?.timeoutEndpoints === 'all' ? 'all endpoints' : Array.isArray(network?.timeoutEndpoints) ? `${network.timeoutEndpoints.length} selected endpoint(s)` : 'off'}{network?.timeoutEndpoints ? ` (${network.timeoutMs ?? 30000} ms)` : ''}</p>{profile.staleReferences.length > 0 && <Banner tone="warn">Stale references: {profile.staleReferences.join('; ')}</Banner>}</div>; })}
    {editing && <ProfileEditor profile={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}</div>;
}
