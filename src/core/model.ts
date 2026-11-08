import type { GenerationSettings, JsonSchema } from '../schema/types.js';

// Domain model shared by the core, the control API, the MCP server and the UI.
// It must stay free of runtime imports so that the UI can import the types.

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export const ROOT_COLLECTION_ID = 'root';

export interface Header {
  key: string;
  value: string;
}

export interface Scenario {
  id: string;
  name: string;
  statusCode: number;
  headers: Header[];
  body: string;
  latencyMs: number;
  active: boolean;
}

export interface ModelLink {
  rootType: string;
  settings: GenerationSettings;
  /** Source files relative to the access root; empty when the code was pasted. */
  sources: string[];
  schema: JsonSchema;
}

export interface Endpoint {
  id: string;
  collectionId: string;
  method: HttpMethod;
  path: string;
  description: string;
  scenarios: Scenario[];
  model?: ModelLink;
  /** Routes created outside this tool (CRUD, WebSocket, unusual methods) are shown but not editable. */
  readOnly: boolean;
}

export interface Collection {
  id: string;
  name: string;
  active: boolean;
  /** The implicit collection holding routes that are not inside a folder. */
  virtual: boolean;
  endpoints: Endpoint[];
}

export type CorsMode = 'wildcard' | 'reflect';

export interface ProjectSettings {
  port: number;
  /** 127.0.0.1 by default; 0.0.0.0 only when LAN access is enabled explicitly. */
  host: string;
  cors: { enabled: boolean; mode: CorsMode };
  generation: GenerationSettings;
  logBodies: boolean;
  /** Requests that no mock matches are forwarded to a real backend while enabled. */
  proxy: { enabled: boolean; host: string };
  /** Off by default: imported Mockoon files must not run templating helpers, callbacks or data buckets. */
  allowTemplating: boolean;
}

export interface ProjectModel {
  name: string;
  collections: Collection[];
  settings: ProjectSettings;
}

export interface Conflict {
  kind: 'duplicate' | 'shadowed';
  severity: 'error' | 'warning';
  method: HttpMethod;
  path: string;
  endpointIds: string[];
  message: string;
}

export interface ScenarioInput {
  name?: string;
  statusCode?: number;
  headers?: Header[];
  body?: string;
  latencyMs?: number;
}

export interface EndpointInput {
  method: HttpMethod;
  path: string;
  description?: string;
  scenarios?: ScenarioInput[];
}

export interface EndpointPatch {
  method?: HttpMethod;
  path?: string;
  description?: string;
  collectionId?: string;
}

export interface SettingsPatch {
  port?: number;
  host?: string;
  cors?: { enabled?: boolean; mode?: CorsMode };
  generation?: Partial<GenerationSettings>;
  logBodies?: boolean;
  proxy?: { enabled?: boolean; host?: string };
  allowTemplating?: boolean;
}
