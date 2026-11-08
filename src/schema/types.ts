export type JsonSchema = Record<string, unknown>;

export type NamingStrategy = 'identity' | 'snake_case';
export type DateFormat = 'iso8601' | 'epoch-seconds' | 'epoch-millis';

/** Decoder level settings that change the JSON shape of a model. */
export interface GenerationSettings {
  naming: NamingStrategy;
  dateFormat: DateFormat;
  classDiscriminator?: string;
  polymorphism?: { discriminator: string };
}

export const DEFAULT_SETTINGS: GenerationSettings = { naming: 'identity', dateFormat: 'iso8601' };

export const JSON_SCHEMA_DRAFT = 'https://json-schema.org/draft/2020-12/schema';

export function normalizeSettings(input: Partial<GenerationSettings> | undefined): GenerationSettings {
  const naming = input?.naming === 'snake_case' ? 'snake_case' : 'identity';
  const dateFormat =
    input?.dateFormat === 'epoch-seconds' || input?.dateFormat === 'epoch-millis' ? input.dateFormat : 'iso8601';
  return { naming, dateFormat, ...(input?.classDiscriminator ? { classDiscriminator: input.classDiscriminator } : {}), ...(input?.polymorphism?.discriminator ? { polymorphism: { discriminator: input.polymorphism.discriminator } } : {}) };
}

export interface TypeSummary {
  name: string;
  kind: 'class' | 'enum';
  language: 'kotlin' | 'swift';
  file: string;
  line: number;
  typeParams: string[];
  fieldCount: number;
  unsupported?: string;
}

export interface ValidationIssue {
  path: string;
  message: string;
  keyword: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
}
