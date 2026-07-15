import jwksClient from 'jwks-rsa';
import { verify } from 'jsonwebtoken';
import type { HttpRequest } from '@azure/functions';

export class AuthError extends Error {
  constructor(message: string) { super(message); this.name = 'AuthError'; }
}

export interface AuthUser {
  id: string;    // Entra oid claim
  tid: string;   // Entra tenant ID
  email: string; // preferred_username or email claim
}

const client = jwksClient({
  jwksUri: 'https://login.microsoftonline.com/common/discovery/v2.0/keys',
  cache: true,
  cacheMaxEntries: 5,
  cacheMaxAge: 600_000,
});

function getKey(header: any, callback: (err: Error | null, key?: string) => void): void {
  client.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    callback(null, key?.getPublicKey());
  });
}

// Multi-tenant: issuer varies per tenant — validate pattern, not fixed value
const ISSUER_RE = /^https:\/\/login\.microsoftonline\.com\/[0-9a-f-]{36}\/v2\.0$/;

function verifyToken(token: string): Promise<AuthUser> {
  return new Promise((resolve, reject) => {
    verify(
      token,
      getKey as any,
      {
        audience: process.env.ENTRA_CLIENT_ID,
        algorithms: ['RS256'],
        // issuer intentionally omitted — multi-tenant tokens have per-tenant issuers
      },
      (err, decoded) => {
        if (err) return reject(new AuthError(err.message));
        const d = decoded as Record<string, string>;
        if (!ISSUER_RE.test(d.iss)) return reject(new AuthError('Invalid token issuer'));
        if (!d.oid || !d.tid) return reject(new AuthError('Missing oid or tid claims'));
        resolve({
          id: d.oid,
          tid: d.tid,
          email: d.preferred_username ?? d.email ?? d.upn ?? '',
        });
      },
    );
  });
}

export async function authenticate(req: Pick<HttpRequest, 'headers'>): Promise<AuthUser> {
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) throw new AuthError('Missing Bearer token');
  return verifyToken(auth.slice(7));
}
