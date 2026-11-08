import { EventEmitter } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import type { RuntimeOverrides } from '../runtime/environment.js';
import { buildRuntimeEnvironment } from '../runtime/environment.js';
import { MockRuntime } from '../runtime/runtime.js';
import { type ValidationIssue, validateBody as validateAgainstSchema } from '../schema/index.js';
import { profileSchema } from '../store/studio-file.js';
import type { ProjectDocument } from '../store/document.js';
import {
  type FileHashes,
  type LoadedProject,
  type ProjectLocation,
  type Watcher,
  createProjectFiles,
  currentHashes,
  loadProject,
  locateProject,
  saveProject,
  watchProject,
} from '../store/files.js';
import { detectConflicts, errorConflicts, newErrorConflicts, pathShape } from './conflicts.js';
import { StudioError, invalid, notFound } from './errors.js';
import type {
  Conflict,
  EndpointInput,
  EndpointPatch,
  Header,
  HttpMethod,
  ModelLink,
  ProjectModel,
  Profile,
  ProfileInput,
  ScenarioInput,
  SettingsPatch,
} from './model.js';
import { ModelService, stripSourceInfo } from './model-service.js';
import { isInside } from './safe-path.js';
import { diffSchemas } from './schema-diff.js';
import { updateModelBody } from './model-update.js';
import type { ModelCheck, ModelUpdatePreview, ModelUpdateSelection, ProjectView, RuntimeStatus } from './view.js';
import { normalizeSettings } from '../schema/types.js';
import { exportBundle, parseBundle } from './import/bundle.js';

export interface UpsertInput {
  collection: string;
  method: HttpMethod;
  path: string;
  scenarioName?: string;
  statusCode?: number;
  headers?: Header[];
  body: string;
  latencyMs?: number;
  description?: string;
  makeActive?: boolean;
  model?: ModelLink;
}

export interface ServiceOptions {
  /** Folder model files may be read from; defaults to the project folder. */
  root?: string;
  /** Watch the project files for changes made outside this process. */
  watch?: boolean;
  /** Listener overrides that are not written to the project (CLI --port / --host). */
  overrides?: RuntimeOverrides;
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/** A linked model describes the success response; error scenarios (4xx/5xx) have their own shapes. */
export const isModelBound = (statusCode: number): boolean => statusCode >= 200 && statusCode < 300;
const MAX_SCHEMA_BYTES = 1_000_000;

/**
 * Model links come from clients: source locations are dropped and source files must lie inside the access
 * root. They are stored relative to the project folder, so the file stays portable between machines.
 */
export function sanitizeModelLink(link: ModelLink, root: string, projectDir: string): ModelLink {
  if (!link || typeof link.rootType !== 'string' || link.rootType.trim() === '') throw invalid('The model link needs a root type.');
  if (!link.schema || typeof link.schema !== 'object') throw invalid('The model link needs a JSON schema.');
  const schema = stripSourceInfo(link.schema);
  if (JSON.stringify(schema).length > MAX_SCHEMA_BYTES) throw invalid('The model schema is too large.');
  const sources = (Array.isArray(link.sources) ? link.sources : [])
    .filter((s): s is string => typeof s === 'string' && s.length > 0 && s.length < 500)
    .map((s) => s.replace(/\\/g, '/'))
    .filter((s) => !s.startsWith('/') && !/^[A-Za-z]:/.test(s))
    .map((s) => path.resolve(root, s))
    .filter((absolute) => isInside(root, absolute))
    .map((absolute) => path.relative(projectDir, absolute).split(path.sep).join('/'));
  return { rootType: link.rootType.trim(), settings: normalizeSettings(link.settings), sources, schema };
}

/** Owns one project: validates and persists changes, keeps the running server in sync. */
export class ProjectService extends EventEmitter {
  models: ModelService;
  readonly runtime: MockRuntime;
  root: string;
  private document: ProjectDocument;
  private hashes: FileHashes;
  private revision = 1;
  private loadError: string | undefined;
  private runtimeNotice: string | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private watcher: Watcher | undefined;
  private overrides: RuntimeOverrides;

