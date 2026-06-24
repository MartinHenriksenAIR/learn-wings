import type { HttpResponseInit, InvocationContext } from '@azure/functions';
import { corsResponse } from './cors';

/**
 * CWE-209 hardening (ADR-0014): unexpected exceptions must never leak their
 * message (schema names, connection strings, driver errors) to callers.
 * Every handler's generic catch routes its 500 through here — the real error
 * (message + stack) is logged on the invocation context for App Insights,
 * and the caller gets a constant body.
 *
 * Deliberate 4xx contracts (validation messages, AuthError 401s) are NOT
 * exception propagation and do NOT go through this helper.
 */
export function internalError(
  context: Pick<InvocationContext, 'error'>,
  origin: string | null,
  err: unknown,
): HttpResponseInit {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error && err.stack ? `\n${err.stack}` : '';
  context.error(`Unhandled error: ${message}${stack}`);
  return corsResponse(origin, 500, { error: 'Internal server error' });
}
