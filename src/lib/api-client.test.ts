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

import { callApi, callApiRaw, ApiError } from './api-client';

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
});
