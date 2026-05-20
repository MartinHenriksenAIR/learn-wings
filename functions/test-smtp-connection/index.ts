import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { queryOne } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { createConnection } from 'node:net';
import { connect as tlsConnect } from 'node:tls';

async function testConnection(host: string, port: number, useTls: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Connection timeout after 8 seconds')), 8000);
    const onConnect = () => { clearTimeout(timeout); sock.destroy(); resolve(`Connected to ${host}:${port}`); };
    const onError = (e: Error) => { clearTimeout(timeout); reject(e); };
    const sock = useTls
      ? tlsConnect({ host, port, rejectUnauthorized: false }, onConnect)
      : createConnection({ host, port }, onConnect);
    sock.on('error', onError);
  });
}

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin) as HttpResponseInit;
  try {
    // Auth gate — the Supabase function had NONE; this is the security fix
    const user = await authenticate(req);
    const isAdmin = await queryOne<{ is_platform_admin: boolean }>(
      'SELECT is_platform_admin FROM profiles WHERE entra_oid = $1', [user.id]
    );
    if (!isAdmin?.is_platform_admin) return corsResponse(origin, 403, { error: 'Platform admin required' }) as HttpResponseInit;

    const { host, port, encryption } = await req.json() as { host: string; port: number; encryption: 'none' | 'ssl_tls' | 'starttls' };
    const useTls = encryption === 'ssl_tls';
    const message = await testConnection(host, port, useTls);
    return corsResponse(origin, 200, { success: true, message }) as HttpResponseInit;
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message }) as HttpResponseInit;
    const msg = err instanceof Error ? err.message : 'Connection failed';
    return corsResponse(origin, 200, { success: false, error: msg }) as HttpResponseInit;
  }
}

export default handler;
app.http('test-smtp-connection', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
