import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));
vi.mock('resend', () => ({ Resend: vi.fn().mockImplementation(() => ({ emails: { send: mockSend } })) }));

import { renderSeatRequestEmail, notifySeatRequest } from './seat-request-notify';

const params = {
  recipient: 'jacob@ai-raadgivning.dk', orgName: 'Acme A/S',
  requesterName: 'Mette Hansen', requesterEmail: 'mette@acme.dk',
  seatLimit: 10, usedSeats: 10, additionalSeats: 5,
  unitPrice: 1200, currency: 'DKK', requestId: 'req-1', createdAt: '2026-07-20T10:00:00.000Z',
};

describe('renderSeatRequestEmail', () => {
  it('includes org, requester, seat counts, and the request id', () => {
    const { subject, html } = renderSeatRequestEmail(params);
    expect(subject).toContain('Acme A/S');
    expect(subject).toContain('5');
    expect(html).toContain('Acme A/S');
    expect(html).toContain('Mette Hansen');
    expect(html).toContain('mette@acme.dk');
    expect(html).toContain('req-1');
  });
});

describe('notifySeatRequest', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends via Resend from the branded sender to the recipient', async () => {
    mockSend.mockResolvedValueOnce({ id: 'e1' });
    await notifySeatRequest({ error: vi.fn() } as any, params);
    expect(mockSend).toHaveBeenCalledTimes(1);
    const arg = mockSend.mock.calls[0][0];
    expect(arg.from).toBe('AI Uddannelse <no-reply@ai-uddannelse.dk>');
    expect(arg.to).toEqual(['jacob@ai-raadgivning.dk']);
  });

  it('never throws when Resend fails — logs instead', async () => {
    const context = { error: vi.fn() } as any;
    mockSend.mockRejectedValueOnce(new Error('resend down'));
    await expect(notifySeatRequest(context, params)).resolves.toBeUndefined();
    expect(context.error).toHaveBeenCalled();
  });
});
