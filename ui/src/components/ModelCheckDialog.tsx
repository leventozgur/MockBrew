import { useEffect, useState } from 'react';
import type { ModelCheck, MutationResponse } from '../../../src/core/view';
import { api } from '../api';
import { useStudio } from '../store';
import { Badge, Banner, Dialog, MethodBadge } from './ui';

/** Compares every linked model with its current source code and the saved bodies. */
export function ModelCheckDialog({ onClose }: { onClose(): void }) {
  const { act } = useStudio();
  const [checks, setChecks] = useState<ModelCheck[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setChecks(null);
    try {
      setChecks(await api<ModelCheck[]>('GET', '/api/models/check'));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <Dialog title="Check linked models" onClose={onClose} wide>
      <div className="stack">
        {error && <Banner tone="error">{error}</Banner>}
        {!checks && !error && <span className="muted">Reading the model files…</span>}
        {checks?.length === 0 && <p className="muted">No endpoint is linked to a model yet. Generate a response from a model first.</p>}
        {checks?.map((check) => (
          <section key={check.endpointId} className="snippet stack">
            <div className="row">
              <MethodBadge method={check.method} />
              <code>{check.path}</code>
              <span className="muted">
                {check.collection} · {check.rootType}
              </span>
              <span className="grow" />
              <Badge tone={check.status === 'ok' ? 'ok' : check.status === 'drift' ? 'warn' : 'neutral'}>{check.status === 'ok' ? 'up to date' : check.status === 'drift' ? 'changed' : 'cannot check'}</Badge>
            </div>
            {check.reason && <span className="muted small">{check.reason}</span>}
            {check.changes.length > 0 && (
              <ul className="issues">
                {check.changes.map((change, i) => (
                  <li key={i}>
                    <Badge tone={change.breaking ? 'error' : 'neutral'}>{change.breaking ? 'breaking' : 'compatible'}</Badge> {change.message}
                  </li>
                ))}
              </ul>
            )}
            {check.violations.map((violation) => (
              <Banner key={violation.scenarioId} tone="warn">
                Scenario “{violation.scenario}” no longer matches the model:{' '}
                {violation.errors.slice(0, 3).map((e) => `${e.path} ${e.message}`).join('; ')}
              </Banner>
            ))}
            {check.changes.length > 0 && (
              <div>
                <button
                  className="button"
                  onClick={async () => {
                    await act(() => api<MutationResponse>('POST', `/api/endpoints/${check.endpointId}/model/refresh`));
                    await load();
                  }}
                >
                  Accept the new model
                </button>
                <span className="muted small"> Stores the current schema; edit the scenario bodies to match.</span>
              </div>
            )}
          </section>
        ))}
        <div className="row-end">
          <button className="button" onClick={() => void load()}>
            Check again
          </button>
          <button className="button button-primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </Dialog>
  );
}