  private constructor(
    private readonly location: ProjectLocation,
    loaded: LoadedProject,
    options: ServiceOptions,
  ) {
    super();
    this.document = loaded.document;
    this.hashes = loaded.hashes;
    this.root = path.resolve(options.root ?? location.dir);
    this.overrides = options.overrides ?? {};
    this.models = new ModelService(this.root);
    this.runtime = new MockRuntime({ environmentDirectory: location.dir });
    this.runtime.on('status', () => this.emit('runtime'));
    this.runtime.on('log', (entry) => this.emit('log', entry));
    if (options.watch) this.watcher = watchProject(location, () => void this.reloadFromDisk());
  }

  static async open(input: string, options: ServiceOptions = {}): Promise<ProjectService> {
    const location = await locateProject(input);
    return new ProjectService(location, await loadProject(location), options);
  }

  static async init(dir: string, name: string, options: ServiceOptions & { port?: number } = {}): Promise<ProjectService> {
    const location = await createProjectFiles(dir, name, options.port);
    return new ProjectService(location, await loadProject(location), options);
  }

  // ------------------------------------------------------------------- view

  get projectFile(): string {
    return this.location.studioPath;
  }

  model(): ProjectModel {
    return this.document.snapshot();
  }

  exportBundle(collections?: string[]) { return exportBundle(this.model(), collections); }

  previewBundle(content: string) {
    const bundle = parseBundle(content);
    const project = this.model();
    const conflicts = bundle.collections.flatMap((collection) => collection.endpoints.flatMap((endpoint) =>
      project.collections.flatMap((existing) => existing.endpoints.filter((e) =>
        e.method === endpoint.method && pathShape(e.path) === pathShape(endpoint.path) &&
        (existing.active || existing.name.toLowerCase() === collection.name.toLowerCase()),
      ).map((e) => ({ collection: collection.name, method: endpoint.method, path: endpoint.path, existingCollection: existing.name, endpointId: e.id }))),
    ));
    const hash = createHash('sha256').update(JSON.stringify({ bundle, revision: this.revision })).digest('hex');
    return { hash, bundle, conflicts, newCollections: bundle.collections.filter((c) => !project.collections.some((e) => e.name.toLowerCase() === c.name.toLowerCase())).map((c) => c.name) };
  }

  applyBundle(content: string, previewHash: string, strategy: 'skip' | 'rename' | 'replace'): Promise<void> {
    if (!['skip', 'rename', 'replace'].includes(strategy)) throw invalid('Invalid conflict strategy.');
    return this.mutate((doc) => {
      const preview = this.previewBundle(content);
      if (preview.hash !== previewHash) throw new StudioError('STALE', 'Import preview is stale. Preview again.');
      for (const incoming of preview.bundle.collections) {
        let existing = doc.snapshot().collections.find((c) => c.name.toLowerCase() === incoming.name.toLowerCase());
        const conflicts = preview.conflicts.filter((c) => c.collection === incoming.name);
        let name = incoming.name;
        if (strategy === 'rename' && (existing || conflicts.length)) {
          name = `${incoming.name.slice(0, 88)} (imported)`;
          let n = 2;
          while (doc.snapshot().collections.some((c) => c.name.toLowerCase() === name.toLowerCase())) name = `${incoming.name.slice(0, 82)} (imported ${n++})`;
          existing = undefined;
        }
        const collectionId = existing?.id ?? doc.addCollection(name);
        if (strategy === 'rename' && conflicts.length) doc.setCollectionActive(collectionId, false);
        for (const endpoint of incoming.endpoints) {
          const collisions = doc.snapshot().collections.flatMap((c) => c.endpoints.filter((e) =>
            e.method === endpoint.method && pathShape(e.path) === pathShape(endpoint.path) && (c.active || c.id === collectionId)));
          if (collisions.length && strategy === 'skip') continue;
          if (collisions.length && strategy === 'replace') {
            for (const collision of collisions) {
              const first = collision.scenarios[0];
              if (!first) throw invalid('Existing endpoint has no scenarios.');
              for (const old of collision.scenarios.slice(1)) doc.removeScenario(collision.id, old.id);
              const ids = [first.id];
              doc.updateScenario(collision.id, first.id, endpoint.scenarios[0]!);
              doc.setScenarioRules(collision.id, first.id, endpoint.scenarios[0]!.rules, endpoint.scenarios[0]!.rulesOperator);
              for (const incomingScenario of endpoint.scenarios.slice(1)) {
                const scenarioId = doc.addScenario(collision.id, incomingScenario);
                doc.setScenarioRules(collision.id, scenarioId, incomingScenario.rules, incomingScenario.rulesOperator);
                ids.push(scenarioId);
              }
              doc.setActiveScenario(collision.id, ids[endpoint.scenarios.findIndex((s) => s.default)]!);
            }
            continue;
          }
          const id = doc.addBundleEndpoint(collectionId, endpoint);
          if (endpoint.model) doc.setModel(id, sanitizeModelLink(endpoint.model, this.root, this.location.dir));
        }
      }
    });
  }

