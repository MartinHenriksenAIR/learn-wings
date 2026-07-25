import jwksClient, { SigningKeyNotFoundError } from 'jwks-rsa';
import { verify, JsonWebTokenError } from 'jsonwebtoken';
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
        // Only genuine token-verification failures become AuthError → 401.
        // Two token-problem classes qualify:
        //   • JsonWebTokenError — covers TokenExpiredError and NotBeforeError (both subclasses),
        //     i.e. every jsonwebtoken validation error (bad signature, expiry, etc.).
        //   • SigningKeyNotFoundError — jwks-rsa found no signing key for the token's `kid`.
        //     An unknown/garbage kid is attacker-controllable via a crafted token, so it's a
        //     TOKEN problem (→ 401), NOT a server fault. Bucketing it as 500 would let bad-kid
        //     tokens spam logged 500s on demand, masking a real Entra outage.
        // Any OTHER error here is a signing-key transport/fetch failure surfaced via
        // getKey/jwks-rsa (JwksError/JwksRateLimitError/DNS fetching login.microsoftonline.com
        // keys) — reject it AS-IS so the endpoint factory's catch routes it through internalError
        // (logs + generic 500, ADR-0014) instead of a silent 401.
        if (err) {
          // NB: jsonwebtoken types `err` as VerifyErrors (JWT subclasses only), but errors from
          // getKey/jwks-rsa (SigningKeyNotFoundError, JwksError, transport) also surface here at
          // runtime — its types don't model that. Widen to Error so both instanceof checks are live.
          const e: Error = err;
          const isTokenFailure = e instanceof JsonWebTokenError || e instanceof SigningKeyNotFoundError;
          return reject(isTokenFailure ? new AuthError(e.message) : e);
        }
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
