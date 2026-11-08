import { ParserHost, languageOf } from './host.js';
import type { ExtractOptions, ExtractResult, Issue, SourceFile } from './ir.js';

export type { ExtractOptions, ExtractResult, Issue, SourceFile } from './ir.js';
export * from './ir.js';
export { MAX_FILES, MAX_FILE_BYTES, ParserHost, languageOf } from './host.js';

let shared: ParserHost | undefined;

function host(): ParserHost {
  shared ??= new ParserHost();
  return shared;
}

/** Extracts type declarations from Kotlin and Swift sources (mixed input is allowed). */
export async function extractModels(files: SourceFile[], options?: ExtractOptions): Promise<ExtractResult> {
  const result: ExtractResult = { declarations: [], aliases: [], issues: [] };
  const byLanguage = { kotlin: [] as SourceFile[], swift: [] as SourceFile[] };
  for (const file of files) {
    const language = languageOf(file.name);
    if (language) {
      byLanguage[language].push(file);
    } else {
      const issue: Issue = { severity: 'warning', code: 'unsupported-file', message: `${file.name} is not a .kt, .kts or .swift file and is ignored.`, file: file.name };
      result.issues.push(issue);
    }
  }
  for (const language of ['kotlin', 'swift'] as const) {
    if (byLanguage[language].length === 0) continue;
    const part = await host().extract(language, byLanguage[language], options);
    result.declarations.push(...part.declarations);
    result.aliases.push(...part.aliases);
    result.issues.push(...part.issues);
  }
  return result;
}

export function shutdownParser(): void {
  shared?.close();
  shared = undefined;
}
