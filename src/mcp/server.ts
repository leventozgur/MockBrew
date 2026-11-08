import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { StudioError, invalid } from '../core/errors.js';
import type { ModelInput } from '../core/model-service.js';
import type { ModelLink } from '../core/model.js';
import type { ProjectService } from '../core/service.js';
import { VARIANTS } from '../generator/index.js';
import { validateBody } from '../schema/index.js';
import { registerProjectTools } from './tools/project.js';

const MAX_SOURCE_CHARS = 1_000_000;

const instructions = `Mock API studio: turns Kotlin (Gson, Kotlinx Serialization, Moshi) and Swift (Codable) models into validated mock responses.

Typical flow for "make a mock for this model":
1. parse_model with the model file paths (relative to the project root) or the pasted source, to see the declared types and any unsupported constructs.
2. get_schema for the response type (generics are allowed, e.g. BaseResponse<List<User>>). Use naming/dateFormat when the app's decoder is configured for snake_case or epoch dates.
3. Write the JSON body (generate_sample gives a deterministic baseline you can edit), then check it with validate_body.
4. save_scenario stores it as a scenario of GET/POST/... <path> in a collection. The body is validated against the model and rejected when it does not match.
For a 401 when Authorization is missing, set a header rule with modifier Authorization and operator null. For an empty list at page=99, use query page equals 99. For premium prices use body $.type equals premium. For a first 500 then 200, order those scenarios and use sequential mode. X-Mock-Scenario selects a scenario by name or id in app debug menus in rules and fixed modes; sequential and random modes do not support this override.
Use list_collections and list_endpoints to find IDs, manage collections, endpoints and scenarios with their respective tools, and review deletion previews before confirming. Start the mock server with start_server, inspect server_status and get_request_logs, and stop it with stop_server. check_models reports model drift without changing files.
Nothing here executes model code or touches files outside the project root.`;

const sourceFiles = z
  .array(z.object({ name: z.string().max(300), content: z.string().max(MAX_SOURCE_CHARS) }))
  .max(50)
  .optional()
  .describe('Model source text. Use this when the code is not available as a file.');

const sourcePaths = z
  .array(z.string().max(500))
  .max(100)
  .optional()
  .describe('Model files or folders, relative to the project root. Folders are searched for .kt/.kts/.swift files.');

const settingsShape = {
  naming: z.enum(['identity', 'snake_case']).optional().describe('JSON key naming used by the app decoder.'),
  dateFormat: z.enum(['iso8601', 'epoch-seconds', 'epoch-millis']).optional().describe('How dates are encoded in JSON.'),
};

const modelShape = {
  files: sourceFiles,
  paths: sourcePaths,
  framework: z.enum(['auto', 'gson', 'kotlinx', 'moshi']).optional().describe('Kotlin JSON library; auto detects the annotations.'),
};

export function text(value: unknown) {
  return { content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] };
}

function failure(error: unknown) {
  if (error instanceof StudioError) {
    const detail = error.details ? `\n${JSON.stringify(error.details, null, 2)}` : '';
    return { isError: true, content: [{ type: 'text' as const, text: `${error.message}${detail}` }] };
  }
  return { isError: true, content: [{ type: 'text' as const, text: `Unexpected error: ${(error as Error).message}` }] };
}

/** Wraps a handler so that failures reach the AI client as readable tool errors. */
export function guarded<A>(handler: (args: A) => Promise<ReturnType<typeof text>>) {
  return async (args: A) => {
    try {
      return await handler(args);
    } catch (error) {
      return failure(error);
    }
  };
}

function input(args: { files?: { name: string; content: string }[]; paths?: string[]; framework?: ModelInput['framework'] }): ModelInput {
  return { files: args.files, paths: args.paths, framework: args.framework };
}

