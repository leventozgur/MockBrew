import {
  BodyTypes,
  type Environment,
  EnvironmentSchemaNoFix,
  type Folder,
  HighestMigrationId,
  Migrations,
  type Route,
  type RouteResponse,
  BuildEnvironment,
  BuildFolder,
  BuildHTTPRoute,
  BuildRouteResponse,
  CORSHeaders,
  addFolderMutator,
  addRouteMutator,
  removeFolderMutator,
  removeRouteMutator,
  updateFolderMutator,
} from '@mockoon/commons';
import { createHash } from 'node:crypto';
import { normalizePath } from '../core/conflicts.js';
import { StudioError, invalid, notFound } from '../core/errors.js';
import {
  type Collection,
  type CorsMode,
  type Endpoint,
  type EndpointInput,
  type EndpointPatch,
  HTTP_METHODS,
  type Header,
  type HttpMethod,
  type ModelLink,
  type ProjectModel,
  ROOT_COLLECTION_ID,
  type Scenario,
  type ScenarioInput,
  type SettingsPatch,
} from '../core/model.js';
import {
  validateBody,
  validateHeaders,
  validateHost,
  validateLatency,
  validateMethod,
  validateName,
  validatePath,
  validatePort,
  validateProxyHost,
  validateStatus,
  validateRules,
  withDefaultContentType,
} from '../core/validation.js';
import { normalizeSettings } from '../schema/types.js';
import { type StudioFile, newStudioFile, parseStudioFile } from './studio-file.js';

const CORS_METHODS = 'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS';
const CORS_HEADERS = 'Content-Type, Origin, Accept, Authorization, Content-Length, X-Requested-With';
const CORS_KEYS = new Set(CORSHeaders.map((h) => h.key.toLowerCase()).concat(['access-control-allow-credentials', 'vary']));

export interface SerializedProject {
  environment: string;
  studio: string;
}

export function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * The project as stored on disk: a Mockoon environment plus the tool's sidecar.
 * Everything Mockoon specific lives here; unknown parts of the environment are preserved untouched.
 */
export class ProjectDocument {
  /** True when the environment was upgraded by Mockoon's migrations while loading. */
  migrated = false;

  constructor(
    public environment: Environment,
    public studio: StudioFile,
  ) {}

  static create(name: string, environmentFile: string, port = 3000): ProjectDocument {
    const projectName = validateName('Project', name);
    const environment = BuildEnvironment({ hasDefaultRoute: false, hasContentTypeHeader: false, hasCorsHeaders: true, port });
    environment.name = projectName;
    environment.hostname = '127.0.0.1';
    return new ProjectDocument(environment, newStudioFile(environmentFile));
  }

  static fromParts(environmentRaw: unknown, studioRaw: unknown | undefined, environmentFile: string): ProjectDocument {
    if (typeof environmentRaw !== 'object' || environmentRaw === null || Array.isArray(environmentRaw)) {
      throw invalid('The environment file must contain a JSON object.');
    }
    const environment = structuredClone(environmentRaw) as Environment;
    let migrated = false;
    const last = (environment as { lastMigration?: unknown }).lastMigration;
    if (typeof last !== 'number') throw invalid('The environment file has no "lastMigration"; it is not a Mockoon environment.');
    if (last > HighestMigrationId) {
      throw new StudioError(
        'UNSUPPORTED_VERSION',
        `The environment was saved by a newer Mockoon version (migration ${last}); this tool supports up to ${HighestMigrationId}.`,
      );
    }
    for (const migration of Migrations) {
      if (migration.id > last) {
        migration.migrationFunction(environment);
        environment.lastMigration = migration.id;
        migrated = true;
      }
    }
    // Preserve future response modes while validating the rest of the environment.
    const validationEnvironment = structuredClone(environment);
    for (const route of validationEnvironment.routes ?? []) {
      if (route.responseMode !== null && !['DISABLE_RULES', 'SEQUENTIAL', 'RANDOM', 'FALLBACK'].includes(route.responseMode)) route.responseMode = null;
    }
    const { error } = EnvironmentSchemaNoFix.validate(validationEnvironment, { abortEarly: false, allowUnknown: true });
    if (error) {
      const details = (error.details as { message: string }[]).slice(0, 3).map((d) => d.message).join('; ');
      throw invalid(`The environment file is not a valid Mockoon environment: ${details}`);
    }
    const studio = studioRaw === undefined ? newStudioFile(environmentFile) : parseStudioFile(studioRaw);
    const document = new ProjectDocument(environment, studio);
    document.migrated = migrated || (typeof studioRaw === 'object' && studioRaw !== null && (studioRaw as { schemaVersion?: unknown }).schemaVersion === 1);
    return document;
  }

