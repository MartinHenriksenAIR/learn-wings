import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../shared/auth', () => ({
  authenticate: () => ({ id: 'entra-oid-123', tid: 'tid-1', email: 'admin@test.com' }),
  AuthError: class AuthError extends Error {},
}));

const { mockQueryOne, mockEmailSend, mockGetProfile } = vi.hoisted(() => ({
  mockQueryOne: vi.fn(),
  mockEmailSend: vi.fn(),
  mockGetProfile: vi.fn(),
}));
vi.mock('../shared/db', () => ({ queryOne: mockQueryOne }));
vi.mock('../shared/profile', () => ({ getProfile: mockGetProfile }));
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: mockEmailSend };
  },
}));

import handler from './index';

const makeReq = (body: object) => ({
  method: 'POST',
  headers: { get: (k: string) => (k === 'origin' ? 'https://ai-uddannelse.dk' : 'Bearer tok') },
  json: async () => body,
});

const makeCtx = () => ({ log: vi.fn(), error: vi.fn(), warn: vi.fn() });

// The body the frontend sends today. `orgName`, `role` and `email` are present
// but the server MUST ignore them (#306): it derives org, role and recipient
// from the authoritative invitation row identified by the link_id embedded in
// `inviteLink`. The `role: 'platform_admin'` here is a deliberately hostile
// client value that must never influence the email.
const clientBody = {
  email: 'attacker-controlled@example.com',
  orgName: 'Client-Supplied Org',
  role: 'platform_admin',
  inviteLink: 'https://ai-uddannelse.dk/signup?invite=link-abc',
};

// Callers as resolved by getProfile.
const orgAdmin = { id: 'prof-1', is_platform_admin: false };
const platformAdmin = { id: 'prof-2', is_platform_admin: true };

// Invitation rows as returned by the combined lookup+authz query. `role` is the
// org_role enum ('org_admin' | 'learner'); platform-admin invites carry org_id
// NULL and is_platform_admin_invite = true.
const orgInvitation = {
  org_id: 'org-1',
  role: 'learner',
  invitee_email: 'invitee@example.com',
  is_platform_admin_invite: false,
  org_name: 'Acme A/S',
  caller_is_org_admin: true,
};
const platformInvitation = {
  org_id: null,
  role: 'learner',
  invitee_email: 'new-admin@example.com',
  is_platform_admin_invite: true,
  org_name: null,
  caller_is_org_admin: false,
};