  /** Parts of the view that only depend on the files; recomputed once per revision. */
  private derived: { revision: number; project: ProjectModel; conflicts: Conflict[]; violations: Record<string, ValidationIssue[]>; safeModeNotes: string[] } | undefined;

  private derive() {
    if (this.derived?.revision === this.revision) return this.derived;
    const project = this.document.snapshot();
    const violations: Record<string, ValidationIssue[]> = {};
    for (const collection of project.collections) {
      for (const endpoint of collection.endpoints) {
        if (!endpoint.model) continue;
        for (const scenario of endpoint.scenarios) {
          if (scenario.body.trim() === '' || !isModelBound(scenario.statusCode)) continue;
          const result = validateAgainstSchema(endpoint.model.schema, scenario.body);
          if (!result.valid) violations[scenario.id] = result.errors.slice(0, 20);
        }
      }
    }
    this.derived = {
      revision: this.revision,
      project,
      conflicts: detectConflicts(project),
      violations,
      safeModeNotes: buildRuntimeEnvironment(this.document).safeModeNotes,
    };
    return this.derived;
  }

  view(): ProjectView {
    const { project, conflicts, violations, safeModeNotes } = this.derive();
    return {
      revision: this.revision,
      project,
      conflicts,
      violations,
      runtime: this.runtime.status(),
      lan: !LOOPBACK.has(this.overrides.host ?? project.settings.host),
      ...(this.loadError ? { loadError: this.loadError } : {}),
      ...(this.runtimeNotice ? { runtimeNotice: this.runtimeNotice } : {}),
      safeModeNotes,
      migrated: this.document.migrated,
      projectFile: path.basename(this.location.studioPath),
    };
  }

  // -------------------------------------------------------------- mutations

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async assertNotStale(): Promise<void> {
    const disk = await currentHashes(this.location);
    if (disk.environment !== this.hashes.environment || disk.studio !== this.hashes.studio) {
      await this.reload();
      throw new StudioError('STALE', 'The project files changed on disk and were reloaded. Review the current state and try again.');
    }
  }

  /** Applies `change` to a copy, rejects new route conflicts, saves atomically and updates the server. */
  private mutate<T>(change: (document: ProjectDocument) => T): Promise<T> {
    return this.enqueue(async () => {
      await this.assertNotStale();
      const before = detectConflicts(this.document.snapshot());
      const candidate = this.document.clone();
      const result = change(candidate);
      const after = detectConflicts(candidate.snapshot());
      const introduced = newErrorConflicts(before, after);
      if (introduced.length > 0) {
        throw new StudioError('CONFLICT', introduced.map((c) => c.message).join(' '), introduced);
      }
      this.hashes = await saveProject(this.location, candidate, this.hashes);
      this.document = candidate;
      this.revision++;
      await this.syncRuntime();
      this.emit('changed', { external: false });
      return result;
    });
  }

