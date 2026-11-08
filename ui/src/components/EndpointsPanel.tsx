import { useEffect, useState } from 'react';
import { type Collection, type Endpoint, HTTP_METHODS, type HttpMethod, type ModelLink } from '../../../src/core/model';
import type { ModelCheck, MutationResponse } from '../../../src/core/view';
import { api } from '../api';
import { useStudio } from '../store';
import { Badge, Banner, Dialog, Field, MethodBadge } from './ui';
import { GenerateDialog, type GenerateResult } from './GenerateDialog';
import { ModelCheckDialog } from './ModelCheckDialog';
import { ScenarioEditor } from './ScenarioEditor';
import { ConditionsEditor, ruleSummary } from './ConditionsEditor';

function NewEndpointDialog({ collection, onClose, onCreated }: { collection: Collection; onClose(): void; onCreated(id: string): void }) {
  const { act } = useStudio();
  const [method, setMethod] = useState<HttpMethod>('GET');
  const [path, setPath] = useState('/');
  const [body, setBody] = useState('{}');
  const [link, setLink] = useState<ModelLink | null>(null);
  const [generating, setGenerating] = useState(false);

  const create = async () => {
    const result = await act(() =>
      api<MutationResponse>('POST', `/api/collections/${collection.id}/endpoints`, { method, path, scenarios: [{ name: 'Success', statusCode: 200, body }] }),
    );
    if (!result?.id) return;
    if (link) await act(() => api<MutationResponse>('PUT', `/api/endpoints/${result.id}/model`, link));
    onCreated(result.id);
    onClose();
  };

  const onResult = (r: GenerateResult) => {
    setBody(r.body);
    setLink(r.link);
  };

  return (
    <Dialog title={`New endpoint in ${collection.name}`} onClose={onClose}>
      <div className="stack">
        <div className="row">
          <Field label="Method">
            <select value={method} onChange={(e) => setMethod(e.target.value as HttpMethod)}>
              {HTTP_METHODS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </Field>
          <Field label="Path" hint="Parameters use :name, e.g. /users/:id">
            <input value={path} onChange={(e) => setPath(e.target.value)} autoFocus size={36} />
          </Field>
        </div>
        <Field label="First response body">
          <textarea className="code" rows={8} value={body} onChange={(e) => setBody(e.target.value)} spellCheck={false} />
        </Field>
        <div className="row">
          <button className="button" onClick={() => setGenerating(true)}>
            Generate from model…
          </button>
          {link && <Badge tone="accent">linked to {link.rootType}</Badge>}
        </div>
        <div className="row-end">
          <button className="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button button-primary" onClick={() => void create()}>
            Create
          </button>
        </div>
      </div>
      {generating && <GenerateDialog onClose={() => setGenerating(false)} onResult={onResult} />}
    </Dialog>
  );
}

function EndpointEditor({ endpoint, collections }: { endpoint: Endpoint; collections: Collection[] }) {
  const { view, act } = useStudio();
  const [selectedScenario, setSelectedScenario] = useState<string | null>(null);
  const [method, setMethod] = useState<string>(endpoint.method);
  const [path, setPath] = useState(endpoint.path);
  const [description, setDescription] = useState(endpoint.description);
  const [newScenario, setNewScenario] = useState('');
  const [requestPicking, setRequestPicking] = useState(false);
  const [dragged, setDragged] = useState<string | null>(null);

  useEffect(() => {
    setMethod(endpoint.method);
    setPath(endpoint.path);
    setDescription(endpoint.description);
  }, [endpoint.method, endpoint.path, endpoint.description, endpoint.id]);

  const active = endpoint.scenarios.find((s) => s.active) ?? endpoint.scenarios[0];
  const current = endpoint.scenarios.find((s) => s.id === selectedScenario) ?? active;
  const headerDirty = method !== endpoint.method || path !== endpoint.path || description !== endpoint.description;
  const conflicts = view?.conflicts.filter((c) => c.endpointIds.includes(endpoint.id)) ?? [];

  const patchEndpoint = (patch: object) => act(() => api<MutationResponse>('PATCH', `/api/endpoints/${endpoint.id}`, patch));

  return (
    <div className="stack">
      {endpoint.readOnly && <Banner tone="info">This route was not created by this tool (CRUD, WebSocket or an unusual method). It is shown for reference; edit it in the original editor.</Banner>}
      {conflicts.map((c, i) => (
        <Banner key={i} tone={c.severity === 'error' ? 'error' : 'warn'}>
          {c.message}
        </Banner>
      ))}
      <div className="row">
        <Field label="Method">
          <select value={method} onChange={(e) => setMethod(e.target.value)} disabled={endpoint.readOnly}>
            {[...new Set([endpoint.method, ...HTTP_METHODS])].map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </Field>
        <Field label="Path">
          <input value={path} onChange={(e) => setPath(e.target.value)} size={36} disabled={endpoint.readOnly} />
        </Field>
        <Field label="Collection">
          <select value={endpoint.collectionId} onChange={(e) => void patchEndpoint({ collectionId: e.target.value })} disabled={endpoint.readOnly}>
            {collections.filter((c) => !c.virtual || c.id === endpoint.collectionId).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Description">
        <input value={description} onChange={(e) => setDescription(e.target.value)} disabled={endpoint.readOnly} />
      </Field>
      <div className="row">
        <button className="button button-primary" disabled={!headerDirty || endpoint.readOnly} onClick={() => void patchEndpoint({ method, path, description })}>
          Save endpoint
        </button>
        <button
          className="button button-danger"
          onClick={() => {
            if (window.confirm(`Delete ${endpoint.method} ${endpoint.path}?`)) void act(() => api<MutationResponse>('DELETE', `/api/endpoints/${endpoint.id}`));
          }}
        >
          Delete endpoint
        </button>
        {endpoint.model && <Badge tone="accent" title={endpoint.model.sources.join(', ')}>model: {endpoint.model.rootType}</Badge>}
      </div>

      {['POST', 'PUT', 'PATCH'].includes(endpoint.method) && <section className="stack">
        <h3>Request model</h3>
        <p className="muted small">Validate incoming JSON against a Kotlin or Swift type. Invalid requests use the selected scenario.</p>
        <div className="row"><button className="button" disabled={endpoint.readOnly} onClick={() => setRequestPicking(true)}>{endpoint.requestModel ? 'Change request model…' : 'Link request model…'}</button>
          {endpoint.requestModel && <><Badge tone="accent">{endpoint.requestModel.rootType}</Badge><button className="button" disabled={endpoint.readOnly} onClick={() => void act(() => api<MutationResponse>('DELETE', `/api/endpoints/${endpoint.id}/request-model`))}>Unlink</button></>}</div>
        {endpoint.requestModel && <Field label="Invalid-request scenario"><select disabled={endpoint.readOnly} value={endpoint.invalidRequestScenarioId ?? ''} onChange={(e) => void act(() => api<MutationResponse>('PUT', `/api/endpoints/${endpoint.id}/request-model`, { model: endpoint.requestModel, invalidRequestScenarioId: e.target.value }))}>
          {!endpoint.invalidRequestScenarioId && <option value="">Default 422</option>}{endpoint.scenarios.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.statusCode})</option>)}
        </select></Field>}
      </section>}
      {requestPicking && <GenerateDialog onClose={() => setRequestPicking(false)} onResult={(result) => { void act(() => api<MutationResponse>('PUT', `/api/endpoints/${endpoint.id}/request-model`, { model: result.link })); }} />}
      <Field label="Response mode" hint={{ rules: 'Return the first matching scenario, or the default.', fixed: 'Always return the default scenario.', sequential: 'Return scenarios in order on successive requests.', random: 'Choose a scenario randomly.', other: 'This imported mode is not editable here.' }[endpoint.responseMode] ?? 'This imported mode is not editable here.'}>
        <select value={endpoint.responseMode} disabled={endpoint.readOnly} onChange={(e) => void act(() => api<MutationResponse>('PATCH', `/api/endpoints/${endpoint.id}/response-mode`, { responseMode: e.target.value }))}>
          {endpoint.responseMode === 'other' && <option value="other">Other (imported)</option>}
          <option value="rules">Rules</option><option value="fixed">Fixed scenario</option><option value="sequential">Sequential</option><option value="random">Random</option>
        </select>
      </Field>
      {(endpoint.responseMode === 'sequential' || endpoint.responseMode === 'random') && <Banner tone="warn">X-Mock-Scenario is unavailable in sequential and random modes.</Banner>}
      <h3>Scenarios</h3>
      <p className="muted small">First matching scenario wins; the default scenario is the fallback. Drag scenarios or use the move buttons to change their order.</p>
      <div className="scenario-tabs">
        {endpoint.scenarios.map((s, index) => {
          const move = (to: number) => {
            const ids = endpoint.scenarios.map((item) => item.id);
            ids.splice(index, 1); ids.splice(to, 0, s.id);
            void act(() => api<MutationResponse>('PUT', `/api/endpoints/${endpoint.id}/scenario-order`, { scenarioIds: ids }));
          };
          return <div className="scenario-list-item" key={s.id} draggable={!endpoint.readOnly} onDragStart={() => setDragged(s.id)} onDragEnd={() => setDragged(null)} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const from = endpoint.scenarios.findIndex((item) => item.id === dragged); if (from < 0 || from === index) return; const ids = endpoint.scenarios.map((item) => item.id); const [id] = ids.splice(from, 1); ids.splice(index, 0, id); void act(() => api<MutationResponse>('PUT', `/api/endpoints/${endpoint.id}/scenario-order`, { scenarioIds: ids })); setDragged(null); }}>
            <button className={`scenario-tab${current?.id === s.id ? ' scenario-tab-active' : ''}`} onClick={() => setSelectedScenario(s.id)}>
              {s.name} <span className="muted">{s.statusCode}</span> {s.active && <Badge tone="ok">default</Badge>}
              <span className="scenario-summary">{s.rules.length ? s.rules.map(ruleSummary).join(` ${s.rulesOperator} `) : 'No conditions'}</span>
            </button>
            <button className="icon-button" aria-label={`Move ${s.name} up`} disabled={endpoint.readOnly || index === 0} onClick={() => move(index - 1)}>↑</button>
            <button className="icon-button" aria-label={`Move ${s.name} down`} disabled={endpoint.readOnly || index === endpoint.scenarios.length - 1} onClick={() => move(index + 1)}>↓</button>
          </div>;
        })}
        {!endpoint.readOnly && (
          <span className="scenario-new">
            <input value={newScenario} onChange={(e) => setNewScenario(e.target.value)} placeholder="New scenario" size={14} />
            <button
              className="button"
              disabled={newScenario.trim() === ''}
              onClick={async () => {
                const created = await act(() => api<MutationResponse>('POST', `/api/endpoints/${endpoint.id}/scenarios`, { name: newScenario, body: '{}' }));
                if (created?.id) {
                  setSelectedScenario(created.id);
                  setNewScenario('');
                }
              }}
            >
              Add
            </button>
          </span>
        )}
      </div>

      {current && (
        <>
          <div className="row">
            {current.active ? (
              <Badge tone="ok">default scenario</Badge>
            ) : (
              <button className="button" disabled={endpoint.readOnly} onClick={() => void act(() => api<MutationResponse>('PUT', `/api/endpoints/${endpoint.id}/active-scenario`, { scenarioId: current.id }))}>
                Serve this scenario
              </button>
            )}
            <button
              className="button button-danger"
              disabled={endpoint.scenarios.length < 2 || endpoint.readOnly}
              onClick={async () => {
                if (window.confirm(`Delete scenario "${current.name}"?`)) {
                  await act(() => api<MutationResponse>('DELETE', `/api/endpoints/${endpoint.id}/scenarios/${current.id}`));
                  setSelectedScenario(null);
                }
              }}
            >
              Delete scenario
            </button>
          </div>
          <ConditionsEditor key={`${current.id}:${JSON.stringify([current.rules, current.rulesOperator])}`} endpoint={endpoint} scenario={current} />
          <ScenarioEditor key={current.id} endpoint={endpoint} scenario={current} violations={view?.violations[current.id] ?? []} />
        </>
      )}
    </div>
  );
}

