import type { Bundle } from './bundle.js';

/** Postman 2.1 export with one saved response per scenario. */
export function exportPostman(bundle: Bundle, name: string, mockUrl: string): unknown {
  return {
    info: { name, schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
    variable: [{ key: 'baseUrl', value: mockUrl }],
    item: bundle.collections.map((collection) => ({
      name: collection.name,
      item: collection.endpoints.map((endpoint) => {
        const request = { method: endpoint.method, url: { raw: `{{baseUrl}}${endpoint.path}`, host: ['{{baseUrl}}'], path: endpoint.path.split('/').filter(Boolean) }, description: endpoint.description };
        return { name: `${endpoint.method} ${endpoint.path}`, request,
          response: endpoint.scenarios.map((scenario) => ({ name: scenario.name, originalRequest: request, code: scenario.statusCode, header: scenario.headers, body: scenario.body })) };
      }),
    })),
  };
}