  clone(): ProjectDocument {
    const copy = new ProjectDocument(structuredClone(this.environment), structuredClone(this.studio));
    copy.migrated = this.migrated;
    return copy;
  }

  serialize(): SerializedProject {
    return {
      environment: `${JSON.stringify(this.environment, null, 2)}\n`,
      studio: `${JSON.stringify(this.studio, null, 2)}\n`,
    };
  }

  get name(): string {
    return this.environment.name;
  }

  // ---------------------------------------------------------------- reading

  private foldersByUuid(): Map<string, Folder> {
    return new Map(this.environment.folders.map((f) => [f.uuid, f]));
  }

  private routesByUuid(): Map<string, Route> {
    return new Map(this.environment.routes.map((r) => [r.uuid, r]));
  }

  /** Route uuids below a folder, in engine order. */
  private routeIdsIn(folderUuid: string, folders = this.foldersByUuid()): string[] {
    const out: string[] = [];
    const folder = folders.get(folderUuid);
    for (const child of folder?.children ?? []) {
      if (child.type === 'route') out.push(child.uuid);
      else out.push(...this.routeIdsIn(child.uuid, folders));
    }
    return out;
  }

  private toScenario(response: RouteResponse, index: number): Scenario {
    return {
      id: response.uuid,
      name: response.label || (index === 0 ? 'Default' : `Response ${index + 1}`),
      statusCode: response.statusCode,
      headers: response.headers.map((h) => ({ key: h.key, value: h.value })),
      body: response.body,
      latencyMs: response.latency,
      active: response.default,
      rules: structuredClone(response.rules),
      rulesOperator: response.rulesOperator,
    };
  }

  private toEndpoint(route: Route, collectionId: string): Endpoint {
    const method = route.method.toUpperCase();
    const readOnly = route.type !== 'http' || !(HTTP_METHODS as readonly string[]).includes(method);
    const endpoint: Endpoint = {
      id: route.uuid,
      collectionId,
      method: method as HttpMethod,
      path: normalizePath(route.endpoint),
      description: route.documentation,
      scenarios: route.responses.map((r, i) => this.toScenario(r, i)),
      readOnly,
      responseMode: route.responseMode === null ? 'rules' : route.responseMode === 'DISABLE_RULES' ? 'fixed' : route.responseMode === 'SEQUENTIAL' ? 'sequential' : route.responseMode === 'RANDOM' ? 'random' : 'other',
    };
    const model = this.studio.endpoints[route.uuid]?.model;
    if (model) endpoint.model = { ...model, settings: normalizeSettings(model.settings) } as ModelLink;
    return endpoint;
  }

