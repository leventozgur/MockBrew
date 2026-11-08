import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type GenerateOptions, generateValue } from '../src/generator/index.js';
import { extractModels } from '../src/parser/index.js';
import { type GenerationSettings, buildSchema, validateValue } from '../src/schema/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export function fixture(...parts: string[]): { name: string; content: string } {
  const file = path.join(here, 'fixtures', ...parts);
  return { name: parts.join('/'), content: readFileSync(file, 'utf8') };
}

export async function schemaFor(
  files: { name: string; content: string }[],
  type: string,
  settings?: Partial<GenerationSettings>,
) {
  const extract = await extractModels(files);
  return buildSchema(extract, type, settings);
}

export async function roundTrip(
  files: { name: string; content: string }[],
  type: string,
  settings?: Partial<GenerationSettings>,
  options?: GenerateOptions,
) {
  const { schema, issues } = await schemaFor(files, type, settings);
  const value = generateValue(schema, options);
  return { schema, issues, value, validation: validateValue(schema, value) };
}

type Json = Record<string, any>;

/** Follows the root $ref of a built schema. */
export function rootDef(schema: Json): Json {
  const ref = schema.$ref as string | undefined;
  if (!ref) return schema;
  return schema.$defs[ref.replace('#/$defs/', '')];
}

export function def(schema: Json, key: string): Json {
  return schema.$defs[key];
}
