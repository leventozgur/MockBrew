import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AiRequest, AiService } from '../ai/service.js';
import { isSea, seaAssetDir } from '../core/runtime-env.js';
import { StudioError, invalid } from '../core/errors.js';
import { HTTP_METHODS, type ModelLink } from '../core/model.js';
import type { ProjectService } from '../core/service.js';
import { buildOpenApi } from '../core/openapi.js';
import { connectionSnippets, lanAddresses } from '../core/snippets.js';
import type { ApiErrorBody, ModelInput, MutationResponse, PollResponse } from '../core/view.js';
import { VARIANTS, type Variant } from '../generator/index.js';
import { validateBody } from '../schema/index.js';

export interface ControlApiOptions {
  service: ProjectService;
  /** 0 picks a free port. */
  port?: number;
  /** Lifetime of the session token. */
  tokenTtlMs?: number;
  /** Folder with the built UI; defaults to dist/ui next to the compiled server. */
  uiDir?: string;
  /** Optional AI generation; without it the AI endpoints answer "not enabled". */
  ai?: AiService;
}

export interface ControlApi {
  url: string;
  port: number;
  token: string;
  /** URL that hands the token to the UI through the fragment, which is never sent to a server. */
  launchUrl: string;
  close(): Promise<void>;
}

const LOOPBACK_HOST = '127.0.0.1';
const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000;

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

function defaultUiDir(): string {
  if (isSea()) return path.join(seaAssetDir(), 'ui');
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', 'ui');
}

function asObject(body: unknown): Record<string, unknown> {
  if (body === undefined || body === null) return {};
  if (typeof body !== 'object' || Array.isArray(body)) throw invalid('The request body must be a JSON object.');
  return body as Record<string, unknown>;
}

function str(value: unknown, name: string): string {
  if (typeof value !== 'string') throw invalid(`"${name}" must be a string.`);
  return value;
}

function modelInput(body: Record<string, unknown>): ModelInput {
  const input: ModelInput = {};
  if (body.files !== undefined) {
    if (!Array.isArray(body.files)) throw invalid('"files" must be a list of { name, content }.');
    input.files = body.files.map((f) => ({ name: str(f?.name, 'files[].name'), content: str(f?.content, 'files[].content') }));
  }
  if (body.paths !== undefined) {
    if (!Array.isArray(body.paths)) throw invalid('"paths" must be a list of strings.');
    input.paths = body.paths.map((p) => str(p, 'paths[]'));
  }
  if (body.framework !== undefined) {
    if (!['auto', 'gson', 'kotlinx', 'moshi'].includes(body.framework as string)) throw invalid('Unknown "framework".');
    input.framework = body.framework as ModelInput['framework'];
  }
  return input;
}

function settingsOf(body: Record<string, unknown>): Record<string, unknown> | undefined {
  return body.settings === undefined ? undefined : asObject(body.settings);
}

function variantOf(value: unknown): Variant | undefined {
  if (value === undefined) return undefined;
  if (!VARIANTS.includes(value as Variant)) throw invalid(`"variant" must be one of ${VARIANTS.join(', ')}.`);
  return value as Variant;
}

function aiRequest(body: Record<string, unknown>): AiRequest {
  const instruction = body.instruction === undefined ? undefined : str(body.instruction, 'instruction');
  if (instruction !== undefined && instruction.length > 2000) throw invalid('The instruction is too long (2000 characters at most).');
  return {
    input: modelInput(body),
    rootType: str(body.rootType, 'rootType'),
    settings: settingsOf(body),
    instruction,
    includeSource: body.includeSource === true,
    variant: variantOf(body.variant),
    seed: body.seed as string | number | undefined,
  };
}

