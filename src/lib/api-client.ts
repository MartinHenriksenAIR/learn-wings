import { msalInstance, apiScopes } from './msal-config';

const API_BASE = import.meta.env.VITE_API_BASE_URL as string;

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
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error ?? `API error ${res.status}`);
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
