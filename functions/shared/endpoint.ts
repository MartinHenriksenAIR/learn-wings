import { app } from '@azure/functions';
import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from './auth';
import type { AuthUser } from './auth';
import { getProfile, isOrgAdmin, isActiveMember } from './profile';
import type { CallerProfile } from './profile';
import { corsPreflightResponse, corsResponse } from './cors';
import { internalError } from './errors';


export class Reply {
  constructor(readonly status: number, readonly body: unknown) {}
}

export interface AuthedCtx {
  req: HttpRequest;                  // body parsing stays the endpoint's job — the module never touches the body
  context: InvocationContext;
  origin: string | null;
  user: AuthUser;
  profile: CallerProfile;            // from shared/profile — non-null by construction
  reply(status: number, body: unknown): HttpResponseInit;   // exactly corsResponse(origin, status, body)
  requireOrgAdmin(orgId: string): Promise<void>;
  requireActiveMember(orgId: string): Promise<void>;
  requirePlatformAdmin(): void;
}

export type AzureHandler = (req: HttpRequest, context: InvocationContext) => Promise<HttpResponseInit>;

export type EndpointRun = (ctx: AuthedCtx) => Promise<HttpResponseInit>;

function makeHandler(
  requireAdmin: boolean,
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
        return corsResponse(origin, 403, { error: 'Forbidden' });
      }
      const ctx: AuthedCtx = {
        req,
        context,
        origin,
        user,
        profile,
        reply: (status, body) => corsResponse(origin, status, body),
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
          return internalError(context, origin, renderErr);
        }
      }
      if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message });
      return internalError(context, origin, err);
    }
  };
}

function register(name: string, handler: AzureHandler): AzureHandler {
  app.http(name, { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
  return handler;
}

export function endpoint(name: string, run: EndpointRun): AzureHandler {
  return register(name, makeHandler(false, run));
}

export function adminEndpoint(name: string, run: EndpointRun): AzureHandler {
  return register(name, makeHandler(true, run));
}
