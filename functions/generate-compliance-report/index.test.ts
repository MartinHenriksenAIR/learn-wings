import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuthenticate, MockAuthError, mockQuery, mockQueryOne } = vi.hoisted(() => {
  class MockAuthError extends Error {}
  return { mockAuthenticate: vi.fn(), MockAuthError, mockQuery: vi.fn(), mockQueryOne: vi.fn() };
});
vi.mock('../shared/auth', () => ({ authenticate: mockAuthenticate, AuthError: MockAuthError }));
vi.mock('../shared/db', () => ({ query: mockQuery, queryOne: mockQueryOne }));

import handler from './index';
import { STRINGS, resolveLang } from './strings';

const req = (body: unknown, method = 'POST') =>
  ({ method, headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : null) }, json: async () => body }) as any;

const isPdf = (body: unknown) => Buffer.isBuffer(body) && (body as Buffer).subarray(0, 5).toString('latin1') === '%PDF-';

// Default happy-path DB: org-admin caller, org found, no courses/members.
function seedDefaults() {
  mockAuthenticate.mockResolvedValue({ id: 'oid-1' });
  mockQueryOne.mockImplementation(async (sql: string) =>
    sql.includes('FROM profiles p')
      ? { full_name: 'M. Admin', is_platform_admin: false, is_org_admin: true }
      : sql.includes('FROM organizations')
        ? { name: 'Acme A/S' }
        : null);
  mockQuery.mockImplementation(async (sql: string) =>
    sql.includes('GROUP BY c.id') ? [] : []); // courseStats [], members []
}

describe('generate-compliance-report', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedDefaults();
  });

  it('handles OPTIONS preflight', async () => {
    const res = await handler(req({}, 'OPTIONS'), {} as any);
    expect(res.status).toBe(204);
  });

  it('returns 401 when the token is invalid', async () => {
    mockAuthenticate.mockRejectedValueOnce(new MockAuthError('bad token'));
    const res = await handler(req({ orgId: 'org-1' }), {} as any);
    expect(res.status).toBe(401);
  });

  it('returns 400 when orgId is missing', async () => {
    const res = await handler(req({}), {} as any);
    expect(res.status).toBe(400);
  });

  it('returns 403 for a non-admin caller', async () => {
    mockQueryOne.mockImplementation(async (sql: string) =>
      sql.includes('FROM profiles p') ? { full_name: 'Learner', is_platform_admin: false, is_org_admin: false } : null);
    const res = await handler(req({ orgId: 'org-1' }), {} as any);
    expect(res.status).toBe(403);
  });

  it('returns 404 when the organization does not exist', async () => {
    mockQueryOne.mockImplementation(async (sql: string) =>
      sql.includes('FROM profiles p') ? { full_name: 'M. Admin', is_platform_admin: true, is_org_admin: false } : null);
    const res = await handler(req({ orgId: 'missing' }), {} as any);
    expect(res.status).toBe(404);
  });

  it('returns a branded PDF for an authorized admin (empty org)', async () => {
    const res = await handler(req({ orgId: 'org-1' }), {} as any);
    expect(res.status).toBe(200);
    expect((res.headers as Record<string, string>)['Content-Type']).toBe('application/pdf');
    expect((res.headers as Record<string, string>)['Content-Disposition']).toMatch(/compliance/);
    expect(isPdf(res.body)).toBe(true);
  });

  it('renders with real department, course and assessment data', async () => {
    mockQuery.mockImplementation(async (sql: string) =>
      sql.includes('GROUP BY c.id')
        ? [
            { title: 'Introduktion til AI Act', enrolled: 10, completed: 8 },
            { title: 'Ansvarlig brug af generativ AI', enrolled: 10, completed: 4 },
          ]
        : [
            { department: 'Salg', assessment_level: 'advanced', trained: true, last_completed: '2026-07-01T00:00:00Z' },
            { department: 'Salg', assessment_level: 'intermediate', trained: false, last_completed: null },
            { department: 'Lager', assessment_level: null, trained: false, last_completed: null },
            { department: null, assessment_level: 'basic', trained: true, last_completed: '2024-01-01T00:00:00Z' }, // >12mo → refresher due
          ]);
    const res = await handler(req({ orgId: 'org-1' }), {} as any);
    expect(res.status).toBe(200);
    expect(isPdf(res.body)).toBe(true);
  });

  it('produces different output for da vs en (localized template)', async () => {
    const en = await handler(req({ orgId: 'org-1', language: 'en' }), {} as any);
    const da = await handler(req({ orgId: 'org-1', language: 'da' }), {} as any);
    expect(isPdf(en.body)).toBe(true);
    expect(isPdf(da.body)).toBe(true);
    expect((da.body as Buffer).equals(en.body as Buffer)).toBe(false);
  });

  it('resolveLang maps only da/en; everything else falls back to en', () => {
    expect(resolveLang('da')).toBe('da');
    expect(resolveLang('en')).toBe('en');
    expect(resolveLang('es')).toBe('en');
    expect(resolveLang(undefined)).toBe('en');
    // localization sanity: the two templates really differ
    expect(STRINGS.da.title).not.toBe(STRINGS.en.title);
  });
});
