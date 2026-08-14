import { InteractionRequiredAuthError } from '@azure/msal-browser';
import { msalInstance, apiScopes } from './msal-config';
import { handleSessionExpired } from './session-expired';

const API_BASE = import.meta.env.VITE_API_BASE_URL as string;

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
  try {
    const result = await msalInstance.acquireTokenSilent({ scopes: apiScopes, account });
    return result.accessToken;
  } catch (err) {
    if (err instanceof InteractionRequiredAuthError) handleSessionExpired();
    throw err;
  }
}

export async function callApi<T = unknown>(path: string, body: unknown): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    if (res.status === 401) handleSessionExpired();
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
  if (!res.ok) {
    if (res.status === 401) handleSessionExpired();
    const err = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as {
      error?: string;
      code?: string;
    };
    throw new ApiError(err.error ?? `API error ${res.status}`, res.status, err.code);
  }
  return res;
}