export async function startControlApi(options: ControlApiOptions): Promise<ControlApi> {
  const { service } = options;
  const token = randomBytes(24).toString('base64url');
  const tokenHash = digest(token);
  const expiresAt = Date.now() + (options.tokenTtlMs ?? DEFAULT_TTL_MS);
  const uiDir = options.uiDir ?? defaultUiDir();
  const hasUi = existsSync(path.join(uiDir, 'index.html'));

  const app: FastifyInstance = Fastify({ logger: false, bodyLimit: 10_000_000 });
  let allowedHosts = new Set<string>();
  let allowedOrigins = new Set<string>();

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );
    // DNS rebinding: the Host header must name the loopback address we listen on.
    if (!allowedHosts.has((request.headers.host ?? '').toLowerCase())) {
      return reply.code(403).send(errorBody('FORBIDDEN', 'Unexpected Host header.'));
    }
    const origin = request.headers.origin;
    if (origin !== undefined && !allowedOrigins.has(origin.toLowerCase())) {
      return reply.code(403).send(errorBody('FORBIDDEN', 'Cross-origin requests are not allowed.'));
    }
    if (request.url.startsWith('/api/')) {
      reply.header('Cache-Control', 'no-store');
      const header = request.headers.authorization ?? '';
      const supplied = header.startsWith('Bearer ') ? header.slice(7) : '';
      if (Date.now() > expiresAt || !timingSafeEqual(digest(supplied), tokenHash)) {
        return reply.code(401).send(errorBody('UNAUTHORIZED', 'Missing, wrong or expired session token. Start the UI again.'));
      }
    }
    return undefined;
  });

  app.setErrorHandler((error: unknown, _request, reply) => {
    if (error instanceof StudioError) {
      return reply.code(error.status).send(errorBody(error.code, error.message, error.details));
    }
    const err = error as { statusCode?: number; message?: string };
    if (err.statusCode && err.statusCode < 500) {
      return reply.code(err.statusCode).send(errorBody('INVALID', err.message ?? 'Bad request.'));
    }
    return reply.code(500).send(errorBody('INVALID', 'Unexpected server error.'));
  });

  const done = (id?: string): MutationResponse => ({ ...(id ? { id } : {}), view: service.view() });

  // ---------------------------------------------------------------- project
  app.get('/api/project', async () => service.view());

  app.get('/api/poll', async (request): Promise<PollResponse> => {
    const query = request.query as { revision?: string; after?: string };
    const revision = Number(query.revision ?? 0);
    const after = Number(query.after ?? 0);
    const view = service.view();
    return {
      revision: view.revision,
      ...(view.revision !== revision ? { view } : {}),
      runtime: view.runtime,
      logs: service.runtime.logs(Number.isFinite(after) ? after : 0),
    };
  });

  app.post('/api/collections', async (request) => {
    const body = asObject(request.body);
    return done(await service.createCollection(str(body.name, 'name') as string));
  });

  app.patch('/api/collections/:id', async (request) => {
    const { id } = request.params as { id: string };
    const body = asObject(request.body);
    if (body.name !== undefined) await service.renameCollection(id, body.name as string);
    if (body.active !== undefined) {
      if (typeof body.active !== 'boolean') throw invalid('"active" must be a boolean.');
      await service.setCollectionActive(id, body.active);
    }
    return done();
  });

  app.delete('/api/collections/:id', async (request) => {
    await service.deleteCollection((request.params as { id: string }).id);
    return done();
  });

  app.post('/api/collections/:id/endpoints', async (request) => {
    const body = asObject(request.body);
    const method = str(body.method, 'method').toUpperCase();
    if (!(HTTP_METHODS as readonly string[]).includes(method)) throw invalid(`Method must be one of ${HTTP_METHODS.join(', ')}.`);
    const id = await service.createEndpoint((request.params as { id: string }).id, {
      method: method as (typeof HTTP_METHODS)[number],
      path: str(body.path, 'path'),
      description: body.description as string | undefined,
      scenarios: body.scenarios as never,
    });
    return done(id);
  });

  app.patch('/api/endpoints/:id', async (request) => {
    await service.updateEndpoint((request.params as { id: string }).id, asObject(request.body));
    return done();
  });

  app.delete('/api/endpoints/:id', async (request) => {
    await service.deleteEndpoint((request.params as { id: string }).id);
    return done();
  });

  app.post('/api/endpoints/:id/scenarios', async (request) => {
    const id = await service.createScenario((request.params as { id: string }).id, asObject(request.body));
    return done(id);
  });

  app.patch('/api/endpoints/:id/scenarios/:sid', async (request) => {
    const { id, sid } = request.params as { id: string; sid: string };
    await service.updateScenario(id, sid, asObject(request.body));
    return done();
  });

  app.delete('/api/endpoints/:id/scenarios/:sid', async (request) => {
    const { id, sid } = request.params as { id: string; sid: string };
    await service.deleteScenario(id, sid);
    return done();
  });

  app.put('/api/endpoints/:id/scenarios/:sid/rules', async (request) => {
    const { id, sid } = request.params as { id: string; sid: string };
    const body = asObject(request.body);
    await service.setScenarioRules(id, sid, body.rules, body.rulesOperator);
    return done();
  });

  app.patch('/api/endpoints/:id/response-mode', async (request) => {
    await service.setEndpointMode((request.params as { id: string }).id, asObject(request.body).responseMode);
    return done();
  });

  app.put('/api/endpoints/:id/scenario-order', async (request) => {
    await service.reorderScenarios((request.params as { id: string }).id, asObject(request.body).scenarioIds);
    return done();
  });

  app.post('/api/runtime/reset-counters', async () => {
    await service.resetRequestCounters();
    return done();
  });

  app.put('/api/endpoints/:id/active-scenario', async (request) => {
    const body = asObject(request.body);
    await service.setActiveScenario((request.params as { id: string }).id, str(body.scenarioId, 'scenarioId'));
    return done();
  });

  app.put('/api/endpoints/:id/model', async (request) => {
    await service.setEndpointModel((request.params as { id: string }).id, asObject(request.body) as unknown as ModelLink);
    return done();
  });

  app.delete('/api/endpoints/:id/model', async (request) => {
    await service.setEndpointModel((request.params as { id: string }).id, null);
    return done();
  });

  app.patch('/api/settings', async (request) => {
    await service.updateSettings(asObject(request.body));
    return done();
  });

  // ----------------------------------------------------------------- models
  app.get('/api/models/check', async () => service.checkModels());
  app.get('/api/models/update/preview', async (request) => {
    const query = request.query as { endpointId?: string; fillOptional?: string };
    return service.previewModelUpdate(query.endpointId, query.fillOptional === 'true');
  });
  app.post('/api/models/update/apply', async (request) => {
    const body = asObject(request.body);
    if (!Array.isArray(body.selection)) throw invalid('"selection" must be a list.');
    const selection = body.selection.map((item: unknown) => {
      const entry = asObject(item);
      if (!Array.isArray(entry.scenarioIds)) throw invalid('"scenarioIds" must be a list.');
      return { endpointId: str(entry.endpointId, 'endpointId'), scenarioIds: entry.scenarioIds.map((id: unknown) => str(id, 'scenarioIds[]')) };
    });
    await service.applyModelUpdate(selection, str(body.previewHash, 'previewHash'));
    return done();
  });

  app.post('/api/endpoints/:id/model/refresh', async (request) => {
    await service.refreshModel((request.params as { id: string }).id);
    return done();
  });

  app.post('/api/models/parse', async (request) => service.models.parse(modelInput(asObject(request.body))));

  app.post('/api/models/schema', async (request) => {
    const body = asObject(request.body);
    return service.models.schema(modelInput(body), str(body.rootType, 'rootType'), settingsOf(body));
  });

  app.post('/api/models/generate', async (request) => {
    const body = asObject(request.body);
    return service.models.generate(modelInput(body), str(body.rootType, 'rootType'), {
      settings: settingsOf(body),
      variant: variantOf(body.variant),
      seed: body.seed as string | number | undefined,
    });
  });

  app.post('/api/validate', async (request) => {
    const body = asObject(request.body);
    const text = str(body.body, 'body');
    if (typeof body.endpointId === 'string') {
      const model = service.findEndpoint(body.endpointId).model;
      if (!model) throw invalid('This endpoint is not linked to a model.');
      return validateBody(model.schema, text);
    }
    return validateBody(asObject(body.schema), text);
  });

  // --------------------------------------------------------------------- AI
  const requireAi = (): AiService => {
    if (!options.ai) throw new StudioError('FORBIDDEN', 'AI generation is not enabled. Start the UI with --ai copilot to turn it on.');
    return options.ai;
  };

  app.get('/api/ai/status', async () => (options.ai ? options.ai.status() : { enabled: false }));

  app.post('/api/ai/preview', async (request) => requireAi().preview(aiRequest(asObject(request.body))));

  app.post('/api/ai/generate', async (request, reply) => {
    const ai = requireAi();
    const body = asObject(request.body);
    const controller = new AbortController();
    reply.raw.on('close', () => {
      if (!reply.raw.writableFinished) controller.abort();
    });
    return ai.generate(aiRequest(body), str(body.confirm, 'confirm'), controller.signal);
  });

  app.get('/api/export/openapi', async (request) => {
    const query = request.query as { includeInactive?: string };
    return buildOpenApi(service.model(), { onlyActive: query.includeInactive !== '1' });
  });

  // ---------------------------------------------------------------- runtime
  app.post('/api/runtime/start', async () => {
    await service.start();
    return done();
  });

  app.post('/api/runtime/stop', async () => {
    await service.stop();
    return done();
  });

  app.post('/api/runtime/logs/clear', async () => {
    service.runtime.clearLogs();
    return done();
  });

  app.get('/api/snippets', async () => {
    const lan = lanAddresses();
    const port = service.view().runtime.port || service.model().settings.port;
    return { port, lan, snippets: connectionSnippets(port, lan) };
  });

  // ------------------------------------------------------------------- UI
  if (hasUi) {
    await app.register(fastifyStatic, { root: uiDir, index: ['index.html'] });
    app.setNotFoundHandler(async (request, reply) => {
      if (request.method === 'GET' && !request.url.startsWith('/api/')) return reply.sendFile('index.html');
      return reply.code(404).send(errorBody('NOT_FOUND', 'Not found.'));
    });
  } else {
    app.get('/', async (_request, reply) =>
      reply.type('text/plain').send('The UI is not built. Run "npm run build" in the mockbrew package, then start again.'),
    );
  }

  await app.listen({ host: LOOPBACK_HOST, port: options.port ?? 0 });
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  allowedOrigins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
  const url = `http://127.0.0.1:${port}`;

  return {
    url,
    port,
    token,
    launchUrl: `${url}/#token=${token}`,
    close: () => app.close(),
  };
}

function errorBody(code: string, message: string, details?: unknown): ApiErrorBody {
  return { error: { code, message, ...(details === undefined ? {} : { details }) } };
}
