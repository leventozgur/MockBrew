import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const guide = `# MockBrew MCP guide

## Create an endpoint from a model
1. Use parse_model with source paths or pasted files; review unsupported constructs.
2. Use get_schema for the model type and decoder naming/date settings, then generate_sample and validate_body.
3. Use save_scenario with collection, method, path, type, source and validated body to create a model-linked success scenario. Use list_collections and list_endpoints to inspect IDs.

## Scenarios and conditions
Use save_scenario for 401 and 500 responses and generate_sample with empty-list for an empty success response. Validate success bodies. Use set_scenario_rules for header (Authorization null), query (page equals 99), or body ($.type equals premium) conditions; use set_endpoint_mode with rules and reorder_scenarios to control precedence. Sequential and random modes do not support X-Mock-Scenario overrides.

## Profiles and drift
Use save_profile to select scenarios across endpoints and activate_profile to apply it; list_profiles and deactivate_profile inspect and restore selections. Use check_models, preview_model_update, review the proposed changes, then apply_model_update with the approved preview hash and selection.

## Project variables
Use set_variables to list, set, or delete project variables. Values are stored as plaintext; do not store secrets. Dynamic response interpolation is not yet available.

## Import, export and recording
Use preview_import and review conflicts before apply_import with its hash. Export with export_bundle. With the proxy running, start_recording, inspect list_recordings, then preview_recordings and save_recordings with the reviewed hash. Recorded bodies can contain sensitive data.

## Safety
Model code is parsed, never executed. Source paths are restricted to the configured root. Review deletion previews before confirming. start_server uses the existing host settings; check server_status and masked get_request_logs, then stop_server. Keep safe mode enabled and avoid sensitive data in scenarios.
`;

export function registerGuide(server: McpServer): void {
  server.registerResource('guide', 'mockbrew://guide', { title: 'MockBrew guide', mimeType: 'text/markdown' }, async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: guide }] }));
  server.registerPrompt('mock_endpoint_from_model', { description: 'Create a model-linked endpoint.', argsSchema: { modelType: z.string().min(1), method: z.string().min(1), path: z.string().min(1) } }, ({ modelType, method, path }) => ({ messages: [{ role: 'user', content: { type: 'text', text: `Create ${method} ${path} for model ${modelType}. 1. Find or request model sources and a collection. 2. Use parse_model and get_schema, review issues. 3. Use generate_sample and validate_body. 4. Use save_scenario with the model and validated body. 5. Inspect using list_endpoints. Consult mockbrew://guide.` } }] }));
  server.registerPrompt('add_error_scenarios', { description: 'Add error scenarios to an endpoint.', argsSchema: { endpointId: z.string().min(1) } }, ({ endpointId }) => ({ messages: [{ role: 'user', content: { type: 'text', text: `Add error scenarios to endpoint ${endpointId}. 1. Use list_endpoints to find its collection, method and path. 2. Use save_scenario to add 401 and 500 JSON responses without activating them. 3. Use set_scenario_rules for a missing Authorization header and set_endpoint_mode to rules; review order with reorder_scenarios. 4. Inspect the result with list_endpoints. Consult mockbrew://guide.` } }] }));
}
