import { Fragment, useMemo, useState } from 'react';
import type { RequestLog } from '../../../src/core/view';
import { useStudio } from '../store';
import { statusTone, timeOf } from '../util';
import { Badge, MethodBadge } from './ui';

function Details({ log }: { log: RequestLog }) {
  const table = (title: string, headers: { key: string; value: string }[]) => (
    <div>
      <h4>{title}</h4>
      <table className="kv">
        <tbody>
          {headers.map((h, i) => (
            <tr key={i}>
              <td>{h.key}</td>
              <td>{h.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  return (
    <div className="log-details">
      {!log.matched && !log.proxied && <p>No active mock matched this request. Check the method, the path and which collections are active.</p>}
      {log.proxied && <p>No mock matched, so the request was forwarded to the real backend.</p>}
      {table('Request headers', log.requestHeaders)}
      {table('Response headers', log.responseHeaders)}
      {log.requestBody !== undefined && (
        <div>
          <h4>Request body</h4>
          <pre>{log.requestBody}</pre>
        </div>
      )}
      {log.responseBody !== undefined && (
        <div>
          <h4>Response body</h4>
          <pre>{log.responseBody}</pre>
        </div>
      )}
      <p className="muted small">Authorization, cookie and API key values are masked. Bodies are logged only when enabled in the settings.</p>
    </div>
  );
}

export function LogsPanel() {
  const { logs, clearLogs, view } = useStudio();
  const [onlyUnmatched, setOnlyUnmatched] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const shown = useMemo(() => (onlyUnmatched ? logs.filter((l) => !l.matched) : logs).slice().reverse(), [logs, onlyUnmatched]);
  const running = view?.runtime.state === 'running';

  return (
    <div className="panel">
      <div className="row">
        <label className="inline">
          <input type="checkbox" checked={onlyUnmatched} onChange={(e) => setOnlyUnmatched(e.target.checked)} /> Only unmatched requests
        </label>
        <span className="grow" />
        <span className="muted">{logs.length} request(s)</span>
        <button className="button" onClick={() => void clearLogs()}>
          Clear
        </button>
      </div>
      {logs.length === 0 && <p className="muted">{running ? 'Waiting for requests…' : 'Start the mock server to see requests here.'}</p>}
      <table className="logs">
        <tbody>
          {shown.map((log) => (
            <Fragment key={log.id}>
              <tr className={log.matched || log.proxied ? '' : 'unmatched'} onClick={() => setOpen(open === log.id ? null : log.id)}>
                <td className="muted">{timeOf(log.timestamp)}</td>
                <td>
                  <MethodBadge method={log.method} />
                </td>
                <td className="mono">
                  {log.path}
                  {log.query ? `?${log.query}` : ''}
                </td>
                <td>
                  <Badge tone={statusTone(log.status)}>{log.status}</Badge>
                </td>
                <td className="muted">{log.matched ? (log.scenario ?? '') : log.proxied ? 'proxied to the real backend' : 'no mock matched'}</td>
              </tr>
              {open === log.id && (
                <tr>
                  <td colSpan={5}>
                    <Details log={log} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