export function EndpointsPanel({ selectedEndpoint }: { selectedEndpoint: string | null }) {
  const { view, act } = useStudio();
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => { if (selectedEndpoint) setSelected(selectedEndpoint); }, [selectedEndpoint]);
  const [newCollection, setNewCollection] = useState('');
  const [addingTo, setAddingTo] = useState<Collection | null>(null);
  const [checking, setChecking] = useState(false);
  const [modelChecks, setModelChecks] = useState<ModelCheck[]>([]);

  if (!view) return null;

  const exportOpenApi = async () => {
    const document = await api<unknown>('GET', '/api/export/openapi');
    const url = URL.createObjectURL(new Blob([`${JSON.stringify(document, null, 2)}\n`], { type: 'application/json' }));
    const link = window.document.createElement('a');
    link.href = url;
    link.download = 'openapi.json';
    link.click();
    URL.revokeObjectURL(url);
  };
  const collections = view.project.collections;
  const endpoints = collections.flatMap((c) => c.endpoints);
  const endpoint = endpoints.find((e) => e.id === selected) ?? endpoints[0];

  return (
    <div className="split">
      <aside className="sidebar">
        <div className="row toolbar">
          <button className="button" title="Compare linked models and saved bodies with the current source code" onClick={() => setChecking(true)}>
            Check models
          </button>
          <button className="button" title="Download an OpenAPI 3.1 document of the active collections" onClick={() => void exportOpenApi()}>
            Export OpenAPI
          </button>
        </div>
        {collections.map((collection) => (
          <section key={collection.id} className="collection">
            <header className="collection-header">
              <label className="switch" title={collection.active ? 'Active: served by the mock server' : 'Inactive'}>
                <input type="checkbox" checked={collection.active} onChange={(e) => void act(() => api<MutationResponse>('PATCH', `/api/collections/${collection.id}`, { active: e.target.checked }))} />
                <span />
              </label>
              <strong className={collection.active ? '' : 'muted'}>{collection.name}</strong>
              <span className="grow" />
              {!collection.virtual && (
                <>
                  <button className="icon-button" title="Add endpoint" onClick={() => setAddingTo(collection)}>
                    +
                  </button>
                  <button
                    className="icon-button"
                    title="Rename"
                    onClick={() => {
                      const name = window.prompt('Collection name', collection.name);
                      if (name && name !== collection.name) void act(() => api<MutationResponse>('PATCH', `/api/collections/${collection.id}`, { name }));
                    }}
                  >
                    ✎
                  </button>
                  <button
                    className="icon-button"
                    title="Delete collection"
                    onClick={() => {
                      if (window.confirm(`Delete collection "${collection.name}" and its ${collection.endpoints.length} endpoint(s)?`)) void act(() => api<MutationResponse>('DELETE', `/api/collections/${collection.id}`));
                    }}
                  >
                    ×
                  </button>
                </>
              )}
            </header>
            <ul className="endpoint-list">
              {collection.endpoints.map((e) => (
                <li key={e.id}>
                  <button className={`endpoint-item${endpoint?.id === e.id ? ' endpoint-item-active' : ''}${collection.active ? '' : ' muted'}`} onClick={() => setSelected(e.id)}>
                    <MethodBadge method={e.method} />
                    <span className="endpoint-path">{e.path}</span>
                    {modelChecks.some((c) => c.endpointId === e.id && c.status === 'drift') && <Badge tone="warn">model changed</Badge>}
                    {view.conflicts.some((c) => c.endpointIds.includes(e.id)) && <span title="Route conflict">⚠</span>}
                  </button>
                </li>
              ))}
              {collection.endpoints.length === 0 && <li className="muted small">No endpoints yet.</li>}
            </ul>
          </section>
        ))}
        <form
          className="row new-collection"
          onSubmit={async (e) => {
            e.preventDefault();
            if (newCollection.trim() === '') return;
            const created = await act(() => api<MutationResponse>('POST', '/api/collections', { name: newCollection }));
            if (created) setNewCollection('');
          }}
        >
          <input value={newCollection} onChange={(e) => setNewCollection(e.target.value)} placeholder="New collection" />
          <button className="button" disabled={newCollection.trim() === ''}>
            Add
          </button>
        </form>
      </aside>
      <main className="detail">
        {endpoint ? (
          <EndpointEditor key={endpoint.id} endpoint={endpoint} collections={collections} />
        ) : (
          <div className="empty">
            <h2>No endpoints yet</h2>
            <p>Create a collection on the left, then add an endpoint with “+”. Endpoints can be filled from Kotlin or Swift models.</p>
          </div>
        )}
      </main>
      {checking && <ModelCheckDialog onClose={() => setChecking(false)} onChecks={setModelChecks} />}
      {addingTo && <NewEndpointDialog collection={addingTo} onClose={() => setAddingTo(null)} onCreated={setSelected} />}
    </div>
  );
}
