import type { ModelUpdateChange } from '../../../src/core/view';

/** A bounded line diff; large bodies fall back to showing removed and added lines. */
function lineDiff(before: string, after: string): { kind: string; text: string }[] {
  const a = before.split('\n');
  const b = after.split('\n');
  if (a.length * b.length > 250000) return [...a.map((text) => ({ kind: 'removed', text })), ...b.map((text) => ({ kind: 'added', text }))];
  const rows = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) rows[i]![j] = a[i] === b[j] ? rows[i + 1]![j + 1]! + 1 : Math.max(rows[i + 1]![j]!, rows[i]![j + 1]!);
  const result: { kind: string; text: string }[] = [];
  let i = 0; let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { result.push({ kind: 'same', text: a[i++]! }); j++; }
    else if (j < b.length && (i === a.length || rows[i]![j + 1]! > rows[i + 1]![j]!)) result.push({ kind: 'added', text: b[j++]! });
    else result.push({ kind: 'removed', text: a[i++]! });
  }
  return result;
}

export function ModelUpdatePreview({ before, after, changes }: { before: string; after: string; changes: ModelUpdateChange[] }) {
  const kinds = ['added', 'removed', 'regenerated', 'kept'] as const;
  return <div className="stack">
    <div className="model-diff" role="region" aria-label="Body diff" tabIndex={0}><pre>{lineDiff(before, after).map((line, i) => <span key={i} className={`model-diff-${line.kind}`}>{line.kind === 'added' ? '+ ' : line.kind === 'removed' ? '- ' : '  '}{line.text}{'\n'}</span>)}</pre></div>
    <details><summary>{kinds.map((kind) => `${kind}: ${changes.filter((change) => change.kind === kind).length}`).join(' · ')}</summary>
      <ul className="issues">{changes.map((change, i) => <li key={i}>{change.kind}: <code>{change.path}</code></li>)}</ul>
    </details>
  </div>;
}
