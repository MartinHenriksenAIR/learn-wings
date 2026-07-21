import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));
vi.mock('resend', () => ({ Resend: vi.fn().mockImplementation(() => ({ emails: { send: mockSend } })) }));

import {
  notifySeatRequest,
  notifySeatRequestReceived,
  notifySeatRequestFulfilled,
} from './seat-request-notify';

// The three notify* wrappers all route through one internal sendBestEffort()
// helper (#200). These tests pin its shared contract via the public surface:
// a null recipient is skipped, a Resend failure is swallowed, and the subject
// has CR/LF stripped before it reaches Resend.
const ctx = () => ({ error: vi.fn(), log: vi.fn() }) as any;

const adminParams = {
  recipient: 'admin@ai-uddannelse.dk', orgName: 'Acme A/S',
  requesterName: 'Mette Hansen', requesterEmail: 'mette@acme.dk',
  seatLimit: 10, usedSeats: 10, additionalSeats: 5,
  unitPrice: 1200, currency: 'DKK', requestId: 'req-1', createdAt: '2026-07-20T10:00:00.000Z',
};

describe('sendBestEffort — null recipient is skipped without throwing', () => {
  beforeEach(() => vi.clearAllMocks());

  it('skips the admin-notify path when the recipient is null (retrofitted guard)', async () => {
    const context = ctx();
    await expect(
      notifySeatRequest(context, { ...adminParams, recipient: null as unknown as string }),
    ).resolves.toBeUndefined();
    expect(mockSend).not.toHaveBeenCalled();
    expect(context.log).toHaveBeenCalled();
    expect(context.error).not.toHaveBeenCalled();
  });

  it('skips the received path when the recipient is null', async () => {
    const context = ctx();
    await expect(
      notifySeatRequestReceived(context, { recipient: null, orgName: 'Acme', additionalSeats: 4, language: 'da' }),
    ).resolves.toBeUndefined();
    expect(mockSend).not.toHaveBeenCalled();
    expect(context.log).toHaveBeenCalled();
  });

  it('skips the fulfilled path when the recipient is null', async () => {
    const context = ctx();
    await expect(
      notifySeatRequestFulfilled(context, {
        recipient: null, orgName: 'Acme', additionalSeats: 4, seatLimit: 20, language: 'da',
      }),
    ).resolves.toBeUndefined();
    expect(mockSend).not.toHaveBeenCalled();
    expect(context.log).toHaveBeenCalled();
  });
});

describe('sendBestEffort — a Resend failure is logged, never thrown', () => {
  beforeEach(() => vi.clearAllMocks());

  it('logs and swallows on the admin-notify path', async () => {
    const context = ctx();
    mockSend.mockRejectedValueOnce(new Error('resend down'));
    await expect(notifySeatRequest(context, adminParams)).resolves.toBeUndefined();
    expect(context.error).toHaveBeenCalled();
  });
});

describe('sendBestEffort — CR/LF is stripped from the subject (header-injection hardening)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('strips newlines an org name injects into the subject, keeping it raw plain text', async () => {
    mockSend.mockResolvedValueOnce({ id: 'e1' });
    await notifySeatRequestReceived(ctx(), {
      recipient: 'requester@acme.dk',
      orgName: 'Acme\r\nBcc: evil@example.com',
      additionalSeats: 2,
      language: 'da',
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
    const { subject } = mockSend.mock.calls[0][0];
    expect(subject).not.toContain('\n');
    expect(subject).not.toContain('\r');
    // Subject stays raw plain text — the org name is not HTML-escaped.
    expect(subject).toContain('Bcc: evil@example.com');
    expect(subject).not.toContain('&');
  });
});
