import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { deleteBlob } from '../shared/blob';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { authenticate } from '../shared/auth';
import { getProfile } from '../shared/profile';

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin) as HttpResponseInit;

  try {
    const user = await authenticate(req);
    const profile = await getProfile(user);
    if (!profile) return corsResponse(origin, 401, { error: 'Profile not found' }) as HttpResponseInit;
    if (!profile.is_platform_admin) return corsResponse(origin, 403, { error: 'Forbidden' }) as HttpResponseInit;

    const { blobPath } = await req.json() as { blobPath: string };
    if (!blobPath) return corsResponse(origin, 400, { error: 'blobPath is required' }) as HttpResponseInit;

    const deleted = await deleteBlob(blobPath);
    if (!deleted) {
      return corsResponse(origin, 500, { error: 'Blob delete failed' }) as HttpResponseInit;
    }

    return corsResponse(origin, 200, { success: true, message: 'Blob deleted' }) as HttpResponseInit;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    const status = msg.includes('token') || msg.includes('Token') ? 401 : 500;
    return corsResponse(origin, status, { error: msg }) as HttpResponseInit;
  }
}

export default handler;
app.http('azure-delete-blob', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
