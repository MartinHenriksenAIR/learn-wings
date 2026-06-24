import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { deleteBlob } from '../shared/blob';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { internalError } from '../shared/errors';
import { requirePlatformAdmin } from '../shared/guards';

async function handler(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin);

  try {
    const gate = await requirePlatformAdmin(req, origin);
    if (!gate.ok) return gate.response;

    const { blobPath } = await req.json() as { blobPath: string };
    if (!blobPath) return corsResponse(origin, 400, { error: 'blobPath is required' });

    const deleted = await deleteBlob(blobPath);
    if (!deleted) {
      return corsResponse(origin, 500, { error: 'Blob delete failed' });
    }

    return corsResponse(origin, 200, { success: true, message: 'Blob deleted' });
  } catch (err: unknown) {
    return internalError(context, origin, err);
  }
}

export default handler;
app.http('azure-delete-blob', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
