import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../shared/auth', () => ({
  authenticate: () => ({ id: 'entra-oid-123', email: 'admin@test.com' }),
  AuthError: class AuthError extends Error {},
}));

const { mockQueryOne } = vi.hoisted(() => ({ mockQueryOne: vi.fn() }));
vi.mock('../shared/db', () => ({ queryOne: mockQueryOne }));

// Mock node:net so tests don't make real connections.
// Defer cb to next microtask so `sock` is assigned before onConnect calls sock.destroy().
vi.mock('node:net', () => ({
  createConnection: vi.fn((_opts: unknown, cb: () => void) => {
    const sock = { destroy: vi.fn(), on: vi.fn() };
    Promise.resolve().then(cb);
    return sock;
  }),
}));
vi.mock('node:tls', () => ({
  connect: vi.fn((_opts: unknown, cb: () => void) => {
    const sock = { destroy: vi.fn(), on: vi.fn() };
    Promise.resolve().then(cb);
    return sock;
  }),
}));

import handler from './index';

const makeReq = (body: object) => ({
  method: 'POST',
  headers: { get: (k: string) => k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok' },
  json: async () => body,
});

describe('test-smtp-connection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 403 for non-admin users', async () => {
    mockQueryOne.mockResolvedValueOnce({ is_platform_admin: false });

    const res = await handler(makeReq({ host: 'smtp.test.com', port: 587, encryption: 'none' }) as any, {} as any);

    expect(res.status).toBe(403);
  });

  it('returns success when connection is established', async () => {
    mockQueryOne.mockResolvedValueOnce({ is_platform_admin: true });

    const res = await handler(makeReq({ host: 'smtp.test.com', port: 587, encryption: 'none' }) as any, {} as any);
    const body = JSON.parse(res.body);

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.message).toMatch(/smtp\.test\.com/);
  });
});
