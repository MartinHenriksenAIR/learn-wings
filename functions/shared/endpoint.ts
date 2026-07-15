import { app } from '@azure/functions';
import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from './auth';
import type { AuthUser } from './auth';
import { getProfile, isOrgAdmin, isActiveMember } from './profile';
import type { CallerProfile } from './profile';
import { corsPreflightResponse, corsResponse } from './cors';
import { internalError } from './errors';

/**
 * The endpoint factory — absorbs the HTTP envelope every handler used to
 * hand-roll (~20 lines × ~100 endpoints): origin extraction, OPTIONS/204
 * preflight, authenticate → getProfile → 401, the AuthError→401 catch, the
 * generic internalError catch, and the app.http registration trailer.
 *
 * Ordering guarantee (byte-identical to the legacy envelope — pinned by every
 * migrated endpoint's tests; 90 endpoints use the factory, and 10 deliberately
 * hand-rolled endpoints remain — grep app.http for the list):
 *   1. origin = req.headers.get('origin')
 *   2. OPTIONS → corsPreflightResponse(origin), before any auth work
 *   3. authenticate(req)
 *   4. getProfile(user) → null → 401 { error: 'Profile not found' }
 *   5. adminEndpoint only: !is_platform_admin → 403 (BEFORE run, so before any
 *      body parsing — adminEndpoint subsumed the legacy shared platform-admin
 *      guard; its gate contract is now pinned here and in this module's tests)
 *   6. run(ctx)
 *   7. catch: Reply → rendered as-is · AuthError → 401 { error: err.message }
 *      · anything else → internalError(context, origin, err)
 *
 * DEPENDENCY FREEZE — this module may only ever call authenticate/AuthError
 * (./auth), getProfile/isOrgAdmin/isActiveMember (./profile), and the cors and
 * errors helpers. Endpoint tests mock exactly those module names; any new call
 * (in particular anything from ./db) is a breaking change to every
 * migrated endpoint's tests. Body parsing stays the endpoint's job — the
 * module never touches the request body.
 *
 * Reply is control flow, not an error: a deliberate early HTTP exit thrown by
 * the authz helpers (and available for explicit throws). It is never logged
 * and never routed to internalError.
 */

// Deliberate early HTTP exit thrown by the authz helpers (and available for explicit throws).
// Control flow, not an error: deliberately does NOT extend Error; never logged, never routed to internalError.
export class Reply {
  constructor(readonly status: number, readonly body: unknown) {}
}

export interface AuthedCtx {
  req: HttpRequest;                  // body parsing stays the endpoint's job — the module never touches the body
  context: InvocationContext;
  origin: string | null;
  user: AuthUser;                    // from shared/auth
  profile: CallerProfile;            // from shared/profile — non-null by construction
  reply(status: number, body: unknown): HttpResponseInit;   // exactly corsResponse(origin, status, body)
  // Guards throw Reply(403, { error: 'Forbidden' }) on denial. Custom 403 bodies:
  // use `throw new Reply(403, {...})` in the endpoint instead.
  requireOrgAdmin(orgId: string): Promise<void>;
  requireActiveMember(orgId: string): Promise<void>;
  // For endpoints that must validate before gating — adminEndpoint gates before body parse.
  requirePlatformAdmin(): void;
}

export type AzureHandler = (req: HttpRequest, context: InvocationContext) => Promise<HttpResponseInit>;

export type EndpointRun = (ctx: AuthedCtx) => Promise<HttpResponseInit>;

function makeHandler(
  requireAdmin: boolean,
  opts: { forbiddenError?: string } | undefined,
  run: EndpointRun,
): AzureHandler {
  return async (req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    const origin = req.headers.get('origin');
    if (req.method === 'OPTIONS') return corsPreflightResponse(origin);
    try {
      const user = await authenticate(req);
      const profile = await getProfile(user);
      if (!profile) return corsResponse(origin, 401, { error: 'Profile not found' });
      if (requireAdmin && !profile.is_platform_admin) {
        return corsResponse(origin, 403, { error: opts?.forbiddenError ?? 'Forbidden' });
      }
      const ctx: AuthedCtx = {
        req,
        context,
        origin,
        user,
        profile,
        reply: (status, body) => corsResponse(origin, status, body),
        // Platform admins short-circuit WITHOUT the DB probe — parity with the
        // legacy `profile.is_platform_admin || await isOrgAdmin(...)` pattern.
        requireOrgAdmin: async (orgId) => {
          if (profile.is_platform_admin) return;
          if (await isOrgAdmin(profile.id, orgId)) return;
          throw new Reply(403, { error: 'Forbidden' });
        },
        requireActiveMember: async (orgId) => {
          if (profile.is_platform_admin) return;
          if (await isActiveMember(profile.id, orgId)) return;
          throw new Reply(403, { error: 'Forbidden' });
        },
        // No DB probe — reads profile.is_platform_admin only.
        requirePlatformAdmin: () => {
          if (!profile.is_platform_admin) throw new Reply(403, { error: 'Forbidden' });
        },
      };
      return await run(ctx);
    } catch (err: unknown) {
      if (err instanceof Reply) {
        try {
          return corsResponse(origin, err.status, err.body);
        } catch (renderErr: unknown) {
          // Non-serializable Reply body (circular ref, BigInt): the render itself
          // threw — fall through to the constant 500 so nothing escapes the handler.
          return internalError(context, origin, renderErr);
        }
      }
      if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message });
      return internalError(context, origin, err);
    }
  };
}

// app.http registration is the same load-time side effect every endpoint file
// performed pre-migration; functions.md forbids ADDING load-time code that can throw.
function register(name: string, handler: AzureHandler): AzureHandler {
  app.http(name, { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
  return handler;
}

export function endpoint(name: string, run: EndpointRun): AzureHandler {
  return register(name, makeHandler(false, undefined, run));
}

export function adminEndpoint(
  name: string,
  run: EndpointRun,
  opts?: { forbiddenError?: string },
): AzureHandler {
  return register(name, makeHandler(true, opts, run));
}
