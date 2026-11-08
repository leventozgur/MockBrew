import { useEffect, useRef, useState } from 'react';
import type { Issue, KotlinFramework } from '../../../src/parser/ir';
import type { GenerationSettings, TypeSummary } from '../../../src/schema/types';
import type { ModelLink } from '../../../src/core/model';
import type { AiPreview, AiResult, AiStatus, GeneratedBody, ModelInput, ParsedModels } from '../../../src/core/view';
import { api } from '../api';
import { useStudio } from '../store';
import { Banner, Badge, Dialog, Field } from './ui';

type SourceTab = 'paste' | 'files' | 'paths';
type Variant = 'full' | 'minimal' | 'empty-list';

export interface GenerateResult {
  body: string;
  link: ModelLink;
}

function IssueList({ issues }: { issues: Issue[] }) {
  if (issues.length === 0) return null;
  const sorted = [...issues].sort((a, b) => order(a.severity) - order(b.severity));
  return (
    <ul className="issues">
      {sorted.map((issue, index) => (
        <li key={index}>
          <Badge tone={issue.severity === 'error' ? 'error' : issue.severity === 'warning' ? 'warn' : 'neutral'}>{issue.severity}</Badge>{' '}
          <strong>{issue.code}</strong> {issue.message}
          {issue.file ? (
            <span className="muted">
              {' '}
              {issue.file}
              {issue.line ? `:${issue.line}` : ''}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

const order = (severity: string) => (severity === 'error' ? 0 : severity === 'warning' ? 1 : 2);

/** Optional AI step: shows the exact prompt first and sends nothing until it is confirmed. */
function AiPanel({ buildRequest, onResult }: { buildRequest: () => object; onResult: (result: AiResult) => void }) {
  const [instruction, setInstruction] = useState('');
  const [includeSource, setIncludeSource] = useState(false);
  const [preview, setPreview] = useState<AiPreview | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);

  const request = () => ({ ...buildRequest(), instruction, includeSource });

  const review = async () => {
    setError(null);
    try {
      setPreview(await api<AiPreview>('POST', '/api/ai/preview', request()));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const send = async () => {
    if (!preview) return;
    controller.current = new AbortController();
    setWaiting(true);
    setError(null);
    try {
      onResult(await api<AiResult>('POST', '/api/ai/generate', { ...request(), confirm: preview.hash }, controller.current.signal));
      setPreview(null);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWaiting(false);
    }
  };

  return (
    <div className="stack ai-panel">
      <strong>Optional: realistic data with AI</strong>
      <Field label="What should the data look like?" hint="Optional, e.g. “three orders, one of them cancelled”. Without it the AI uses the field names.">
        <textarea rows={2} value={instruction} onChange={(e) => { setInstruction(e.target.value); setPreview(null); }} />
      </Field>
      <label className="inline">
        <input type="checkbox" checked={includeSource} onChange={(e) => { setIncludeSource(e.target.checked); setPreview(null); }} /> Also send the model source code (off: only the JSON Schema is sent)
      </label>
      {!preview && (
        <div>
          <button className="button" onClick={() => void review()}>
            Review what will be sent…
          </button>
        </div>
      )}
      {preview && (
        <div className="stack">
          <Banner tone="warn">
            This exact text ({preview.bytes} bytes) will be sent to {preview.provider.name} (<code>{preview.command}</code>) and on to its service. Nothing is sent before you confirm.
          </Banner>
          <pre className="prompt">{preview.prompt}</pre>
          <ul className="issues">
            {preview.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          <div className="row">
            <button className="button button-primary" disabled={waiting} onClick={() => void send()}>
              {waiting ? 'Waiting for the CLI…' : `Send to ${preview.provider.name}`}
            </button>
            {waiting ? (
              <button className="button" onClick={() => controller.current?.abort()}>
                Cancel
              </button>
            ) : (
              <button className="button" onClick={() => setPreview(null)}>
                Don’t send
              </button>
            )}
          </div>
        </div>
      )}
      {error && <Banner tone="error">{error}</Banner>}
    </div>
  );
}

/** Model to JSON: read Kotlin/Swift code, pick a type, preview a body that matches it. */
export function GenerateDialog({ onClose, onResult }: { onClose(): void; onResult(result: GenerateResult): void }) {
  const { view } = useStudio();
  const defaults = view?.project.settings.generation;
  const [tab, setTab] = useState<SourceTab>('paste');
  const [language, setLanguage] = useState<'kotlin' | 'swift'>('kotlin');
  const [pasted, setPasted] = useState('');
  const [files, setFiles] = useState<{ name: string; content: string }[]>([]);
  const [paths, setPaths] = useState('');
  const [framework, setFramework] = useState<KotlinFramework>('auto');
  const [parsed, setParsed] = useState<ParsedModels | null>(null);
  const [rootType, setRootType] = useState('');
  const [settings, setSettings] = useState<GenerationSettings>(defaults ?? { naming: 'identity', dateFormat: 'iso8601' });
  const [variant, setVariant] = useState<Variant>('full');
  const [seed, setSeed] = useState('0');
  const [generated, setGenerated] = useState<GeneratedBody | null>(null);
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ai, setAi] = useState<AiStatus>({ enabled: false });
  const [resultNote, setResultNote] = useState<AiResult | null>(null);

  useEffect(() => {
    void api<AiStatus>('GET', '/api/ai/status').then(setAi, () => undefined);
  }, []);

  const input = (): ModelInput => {
    const result: ModelInput = { framework };
    if (tab === 'paste') result.files = [{ name: language === 'kotlin' ? 'Pasted.kt' : 'Pasted.swift', content: pasted }];
    if (tab === 'files') result.files = files;
    if (tab === 'paths') result.paths = paths.split('\n').map((p) => p.trim()).filter(Boolean);
    return result;
  };

  const guard = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const parse = () =>
    guard(async () => {
      const result = await api<ParsedModels>('POST', '/api/models/parse', input());
      setParsed(result);
      setGenerated(null);
      const candidates = result.types.filter((t: TypeSummary) => t.kind === 'class' && !t.name.includes('.') && t.typeParams.length === 0);
      if (!rootType && candidates.length === 1) setRootType(candidates[0]?.name ?? '');
    });

  const generate = () =>
    guard(async () => {
      const result = await api<GeneratedBody>('POST', '/api/models/generate', { ...input(), rootType, settings, variant, seed });
      setGenerated(result);
      setBody(result.body);
      setResultNote(null);
    });

  const readFiles = async (list: FileList | null) => {
    if (!list) return;
    const loaded = await Promise.all(
      [...list]
        .filter((f) => /\.(kt|kts|swift)$/i.test(f.name))
        .map(async (f) => ({ name: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name, content: await f.text() })),
    );
    setFiles(loaded);
    setParsed(null);
  };

  const use = () => {
    if (!generated) return;
    onResult({
      body,
      link: { rootType: generated.rootType, settings: generated.settings, sources: generated.sources, schema: generated.schema },
    });
    onClose();
  };

  const hasInput = (tab === 'paste' && pasted.trim() !== '') || (tab === 'files' && files.length > 0) || (tab === 'paths' && paths.trim() !== '');

  return (
    <Dialog title="Generate a response from a model" onClose={onClose} wide>
      <div className="stack">
        <div className="tabs">
          {(['paste', 'files', 'paths'] as const).map((t) => (
            <button key={t} className={`tab${tab === t ? ' tab-active' : ''}`} onClick={() => { setTab(t); setParsed(null); setGenerated(null); }}>
              {t === 'paste' ? 'Paste code' : t === 'files' ? 'Choose files' : 'Project paths'}
            </button>
          ))}
        </div>

        {tab === 'paste' && (
          <>
            <Field label="Language">
              <select value={language} onChange={(e) => setLanguage(e.target.value as 'kotlin' | 'swift')}>
                <option value="kotlin">Kotlin</option>
                <option value="swift">Swift</option>
              </select>
            </Field>
            <textarea className="code" rows={10} placeholder="Paste the model classes here. The code is parsed, never executed." value={pasted} onChange={(e) => setPasted(e.target.value)} spellCheck={false} />
          </>
        )}
        {tab === 'files' && (
          <div className="stack">
            <Field label="Files (.kt, .kts, .swift)">
              <input type="file" multiple accept=".kt,.kts,.swift" onChange={(e) => void readFiles(e.target.files)} />
            </Field>
            <Field label="Or a whole folder">
              <input type="file" multiple {...({ webkitdirectory: '' } as object)} onChange={(e) => void readFiles(e.target.files)} />
            </Field>
            <span className="muted">{files.length} file(s) read in the browser; nothing leaves this machine.</span>
          </div>
        )}
        {tab === 'paths' && (
          <Field label="Files or folders, one per line" hint="Relative to the access root (default: the project folder; change it with --root).">
            <textarea className="code" rows={4} value={paths} onChange={(e) => setPaths(e.target.value)} placeholder="../app/src/main/java/com/example/model" spellCheck={false} />
          </Field>
        )}

        <div className="row">
          <Field label="Kotlin library">
            <select value={framework} onChange={(e) => setFramework(e.target.value as KotlinFramework)}>
              <option value="auto">Detect (Gson / Kotlinx / Moshi)</option>
              <option value="gson">Gson</option>
              <option value="kotlinx">Kotlinx Serialization</option>
              <option value="moshi">Moshi</option>
            </select>
          </Field>
          <button className="button" disabled={busy || !hasInput} onClick={() => void parse()}>
            Read models
          </button>
        </div>

        {parsed && (
          <div className="stack">
            <span className="muted">
              {parsed.types.length} type(s) found
              {parsed.sources.length ? ` in ${parsed.sources.length} file(s)` : ''}.
            </span>
            <IssueList issues={parsed.issues} />
            <div className="row">
              <Field label="Type" hint="Generics work too: BaseResponse<User>, List<User>, [User]">
                <input list="model-types" value={rootType} onChange={(e) => setRootType(e.target.value)} placeholder="User" />
                <datalist id="model-types">
                  {parsed.types.map((t) => (
                    <option key={`${t.file}:${t.name}`} value={t.name} />
                  ))}
                </datalist>
              </Field>
              <Field label="Field names">
                <select value={settings.naming} onChange={(e) => setSettings({ ...settings, naming: e.target.value as GenerationSettings['naming'] })}>
                  <option value="identity">As written</option>
                  <option value="snake_case">snake_case</option>
                </select>
              </Field>
              <Field label="Dates">
                <select value={settings.dateFormat} onChange={(e) => setSettings({ ...settings, dateFormat: e.target.value as GenerationSettings['dateFormat'] })}>
                  <option value="iso8601">ISO 8601</option>
                  <option value="epoch-seconds">Epoch seconds</option>
                  <option value="epoch-millis">Epoch milliseconds</option>
                </select>
              </Field>
              <Field label="Variant">
                <select value={variant} onChange={(e) => setVariant(e.target.value as Variant)}>
                  <option value="full">Full</option>
                  <option value="minimal">Minimal (required only)</option>
                  <option value="empty-list">Empty lists</option>
                </select>
              </Field>
              <Field label="Seed">
                <input value={seed} onChange={(e) => setSeed(e.target.value)} size={6} />
              </Field>
            </div>
            <div>
              <button className="button button-primary" disabled={busy || rootType.trim() === ''} onClick={() => void generate()}>
                {generated ? 'Generate again' : 'Generate'}
              </button>
            </div>
            {ai.enabled && rootType.trim() !== '' && (
              <AiPanel
                buildRequest={() => ({ ...input(), rootType, settings, variant, seed })}
                onResult={(result) => {
                  setGenerated(result);
                  setBody(result.body);
                  setResultNote(result);
                }}
              />
            )}
          </div>
        )}

        {error && <Banner tone="error">{error}</Banner>}

        {generated && (
          <div className="stack">
            {resultNote?.source === 'ai' && <Banner tone="info">Generated by the AI CLI and checked against the model.</Banner>}
            {resultNote?.source === 'local' && <Banner tone="warn">The AI did not provide usable data ({resultNote.fallbackReason}). The local generator was used instead.</Banner>}
            <IssueList issues={generated.issues} />
            <div className="row">
              <strong>Preview</strong>
              {generated.validation.valid ? <Badge tone="ok">matches the model</Badge> : <Badge tone="warn">{generated.validation.errors.length} difference(s)</Badge>}
            </div>
            <textarea className="code" rows={12} value={body} onChange={(e) => setBody(e.target.value)} spellCheck={false} />
            <div className="row-end">
              <button className="button" onClick={onClose}>
                Cancel
              </button>
              <button className="button button-primary" onClick={use}>
                Use this body
              </button>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
