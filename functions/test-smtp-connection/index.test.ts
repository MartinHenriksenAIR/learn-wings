import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return { mockAuthenticate: vi.fn(), MockAuthError };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));

const { mockQueryOne } = vi.hoisted(() => ({ mockQueryOne: vi.fn() }));
vi.mock('../shared/db', () => ({ queryOne: mockQueryOne }));

// shared/net-guard runs for real (that's the thing under test); only its DNS
// dependency is mocked, so the SSRF gate is exercised without real resolution.
const { mockLookup } = vi.hoisted(() => ({ mockLookup: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: mockLookup }));

// Mock node:net so tests don't make real connections.
// Defer cb to next microtask so `sock` is assigned before onConnect calls sock.destroy().
const { mockCreateConnection, mockTlsConnect } = vi.hoisted(() => {
  const openSocket = (_opts: unknown, cb: () => void) => {
    const sock = { destroy: vi.fn(), on: vi.fn() };
    Promise.resolve().then(cb);
    return sock;
  };
  return { mockCreateConnection: vi.fn(openSocket), mockTlsConnect: vi.fn(openSocket) };
});
vi.mock('node:net', () => ({ createConnection: mockCreateConnection }));
vi.mock('node:tls', () => ({ connect: mockTlsConnect }));

import handler from './index';
import { BLOCKED_HOST_MESSAGE } from '../shared/net-guard';

const PUBLIC_ANSWER = [{ address: '93.184.216.34', family: 4 }];

