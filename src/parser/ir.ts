// Language-neutral model description produced by the Kotlin and Swift extractors.

export type Language = 'kotlin' | 'swift';

export type ScalarKind =
  | 'string'
  | 'boolean'
  | 'int32'
  | 'int64'
  | 'double'
  | 'decimal'
  | 'instant'
  | 'localDate'
  | 'localTime'
  | 'uuid'
  | 'url'
  | 'base64'
  | 'any';

export type TypeRefBody =
  | { kind: 'scalar'; scalar: ScalarKind; source: string }
  | { kind: 'list'; item: TypeRef }
  | { kind: 'map'; value: TypeRef }
  | { kind: 'named'; name: string; args: TypeRef[] }
  | { kind: 'unsupported'; text: string };

export type TypeRef = TypeRefBody & { nullable?: boolean };

export interface FieldDecl {
  /** Property name in source code. */
  name: string;
  /** Explicit JSON key from annotations / CodingKeys, if any. */
  jsonName?: string;
  alternateNames?: string[];
  type: TypeRef;
  hasDefault: boolean;
  line: number;
}

export interface EnumCaseDecl {
  name: string;
  /** Explicit serialized value (SerialName / raw value). */
  value?: string | number;
}

export interface UnsupportedInfo {
  code: string;
  message: string;
}

export interface TypeDecl {
  kind: 'class' | 'enum';
  name: string;
  /** Dot separated path including outer types, e.g. `User.Inner`. */
  qualifiedName: string;
  typeParams: string[];
  fields: FieldDecl[];
  enumCases: EnumCaseDecl[];
  /** Swift enums with raw values: kind of the raw value. */
  enumRaw?: 'string' | 'int';
  language: Language;
  file: string;
  line: number;
  /** The type cannot be represented faithfully; schemas fall back to "any" for it. */
  unsupported?: UnsupportedInfo;
  parentNames?: string[];
  sealed?: boolean;
  object?: boolean;
  serialName?: string;
  packageName?: string;
  discriminator?: string;
  polymorphismFramework?: KotlinFramework;
}

export interface AliasDecl {
  name: string;
  typeParams: string[];
  type: TypeRef;
  language: Language;
  file: string;
}

export type IssueSeverity = 'error' | 'warning' | 'info';

export interface Issue {
  severity: IssueSeverity;
  code: string;
  message: string;
  file?: string;
  line?: number;
  type?: string;
  field?: string;
}

export interface SourceFile {
  name: string;
  content: string;
}

export interface ExtractResult {
  declarations: TypeDecl[];
  aliases: AliasDecl[];
  issues: Issue[];
}

export type KotlinFramework = 'auto' | 'gson' | 'kotlinx' | 'moshi';

export interface ExtractOptions {
  framework?: KotlinFramework;
}
