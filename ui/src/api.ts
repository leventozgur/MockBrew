import type { ApiErrorBody } from '../../src/core/view';

const TOKEN_KEY = 'mockbrew-token';

/** Takes the session token from the URL fragment (never sent to a server) and keeps it per tab. */
export function initToken(): string | null {
  const match = /[#&]token=([^&]+)/.exec(window.location.hash);
  if (match?.[1]) {
    sessionStorage.setItem(TOKEN_KEY, decodeURIComponent(match[1]));
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
  return sessionStorage.getItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export async function api<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const token = sessionStorage.getItem(TOKEN_KEY) ?? '';
  const response = await fetch(path, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  const text = await response.text();
  const data = text ? (JSON.parse(text) as unknown) : undefined;
  if (!response.ok) {
    const error = (data as ApiErrorBody | undefined)?.error;
    throw new ApiError(error?.code ?? 'ERROR', error?.message ?? response.statusText, response.status, error?.details);
  }
  return data as T;
}

/** Download the authenticated export, retaining the filename supplied by the server. */
export async function downloadExport(format: string, collections: string[]): Promise<void> {
  const token = sessionStorage.getItem(TOKEN_KEY) ?? '';
  const fetchExport = async (collection?: string) => {
    const query = new URLSearchParams({ format });
    if (collection) query.set('collection', collection);
    const response = await fetch(`/api/export?${query}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) {
      const data = await response.json() as ApiErrorBody;
      throw new ApiError(data.error?.code ?? 'ERROR', data.error?.message ?? response.statusText, response.status);
    }
    return response;
  };
  const responses = await Promise.all((collections.length ? collections : [undefined]).map(fetchExport));
  const filename = /filename="([^"/\\]+)"/.exec(responses[0]!.headers.get('Content-Disposition') ?? '')?.[1] ?? 'mockbrew-export.json';
  let blob: Blob;
  if (responses.length === 1) blob = await responses[0]!.blob();
  else {
    const bundles = await Promise.all(responses.map((response) => response.json() as Promise<{ format: string; version: number; exportedAt: string; collections: unknown[] }>));
    blob = new Blob([JSON.stringify({ ...bundles[0], collections: bundles.flatMap((bundle) => bundle.collections) }, null, 2)], { type: 'application/json' });
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadCa(): Promise<void> {
  const token = sessionStorage.getItem(TOKEN_KEY) ?? '';
  const response = await fetch('/api/certs/ca', { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error('Could not download the CA certificate.');
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url; link.download = 'mockbrew-ca.pem'; link.click();
  URL.revokeObjectURL(url);
}
