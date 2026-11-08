import { z } from 'zod';
import { StudioError, invalid } from '../core/errors.js';

export const STUDIO_SCHEMA_VERSION = 2;

const generationSchema = z.object({
  naming: z.enum(['identity', 'snake_case']).default('identity'),
  dateFormat: z.enum(['iso8601', 'epoch-seconds', 'epoch-millis']).default('iso8601'),
}).passthrough();

const modelLinkSchema = z.object({
  rootType: z.string().min(1),
  settings: generationSchema,
  sources: z.array(z.string()),
  schema: z.record(z.string(), z.unknown()),
}).passthrough();

const settingsSchema = z.object({
  cors: z
    .object({ enabled: z.boolean().default(true), mode: z.enum(['wildcard', 'reflect']).default('wildcard') }).passthrough()
    .default({ enabled: true, mode: 'wildcard' }),
  generation: generationSchema.default({ naming: 'identity', dateFormat: 'iso8601' }),
  logBodies: z.boolean().default(false),
  /** Mockoon templating, data buckets, callbacks and CRUD/WebSocket routes run only when this is on. */
  allowTemplating: z.boolean().default(false),
  scenarioOverrideHeader: z.boolean().default(true),
  https: z.object({ enabled: z.boolean().default(false) }).default({ enabled: false }),
}).passthrough();

export const profileSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().max(1000).optional(),
  endpoints: z.record(z.string().min(1).max(200), z.object({ scenarioId: z.string().min(1).max(200), mode: z.literal('fixed').optional() }).passthrough()).refine((v) => Object.keys(v).length <= 1000, 'Too many endpoints.'),
  network: z.object({ latencyMs: z.number().int().min(0).max(60000).optional(), timeoutEndpoints: z.union([z.literal('all'), z.array(z.string().min(1).max(200)).max(1000)]).optional(), timeoutMs: z.number().int().min(1).max(600000).optional() }).passthrough().optional(),
}).passthrough();

// Version 2 readers preserve unknown fields via passthrough; these optional additions need no migration.
const studioFileSchema = z.object({
  schemaVersion: z.literal(STUDIO_SCHEMA_VERSION),
  /** Plain file name of the Mockoon environment in the same folder. */
  environmentFile: z.string().min(1),
  settings: settingsSchema.default({
    cors: { enabled: true, mode: 'wildcard' },
    generation: { naming: 'identity', dateFormat: 'iso8601' },
    logBodies: false,
    allowTemplating: false,
    scenarioOverrideHeader: true,
    https: { enabled: false },
  }),
  profiles: z.record(z.string().min(1).max(200), profileSchema).refine((v) => Object.keys(v).length <= 200, 'Too many profiles.').default({}),
  activeProfileId: z.string().min(1).max(200).nullable().optional(),
  collections: z.record(z.string(), z.object({ active: z.boolean() }).passthrough()).default({}),
  endpoints: z.record(z.string(), z.object({ model: modelLinkSchema.optional() }).passthrough()).default({}),
}).passthrough();

export type StudioFile = z.infer<typeof studioFileSchema>;

export function isPlainFileName(name: string): boolean {
  return name.length > 0 && !/[\\/]/.test(name) && name !== '.' && name !== '..' && !name.includes('\0');
}

export function newStudioFile(environmentFile: string): StudioFile {
  return studioFileSchema.parse({ schemaVersion: STUDIO_SCHEMA_VERSION, environmentFile });
}

/** Validates a sidecar read from disk. Unknown future major versions are never loaded silently. */
export function parseStudioFile(raw: unknown): StudioFile {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw invalid('The studio file must contain a JSON object.');
  const version = (raw as { schemaVersion?: unknown }).schemaVersion;
  if (typeof version !== 'number') throw invalid('The studio file has no numeric "schemaVersion".');
  if (version > STUDIO_SCHEMA_VERSION) {
    throw new StudioError(
      'UNSUPPORTED_VERSION',
      `The studio file uses schemaVersion ${version}, but this tool only supports up to ${STUDIO_SCHEMA_VERSION}. Update the tool to open it.`,
    );
  }
  const parsed = studioFileSchema.safeParse(version === 1 ? { ...raw, schemaVersion: 2 } : raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw invalid(`The studio file is invalid at "${first?.path.join('.') ?? ''}": ${first?.message ?? 'unknown error'}.`);
  }
  const names = Object.values(parsed.data.profiles).map((p) => p.name.toLowerCase());
  if (new Set(names).size !== names.length) throw invalid('Profile names must be unique.');
  if (!isPlainFileName(parsed.data.environmentFile)) {
    throw invalid('"environmentFile" must be a file name in the same folder as the studio file.');
  }
  return parsed.data;
}
