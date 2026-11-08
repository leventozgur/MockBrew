import { useEffect, useState } from 'react';
import type { SettingsPatch } from '../../../src/core/model';
import type { MutationResponse } from '../../../src/core/view';
import { api, downloadCa } from '../api';
import { useStudio } from '../store';
import { Banner, Field } from './ui';

export function SettingsPanel() {
  const { view, act, applyView } = useStudio();
  const settings = view?.project.settings;
  const [certs, setCerts] = useState<{ exists: boolean; caPath?: string } | null>(null);
  const [certError, setCertError] = useState('');
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [variableName, setVariableName] = useState('');
  const [variableValue, setVariableValue] = useState('');
  const [variableError, setVariableError] = useState('');
  const loadVariables = () => api<Record<string, string>>('GET', '/api/variables').then(setVariables).catch((e: Error) => setVariableError(e.message));
  useEffect(() => { void loadVariables(); }, []);
  useEffect(() => { void api<{ exists: boolean; caPath?: string }>('GET', '/api/certs').then(setCerts).catch((e: Error) => setCertError(e.message)); }, []);
  const [port, setPort] = useState(String(settings?.port ?? ''));
  const [proxyHost, setProxyHost] = useState(settings?.proxy.host ?? '');

  useEffect(() => {
    if (settings) setPort(String(settings.port));
  }, [settings?.port]);

  useEffect(() => {
    if (settings) setProxyHost(settings.proxy.host);
  }, [settings?.proxy.host]);

  if (!view || !settings) return null;
  const patch = (body: SettingsPatch) => act(() => api<MutationResponse>('PATCH', '/api/settings', body));
  const lan = settings.host !== '127.0.0.1' && settings.host !== 'localhost';

  return (
    <div className="panel stack narrow">
      <h3>Project variables</h3>
      <Banner tone="warn">Values are stored in plain text in the project file. Do not store secrets.</Banner>
      <table className="kv"><tbody>{Object.entries(variables).map(([name, value]) => <tr key={name}><td><code>{name}</code></td><td>{value}</td><td><button className="button" onClick={() => { setVariableName(name); setVariableValue(value); }}>Edit</button> <button className="button" onClick={() => void api<MutationResponse>('DELETE', `/api/variables/${encodeURIComponent(name)}`).then((result) => { applyView(result.view); return loadVariables(); }).catch((e: Error) => setVariableError(e.message))}>Delete</button></td></tr>)}</tbody></table>
      <div className="row"><Field label="Variable name" hint="Letters, digits and underscores; start with a letter or underscore."><input value={variableName} onChange={(e) => setVariableName(e.target.value)} /></Field><Field label="Variable value"><input value={variableValue} onChange={(e) => setVariableValue(e.target.value)} /></Field>
      <button className="button" disabled={!/^[A-Za-z_][A-Za-z0-9_]*$/.test(variableName)} onClick={() => void api<MutationResponse>('PUT', '/api/variables', { [variableName]: variableValue }).then((result) => { applyView(result.view); setVariableName(''); setVariableValue(''); setVariableError(''); return loadVariables(); }).catch((e: Error) => setVariableError(e.message))}>Save variable</button></div>
      {variableName && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(variableName) && <span className="small">Invalid variable name.</span>}{variableError && <Banner tone="error">{variableError}</Banner>}
      <h3>Server</h3>
      <div className="row">
        <Field label="Port">
          <input value={port} onChange={(e) => setPort(e.target.value)} size={6} />
        </Field>
        <button className="button" disabled={port === String(settings.port) || !/^\d+$/.test(port)} onClick={() => void patch({ port: Number(port) })}>
          Apply
        </button>
      </div>
      <label className="inline">
        <input
          type="checkbox"
          checked={lan}
          onChange={(e) => {
            if (!e.target.checked || window.confirm('Listen on all network interfaces? Anyone on your network can then reach the mock server.')) {
              void patch({ host: e.target.checked ? '0.0.0.0' : '127.0.0.1' });
            }
          }}
        />{' '}
        Allow devices on my network (LAN access)
      </label>
      {lan && <Banner tone="warn">LAN access is on: the mock server listens on {settings.host}. Only needed for physical iOS devices; turn it off otherwise.</Banner>}

      <h3>Local HTTPS</h3>
      <p className="muted small">Create a local CA and server certificate for this project. Recreate them if your LAN address changes.</p>
      <button className="button" disabled={certs?.exists} onClick={() => {
        if (window.confirm('Create a local CA and server certificate for this project?')) {
          void api<{ exists: boolean; caPath?: string }>('POST', '/api/certs', { confirm: true }).then(setCerts).catch((e: Error) => setCertError(e.message));
        }
      }}>Create certificates</button>
      {certError && <Banner tone="warn">{certError}</Banner>}
      <label className="inline"><input type="checkbox" disabled={!certs?.exists} checked={settings.https?.enabled ?? false} onChange={(e) => void patch({ https: { enabled: e.target.checked } })} /> Enable HTTPS</label>
      {certs?.exists && <><button className="button" onClick={() => void downloadCa().catch((e: Error) => setCertError(e.message))}>Download CA certificate</button>
        <p className="small">iOS Simulator: <code>xcrun simctl keychain booted add-root-cert {certs.caPath}</code></p>
        <p className="small">iOS device: install the CA certificate as a profile, then enable full trust for it in Settings → General → About → Certificate Trust Settings.</p>
        <p className="small">Android: install the CA as a user certificate. In the debug network security configuration, trust user certificates:</p>
        <pre>{`<network-security-config>
    <debug-overrides>
        <trust-anchors><certificates src="user" /></trust-anchors>
    </debug-overrides>
</network-security-config>`}</pre></>}

      <h3>Scenario override</h3>
      <label className="inline"><input type="checkbox" checked={settings.scenarioOverrideHeader} onChange={(e) => void patch({ scenarioOverrideHeader: e.target.checked })} /> Enable X-Mock-Scenario override header</label>
      <p className="muted small">An app debug menu can send this header to select a scenario by name. It is unavailable in sequential and random modes.</p>
      <div className="row"><code>X-Mock-Scenario: &lt;scenario name&gt;</code><button className="button" onClick={() => void navigator.clipboard.writeText('X-Mock-Scenario: <scenario name>')}>Copy example</button></div>
      <h3>Real backend fallback</h3>
      <label className="inline">
        <input
          type="checkbox"
          checked={settings.proxy.enabled}
          onChange={(e) => {
            if (!e.target.checked || window.confirm('Forward every request that no mock matches to the real backend, including its Authorization header and cookies?')) {
              void patch({ proxy: { enabled: e.target.checked, host: proxyHost } });
            }
          }}
        />{' '}
        Forward requests that no mock matches to the real backend
      </label>
      <div className="row">
        <Field label="Backend address" hint="e.g. https://api.example.com. Matching mocks still win; everything else is forwarded.">
          <input value={proxyHost} onChange={(e) => setProxyHost(e.target.value)} size={40} placeholder="https://api.example.com" />
        </Field>
        <button className="button" disabled={proxyHost === settings.proxy.host} onClick={() => void patch({ proxy: { host: proxyHost } })}>
          Save address
        </button>
      </div>
      {settings.proxy.enabled && <Banner tone="warn">Unmatched requests are sent to {settings.proxy.host}. They show as “proxied” in the request list and are not answered with a 404.</Banner>}

      <h3>CORS</h3>
      <label className="inline">
        <input type="checkbox" checked={settings.cors.enabled} onChange={(e) => void patch({ cors: { enabled: e.target.checked } })} /> Enable CORS and answer preflight (OPTIONS) requests
      </label>
      <Field label="Allowed origin" hint="Native Android and iOS clients ignore CORS. It matters for WebView, browsers and KMP web targets.">
        <select value={settings.cors.mode} disabled={!settings.cors.enabled} onChange={(e) => void patch({ cors: { mode: e.target.value as 'wildcard' | 'reflect' } })}>
          <option value="wildcard">Any origin (*)</option>
          <option value="reflect">Reflect the request origin (needed for credentials)</option>
        </select>
      </Field>

      <h3>Model generation defaults</h3>
      <div className="row">
        <Field label="Field names">
          <select value={settings.generation.naming} onChange={(e) => void patch({ generation: { naming: e.target.value as 'identity' | 'snake_case' } })}>
            <option value="identity">As written</option>
            <option value="snake_case">snake_case</option>
          </select>
        </Field>
        <Field label="Dates">
          <select value={settings.generation.dateFormat} onChange={(e) => void patch({ generation: { dateFormat: e.target.value as 'iso8601' | 'epoch-seconds' | 'epoch-millis' } })}>
            <option value="iso8601">ISO 8601</option>
            <option value="epoch-seconds">Epoch seconds</option>
            <option value="epoch-millis">Epoch milliseconds</option>
          </select>
        </Field>
      </div>

      <h3>Imported templating</h3>
      <label className="inline">
        <input
          type="checkbox"
          checked={settings.allowTemplating}
          onChange={(e) => {
            if (!e.target.checked || window.confirm('Allow templating helpers, data buckets, callbacks and CRUD/WebSocket routes from the project files to run? Only do this for files you trust: a shared file could use them to run code on this machine.')) {
              void patch({ allowTemplating: e.target.checked });
            }
          }}
        />{' '}
        Allow Imported templating, data buckets, callbacks and CRUD/WebSocket routes (off by default)
      </label>
      {view.safeModeNotes.length > 0 && <span className="muted small">Currently switched off: {view.safeModeNotes.join('; ')}.</span>}

      <h3>Logging</h3>
      <label className="inline">
        <input type="checkbox" checked={settings.logBodies} onChange={(e) => void patch({ logBodies: e.target.checked })} /> Log request and response bodies (off by default; they may contain personal data)
      </label>
    </div>
  );
}