  snapshot(): ProjectModel {
    const env = this.environment;
    const folders = this.foldersByUuid();
    const routes = this.routesByUuid();
    const collections: Collection[] = [];
    let root: Collection | undefined;

    for (const child of env.rootChildren) {
      if (child.type === 'folder') {
        const folder = folders.get(child.uuid);
        if (!folder) continue;
        collections.push({
          id: folder.uuid,
          name: folder.name,
          active: this.studio.collections[folder.uuid]?.active ?? true,
          virtual: false,
          endpoints: this.routeIdsIn(folder.uuid, folders)
            .map((id) => routes.get(id))
            .filter((r): r is Route => !!r)
            .map((r) => this.toEndpoint(r, folder.uuid)),
        });
      } else {
        const route = routes.get(child.uuid);
        if (!route) continue;
        if (!root) {
          root = {
            id: ROOT_COLLECTION_ID,
            name: 'Ungrouped',
            active: this.studio.collections[ROOT_COLLECTION_ID]?.active ?? true,
            virtual: true,
            endpoints: [],
          };
          collections.push(root);
        }
        root.endpoints.push(this.toEndpoint(route, ROOT_COLLECTION_ID));
      }
    }

    const { cors, generation, logBodies, allowTemplating, scenarioOverrideHeader } = this.studio.settings;
    return {
      name: env.name,
      collections,
      settings: {
        port: env.port,
        host: env.hostname,
        cors: { enabled: env.cors && cors.enabled, mode: cors.mode },
        generation: normalizeSettings(generation),
        logBodies,
        proxy: { enabled: env.proxyMode, host: env.proxyHost },
        allowTemplating,
        scenarioOverrideHeader,
      },
    };
  }

  // ------------------------------------------------------------ collections

  private requireFolder(collectionId: string): Folder {
    if (collectionId === ROOT_COLLECTION_ID) throw invalid('The ungrouped collection cannot be changed this way.');
    const folder = this.environment.rootChildren.some((c) => c.type === 'folder' && c.uuid === collectionId)
      ? this.environment.folders.find((f) => f.uuid === collectionId)
      : undefined;
    if (!folder) throw notFound('Collection', collectionId);
    return folder;
  }

  private assertUniqueCollectionName(name: string, exceptId?: string): void {
    const taken = this.snapshot().collections.some((c) => c.id !== exceptId && c.name.toLowerCase() === name.toLowerCase());
    if (taken) throw invalid(`A collection named "${name}" already exists.`);
  }

  addCollection(nameInput: unknown): string {
    const name = validateName('Collection', nameInput);
    this.assertUniqueCollectionName(name);
    const folder = BuildFolder();
    folder.name = name;
    this.environment = addFolderMutator(this.environment, folder, 'root');
    this.studio.collections[folder.uuid] = { active: true };
    return folder.uuid;
  }

  renameCollection(collectionId: string, nameInput: unknown): void {
    this.requireFolder(collectionId);
    const name = validateName('Collection', nameInput);
    this.assertUniqueCollectionName(name, collectionId);
    this.environment = updateFolderMutator(this.environment, collectionId, { name });
  }

  setCollectionActive(collectionId: string, active: boolean): void {
    if (collectionId !== ROOT_COLLECTION_ID) this.requireFolder(collectionId);
    else if (!this.snapshot().collections.some((c) => c.virtual)) throw notFound('Collection', collectionId);
    this.studio.collections[collectionId] = { active };
  }

  removeCollection(collectionId: string): void {
    const folder = this.requireFolder(collectionId);
    const folders = this.foldersByUuid();
    const nestedFolders: string[] = [];
    const collectNested = (uuid: string) => {
      for (const child of folders.get(uuid)?.children ?? []) {
        if (child.type === 'folder') {
          nestedFolders.push(child.uuid);
          collectNested(child.uuid);
        }
      }
    };
    collectNested(folder.uuid);
    for (const routeId of this.routeIdsIn(folder.uuid, folders)) {
      this.environment = removeRouteMutator(this.environment, routeId);
      delete this.studio.endpoints[routeId];
    }
    for (const nested of nestedFolders) this.environment = removeFolderMutator(this.environment, nested);
    this.environment = removeFolderMutator(this.environment, folder.uuid);
    delete this.studio.collections[folder.uuid];
  }

  // -------------------------------------------------------------- endpoints

