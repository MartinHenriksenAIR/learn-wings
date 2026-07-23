import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../shared/auth', () => ({
  authenticate: () => ({ id: 'entra-oid-123', email: 'admin@test.com' }),
  AuthError: class AuthError extends Error {},
}));

const { mockQueryOne, mockEmailSend } = vi.hoisted(() => ({
  mockQueryOne: vi.fn(),
  mockEmailSend: vi.fn(),
}));
vi.mock('../shared/db', () => ({ queryOne: mockQueryOne }));
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: mockEmailSend };
  },
}));

import handler from './index';

const makeReq = (body: object) => ({
  method: 'POST',
  headers: { get: (k: string) => k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok' },
  json: async () => body,
});

const validBody = {
  email: 'invitee@example.com',
  orgName: 'Test Org',
  role: 'learner',
  inviteLink: 'https://ai-uddannelse.dk/invite/abc123',
};

describe('send-invitation-email', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ALLOWED_ORIGINS;
  });

  it('returns 403 for users who are not admin or org admin', async () => {
    // not platform admin, not org admin
    mockQueryOne.mockResolvedValueOnce({ is_platform_admin: false, is_org_admin: false });

    const res = await handler(makeReq(validBody) as any, {} as any);

    expect(res.status).toBe(403);
  });

  it('sends email and returns success for platform admin', async () => {
    mockQueryOne.mockResolvedValueOnce({ is_platform_admin: true });
    mockEmailSend.mockResolvedValueOnce({ id: 'email-id-123' });

    const res = await handler(makeReq(validBody) as any, {} as any);
    const body = JSON.parse(res.body);

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockEmailSend).toHaveBeenCalledOnce();
    // Verify logo does not reference supabase storage
    const callArgs = mockEmailSend.mock.calls[0][0];
    expect(callArgs.html).not.toContain('supabase.co');
  });

  it('returns 400 for invite links from non-allowed domains', async () => {
    mockQueryOne.mockResolvedValueOnce({ is_platform_admin: true });

    const res = await handler(
      makeReq({ ...validBody, inviteLink: 'https://evil.com/invite/abc' }) as any,
      {} as any
    );

    expect(res.status).toBe(400);
  });

  // Regression (2026-07-22): until the #115 domain cutover the app runs on the
  // SWA host and mints invite links on that origin — the hardcoded
  // ai-uddannelse.dk-only allowlist 400'd every invite email in prod.
  it('accepts invite links on any ALLOWED_ORIGINS host', async () => {
    process.env.ALLOWED_ORIGINS = 'https://black-forest-0d7f96c03.7.azurestaticapps.net';
    mockQueryOne.mockResolvedValueOnce({ is_platform_admin: true });
    mockEmailSend.mockResolvedValueOnce({ id: 'email-id-456' });

    const res = await handler(
      makeReq({
        ...validBody,
        inviteLink: 'https://black-forest-0d7f96c03.7.azurestaticapps.net/signup?invite=abc123',
      }) as any,
      {} as any
    );

    expect(res.status).toBe(200);
    expect(mockEmailSend).toHaveBeenCalledOnce();
  });

  it('still rejects non-allowed domains when ALLOWED_ORIGINS is set', async () => {
    process.env.ALLOWED_ORIGINS = 'https://black-forest-0d7f96c03.7.azurestaticapps.net';
    mockQueryOne.mockResolvedValueOnce({ is_platform_admin: true });

    const res = await handler(
      makeReq({ ...validBody, inviteLink: 'https://evil.com/signup?invite=abc' }) as any,
      {} as any
    );

    expect(res.status).toBe(400);
    expect(mockEmailSend).not.toHaveBeenCalled();
  });

  it("uses the existing recipient's preferred_language over the inviter's pick", async () => {
    mockQueryOne
      .mockResolvedValueOnce({ is_platform_admin: true })      // authz
      .mockResolvedValueOnce({ preferred_language: 'en' });    // invitee profile
    mockEmailSend.mockResolvedValueOnce({ id: 'e1' });

    const res = await handler(makeReq({ ...validBody, inviterLanguage: 'da' }) as any, {} as any);
    const html = mockEmailSend.mock.calls[0][0].html as string;
    const subject = mockEmailSend.mock.calls[0][0].subject as string;

    expect(res.status).toBe(200);
    expect(html).toContain('lang="en"');
    expect(html).toContain("You're invited!");
    expect(subject).toContain('You have been invited');
  });

  it("uses the inviter's pick when the recipient has no profile", async () => {
    mockQueryOne
      .mockResolvedValueOnce({ is_platform_admin: true })      // authz
      .mockResolvedValueOnce(undefined);                        // no invitee profile
    mockEmailSend.mockResolvedValueOnce({ id: 'e2' });

    const res = await handler(makeReq({ ...validBody, inviterLanguage: 'en' }) as any, {} as any);
    const html = mockEmailSend.mock.calls[0][0].html as string;

    expect(res.status).toBe(200);
    expect(html).toContain('lang="en"');
    expect(html).toContain("You're invited!");
  });

  it('falls back to Danish when no profile and no inviter pick', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ is_platform_admin: true })      // authz
      .mockResolvedValueOnce(undefined);                        // no invitee profile
    mockEmailSend.mockResolvedValueOnce({ id: 'e3' });

    const res = await handler(makeReq(validBody) as any, {} as any); // no inviterLanguage
    const html = mockEmailSend.mock.calls[0][0].html as string;

    expect(res.status).toBe(200);
    expect(html).toContain('lang="da"');
    expect(html).toContain('Du er inviteret!');
  });
});
