import { Fragment, useEffect, useState } from 'react';
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

export function ConnectPanel() {
  const { view } = useStudio();
  const [data, setData] = useState<SnippetsResponse | null>(null);
  const port = view?.runtime.port || view?.project.settings.port;

  useEffect(() => {
    void api<SnippetsResponse>('GET', '/api/snippets').then(setData);
  }, [port]);

  if (!data) return null;
  return (
    <div className="panel stack">
      <p>
        Point the debug build of your app at the mock server. These snippets only touch debug configuration; production settings stay as they are.
      </p>
      {data.snippets.map((s) => (
        <Fragment key={s.id}>
          <SnippetCard snippet={s} />
        </Fragment>
      ))}
    </div>
  );
}
