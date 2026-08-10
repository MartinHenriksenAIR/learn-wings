import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAcquireTokenSilent, mockGetActiveAccount, mockGetAllAccounts } = vi.hoisted(() => ({
  mockAcquireTokenSilent: vi.fn(),
  mockGetActiveAccount: vi.fn(),
  mockGetAllAccounts: vi.fn(),
}));

vi.mock('./msal-config', () => ({
  msalInstance: {
    getActiveAccount: mockGetActiveAccount,
    getAllAccounts: mockGetAllAccounts,
    acquireTokenSilent: mockAcquireTokenSilent,
  },
  apiScopes: ['api://test-client-id/access_as_user'],
}));

vi.mock('./session-expired', () => ({ handleSessionExpired: vi.fn() }));

import { InteractionRequiredAuthError } from '@azure/msal-browser';
import { callApi, callApiRaw, ApiError } from './api-client';
import { handleSessionExpired } from './session-expired';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('api-client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetActiveAccount.mockReturnValue({ homeAccountId: 'acc-1' });
    mockAcquireTokenSilent.mockResolvedValue({ accessToken: 'test-token-abc' });
  });

  it('callApi sends Bearer token and returns parsed JSON', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ profile: { id: 'p-1' } }),
    });

    const result = await callApi('/api/user-context', { foo: 'bar' });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [_url, init] = mockFetch.mock.calls[0];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-token-abc');
    expect(init.method).toBe('POST');
    expect(result).toEqual({ profile: { id: 'p-1' } });
  });

  it('callApi throws with error message when API returns non-ok status', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ error: 'Quiz access denied' }),
    });

    await expect(callApi('/api/grade-quiz', {})).rejects.toThrow('Quiz access denied');
  });

  it('callApi throws ApiError exposing the structured code and status (ADR-0013)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ error: 'Slug already in use', code: 'DUPLICATE_SLUG' }),
    });

    const err = await callApi('/api/organization-create', {}).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe('Slug already in use');
    expect((err as ApiError).code).toBe('DUPLICATE_SLUG');
    expect((err as ApiError).status).toBe(409);
  });

  it('callApi throws ApiError with undefined code when the body has none', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ error: 'Forbidden' }),
    });

    const err = await callApi('/api/organization-create', {}).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBeUndefined();
  });

  it('callApi throws when no account is available', async () => {
    mockGetActiveAccount.mockReturnValue(null);
    mockGetAllAccounts.mockReturnValue([]);

    await expect(callApi('/api/user-context', {})).rejects.toThrow('Not authenticated');
  });

  it('callApiRaw returns raw Response for binary endpoints like PDF', async () => {
    const fakeResponse = { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
    mockFetch.mockResolvedValueOnce(fakeResponse);

    const res = await callApiRaw('/api/generate-certificate', { enrollmentId: 'e-1' });

    expect(res).toBe(fakeResponse);
    const [_url, init] = mockFetch.mock.calls[0];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-token-abc');
  });

  it('callApi triggers the dead-session redirect and throws ApiError on a 401', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Unauthorized' }),
    });

    const err = await callApi('/api/user-context', {}).catch((e: unknown) => e);

    expect(handleSessionExpired).toHaveBeenCalledOnce();
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
  });

  it('callApi does NOT redirect on a 500 — transient errors keep their local handling', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Server error' }),
    });

    await expect(callApi('/api/user-context', {})).rejects.toBeInstanceOf(ApiError);
    expect(handleSessionExpired).not.toHaveBeenCalled();
  });

  it('callApi redirects when the refresh token is dead (InteractionRequiredAuthError)', async () => {
    mockAcquireTokenSilent.mockRejectedValueOnce(
      new InteractionRequiredAuthError('interaction_required', 'silent renew failed'),
    );

    await expect(callApi('/api/user-context', {})).rejects.toBeInstanceOf(InteractionRequiredAuthError);
    expect(handleSessionExpired).toHaveBeenCalledOnce();
  });

  it('getAccessToken lets a non-interactive (network) error propagate WITHOUT redirecting', async () => {
    mockAcquireTokenSilent.mockRejectedValueOnce(new Error('network down'));

    await expect(callApi('/api/user-context', {})).rejects.toThrow('network down');
    expect(handleSessionExpired).not.toHaveBeenCalled();
  });

  it('callApiRaw throws ApiError (not a bare Error) with the status, and redirects on 401', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Unauthorized' }),
    });

    const err = await callApiRaw('/api/generate-certificate', { enrollmentId: 'e-1' }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
    expect(handleSessionExpired).toHaveBeenCalledOnce();
  });
});
