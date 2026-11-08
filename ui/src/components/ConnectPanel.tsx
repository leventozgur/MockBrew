import { Fragment, useEffect, useState } from 'react';
import qrcode from 'qrcode-generator';
import type { Snippet, SnippetsResponse } from '../../../src/core/view';
import { api } from '../api';
import { useStudio } from '../store';

function SnippetCard({ snippet }: { snippet: Snippet }) {
  const [copied, setCopied] = useState(false);
  return (
    <section className="snippet">
      <header className="row">
        <h3>{snippet.title}</h3>
        <span className="grow" />
        <button
          className="button"
          onClick={() => {
            void navigator.clipboard?.writeText(snippet.code).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1200);
            });
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </header>
      <p className="muted">{snippet.description}</p>
      {snippet.location && <p className="small">
        File: <code>{snippet.location}</code>
      </p>}
      <pre>{snippet.code}</pre>
    </section>
  );
}

function ConnectionCard({ title, url }: { title: string; url: string }) {
  const qr = qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  const size = qr.getModuleCount();
  const cells: string[] = [];
  for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) {
    if (qr.isDark(row, col)) cells.push(`M${col + 4},${row + 4}h1v1h-1z`);
  }
  return <section className="snippet">
    <h3>{title}</h3>
    <p><code>{url}</code> <button className="button" onClick={() => void navigator.clipboard.writeText(url)}>Copy URL</button></p>
    <svg role="img" aria-label={`QR code for ${title}`} width="180" height="180" viewBox={`0 0 ${size + 8} ${size + 8}`} shapeRendering="crispEdges">
      <rect width="100%" height="100%" fill="white" /><path d={cells.join('')} fill="black" />
    </svg>
  </section>;
}

export function ConnectPanel() {
  const { view } = useStudio();
  const [data, setData] = useState<SnippetsResponse | null>(null);
  const port = view?.runtime.port || view?.project.settings.port;

  useEffect(() => {
    void api<SnippetsResponse>('GET', '/api/snippets').then(setData);
  }, [port]);

  if (!data || !view) return null;
  const protocol = view.runtime.state === 'running' ? (view.runtime.url?.startsWith('https:') ? 'https' : 'http') : (view.project.settings.https?.enabled ? 'https' : 'http');
  const targets = [
    { title: 'Android Emulator', host: '10.0.2.2' },
    { title: 'iOS Simulator', host: 'localhost' },
    { title: 'Android device (adb reverse)', host: 'localhost' },
    ...(view.lan ? data.lan.map((host) => ({ title: `Physical device (${host})`, host })) : []),
  ];
  return (
    <div className="panel stack">
      <p>
        Point the debug build of your app at the mock server. These snippets only touch debug configuration; production settings stay as they are.
      </p>
      <p className="small">Send <code>X-Mock-Scenario: &lt;scenario name&gt;</code> to select a scenario when the override is enabled. The QR codes contain only the base URL.</p>
      {targets.map((target) => <ConnectionCard key={target.title} title={target.title} url={`${protocol}://${target.host}:${data.port}/`} />)}
      {view.lan && data.lan.length === 0 && <p>No LAN address was found.</p>}
      {data.snippets.map((s) => (
        <Fragment key={s.id}>
          <SnippetCard snippet={protocol === 'https' && ['android-emulator', 'android-device', 'ios-simulator', 'ios-device', 'kotlin-base-url', 'swift-base-url'].includes(s.id) ? { ...s, code: s.code.replaceAll('http://', 'https://') } : s} />
        </Fragment>
      ))}
    </div>
  );
}