  private async syncRuntime(): Promise<void> {
    this.runtimeNotice = undefined;
    if (this.runtime.status().state !== 'running') return;
    const conflicts = errorConflicts(detectConflicts(this.document.snapshot()));
    if (conflicts.length > 0) {
      this.runtimeNotice = `The running server was not updated: ${conflicts.map((c) => c.message).join(' ')}`;
      return;
    }
    await this.runtime.update(this.document, this.overrides);
  }

  private async reload(): Promise<void> {
    try {
      const loaded = await loadProject(this.location);
      this.document = loaded.document;
      this.hashes = loaded.hashes;
      this.loadError = undefined;
      this.revision++;
      await this.syncRuntime();
    } catch (error) {
      this.loadError = (error as Error).message;
      this.revision++;
    }
  }

  /** Picks up edits made outside this process (git pull, a text editor, Mockoon desktop). */
  reloadFromDisk(): Promise<void> {
    return this.enqueue(async () => {
      const disk = await currentHashes(this.location);
      if (disk.environment === this.hashes.environment && disk.studio === this.hashes.studio && !this.loadError) return;
      await this.reload();
      this.emit('changed', { external: true });
    });
  }

  listProfiles(): { profiles: Profile[]; activeProfileId: string | null } {
    const endpoints = this.document.snapshot().collections.flatMap((c) => c.endpoints);
    const profiles = Object.entries(this.document.studio.profiles).map(([id, profile]) => {
      const staleReferences: string[] = [];
      for (const [endpointId, selection] of Object.entries(profile.endpoints)) {
        const endpoint = endpoints.find((e) => e.id === endpointId);
        if (!endpoint || !endpoint.scenarios.some((s) => s.id === selection.scenarioId)) staleReferences.push(endpointId);
      }
      if (Array.isArray(profile.network?.timeoutEndpoints)) for (const id of profile.network.timeoutEndpoints) {
        if (!endpoints.some((e) => e.id === id) && !staleReferences.includes(id)) staleReferences.push(id);
      }
      return { ...profile, id, staleReferences } as Profile;
    });
    return { profiles, activeProfileId: this.document.studio.activeProfileId ?? null };
  }

  saveProfile(input: ProfileInput, id?: string): Promise<string> {
    return this.mutate((doc) => {
      const parsed = profileSchema.safeParse(input);
      if (!parsed.success) throw invalid(`Invalid profile: ${parsed.error.issues[0]?.message}`);
      const profile = parsed.data;
      if (id && !doc.studio.profiles[id]) throw notFound('Profile', id);
      if (Object.entries(doc.studio.profiles).some(([key, p]) => key !== id && p.name.toLowerCase() === profile.name.toLowerCase())) throw invalid('Profile names must be unique.');
      const endpoints = doc.snapshot().collections.flatMap((c) => c.endpoints);
      for (const [endpointId, selection] of Object.entries(profile.endpoints)) {
        const endpoint = endpoints.find((e) => e.id === endpointId);
        if (!endpoint || !endpoint.scenarios.some((s) => s.id === selection.scenarioId)) throw invalid(`Invalid profile reference: ${endpointId}.`);
      }
      if (Array.isArray(profile.network?.timeoutEndpoints) && profile.network.timeoutEndpoints.some((id) => !endpoints.some((e) => e.id === id))) throw invalid('Invalid timeout endpoint reference.');
      const key = id ?? randomUUID();
      if (!id && Object.keys(doc.studio.profiles).length >= 200) throw invalid('Too many profiles.');
      doc.studio.profiles[key] = profile;
      return key;
    });
  }

