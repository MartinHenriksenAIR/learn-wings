import { describe, it, expect, vi } from 'vitest';

vi.mock('jwks-rsa', () => ({
  default: () => ({
    getSigningKey: (_kid: string, cb: (err: Error | null, key?: any) => void) => {
      cb(null, { getPublicKey: () => 'mock-public-key' });
    },
  }),
}));

const VALID_ISSUER = 'https://login.microsoftonline.com/11111111-1111-1111-1111-111111111111/v2.0';

vi.mock('jsonwebtoken', () => ({
  verify: (_token: string, _getKey: unknown, _opts: unknown, cb: Function) => {
    const parts = _token.split('.');
    if (parts.length !== 3) return cb(new Error('invalid token'));
    try {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      if (payload._forceError) return cb(new Error('invalid signature'));
      cb(null, payload);
    } catch {
      cb(new Error('decode error'));
    }
  },
}));

process.env.ENTRA_CLIENT_ID = 'test-client-id';

import { authenticate, AuthError } from './auth';

function makeToken(claims: Record<string, unknown>): string {
  const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'k1' })).toString('base64url');
  const p = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${h}.${p}.fakesig`;
}

describe('authenticate', () => {
  it('returns user from valid Entra token', async () => {
    const token = makeToken({ oid: 'oid-abc', tid: '11111111-1111-1111-1111-111111111111', preferred_username: 'user@contoso.com', iss: VALID_ISSUER });
    const req = { headers: { get: (k: string) => k === 'authorization' ? `Bearer ${token}` : null } };
    const user = await authenticate(req as any);
    expect(user.id).toBe('oid-abc');
    expect(user.tid).toBe('11111111-1111-1111-1111-111111111111');
    expect(user.email).toBe('user@contoso.com');
  });

  it('throws AuthError on missing Bearer header', async () => {
    const req = { headers: { get: () => null } };
    await expect(authenticate(req as any)).rejects.toBeInstanceOf(AuthError);
  });

  it('throws AuthError on invalid issuer pattern', async () => {
    const token = makeToken({ oid: 'o', tid: 't', iss: 'https://evil.com/token' });
    const req = { headers: { get: () => `Bearer ${token}` } };
    await expect(authenticate(req as any)).rejects.toBeInstanceOf(AuthError);
  });

  it('throws AuthError on invalid signature', async () => {
    const token = makeToken({ _forceError: true });
    const req = { headers: { get: () => `Bearer ${token}` } };
    await expect(authenticate(req as any)).rejects.toBeInstanceOf(AuthError);
  });

  it('throws AuthError on missing oid or tid', async () => {
    const token = makeToken({ iss: VALID_ISSUER, email: 'x@y.com' });
    const req = { headers: { get: () => `Bearer ${token}` } };
    await expect(authenticate(req as any)).rejects.toBeInstanceOf(AuthError);
  });
});
