import { statSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { StudioError } from '../../core/errors.js';
import { ModelService } from '../../core/model-service.js';
import { commonAncestor, isBroadRoot } from '../../core/safe-path.js';
import type { HttpMethod, ModelLink } from '../../core/model.js';
import { HTTP_METHODS } from '../../core/model.js';
import { VARIANTS, type Variant } from '../../generator/index.js';
import type { DateFormat, GenerationSettings, NamingStrategy } from '../../schema/index.js';
import { type Io, UsageError, formatIssue, openProject } from '../common.js';

export const generateHelp = `mock-studio generate --model <file|folder>... [--type <Type>]

Parses Kotlin (Gson, Kotlinx Serialization, Moshi) and Swift (Codable) models without compiling them and
prints a JSON body that matches the model. The source is parsed only, never executed.

Options:
  -m, --model <path>      Model file or folder (repeatable). Types may be declared in several files.
  -t, --type <Type>       Type to generate, e.g. User, BaseResponse<User>, List<User>, [User]
      --list              List the declared types and parser findings, then exit
      --schema            Print the JSON Schema instead of a body
      --naming <s>        identity (default) | snake_case
      --date <f>          iso8601 (default) | epoch-seconds | epoch-millis
      --variant <v>       full (default) | minimal | empty-list
      --seed <value>      Same seed, same output (default 0)
      --framework <f>     auto (default) | gson | kotlinx | moshi

Save into a project instead of printing:
  -p, --project <path>    Project folder or file
      --collection <n>    Collection name (created when missing)
      --method <m>        GET, POST, PUT, PATCH, DELETE or HEAD
      --path <path>       Endpoint path, e.g. /users/:id
      --scenario <n>      Scenario name (default: Generated)
      --status <n>        Status code (default 200)
      --latency <ms>      Response latency (default 0)`;

function commonRoot(paths: string[]): string {
  const dirs = paths.map((p) => {
    const abs = path.resolve(p);
    try {
      return statSync(abs).isDirectory() ? abs : path.dirname(abs);
    } catch {
      throw new UsageError(`"${p}" was not found.`);
    }
  });
  const split = dirs.map((d) => d.split(path.sep));
  const first = split[0] ?? [];
  let length = first.length;
  for (const parts of split) {
    let i = 0;
    while (i < length && parts[i] === first[i]) i++;
    length = i;
  }
  return first.slice(0, length).join(path.sep) || path.sep;
}

function choice<T extends string>(value: string | undefined, allowed: readonly T[], name: string): T | undefined {
  if (value === undefined) return undefined;
  if (!(allowed as readonly string[]).includes(value)) throw new UsageError(`${name} must be one of: ${allowed.join(', ')}.`);
  return value as T;
}

export async function generateCommand(argv: string[], io: Io): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      model: { type: 'string', short: 'm', multiple: true },
      type: { type: 'string', short: 't' },
      list: { type: 'boolean' },
      schema: { type: 'boolean' },
      naming: { type: 'string' },
      date: { type: 'string' },
      variant: { type: 'string' },
      seed: { type: 'string' },
      framework: { type: 'string' },
      project: { type: 'string', short: 'p' },
      collection: { type: 'string' },
      method: { type: 'string' },
      path: { type: 'string' },
      scenario: { type: 'string' },
      status: { type: 'string' },
      latency: { type: 'string' },
    },
  });
  const modelPaths = values.model ?? [];
  if (modelPaths.length === 0) throw new UsageError('Give at least one --model file or folder.');

  const settings: Partial<GenerationSettings> = {
    naming: choice<NamingStrategy>(values.naming, ['identity', 'snake_case'], '--naming'),
    dateFormat: choice<DateFormat>(values.date, ['iso8601', 'epoch-seconds', 'epoch-millis'], '--date'),
  };
  const variant = choice<Variant>(values.variant, VARIANTS, '--variant');
  const framework = choice(values.framework, ['auto', 'gson', 'kotlinx', 'moshi'] as const, '--framework');

  const root = commonRoot(modelPaths);
  const models = new ModelService(root);
  const input = { paths: modelPaths.map((p) => path.resolve(p)), framework };

  const parsed = await models.parse(input);
  if (values.list) {
    for (const t of parsed.types) {
      io.out(`${t.kind.padEnd(5)} ${t.name}${t.typeParams.length ? `<${t.typeParams.join(', ')}>` : ''}  ${t.file}:${t.line}${t.unsupported ? `  (unsupported: ${t.unsupported})` : ''}`);
    }
    for (const issue of parsed.issues) io.err(formatIssue(issue));
    return;
  }

  let type = values.type;
  if (!type) {
    const candidates = parsed.types.filter((t) => !t.name.includes('.') && t.kind === 'class' && t.typeParams.length === 0);
    if (candidates.length !== 1) {
      throw new UsageError(
        `Pass --type. ${parsed.types.length === 0 ? 'No types were found.' : `Declared types: ${parsed.types.map((t) => t.name).join(', ')}`}`,
      );
    }
    type = (candidates[0] as { name: string }).name;
  }

  const seed = values.seed;
  if (values.schema) {
    const built = await models.schema(input, type, settings);
    for (const issue of built.issues) io.err(formatIssue(issue));
    if (built.issues.some((i) => i.severity === 'error')) throw new StudioError('INVALID', 'The schema could not be built.');
    io.out(JSON.stringify(built.schema, null, 2));
    return;
  }

  const generated = await models.generate(input, type, { settings, variant, seed });
  for (const issue of generated.issues) io.err(formatIssue(issue));

  if (!values.project) {
    io.out(generated.body);
    return;
  }

  if (!values.collection || !values.method || !values.path) {
    throw new UsageError('Saving into a project needs --collection, --method and --path.');
  }
  const method = values.method.toUpperCase();
  if (!(HTTP_METHODS as readonly string[]).includes(method)) throw new UsageError(`--method must be one of ${HTTP_METHODS.join(', ')}.`);
  const service = await openProject(values.project, { watch: false });
  try {
    // Source paths are recorded relative to the project folder, so the model files must share a folder with it.
    const shared = commonAncestor(service.projectDir, root);
    let sources: string[] = [];
    if (isBroadRoot(shared)) {
      io.err('Note: the model files and the project share no folder below your home folder, so no source paths are recorded and "mock-studio check" cannot re-read this model.');
    } else {
      service.setAccessRoot(shared);
      sources = parsed.sources.map((name) => path.relative(shared, path.join(root, name)).split(path.sep).join('/'));
      if (shared !== service.projectDir) io.err(`Note: model files are outside the project folder; pass --root ${path.relative(process.cwd(), shared) || '.'} to check, ui and mcp.`);
    }
    const link: ModelLink = { rootType: generated.rootType, settings: generated.settings, sources, schema: generated.schema };
    const result = await service.upsertScenario({
      collection: values.collection,
      method: method as HttpMethod,
      path: values.path,
      scenarioName: values.scenario ?? 'Generated',
      statusCode: values.status === undefined ? undefined : Number(values.status),
      latencyMs: values.latency === undefined ? undefined : Number(values.latency),
      body: generated.body,
      model: link,
    });
    io.out(`${result.created ? 'Created' : 'Updated'} ${method} ${values.path} in "${values.collection}" with scenario "${values.scenario ?? 'Generated'}" (${service.projectFile}).`);
  } finally {
    await service.close();
  }
}