  captureProfileFromCurrent(name: string): Promise<string> {
    const endpoints: ProfileInput['endpoints'] = {};
    const active = this.document.studio.profiles[this.document.studio.activeProfileId ?? ''];
    for (const endpoint of this.model().collections.flatMap((c) => c.endpoints)) {
      const selection = active?.endpoints[endpoint.id];
      const scenario = endpoint.scenarios.find((s) => s.id === selection?.scenarioId) ?? endpoint.scenarios.find((s) => s.active);
      if (scenario) endpoints[endpoint.id] = { scenarioId: scenario.id };
    }
    return this.saveProfile({ name, endpoints });
  }

  deleteProfile(id: string): Promise<void> {
    return this.mutate((doc) => {
      if (!doc.studio.profiles[id]) throw notFound('Profile', id);
      delete doc.studio.profiles[id];
      if (doc.studio.activeProfileId === id) doc.studio.activeProfileId = null;
    });
  }
  activateProfile(id: string): Promise<void> {
    return this.mutate((doc) => {
      if (!doc.studio.profiles[id]) throw notFound('Profile', id);
      doc.studio.activeProfileId = id;
    });
  }
  deactivateProfile(): Promise<void> { return this.mutate((doc) => { doc.studio.activeProfileId = null; }); }

  createCollection(name: string): Promise<string> {
    return this.mutate((doc) => doc.addCollection(name));
  }

  renameCollection(id: string, name: string): Promise<void> {
    return this.mutate((doc) => doc.renameCollection(id, name));
  }

  setCollectionActive(id: string, active: boolean): Promise<void> {
    return this.mutate((doc) => doc.setCollectionActive(id, active));
  }

  deleteCollection(id: string): Promise<void> {
    return this.mutate((doc) => doc.removeCollection(id));
  }

  createEndpoint(collectionId: string, input: EndpointInput): Promise<string> {
    return this.mutate((doc) => doc.addEndpoint(collectionId, input));
  }

  updateEndpoint(id: string, patch: EndpointPatch): Promise<void> {
    return this.mutate((doc) => doc.updateEndpoint(id, patch));
  }

  deleteEndpoint(id: string): Promise<void> {
    return this.mutate((doc) => doc.removeEndpoint(id));
  }

  createScenario(endpointId: string, input: ScenarioInput): Promise<string> {
    return this.mutate((doc) => doc.addScenario(endpointId, input));
  }

  updateScenario(endpointId: string, scenarioId: string, input: ScenarioInput): Promise<void> {
    return this.mutate((doc) => doc.updateScenario(endpointId, scenarioId, input));
  }

  /** Update a scenario only if its resulting success body matches its linked model. */
  updateValidatedScenario(endpointId: string, scenarioId: string, input: ScenarioInput): Promise<void> {
    return this.mutate((doc) => {
      doc.updateScenario(endpointId, scenarioId, input);
      const endpoint = doc.snapshot().collections.flatMap((c) => c.endpoints).find((e) => e.id === endpointId);
      const scenario = endpoint?.scenarios.find((s) => s.id === scenarioId);
      if (endpoint?.model && scenario && isModelBound(scenario.statusCode)) {
        const result = validateAgainstSchema(endpoint.model.schema, scenario.body);
        if (!result.valid) throw invalid(`The body does not match ${endpoint.model.rootType}: ${result.errors.slice(0, 5).map((e) => `${e.path} ${e.message}`).join('; ')}`, result.errors);
      }
    });
  }

  deleteScenario(endpointId: string, scenarioId: string): Promise<void> {
    return this.mutate((doc) => doc.removeScenario(endpointId, scenarioId));
  }

  setActiveScenario(endpointId: string, scenarioId: string): Promise<void> {
    return this.mutate((doc) => doc.setActiveScenario(endpointId, scenarioId));
  }

  setScenarioRules(endpointId: string, scenarioId: string, rules: unknown, operator: unknown): Promise<void> {
    return this.mutate((doc) => doc.setScenarioRules(endpointId, scenarioId, rules, operator));
  }

  setEndpointMode(endpointId: string, mode: unknown): Promise<void> {
    return this.mutate((doc) => doc.setEndpointMode(endpointId, mode));
  }

