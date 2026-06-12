import { msalInstance, apiScopes } from './msal-config';

const API_BASE = import.meta.env.VITE_API_BASE_URL as string;

/**
 * Error thrown by callApi on non-2xx responses. Exposes the HTTP status and
 * the backend's optional structured error code (ADR-0013: `{ error, code? }`)
 * so callers can match on `code` instead of the English error sentence.
 */
export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function getAccessToken(): Promise<string> {
  const account = msalInstance.getActiveAccount() ?? msalInstance.getAllAccounts()[0];
  if (!account) throw new Error('Not authenticated');
  const result = await msalInstance.acquireTokenSilent({ scopes: apiScopes, account });
  return result.accessToken;
}

export async function callApi<T = unknown>(path: string, body: unknown): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as {
      error?: string;
      code?: string;
    };
    throw new ApiError(err.error ?? `API error ${res.status}`, res.status, err.code);
  }
  return res.json() as Promise<T>;
}

export async function callApiRaw(path: string, body: unknown): Promise<Response> {
  const token = await getAccessToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res;
}
