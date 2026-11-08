import { Fragment, useMemo, useState } from 'react';
import type { RequestLog } from '../../../src/core/view';
import { useStudio } from '../store';
import { statusTone, timeOf } from '../util';
import { Badge, MethodBadge } from './ui';

const reasonText: Record<NonNullable<RequestLog['scenarioReason']>, string> = { profile: 'Selected by a profile.', forced: 'Selected by the X-Mock-Scenario header.', rule: 'Selected by matching conditions.', default: 'Selected as the default fallback.', fixed: 'Selected by fixed scenario mode.', sequential: 'Selected by sequential mode.', random: 'Selected by random mode.', 'request-invalid': 'Request validation failed.' };

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
      {log.dynamic && <p><Badge tone="accent">dynamic</Badge> {log.dynamic.skipped && `Skipped: ${log.dynamic.skipped}`} {log.dynamic.unknownTokens.length > 0 && `Unknown tokens: ${log.dynamic.unknownTokens.join(', ')}`}</p>}
      {log.requestValidation && <div><h4>Request validation: {log.requestValidation.valid ? 'valid' : 'invalid'} ({log.requestValidation.model})</h4><ul className="issues">{log.requestValidation.errors?.map((error, i) => <li key={i}><code>{error.path}</code> {error.message}</li>)}</ul></div>}
      {log.multipart && <div><h4>Multipart ({log.multipart.totalBytes} bytes{log.multipart.truncated ? ', truncated' : ''})</h4><ul className="issues">{log.multipart.parts.map((part, i) => <li key={i}>{part.name ?? '(unnamed)'}{part.fileName ? ` — ${part.fileName}` : ''}{part.contentType ? ` (${part.contentType})` : ''} — {part.size} bytes</li>)}</ul></div>}
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
                <td className="muted">{log.matched ? (log.scenario ?? '') : log.proxied ? 'proxied to the real backend' : 'no mock matched'} {log.dynamic && <Badge tone="accent">dynamic</Badge>} {log.requestValidation && <Badge tone={log.requestValidation.valid ? 'ok' : 'warn'}>{log.requestValidation.valid ? 'valid' : 'invalid'}</Badge>} {log.scenarioReason && <Badge tone="accent" title={log.scenarioReason === 'profile' ? `Selected by profile: ${log.profile ?? 'unknown'}.` : reasonText[log.scenarioReason]}>{log.scenarioReason}{log.scenarioReason === 'profile' && log.profile ? `: ${log.profile}` : ''}</Badge>}</td>
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
