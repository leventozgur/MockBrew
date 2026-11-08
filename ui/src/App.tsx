import { useState } from 'react';
import type { MutationResponse } from '../../src/core/view';
import { api } from './api';
import { ConnectPanel } from './components/ConnectPanel';
import { EndpointsPanel } from './components/EndpointsPanel';
import { LogsPanel } from './components/LogsPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { Badge, Banner } from './components/ui';
import { useStudio } from './store';

type Tab = 'endpoints' | 'logs' | 'connect' | 'settings';

const TABS: { id: Tab; label: string }[] = [
  { id: 'endpoints', label: 'Endpoints' },
  { id: 'logs', label: 'Requests' },
  { id: 'connect', label: 'Connect app' },
  { id: 'settings', label: 'Settings' },
];

function RuntimeControl() {
  const { view, act } = useStudio();
  if (!view) return null;
  const { runtime } = view;
  const running = runtime.state === 'running';
  const blocking = view.conflicts.filter((c) => c.severity === 'error').length > 0;
  return (
    <div className="runtime">
      <Badge tone={running ? 'ok' : runtime.state === 'error' ? 'error' : 'neutral'}>{running ? 'running' : runtime.state}</Badge>
      {running && runtime.url && (
        <code className="mono" title="Base URL on this machine">
          {runtime.url}
        </code>
      )}
      {view.lan && <Badge tone="warn" title="The server listens beyond this machine">LAN</Badge>}
      {running ? (
        <button className="button" onClick={() => void act(() => api<MutationResponse>('POST', '/api/runtime/stop'))}>
          Stop
        </button>
      ) : (
        <button className="button button-primary" disabled={blocking} title={blocking ? 'Resolve the route conflicts first' : undefined} onClick={() => void act(() => api<MutationResponse>('POST', '/api/runtime/start'))}>
          Start server
        </button>
      )}
    </div>
  );
}

export function App() {
  const { view, notice, dismissNotice, sessionLost } = useStudio();
  const [tab, setTab] = useState<Tab>('endpoints');

  if (sessionLost) {
    return (
      <div className="centered">
        <h1>Session ended</h1>
        <p>The session token is missing, wrong or expired. Run <code>mock-studio ui</code> again and open the address it prints.</p>
      </div>
    );
  }
  if (!view) return <div className="centered muted">Loading…</div>;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <strong>{view.project.name}</strong>
          <span className="muted small">{view.projectFile}</span>
        </div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t.id} className={`tab${tab === t.id ? ' tab-active' : ''}`} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
        <RuntimeControl />
      </header>
      {view.loadError && <Banner tone="error">The project files on disk cannot be loaded (showing the last good state): {view.loadError}</Banner>}
      {view.runtimeNotice && <Banner tone="warn">{view.runtimeNotice}</Banner>}
      {view.runtime.state === 'error' && view.runtime.error && <Banner tone="error">{view.runtime.error}</Banner>}
      {view.safeModeNotes.length > 0 && (
        <Banner tone="info">
          Safe mode: {view.safeModeNotes.join('; ')}. Allow templating in the settings only for projects you trust.
        </Banner>
      )}
      {view.migrated && <Banner tone="info">The Mockoon environment was upgraded to the current format; saving writes the upgraded version.</Banner>}
      {notice && (
        <Banner tone={notice.kind === 'error' ? 'error' : 'info'}>
          {notice.text}{' '}
          <button className="link" onClick={dismissNotice}>
            Dismiss
          </button>
        </Banner>
      )}
      <div className="content">
        {tab === 'endpoints' && <EndpointsPanel />}
        {tab === 'logs' && <LogsPanel />}
        {tab === 'connect' && <ConnectPanel />}
        {tab === 'settings' && <SettingsPanel />}
      </div>
    </div>
  );
}
