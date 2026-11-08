import path from 'node:path';
import { generateJson } from '../generator/index.js';
import type { Variant } from '../generator/index.js';
import { type SourceFile, extractModels } from '../parser/index.js';
import {
  type GenerationSettings,
  type JsonSchema,
  buildSchema,
  hasErrors,
  listTypes,
  normalizeSettings,
  validateBody,
} from '../schema/index.js';
import { invalid } from './errors.js';
import { loadSources } from './safe-path.js';
import type { BuiltSchema, GeneratedBody, ModelInput, ParsedModels } from './view.js';

export type { BuiltSchema, GeneratedBody, ModelInput, ParsedModels } from './view.js';

/** Removes absolute-looking and parent-relative parts from names supplied by clients. */
function safeName(name: string): string {
  const cleaned = name
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/');
  return cleaned || path.basename(name) || 'input.kt';
}

/** Parses model sources and derives schemas and sample bodies. Reads files only below `root`. */
export class ModelService {
  constructor(private readonly root: string) {}

  /** Reads the model sources a request refers to (used for AI prompts that include the code). */
  readSources(input: ModelInput): Promise<{ files: SourceFile[]; sources: string[] }> {
    return this.collect(input);
  }

  private async collect(input: ModelInput): Promise<{ files: SourceFile[]; sources: string[] }> {
    const files: SourceFile[] = [];
    let sources: string[] = [];
    if (input.paths?.length) {
      const loaded = await loadSources(this.root, input.paths);
      files.push(...loaded);
      sources = loaded.map((f) => f.name);
    }
    for (const file of input.files ?? []) files.push({ name: safeName(file.name), content: file.content });
    if (files.length === 0) throw invalid('Provide model code (files) or paths to .kt/.swift files.');
    return { files, sources };
  }

  async parse(input: ModelInput): Promise<ParsedModels> {
    const { files, sources } = await this.collect(input);
    const extract = await extractModels(files, { framework: input.framework });
    return { types: listTypes(extract.declarations), issues: extract.issues, sources };
  }

  async schema(input: ModelInput, rootType: string, settings?: Partial<GenerationSettings>): Promise<BuiltSchema> {
    const { files, sources } = await this.collect(input);
    const extract = await extractModels(files, { framework: input.framework });
    let result;
    try {
      result = buildSchema(extract, rootType, normalizeSettings(settings));
    } catch (error) {
      throw invalid((error as Error).message);
    }
    return { ...result, sources };
  }

  async generate(
    input: ModelInput,
    rootType: string,
    options: { settings?: Partial<GenerationSettings>; variant?: Variant; seed?: string | number } = {},
  ): Promise<GeneratedBody> {
    const built = await this.schema(input, rootType, options.settings);
    if (hasErrors(built.issues)) {
      throw invalid(built.issues.filter((i) => i.severity === 'error').map((i) => i.message).join(' '), built.issues);
    }
    const body = generateJson(built.schema, { variant: options.variant, seed: options.seed });
    return { ...built, body, validation: validateBody(built.schema, body) };
  }
}

/** Drops source locations before a schema is stored in the project file. */
export function stripSourceInfo(schema: JsonSchema): JsonSchema {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(node)) {
        if (key !== 'x-source') out[key] = walk(value);
      }
      return out;
    }
    return node;
  };
  return walk(schema) as JsonSchema;
}
