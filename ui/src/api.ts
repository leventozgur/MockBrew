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