  private requireRoute(endpointId: string, mustBeEditable = true): Route {
    const route = this.environment.routes.find((r) => r.uuid === endpointId);
    if (!route) throw notFound('Endpoint', endpointId);
    if (mustBeEditable && (route.type !== 'http' || !(HTTP_METHODS as readonly string[]).includes(route.method.toUpperCase()))) {
      throw invalid('This route was not created by this tool (CRUD, WebSocket or unusual method). Edit it in Mockoon.');
    }
    return route;
  }

  private buildResponse(input: ScenarioInput, index: number, active: boolean): RouteResponse {
    const response = BuildRouteResponse();
    response.label = input.name === undefined ? (index === 0 ? 'Success' : `Response ${index + 1}`) : validateName('Scenario', input.name);
    response.statusCode = input.statusCode === undefined ? 200 : validateStatus(input.statusCode);
    response.headers = withDefaultContentType(input.headers === undefined ? [] : validateHeaders(input.headers));
    response.body = validateBody(input.body === undefined ? '{}' : input.body, response.headers);
    response.latency = input.latencyMs === undefined ? 0 : validateLatency(input.latencyMs);
    response.bodyType = BodyTypes.INLINE;
    response.disableTemplating = true;
    response.default = active;
    return response;
  }

  addEndpoint(collectionId: string, input: EndpointInput): string {
    const method = validateMethod(input.method);
    const path = validatePath(input.path);
    const parentId = collectionId === ROOT_COLLECTION_ID ? 'root' : this.requireFolder(collectionId).uuid;
    const scenarioInputs = input.scenarios && input.scenarios.length > 0 ? input.scenarios : [{}];

    const route = BuildHTTPRoute(false);
    route.method = method.toLowerCase() as Route['method'];
    route.endpoint = path.slice(1);
    route.documentation = typeof input.description === 'string' ? input.description.slice(0, 1000) : '';
    route.responses = scenarioInputs.map((s, i) => this.buildResponse(s, i, i === 0));
    this.assertUniqueScenarioNames(route.responses);
    this.environment = addRouteMutator(this.environment, route, parentId);
    return route.uuid;
  }

  updateEndpoint(endpointId: string, patch: EndpointPatch): void {
    const route = this.requireRoute(endpointId);
    const next: Route = { ...route };
    if (patch.method !== undefined) next.method = validateMethod(patch.method).toLowerCase() as Route['method'];
    if (patch.path !== undefined) next.endpoint = validatePath(patch.path).slice(1);
    if (patch.description !== undefined) next.documentation = String(patch.description).slice(0, 1000);

    if (patch.collectionId !== undefined && patch.collectionId !== this.collectionIdOf(endpointId)) {
      const parentId = patch.collectionId === ROOT_COLLECTION_ID ? 'root' : this.requireFolder(patch.collectionId).uuid;
      this.environment = removeRouteMutator(this.environment, endpointId);
      this.environment = addRouteMutator(this.environment, next, parentId);
      return;
    }
    this.environment = { ...this.environment, routes: this.environment.routes.map((r) => (r.uuid === endpointId ? next : r)) };
  }

  collectionIdOf(endpointId: string): string {
    for (const collection of this.snapshot().collections) {
      if (collection.endpoints.some((e) => e.id === endpointId)) return collection.id;
    }
    throw notFound('Endpoint', endpointId);
  }

  removeEndpoint(endpointId: string): void {
    this.requireRoute(endpointId, false);
    this.environment = removeRouteMutator(this.environment, endpointId);
    delete this.studio.endpoints[endpointId];
  }

  // -------------------------------------------------------------- scenarios

  private assertUniqueScenarioNames(responses: RouteResponse[]): void {
    const seen = new Set<string>();
    for (const r of responses) {
      const key = r.label.toLowerCase();
      if (seen.has(key)) throw invalid(`Scenario name "${r.label}" is used more than once.`);
      seen.add(key);
    }
  }