describe('send-invitation-email', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ALLOWED_ORIGINS;
  });

  // ---- Authorization (#306) ------------------------------------------------

  it('returns 403 when the caller has no profile', async () => {
    mockGetProfile.mockResolvedValueOnce(null);

    const res = await handler(makeReq(clientBody) as any, makeCtx() as any);

    expect(res.status).toBe(403);
    expect(mockEmailSend).not.toHaveBeenCalled();
  });

  it('returns 403 (sending nothing) for an org admin of a DIFFERENT org than the invite', async () => {
    mockGetProfile.mockResolvedValueOnce(orgAdmin);
    // The invite is for org-1, but this caller is not an admin of org-1.
    mockQueryOne.mockResolvedValueOnce({ ...orgInvitation, caller_is_org_admin: false });

    const res = await handler(makeReq(clientBody) as any, makeCtx() as any);

    expect(res.status).toBe(403);
    expect(mockEmailSend).not.toHaveBeenCalled();
  });

  it('returns 403 (sending nothing) for an unknown invite link — even for a platform admin', async () => {
    mockGetProfile.mockResolvedValueOnce(platformAdmin);
    mockQueryOne.mockResolvedValueOnce(null); // no invitation for that link_id

    const res = await handler(makeReq(clientBody) as any, makeCtx() as any);

    expect(res.status).toBe(403);
    expect(mockEmailSend).not.toHaveBeenCalled();
  });

  it('sends the email when the caller is an org admin of the invite’s org', async () => {
    mockGetProfile.mockResolvedValueOnce(orgAdmin);
    mockQueryOne.mockResolvedValueOnce(orgInvitation);
    mockQueryOne.mockResolvedValueOnce(null); // invitee language lookup
    mockEmailSend.mockResolvedValueOnce({ id: 'email-id-1' });

    const res = await handler(makeReq(clientBody) as any, makeCtx() as any);
    const body = JSON.parse(res.body);

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockEmailSend).toHaveBeenCalledOnce();
    // Recipient is the invitation's email from the DB, NOT the client's `email`.
    expect(mockEmailSend.mock.calls[0][0].to).toEqual(['invitee@example.com']);
  });

  it('sends the email when the caller is a platform admin', async () => {
    mockGetProfile.mockResolvedValueOnce(platformAdmin);
    mockQueryOne.mockResolvedValueOnce({ ...orgInvitation, caller_is_org_admin: false });
    mockQueryOne.mockResolvedValueOnce(null);
    mockEmailSend.mockResolvedValueOnce({ id: 'email-id-2' });

    const res = await handler(makeReq(clientBody) as any, makeCtx() as any);

    expect(res.status).toBe(200);
    expect(mockEmailSend).toHaveBeenCalledOnce();
  });

  it('returns 403 for a platform-admin invitation when the caller is not a platform admin', async () => {
    mockGetProfile.mockResolvedValueOnce(orgAdmin);
    mockQueryOne.mockResolvedValueOnce(platformInvitation);

    const res = await handler(makeReq(clientBody) as any, makeCtx() as any);

    expect(res.status).toBe(403);
    expect(mockEmailSend).not.toHaveBeenCalled();
  });

  it('sends a platform-admin invitation for a platform admin (no null/undefined org text)', async () => {
    mockGetProfile.mockResolvedValueOnce(platformAdmin);
    mockQueryOne.mockResolvedValueOnce(platformInvitation);
    mockQueryOne.mockResolvedValueOnce(null);
    mockEmailSend.mockResolvedValueOnce({ id: 'email-id-3' });

    await handler(makeReq(clientBody) as any, makeCtx() as any);

    const sent = mockEmailSend.mock.calls[0][0];
    expect(sent.subject).toContain('Platform Administrator');
    expect(sent.html).not.toContain('null');
    expect(sent.html).not.toContain('undefined');
  });

  // ---- No trust in client-supplied org/role (#306 + #307) ------------------

  it('renders the invitation’s org name from the DB, ignoring the client-supplied orgName', async () => {
    mockGetProfile.mockResolvedValueOnce(orgAdmin);
    mockQueryOne.mockResolvedValueOnce(orgInvitation);
    mockQueryOne.mockResolvedValueOnce(null);
    mockEmailSend.mockResolvedValueOnce({ id: 'email-id-4' });

    await handler(makeReq(clientBody) as any, makeCtx() as any);

    const sent = mockEmailSend.mock.calls[0][0];
    expect(sent.subject).toContain('Acme A/S');
    expect(sent.html).toContain('Acme A/S');
    expect(sent.html).not.toContain('Client-Supplied Org');
  });

  // #307: a hostile client role of 'platform_admin' must be ignored; the email
  // reflects the invitation's real role (learner) and stays an org invite. There
  // is no silent fallback because role now comes from the org_role enum column.
  it('ignores the client-supplied role and renders the invitation’s real role', async () => {
    mockGetProfile.mockResolvedValueOnce(orgAdmin);
    mockQueryOne.mockResolvedValueOnce(orgInvitation); // role: 'learner'
    mockQueryOne.mockResolvedValueOnce(null);
    mockEmailSend.mockResolvedValueOnce({ id: 'email-id-5' });

    await handler(makeReq(clientBody) as any, makeCtx() as any);

    const sent = mockEmailSend.mock.calls[0][0];
    // Danish default: learner label is "Kursist"; platform-admin text must be absent.
    expect(sent.subject).not.toContain('Platform Administrator');
    expect(sent.html).not.toContain('Platform Administrator');
    expect(sent.html).toContain('Kursist');
  });

  it('labels an org_admin invitation as Administrator', async () => {
    mockGetProfile.mockResolvedValueOnce(orgAdmin);
    mockQueryOne.mockResolvedValueOnce({ ...orgInvitation, role: 'org_admin' });
    mockQueryOne.mockResolvedValueOnce(null);
    mockEmailSend.mockResolvedValueOnce({ id: 'email-id-6' });

    await handler(makeReq(clientBody) as any, makeCtx() as any);

    expect(mockEmailSend.mock.calls[0][0].html).toContain('Administrator');
  });

  // ---- Invite-link validation ----------------------------------------------

  it('returns 400 when inviteLink is missing', async () => {
    mockGetProfile.mockResolvedValueOnce(platformAdmin);

    const res = await handler(
      makeReq({ ...clientBody, inviteLink: undefined }) as any,
      makeCtx() as any,
    );

    expect(res.status).toBe(400);
    expect(mockEmailSend).not.toHaveBeenCalled();
  });

  it('returns 400 for invite links from non-allowed domains', async () => {
    mockGetProfile.mockResolvedValueOnce(platformAdmin);

    const res = await handler(
      makeReq({ ...clientBody, inviteLink: 'https://evil.com/signup?invite=abc' }) as any,
      makeCtx() as any,
    );

    expect(res.status).toBe(400);
    expect(mockEmailSend).not.toHaveBeenCalled();
  });

  it('returns 400 when the invite link carries no invitation token', async () => {
    mockGetProfile.mockResolvedValueOnce(platformAdmin);

    const res = await handler(
      makeReq({ ...clientBody, inviteLink: 'https://ai-uddannelse.dk/signup' }) as any,
      makeCtx() as any,
    );

    expect(res.status).toBe(400);
    expect(mockEmailSend).not.toHaveBeenCalled();
  });

  // Regression (2026-07-22): until the #115 domain cutover the app runs on the
  // SWA host and mints invite links on that origin — the hardcoded
  // ai-uddannelse.dk-only allowlist 400'd every invite email in prod.
  it('accepts invite links on any ALLOWED_ORIGINS host', async () => {
    process.env.ALLOWED_ORIGINS = 'https://black-forest-0d7f96c03.7.azurestaticapps.net';
    mockGetProfile.mockResolvedValueOnce(platformAdmin);
    mockQueryOne.mockResolvedValueOnce({ ...orgInvitation, caller_is_org_admin: false });
    mockQueryOne.mockResolvedValueOnce(null);
    mockEmailSend.mockResolvedValueOnce({ id: 'email-id-7' });

    const res = await handler(
      makeReq({
        ...clientBody,
        inviteLink: 'https://black-forest-0d7f96c03.7.azurestaticapps.net/signup?invite=link-abc',
      }) as any,
      makeCtx() as any,
    );

    expect(res.status).toBe(200);
    expect(mockEmailSend).toHaveBeenCalledOnce();
  });

  it('still rejects non-allowed domains when ALLOWED_ORIGINS is set', async () => {
    process.env.ALLOWED_ORIGINS = 'https://black-forest-0d7f96c03.7.azurestaticapps.net';
    mockGetProfile.mockResolvedValueOnce(platformAdmin);

    const res = await handler(
      makeReq({ ...clientBody, inviteLink: 'https://evil.com/signup?invite=abc' }) as any,
      makeCtx() as any,
    );

    expect(res.status).toBe(400);
    expect(mockEmailSend).not.toHaveBeenCalled();
  });

  // ---- Language resolution (#231) ------------------------------------------

  it("uses the existing recipient's preferred_language over the inviter's pick", async () => {
    mockGetProfile.mockResolvedValueOnce(orgAdmin);
    mockQueryOne.mockResolvedValueOnce(orgInvitation);
    mockQueryOne.mockResolvedValueOnce({ preferred_language: 'en' });
    mockEmailSend.mockResolvedValueOnce({ id: 'email-id-8' });

    const res = await handler(makeReq({ ...clientBody, inviterLanguage: 'da' }) as any, makeCtx() as any);
    const sent = mockEmailSend.mock.calls[0][0];

    expect(res.status).toBe(200);
    expect(sent.html).toContain('lang="en"');
    expect(sent.html).toContain("You're invited!");
    expect(sent.subject).toContain('You have been invited to Acme A/S');
  });

  it("uses the inviter's pick when the recipient has no profile", async () => {
    mockGetProfile.mockResolvedValueOnce(orgAdmin);
    mockQueryOne.mockResolvedValueOnce(orgInvitation);
    mockQueryOne.mockResolvedValueOnce(undefined);
    mockEmailSend.mockResolvedValueOnce({ id: 'email-id-9' });

    const res = await handler(makeReq({ ...clientBody, inviterLanguage: 'en' }) as any, makeCtx() as any);

    expect(res.status).toBe(200);
    expect(mockEmailSend.mock.calls[0][0].html).toContain('lang="en"');
  });

  it('falls back to Danish when no profile and no inviter pick', async () => {
    mockGetProfile.mockResolvedValueOnce(orgAdmin);
    mockQueryOne.mockResolvedValueOnce(orgInvitation);
    mockQueryOne.mockResolvedValueOnce(undefined);
    mockEmailSend.mockResolvedValueOnce({ id: 'email-id-10' });

    // clientBody carries no inviterLanguage.
    const res = await handler(makeReq(clientBody) as any, makeCtx() as any);

    expect(res.status).toBe(200);
    expect(mockEmailSend.mock.calls[0][0].html).toContain('lang="da"');
    expect(mockEmailSend.mock.calls[0][0].html).toContain('Du er inviteret!');
  });

  it('still sends when the invitee language lookup fails (best-effort)', async () => {
    mockGetProfile.mockResolvedValueOnce(orgAdmin);
    mockQueryOne.mockResolvedValueOnce(orgInvitation);
    mockQueryOne.mockRejectedValueOnce(new Error('db hiccup')); // language lookup fails
    mockEmailSend.mockResolvedValueOnce({ id: 'email-id-11' });

    const res = await handler(makeReq(clientBody) as any, makeCtx() as any);

    expect(res.status).toBe(200);
    expect(mockEmailSend).toHaveBeenCalledOnce();
  });

  // ---- Delivery reporting (#200) -------------------------------------------

  // The SDK resolves `{ data: null, error }` for every non-2xx (bad key,
  // unverified domain, quota) rather than rejecting.
  it('reports a Resend-rejected send as a failure instead of success', async () => {
    mockGetProfile.mockResolvedValueOnce(orgAdmin);
    mockQueryOne.mockResolvedValueOnce(orgInvitation);
    mockQueryOne.mockResolvedValueOnce(null);
    mockEmailSend.mockResolvedValueOnce({ data: null, error: { message: 'Invalid recipient' } });
    const ctx = makeCtx();

    const res = await handler(makeReq(clientBody) as any, ctx as any);
    const body = JSON.parse(res.body);

    expect(res.status).toBe(200);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Email delivery failed');
    expect(ctx.error).toHaveBeenCalled();
  });

  it('reports a thrown send as a failure', async () => {
    mockGetProfile.mockResolvedValueOnce(orgAdmin);
    mockQueryOne.mockResolvedValueOnce(orgInvitation);
    mockQueryOne.mockResolvedValueOnce(null);
    mockEmailSend.mockRejectedValueOnce(new Error('network down'));
    const ctx = makeCtx();

    const res = await handler(makeReq(clientBody) as any, ctx as any);
    const body = JSON.parse(res.body);

    expect(res.status).toBe(200);
    expect(body.success).toBe(false);
    expect(ctx.error).toHaveBeenCalled();
  });

  // ---- Injection hardening (#195) ------------------------------------------

  // Org names are admin-supplied; a malicious one must not plant markup in a
  // mail sent from the trusted no-reply address.
  it('escapes the org name (from the DB) before it reaches the email body', async () => {
    mockGetProfile.mockResolvedValueOnce(orgAdmin);
    mockQueryOne.mockResolvedValueOnce({ ...orgInvitation, org_name: '<script>alert(1)</script>Evil' });
    mockQueryOne.mockResolvedValueOnce(null);
    mockEmailSend.mockResolvedValueOnce({ id: 'email-id-12' });

    await handler(makeReq(clientBody) as any, makeCtx() as any);
    const html = mockEmailSend.mock.calls[0][0].html as string;

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;Evil');
  });

  // Only the hostname is validated, so the link's path/query arrive verbatim — a
  // quote would otherwise break out of the href attribute.
  it('escapes the invite link so it cannot break out of the href attribute', async () => {
    mockGetProfile.mockResolvedValueOnce(orgAdmin);
    mockQueryOne.mockResolvedValueOnce(orgInvitation);
    mockQueryOne.mockResolvedValueOnce(null);
    mockEmailSend.mockResolvedValueOnce({ id: 'email-id-13' });

    await handler(
      makeReq({
        ...clientBody,
        inviteLink: 'https://ai-uddannelse.dk/signup?invite=link-abc"><img src=x onerror=alert(1)>',
      }) as any,
      makeCtx() as any,
    );
    const html = mockEmailSend.mock.calls[0][0].html as string;

    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&quot;&gt;&lt;img');
  });

  // Subjects are plain text (not HTML-escaped) but a CR/LF would let an org name
  // inject extra mail headers.
  it('keeps the subject plain text and strips CR/LF from it', async () => {
    mockGetProfile.mockResolvedValueOnce(orgAdmin);
    mockQueryOne.mockResolvedValueOnce({ ...orgInvitation, org_name: 'Acme & Co\r\nBcc: attacker@evil.com' });
    mockQueryOne.mockResolvedValueOnce(null);
    mockEmailSend.mockResolvedValueOnce({ id: 'email-id-14' });

    await handler(makeReq(clientBody) as any, makeCtx() as any);
    const subject = mockEmailSend.mock.calls[0][0].subject as string;

    expect(subject).toContain('Acme & Co');
    expect(subject).not.toMatch(/[\r\n]/);
  });

  it('does not reference supabase storage in the logo URL', async () => {
    mockGetProfile.mockResolvedValueOnce(orgAdmin);
    mockQueryOne.mockResolvedValueOnce(orgInvitation);
    mockQueryOne.mockResolvedValueOnce(null);
    mockEmailSend.mockResolvedValueOnce({ id: 'email-id-15' });

    await handler(makeReq(clientBody) as any, makeCtx() as any);

    expect(mockEmailSend.mock.calls[0][0].html).not.toContain('supabase.co');
  });
});
