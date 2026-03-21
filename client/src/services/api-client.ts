/**
 * API Client — XTION_TheFool0
 *
 * Shared HTTP client that:
 *   - Reads the API key from localStorage ('openclaw_key')
 *   - Adds Authorization: Bearer <key> header to all requests
 *   - Uses Vite proxy base path (/api → http://localhost:8080/api)
 *   - Handles errors uniformly, throwing ApiError on non-2xx responses
 *
 * Requirements: 8.1, 8.2
 */

import { useUiStore } from '../stores/uiStore';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function getApiKey(): string {
  return localStorage.getItem('openclaw_key') ?? '';
}

function buildHeaders(extra?: Record<string, string>): Record<string, string> {
  const key = getApiKey();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...extra,
  };
  if (key) {
    headers['Authorization'] = `Bearer ${key}`;
  }
  return headers;
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (res.ok) {
    // 204 No Content
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }
  let code = `HTTP_${res.status}`;
  let message = res.statusText;
  try {
    const body = await res.json() as { error?: { code?: string; message?: string } };
    if (body?.error) {
      code = body.error.code ?? code;
      message = body.error.message ?? message;
    }
  } catch {
    // ignore parse errors
  }
  if (res.status === 403) {
    useUiStore.getState().addNotification({
      type: 'error',
      message: '权限不足',
    });
  }
  throw new ApiError(res.status, code, message);
}

export const apiClient = {
  get<T>(path: string): Promise<T> {
    return fetch(path, { headers: buildHeaders() }).then((r) => handleResponse<T>(r));
  },

  post<T>(path: string, body?: unknown): Promise<T> {
    return fetch(path, {
      method: 'POST',
      headers: buildHeaders(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }).then((r) => handleResponse<T>(r));
  },

  put<T>(path: string, body?: unknown): Promise<T> {
    return fetch(path, {
      method: 'PUT',
      headers: buildHeaders(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }).then((r) => handleResponse<T>(r));
  },

  delete<T>(path: string): Promise<T> {
    return fetch(path, {
      method: 'DELETE',
      headers: buildHeaders(),
    }).then((r) => handleResponse<T>(r));
  },
};

export default apiClient;
