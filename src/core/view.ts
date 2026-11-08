// Types shared between the core, the control API and the UI. Keep this file free of runtime imports.
import type { Issue, KotlinFramework, SourceFile } from '../parser/ir.js';
import type { GenerationSettings, JsonSchema, TypeSummary, ValidationIssue, ValidationResult } from '../schema/types.js';
import type { Conflict, Header, ProjectModel } from './model.js';

export type RuntimeState = 'stopped' | 'starting' | 'running' | 'error';

export interface RuntimeStatus {
  state: RuntimeState;
  host: string;
  port: number;
  url?: string;
  error?: string;
  startedAt?: string;
  routeCount: number;
}

export interface RequestLog {
  id: number;
  timestamp: string;
  method: string;
  path: string;
  query: string;
  status: number;
  /** False when no mock matched (answered by the JSON 404 or the proxy). */
  matched: boolean;
  /** True when the request was forwarded to the real backend. */
  proxied: boolean;
  endpointId?: string;
  scenario?: string;
  requestHeaders: Header[];
  responseHeaders: Header[];
  requestBody?: string;
  responseBody?: string;
}

export interface ProjectView {
  revision: number;
  project: ProjectModel;
  conflicts: Conflict[];
  /** Schema violations of scenario bodies, by scenario id (only endpoints linked to a model). */
  violations: Record<string, ValidationIssue[]>;
  runtime: RuntimeStatus;
  /** True when the server listens on something other than the loopback interface. */
  lan: boolean;
  /** Set when the files on disk cannot be loaded; the last good state is still shown. */
  loadError?: string;
  /** Set when the running server could not take over the latest change. */
  runtimeNotice?: string;
  /** What the default safe mode switches off in this project (templating, data buckets, callbacks, CRUD/WebSocket routes). */
  safeModeNotes: string[];
  migrated: boolean;
  projectFile: string;
}

export interface ModelInput {
  /** Source text sent by the client (pasted code or uploaded files). */
  files?: SourceFile[];
  /** Files or folders below the access root. */
  paths?: string[];
  framework?: KotlinFramework;
}

export interface ParsedModels {
  types: TypeSummary[];
  issues: Issue[];
  sources: string[];
}

export interface BuiltSchema {
  schema: JsonSchema;
  issues: Issue[];
  rootType: string;
  settings: GenerationSettings;
  sources: string[];
}

export interface GeneratedBody extends BuiltSchema {
  body: string;
  validation: ValidationResult;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export interface MutationResponse {
  id?: string;
  view: ProjectView;
}

export interface PollResponse {
  revision: number;
  /** Present only when the revision differs from the one the client sent. */
  view?: ProjectView;
  runtime: RuntimeStatus;
  logs: RequestLog[];
}

export interface Snippet {
  id: string;
  title: string;
  description: string;
  language: 'text' | 'xml' | 'kotlin' | 'swift' | 'shell';
  /** Where the snippet belongs; always a debug-only location. */
  location?: string;
  code: string;
}

export interface SnippetsResponse {
  port: number;
  lan: string[];
  snippets: Snippet[];
}

export interface AiStatus {
  enabled: boolean;
  provider?: { id: string; name: string };
}

export interface AiPreview {
  provider: { id: string; name: string };
  /** Executable that will be started (the prompt is shown separately). */
  command: string;
  prompt: string;
  /** Must be sent back to confirm exactly this prompt. */
  hash: string;
  includesSource: boolean;
  bytes: number;
  notes: string[];
}

export interface AiResult extends GeneratedBody {
  source: 'ai' | 'local';
  /** Why the local generator answered instead of the AI CLI. */
  fallbackReason?: string;
}

export interface SchemaChange {
  kind: 'property-added' | 'property-removed' | 'type-changed' | 'nullable-changed' | 'required-changed' | 'enum-changed' | 'format-changed';
  /** JSON path such as $.items[].price */
  path: string;
  /** Existing bodies would no longer match the model. */
  breaking: boolean;
  message: string;
}

export interface ModelCheck {
  endpointId: string;
  collection: string;
  method: string;
  path: string;
  rootType: string;
  /** ok: model and bodies agree; drift: the model changed or bodies no longer match; unavailable: cannot be re-read. */
  status: 'ok' | 'drift' | 'unavailable';
  reason?: string;
  changes: SchemaChange[];
  violations: { scenarioId: string; scenario: string; errors: ValidationIssue[] }[];
}