  private replaceRoute(route: Route): void {
    this.environment = { ...this.environment, routes: this.environment.routes.map((r) => (r.uuid === route.uuid ? route : r)) };
  }

  addScenario(endpointId: string, input: ScenarioInput): string {
    const route = this.requireRoute(endpointId);
    const response = this.buildResponse(input, route.responses.length, route.responses.length === 0);
    const responses = [...route.responses, response];
    this.assertUniqueScenarioNames(responses);
    this.replaceRoute({ ...route, responses });
    return response.uuid;
  }

  updateScenario(endpointId: string, scenarioId: string, input: ScenarioInput): void {
    const route = this.requireRoute(endpointId);
    const current = route.responses.find((r) => r.uuid === scenarioId);
    if (!current) throw notFound('Scenario', scenarioId);
    const next: RouteResponse = { ...current };
    if (input.name !== undefined) next.label = validateName('Scenario', input.name);
    if (input.statusCode !== undefined) next.statusCode = validateStatus(input.statusCode);
    if (input.headers !== undefined) next.headers = withDefaultContentType(validateHeaders(input.headers));
    if (input.latencyMs !== undefined) next.latency = validateLatency(input.latencyMs);
    if (input.body !== undefined || input.headers !== undefined) {
      next.body = validateBody(input.body === undefined ? current.body : input.body, next.headers);
    }
    const responses = route.responses.map((r) => (r.uuid === scenarioId ? next : r));
    this.assertUniqueScenarioNames(responses);
    this.replaceRoute({ ...route, responses });
  }

  removeScenario(endpointId: string, scenarioId: string): void {
    const route = this.requireRoute(endpointId);
    const target = route.responses.find((r) => r.uuid === scenarioId);
    if (!target) throw notFound('Scenario', scenarioId);
    if (route.responses.length === 1) throw invalid('An endpoint needs at least one scenario.');
    const responses = route.responses.filter((r) => r.uuid !== scenarioId);
    if (target.default) responses[0] = { ...(responses[0] as RouteResponse), default: true };
    this.replaceRoute({ ...route, responses });
  }

  setActiveScenario(endpointId: string, scenarioId: string): void {
    const route = this.requireRoute(endpointId);
    if (!route.responses.some((r) => r.uuid === scenarioId)) throw notFound('Scenario', scenarioId);
    this.replaceRoute({ ...route, responses: route.responses.map((r) => ({ ...r, default: r.uuid === scenarioId })) });
  }

  setScenarioRules(endpointId: string, scenarioId: string, rules: unknown, operator: unknown): void {
    const validated = validateRules(rules, operator);
    const route = this.requireRoute(endpointId);
    const current = route.responses.find((r) => r.uuid === scenarioId);
    if (!current) throw notFound('Scenario', scenarioId);
    if (current.rules.some((r) => !['header', 'query', 'params', 'body', 'cookie', 'request_number', 'method'].includes(r.target) || !['equals', 'regex', 'regex_i', 'null', 'empty_array', 'array_includes'].includes(r.operator))) throw invalid('Imported unsupported rules are read-only.');
    this.replaceRoute({ ...route, responses: route.responses.map((r) => r.uuid === scenarioId ? { ...r, ...validated } : r) });
  }

  setEndpointMode(endpointId: string, mode: unknown): void {
    const modes = { rules: null, fixed: 'DISABLE_RULES', sequential: 'SEQUENTIAL', random: 'RANDOM' } as const;
    if (typeof mode !== 'string' || !Object.hasOwn(modes, mode)) throw invalid('Invalid response mode.');
    const route = this.requireRoute(endpointId);
    this.replaceRoute({ ...route, responseMode: modes[mode as keyof typeof modes] as Route['responseMode'] });
  }