export function createMcpServer(service: ProjectService, version: string): McpServer {
  const server = new McpServer({ name: 'mock-api-studio', version }, { instructions });
  const readOnly = { readOnlyHint: true, openWorldHint: false };
  registerProjectTools(server, service);

  server.registerTool(
    'list_collections',
    {
      title: 'List collections',
      description: 'Lists the collections, endpoints and scenarios of the project, with the model each endpoint is linked to.',
      annotations: readOnly,
    },
    guarded(async () => {
      const { project, conflicts } = service.view();
      return text({
        project: project.name,
        collections: project.collections.map((c) => ({
          name: c.name,
          active: c.active,
          endpoints: c.endpoints.map((e) => ({
            id: e.id,
            method: e.method,
            path: e.path,
            model: e.model?.rootType,
            scenarios: e.scenarios.map((s) => ({ name: s.name, statusCode: s.statusCode, active: s.active })),
          })),
        })),
        conflicts: conflicts.map((c) => c.message),
      });
    }),
  );

  server.registerTool(
    'parse_model',
    {
      title: 'Parse model code',
      description:
        'Reads Kotlin/Swift model code without compiling or running it and lists the declared types plus unsupported constructs (sealed classes, custom serializers, init(from:), unresolved types).',
      inputSchema: modelShape,
      annotations: readOnly,
    },
    guarded(async (args) => text(await service.models.parse(input(args)))),
  );

  server.registerTool(
    'get_schema',
    {
      title: 'Get JSON Schema of a model type',
      description: 'Returns the JSON Schema (draft 2020-12) of a type, honouring annotations such as @SerialName/@SerializedName/CodingKeys, nullability, enums, generics and the naming/date settings.',
      inputSchema: { ...modelShape, type: z.string().min(1).max(300).describe('Type to convert, e.g. User, BaseResponse<List<User>>, [User]'), ...settingsShape },
      annotations: readOnly,
    },
    guarded(async (args) => {
      const built = await service.models.schema(input(args), args.type, { naming: args.naming, dateFormat: args.dateFormat });
      return text({ rootType: built.rootType, settings: built.settings, issues: built.issues, schema: built.schema });
    }),
  );

  server.registerTool(
    'generate_sample',
    {
      title: 'Generate a sample body',
      description: 'Deterministic sample JSON for a type, with meaningful values derived from field names. A baseline to edit; the same seed always gives the same output.',
      inputSchema: {
        ...modelShape,
        type: z.string().min(1).max(300),
        ...settingsShape,
        variant: z.enum(VARIANTS as [string, ...string[]]).optional().describe('full (default), minimal (required fields only) or empty-list'),
        seed: z.union([z.string(), z.number()]).optional(),
      },
      annotations: readOnly,
    },
    guarded(async (args) => {
      const generated = await service.models.generate(input(args), args.type, {
        settings: { naming: args.naming, dateFormat: args.dateFormat },
        variant: args.variant as never,
        seed: args.seed,
      });
      return text({ body: JSON.parse(generated.body), issues: generated.issues });
    }),
  );

  server.registerTool(
    'validate_body',
    {
      title: 'Validate a JSON body against a model',
      description: 'Checks a response body against the schema of a model type, or against the model linked to an existing endpoint. Returns the list of violations.',
      inputSchema: {
        body: z.string().max(5_000_000).describe('The JSON text to validate.'),
        endpointId: z.string().optional().describe('Validate against the model linked to this endpoint (see list_collections).'),
        type: z.string().max(300).optional().describe('Model type; requires files or paths.'),
        ...modelShape,
        ...settingsShape,
      },
      annotations: readOnly,
    },
    guarded(async (args) => {
      if (args.endpointId) {
        const model = service.findEndpoint(args.endpointId).model;
        if (!model) throw invalid('This endpoint is not linked to a model.');
        return text(validateBody(model.schema, args.body));
      }
      if (!args.type) throw invalid('Give an endpointId, or a type together with files/paths.');
      const built = await service.models.schema(input(args), args.type, { naming: args.naming, dateFormat: args.dateFormat });
      return text(validateBody(built.schema, args.body));
    }),
  );

  server.registerTool(
    'save_scenario',
    {
      title: 'Save a response scenario',
      description:
        'Saves a response body as a scenario of an endpoint (method + path) in a collection; the collection and endpoint are created when missing. When a model type is given, or the endpoint is already linked to one and this is a 2xx response, the body must match it, otherwise nothing is saved (error responses such as 404/500 are not checked against the success model). Invalid JSON is always rejected.',
      inputSchema: {
        collection: z.string().min(1).max(100).describe('Collection name, created if it does not exist.'),
        method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']),
        path: z.string().min(1).max(300).describe('Endpoint path, e.g. /users/:id'),
        scenarioName: z.string().min(1).max(100).optional().describe('e.g. Success, Empty list, Unauthorized. An existing scenario with this name is replaced.'),
        statusCode: z.number().int().min(100).max(599).optional(),
        latencyMs: z.number().int().min(0).max(60000).optional(),
        headers: z.array(z.object({ key: z.string(), value: z.string() })).max(50).optional(),
        body: z.string().max(5_000_000).describe('JSON response body (empty for 204).'),
        makeActive: z.boolean().optional().describe('Serve this scenario right away (default true).'),
        description: z.string().max(1000).optional(),
        type: z.string().max(300).optional().describe('Model type the body belongs to; requires files or paths.'),
        ...modelShape,
        ...settingsShape,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    guarded(async (args) => {
      let model: ModelLink | undefined;
      if (args.type) {
        const built = await service.models.schema(input(args), args.type, { naming: args.naming, dateFormat: args.dateFormat });
        if (built.issues.some((i) => i.severity === 'error')) {
          throw invalid(built.issues.filter((i) => i.severity === 'error').map((i) => i.message).join(' '), built.issues);
        }
        model = { rootType: built.rootType, settings: built.settings, sources: built.sources, schema: built.schema };
      }
      const result = await service.upsertScenario({
        collection: args.collection,
        method: args.method,
        path: args.path,
        scenarioName: args.scenarioName,
        statusCode: args.statusCode,
        latencyMs: args.latencyMs,
        headers: args.headers,
        body: args.body,
        makeActive: args.makeActive,
        description: args.description,
        model,
      });
      return text({ saved: true, ...result });
    }),
  );

  return server;
}