const makeReq = (body: object, method = 'POST') => ({
  method,
  headers: { get: (k: string) => k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok' },
  json: async () => body,
});

/** The assertion that actually pins #267: the guard must run BEFORE any dial. */
const expectNoSocketOpened = () => {
  expect(mockCreateConnection).not.toHaveBeenCalled();
  expect(mockTlsConnect).not.toHaveBeenCalled();
};

describe('test-smtp-connection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({ id: 'entra-oid-123', tid: 'tid-1', email: 'admin@test.com' });
    mockLookup.mockResolvedValue(PUBLIC_ANSWER);
  });

  it('responds to OPTIONS preflight without authenticating', async () => {
    const res = await handler(makeReq({}, 'OPTIONS') as any, {} as any);

    expect(res.status).toBe(204);
    expect(res.body).toBeUndefined();
    expect(mockAuthenticate).not.toHaveBeenCalled();
    expectNoSocketOpened();
  });

  it('returns 401 when authenticate throws an AuthError', async () => {
    mockAuthenticate.mockRejectedValueOnce(new MockAuthError('Missing Bearer token'));

    const res = await handler(makeReq({ host: 'smtp.test.com', port: 587, encryption: 'none' }) as any, {} as any);

    expect(res.status).toBe(401);
    expect(JSON.parse(res.body as string)).toEqual({ error: 'Missing Bearer token' });
    expectNoSocketOpened();
  });

  it('returns 403 for non-admin users', async () => {
    mockQueryOne.mockResolvedValueOnce({ is_platform_admin: false });

    const res = await handler(makeReq({ host: 'smtp.test.com', port: 587, encryption: 'none' }) as any, {} as any);

    expect(res.status).toBe(403);
    expectNoSocketOpened();
  });

  it('returns success when connection is established', async () => {
    mockQueryOne.mockResolvedValueOnce({ is_platform_admin: true });

    const res = await handler(makeReq({ host: 'smtp.test.com', port: 587, encryption: 'none' }) as any, {} as any);
    const body = JSON.parse(res.body);

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.message).toMatch(/smtp\.test\.com/);
  });

  // SSRF guard (#267). Failures reuse the endpoint's bespoke 200 {success:false}
  // contract (deliberate ADR-0014 carve-out — Platform Settings renders it inline),
  // so the status alone proves nothing: every case must also pin that no socket opened.
  describe('SSRF guard (#267)', () => {
    beforeEach(() => {
      mockQueryOne.mockResolvedValue({ is_platform_admin: true });
    });

    it.each([
      ['192.168.1.1', 'private literal'],
      ['169.254.169.254', 'cloud metadata endpoint'],
      ['127.0.0.1', 'loopback'],
    ])('refuses %s (%s) and opens no socket', async (host) => {
      mockLookup.mockResolvedValueOnce([{ address: host, family: 4 }]);

      const res = await handler(makeReq({ host, port: 25, encryption: 'none' }) as any, {} as any);

      expect(res.status).toBe(200);
      expect(JSON.parse(res.body as string)).toEqual({ success: false, error: BLOCKED_HOST_MESSAGE });
      expect(mockLookup).toHaveBeenCalledWith(host, { all: true });
      expectNoSocketOpened();
    });

    // The gate resolves rather than string-matching, so a public-looking hostname
    // pointing at an internal address is refused too.
    it('refuses a public hostname that resolves to a private address', async () => {
      mockLookup.mockResolvedValueOnce([{ address: '10.0.0.5', family: 4 }]);

      const res = await handler(makeReq({ host: 'internal.example.com', port: 8080, encryption: 'none' }) as any, {} as any);

      expect(res.status).toBe(200);
      expect(JSON.parse(res.body as string)).toEqual({ success: false, error: BLOCKED_HOST_MESSAGE });
      expectNoSocketOpened();
    });

    it('opens a socket for a public host and reports success', async () => {
      const res = await handler(makeReq({ host: 'smtp.test.com', port: 587, encryption: 'none' }) as any, {} as any);

      expect(res.status).toBe(200);
      expect(JSON.parse(res.body as string)).toEqual({ success: true, message: 'Connected to smtp.test.com:587' });
      expect(mockCreateConnection).toHaveBeenCalledTimes(1);
      expect(mockCreateConnection.mock.calls[0][0]).toEqual({ host: 'smtp.test.com', port: 587 });
      expect(mockTlsConnect).not.toHaveBeenCalled();
    });

    it('takes the TLS connect path for a public host when encryption is ssl_tls', async () => {
      const res = await handler(makeReq({ host: 'smtp.test.com', port: 465, encryption: 'ssl_tls' }) as any, {} as any);

      expect(res.status).toBe(200);
      expect(JSON.parse(res.body as string)).toEqual({ success: true, message: 'Connected to smtp.test.com:465' });
      expect(mockTlsConnect).toHaveBeenCalledTimes(1);
      expect(mockTlsConnect.mock.calls[0][0]).toMatchObject({ host: 'smtp.test.com', port: 465 });
      expect(mockCreateConnection).not.toHaveBeenCalled();
    });

    it.each([
      [undefined, 'missing'],
      ['', 'empty'],
      ['   ', 'whitespace only'],
      [42, 'non-string'],
    ])('rejects host %s (%s) before resolving or dialling', async (host) => {
      const res = await handler(makeReq({ host, port: 587, encryption: 'none' }) as any, {} as any);

      expect(res.status).toBe(200);
      expect(JSON.parse(res.body as string)).toEqual({ success: false, error: 'host is required' });
      expect(mockLookup).not.toHaveBeenCalled();
      expectNoSocketOpened();
    });

    it.each([
      [0, 'below range'],
      [70000, 'above range'],
      [587.5, 'non-integer'],
      ['25', 'string'],
      [undefined, 'missing'],
    ])('rejects port %s (%s) before resolving or dialling', async (port) => {
      const res = await handler(makeReq({ host: 'smtp.test.com', port, encryption: 'none' }) as any, {} as any);

      expect(res.status).toBe(200);
      expect(JSON.parse(res.body as string)).toEqual({
        success: false,
        error: 'port must be an integer between 1 and 65535',
      });
      expect(mockLookup).not.toHaveBeenCalled();
      expectNoSocketOpened();
    });
  });
});