  reorderScenarios(endpointId: string, ids: unknown): Promise<void> {
    return this.mutate((doc) => doc.reorderScenarios(endpointId, ids));
  }

  resetRequestCounters(): Promise<void> {
    return this.enqueue(() => this.runtime.resetRequestCounters());
  }

  setEndpointModel(endpointId: string, model: ModelLink | null): Promise<void> {
    const link = model === null ? null : sanitizeModelLink(model, this.root, this.location.dir);
    return this.mutate((doc) => doc.setModel(endpointId, link));
  }

  updateSettings(patch: SettingsPatch): Promise<void> {
    return this.mutate((doc) => doc.updateSettings(patch));
  }

  /**
   * Saves a body as a scenario of the endpoint with the same method and path, creating the collection
   * and the endpoint when needed. A body that violates the linked model schema is rejected.
   */
  upsertScenario(input: UpsertInput): Promise<{ endpointId: string; scenarioId: string; created: boolean; validatedAgainst?: string }> {
    const model = input.model ? sanitizeModelLink(input.model, this.root, this.location.dir) : undefined;
    return this.mutate((doc) => {
      const name = input.collection.trim();
      let collection = doc.snapshot().collections.find((c) => c.name.toLowerCase() === name.toLowerCase());
      const collectionId = collection?.id ?? doc.addCollection(name);
      collection = doc.snapshot().collections.find((c) => c.id === collectionId);
      const shape = pathShape(input.path);
      const existing = collection?.endpoints.find((e) => !e.readOnly && e.method === input.method.toUpperCase() && pathShape(e.path) === shape);
      const scenario: ScenarioInput = {
        name: input.scenarioName,
        statusCode: input.statusCode,
        headers: input.headers,
        body: input.body,
        latencyMs: input.latencyMs,
      };
      const makeActive = input.makeActive ?? true;

      // The body must match the given model, or the model the endpoint is already linked to.
      const effective = model ?? (isModelBound(input.statusCode ?? 200) ? existing?.model : undefined);
      if (effective) {
        const result = validateAgainstSchema(effective.schema, input.body);
        if (!result.valid) {
          throw invalid(`The body does not match ${effective.rootType}: ${result.errors.slice(0, 5).map((e) => `${e.path} ${e.message}`).join('; ')}`, result.errors);
        }
      }

      let endpointId: string;
      let scenarioId: string;
      let created = false;
      if (!existing) {
        endpointId = doc.addEndpoint(collectionId, { method: input.method, path: input.path, description: input.description, scenarios: [scenario] });
        scenarioId = doc.snapshot().collections.flatMap((c) => c.endpoints).find((e) => e.id === endpointId)?.scenarios[0]?.id as string;
        created = true;
      } else {
        endpointId = existing.id;
        const sameName = scenario.name ? existing.scenarios.find((s) => s.name.toLowerCase() === scenario.name?.toLowerCase()) : undefined;
        if (sameName) {
          doc.updateScenario(endpointId, sameName.id, scenario);
          scenarioId = sameName.id;
        } else {
          scenarioId = doc.addScenario(endpointId, scenario);
        }
        if (makeActive) doc.setActiveScenario(endpointId, scenarioId);
      }
      if (model) doc.setModel(endpointId, model);
      return { endpointId, scenarioId, created, validatedAgainst: effective?.rootType };
    });
  }

  /** Stored sources are relative to the project folder; reading them still requires them to be inside the access root. */
  private storedPaths(sources: string[]): string[] {
    return sources.map((s) => path.resolve(this.location.dir, s));
  }

  /** Widens or moves the folder model files may be read from (before any model is read). */
  setAccessRoot(root: string): void {
    this.root = path.resolve(root);
    this.models = new ModelService(this.root);
  }

  get projectDir(): string {
    return this.location.dir;
  }

