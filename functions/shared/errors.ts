import type { HttpResponseInit, InvocationContext } from '@azure/functions';
import { corsResponse } from './cors';

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