  reorderScenarios(endpointId: string, ids: unknown): void {
    const route = this.requireRoute(endpointId);
    if (!Array.isArray(ids) || ids.length !== route.responses.length || new Set(ids).size !== ids.length || ids.some((id) => typeof id !== 'string' || !route.responses.some((r) => r.uuid === id))) throw invalid('Order must contain each scenario id exactly once.');
    this.replaceRoute({ ...route, responses: ids.map((id) => route.responses.find((r) => r.uuid === id) as RouteResponse) });
  }

  setModel(endpointId: string, model: ModelLink | null): void {
    this.requireRoute(endpointId);
    if (model === null) {
      delete this.studio.endpoints[endpointId];
      return;
    }
    this.studio.endpoints[endpointId] = {
      model: { rootType: model.rootType, settings: { ...normalizeSettings(model.settings) }, sources: model.sources, schema: model.schema },
    };
  }

  // --------------------------------------------------------------- settings

  private applyCors(enabled: boolean, mode: CorsMode): void {
    const headers = this.environment.headers.filter((h) => !CORS_KEYS.has(h.key.toLowerCase()));
    if (enabled) {
      const origin: Header =
        mode === 'reflect'
          ? { key: 'Access-Control-Allow-Origin', value: "{{header 'Origin'}}" }
          : { key: 'Access-Control-Allow-Origin', value: '*' };
      headers.push(origin, { key: 'Access-Control-Allow-Methods', value: CORS_METHODS }, { key: 'Access-Control-Allow-Headers', value: CORS_HEADERS });
      if (mode === 'reflect') headers.push({ key: 'Access-Control-Allow-Credentials', value: 'true' }, { key: 'Vary', value: 'Origin' });
    }
    this.environment = { ...this.environment, cors: enabled, headers };
    this.studio.settings.cors = { ...this.studio.settings.cors, enabled, mode };
  }

  updateSettings(patch: SettingsPatch): void {
    const env = this.environment;
    if (patch.port !== undefined) this.environment = { ...this.environment, port: validatePort(patch.port) };
    if (patch.host !== undefined) this.environment = { ...this.environment, hostname: validateHost(patch.host) };
    if (patch.cors !== undefined) {
      const enabled = patch.cors.enabled ?? env.cors;
      const mode = patch.cors.mode ?? this.studio.settings.cors.mode;
      if (mode !== 'wildcard' && mode !== 'reflect') throw invalid('CORS mode must be "wildcard" or "reflect".');
      this.applyCors(enabled, mode);
    }
    if (patch.generation !== undefined) {
      this.studio.settings.generation = { ...this.studio.settings.generation, ...normalizeSettings({ ...this.studio.settings.generation, ...patch.generation }) };
    }
    if (patch.logBodies !== undefined) this.studio.settings.logBodies = patch.logBodies === true;
    if (patch.scenarioOverrideHeader !== undefined) {
      if (typeof patch.scenarioOverrideHeader !== 'boolean') throw invalid('scenarioOverrideHeader must be a boolean.');
      this.studio.settings.scenarioOverrideHeader = patch.scenarioOverrideHeader;
    }
    if (patch.allowTemplating !== undefined) this.studio.settings.allowTemplating = patch.allowTemplating === true;
    if (patch.proxy !== undefined) {
      const enabled = patch.proxy.enabled ?? this.environment.proxyMode;
      const host = patch.proxy.host === undefined ? this.environment.proxyHost : validateProxyHost(patch.proxy.host);
      if (enabled) {
        validateProxyHost(host);
        const target = new URL(host);
        const loopback = ['localhost', '127.0.0.1', '[::1]', '0.0.0.0'].includes(target.hostname);
        const targetPort = target.port === '' ? (target.protocol === 'https:' ? 443 : 80) : Number(target.port);
        if (loopback && targetPort === this.environment.port) throw invalid('The backend address points to this mock server itself.');
      }
      this.environment = { ...this.environment, proxyMode: enabled, proxyHost: host };
    }
  }
}
