import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import Parser from 'web-tree-sitter';
import { isSea, seaAssetDir } from '../core/runtime-env.js';
import type { Language } from './ir.js';

const require = createRequire(import.meta.url);

let initialized: Promise<void> | undefined;
const parsers = new Map<Language, Promise<Parser>>();

async function loadLanguage(language: Language): Promise<Parser.Language> {
  const wasmDir = isSea() ? seaAssetDir() : path.join(path.dirname(require.resolve('tree-sitter-wasms/package.json')), 'out');
  return Parser.Language.load(await readFile(path.join(wasmDir, `tree-sitter-${language}.wasm`)));
}

/** Returns a parser configured for the language; grammars are compiled once per process. */
export async function getParser(language: Language): Promise<Parser> {
  initialized ??= isSea() ? Parser.init({ locateFile: () => path.join(seaAssetDir(), 'tree-sitter.wasm') }) : Parser.init();
  await initialized;
  let parser = parsers.get(language);
  if (!parser) {
    parser = (async () => {
      const p = new Parser();
      p.setLanguage(await loadLanguage(language));
      return p;
    })();
    parsers.set(language, parser);
  }
  return parser;
}