  /**
   * Re-reads the source files of every linked model and compares the result with the stored schema and
   * with the saved bodies, so model changes show up before the app breaks.
   */
  async checkModels(): Promise<ModelCheck[]> {
    const results: ModelCheck[] = [];
    for (const collection of this.document.snapshot().collections) {
      for (const endpoint of collection.endpoints) {
        const model = endpoint.model;
        if (!model) continue;
        const base: ModelCheck = {
          endpointId: endpoint.id,
          collection: collection.name,
          method: endpoint.method,
          path: endpoint.path,
          rootType: model.rootType,
          status: 'ok',
          changes: [],
          violations: [],
        };
        if (model.sources.length === 0) {
          results.push({ ...base, status: 'unavailable', reason: 'The model was pasted or uploaded, so there are no source files to re-read.' });
          continue;
        }
        let fresh;
        try {
          fresh = await this.models.schema({ paths: this.storedPaths(model.sources) }, model.rootType, model.settings);
        } catch (error) {
          results.push({ ...base, status: 'unavailable', reason: (error as Error).message });
          continue;
        }
        const errors = fresh.issues.filter((i) => i.severity === 'error');
        if (errors.length > 0) {
          results.push({ ...base, status: 'unavailable', reason: errors.map((e) => e.message).join(' ') });
          continue;
        }
        const next = stripSourceInfo(fresh.schema);
        const changes = diffSchemas(model.schema, next);
        const violations = endpoint.scenarios
          .filter((s) => s.body.trim() !== '' && isModelBound(s.statusCode))
          .map((s) => ({ scenarioId: s.id, scenario: s.name, errors: validateAgainstSchema(next, s.body).errors.slice(0, 20) }))
          .filter((v) => v.errors.length > 0);
        results.push({ ...base, status: changes.length > 0 || violations.length > 0 ? 'drift' : 'ok', changes, violations });
      }
    }
    return results;
  }

  private modelPreviews = new Map<string, { endpointId?: string; fillOptional: boolean }>();

  async previewModelUpdate(endpointId?: string, fillOptional = false): Promise<ModelUpdatePreview> {
    const snapshot = this.document.snapshot();
    const endpoints: ModelUpdatePreview['endpoints'] = [];
    if (endpointId) this.findEndpoint(endpointId);
    for (const collection of snapshot.collections) for (const endpoint of collection.endpoints) {
      if (!endpoint.model || (endpointId && endpoint.id !== endpointId)) continue;
      const model = endpoint.model;
      const entry: ModelUpdatePreview['endpoints'][number] = { endpointId: endpoint.id, collection: collection.name, method: endpoint.method, path: endpoint.path, scenarios: [] };
      try {
        if (!model.sources.length) throw invalid('The model has no source files to re-read.');
        const fresh = await this.models.schema({ paths: this.storedPaths(model.sources) }, model.rootType, model.settings);
        const errors = fresh.issues.filter((issue) => issue.severity === 'error');
        if (errors.length) throw invalid(errors.map((issue) => issue.message).join(' '));
        entry.schema = stripSourceInfo(fresh.schema);
        for (const scenario of endpoint.scenarios.filter((s) => isModelBound(s.statusCode))) {
          try { JSON.parse(scenario.body); } catch {
            entry.scenarios.push({ scenarioId: scenario.id, scenario: scenario.name, changes: [], skipped: 'Body is not JSON.' });
            continue;
          }
          try {
            const proposal = updateModelBody(model.schema, entry.schema, scenario.body, { settings: model.settings, fillOptional, seed: scenario.id });
            entry.scenarios.push({ scenarioId: scenario.id, scenario: scenario.name, ...proposal });
          } catch (error) {
            entry.scenarios.push({ scenarioId: scenario.id, scenario: scenario.name, changes: [], skipped: (error as Error).message });
          }
        }
      } catch (error) { entry.unavailable = (error as Error).message; }
      endpoints.push(entry);
    }
    const hash = createHash('sha256').update(JSON.stringify({ snapshot, endpointId, fillOptional, endpoints })).digest('hex');
    this.modelPreviews.set(hash, { endpointId, fillOptional });
    if (this.modelPreviews.size > 50) this.modelPreviews.delete(this.modelPreviews.keys().next().value as string);
    return { hash, endpoints };
  }

