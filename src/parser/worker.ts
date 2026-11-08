// Entry point of the isolated parser process. It must be started with --liftoff-only
// (see host.ts): the optimizing WASM compiler of Node 24+ runs out of memory on the grammars.
import { getParser } from './grammar.js';
import type { ExtractOptions, ExtractResult, Language, SourceFile } from './ir.js';
import { extractKotlin } from './kotlin/extract.js';
import { extractSwift } from './swift/extract.js';

export interface WorkerRequest {
  id: number;
  language: Language;
  files: SourceFile[];
  options?: ExtractOptions;
}

export type WorkerResponse =
  | { id: number; ok: true; result: ExtractResult }
  | { id: number; ok: false; error: string };

async function extract(request: WorkerRequest): Promise<ExtractResult> {
  const parser = await getParser(request.language);
  const merged: ExtractResult = { declarations: [], aliases: [], issues: [] };
  for (const file of request.files) {
    try {
      const tree = parser.parse(file.content);
      try {
        const result =
          request.language === 'kotlin'
            ? extractKotlin(tree, file.name, request.options)
            : extractSwift(tree, file.name);
        merged.declarations.push(...result.declarations);
        merged.aliases.push(...result.aliases);
        merged.issues.push(...result.issues);
      } finally {
        tree.delete();
      }
    } catch (error) {
      merged.issues.push({
        severity: 'error',
        code: 'parse-failed',
        message: `Could not parse ${file.name}: ${error instanceof Error ? error.message : String(error)}`,
        file: file.name,
      });
    }
  }
  return merged;
}

process.on('message', (message: WorkerRequest) => {
  extract(message).then(
    (result) => process.send?.({ id: message.id, ok: true, result } satisfies WorkerResponse),
    (error: unknown) =>
      process.send?.({ id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) } satisfies WorkerResponse),
  );
});

process.send?.({ ready: true });
