// Hand-rolled (not shared/endpoint.ts): bespoke response contract (connection failures return 200 {success:false} — a deliberate ADR-0014 carve-out) and an oid-only admin probe.
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { queryOne } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { validatePublicHost } from '../shared/net-guard';
import { createConnection, isIP } from 'node:net';
import { connect as tlsConnect, type ConnectionOptions as TlsConnectionOptions } from 'node:tls';

/**
 * TLS options for the pinned-IP dial.
 *
 * `servername` is NOT removable: we connect to `address`, and a dial to a bare IP
 * sends no SNI, so shared-IP / load-balanced SMTP providers (SendGrid, Mailgun,
 * Office 365) would fail the handshake and a working Test Connection would start
 * reporting a false failure. It is omitted when the admin typed an IP literal —
 * RFC 6066 forbids IP literals in SNI and Node rejects them.
 */
function tlsOptions(host: string, address: string, port: number): TlsConnectionOptions {
  const options: TlsConnectionOptions = { host: address, port, rejectUnauthorized: false };
  if (isIP(host) === 0) options.servername = host;
  return options;
}

/**
 * Dials `address` — the IP `validatePublicHost` already vetted — rather than
 * `host`, so the socket's own resolution can't run a second lookup that a
 * low-TTL rebinding record answers with a private address. `host` stays the
 * user-facing name: it is what the success message reports and what rides along
 * as the TLS SNI servername.
 */
async function testConnection(host: string, address: string, port: number, useTls: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Connection timeout after 8 seconds')), 8000);
    const onConnect = () => { clearTimeout(timeout); sock.destroy(); resolve(`Connected to ${host}:${port}`); };
    const onError = (e: Error) => { clearTimeout(timeout); reject(e); };
    const sock = useTls
      ? tlsConnect(tlsOptions(host, address, port), onConnect)
      : createConnection({ host: address, port }, onConnect);
    sock.on('error', onError);
  });
}

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin);
  try {
    // Auth gate — the Supabase function had NONE; this is the security fix
    const user = await authenticate(req);
    const isAdmin = await queryOne<{ is_platform_admin: boolean }>(
      'SELECT is_platform_admin FROM profiles WHERE entra_oid = $1', [user.id]
    );
    if (!isAdmin?.is_platform_admin) return corsResponse(origin, 403, { error: 'Platform admin required' });

    const { host, port, encryption } = await req.json() as { host?: unknown; port?: unknown; encryption?: unknown };

    // SSRF guard (#267) — a raw socket to a body-supplied host:port is an internal
    // port-probe primitive even behind the admin gate. Failures reuse the bespoke
    // 200 {success:false} contract because Platform Settings renders it inline.
    if (typeof host !== 'string' || host.trim() === '') {
      return corsResponse(origin, 200, { success: false, error: 'host is required' });
    }
    if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
      return corsResponse(origin, 200, { success: false, error: 'port must be an integer between 1 and 65535' });
    }
    const verdict = await validatePublicHost(host);
    if ('error' in verdict) return corsResponse(origin, 200, { success: false, error: verdict.error });

    const useTls = encryption === 'ssl_tls';
    const message = await testConnection(host.trim(), verdict.address, port, useTls);
    return corsResponse(origin, 200, { success: true, message });
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message });
    const msg = err instanceof Error ? err.message : 'Connection failed';
    return corsResponse(origin, 200, { success: false, error: msg });
  }
}

export default handler;
app.http('test-smtp-connection', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