  async applyModelUpdate(selection: ModelUpdateSelection[], previewHash: string): Promise<void> {
    const scope = this.modelPreviews.get(previewHash);
    if (!scope || !Array.isArray(selection) || selection.length === 0) throw invalid('A matching model update preview and selection are required.');
    const revision = this.revision;
    const preview = await this.previewModelUpdate(scope.endpointId, scope.fillOptional);
    if (preview.hash !== previewHash || this.revision !== revision) throw new StudioError('STALE', 'The model update preview is out of date. Preview again.');
    const seen = new Set<string>();
    for (const selected of selection) {
      if (seen.has(selected.endpointId) || !Array.isArray(selected.scenarioIds) || new Set(selected.scenarioIds).size !== selected.scenarioIds.length) throw invalid('Invalid model update selection.');
      seen.add(selected.endpointId);
      const endpoint = preview.endpoints.find((e) => e.endpointId === selected.endpointId);
      if (!endpoint?.schema || selected.scenarioIds.length === 0 || selected.scenarioIds.some((id) => !endpoint.scenarios.some((s) => s.scenarioId === id && s.body !== undefined && !s.skipped))) throw invalid('Selection contains an unavailable or unpreviewed scenario.');
    }
    await this.mutate((doc) => {
      if (this.revision !== revision) throw new StudioError('STALE', 'The project changed after the preview.');
      for (const selected of selection) {
        const entry = preview.endpoints.find((e) => e.endpointId === selected.endpointId)!;
        const model = this.findEndpoint(selected.endpointId).model!;
        doc.setModel(selected.endpointId, { ...model, schema: entry.schema! });
        for (const id of selected.scenarioIds) doc.updateScenario(selected.endpointId, id, { body: entry.scenarios.find((s) => s.scenarioId === id)!.body! });
      }
    });
    this.modelPreviews.delete(previewHash);
  }

  /** Stores the schema of the current source files as the endpoint's model (after reviewing a check). */
  async refreshModel(endpointId: string): Promise<void> {
    const model = this.findEndpoint(endpointId).model;
    if (!model) throw invalid('This endpoint is not linked to a model.');
    if (model.sources.length === 0) throw invalid('The model has no source files to re-read.');
    const fresh = await this.models.schema({ paths: this.storedPaths(model.sources) }, model.rootType, model.settings);
    const errors = fresh.issues.filter((i) => i.severity === 'error');
    if (errors.length > 0) throw invalid(errors.map((e) => e.message).join(' '), fresh.issues);
    const schema = stripSourceInfo(fresh.schema);
    await this.mutate((doc) => doc.setModel(endpointId, { ...model, schema }));
  }

  findEndpoint(id: string) {
    for (const collection of this.document.snapshot().collections) {
      const endpoint = collection.endpoints.find((e) => e.id === id);
      if (endpoint) return endpoint;
    }
    throw notFound('Endpoint', id);
  }

  // ---------------------------------------------------------------- runtime

  setRuntimeProfile(id: string): void {
    if (!this.document.studio.profiles[id]) throw notFound('Profile', id);
    this.overrides = { ...this.overrides, profileId: id };
  }

  async start(): Promise<RuntimeStatus> {
    const conflicts = errorConflicts(detectConflicts(this.document.snapshot()));
    if (conflicts.length > 0) {
      throw new StudioError('CONFLICT', `The server was not started: ${conflicts.map((c) => c.message).join(' ')}`, conflicts);
    }
    this.runtimeNotice = undefined;
    try {
      return await this.runtime.start(this.document, this.overrides);
    } catch (error) {
      throw new StudioError('CONFLICT', (error as Error).message);
    }
  }

  async stop(): Promise<void> {
    await this.runtime.stop();
  }

  async close(): Promise<void> {
    await this.watcher?.close();
    await this.runtime.stop();
  }
}
