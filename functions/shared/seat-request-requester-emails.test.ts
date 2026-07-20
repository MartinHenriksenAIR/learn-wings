import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));
vi.mock('resend', () => ({ Resend: vi.fn().mockImplementation(() => ({ emails: { send: mockSend } })) }));

import {
  renderSeatRequestReceivedEmail,
  renderSeatRequestFulfilledEmail,
  notifySeatRequestReceived,
  notifySeatRequestFulfilled,
} from './seat-request-notify';

const ctx = () => ({ error: vi.fn(), log: vi.fn() }) as any;

describe('renderSeatRequestReceivedEmail — language pick & escaping', () => {
  it('renders Danish by default (null language)', () => {
    const { subject, html } = renderSeatRequestReceivedEmail({
      recipient: 'a@b.dk', orgName: 'Acme A/S', additionalSeats: 5, language: null,
    });
    expect(subject).toContain('Anmodning modtaget');
    expect(subject).toContain('Acme A/S');
    expect(html).toContain('Vi har modtaget');
    expect(html).toContain('5');
    expect(html).toContain('24 timer');
  });

  it("renders English for language 'en'", () => {
    const { subject, html } = renderSeatRequestReceivedEmail({
      recipient: 'a@b.dk', orgName: 'Acme', additionalSeats: 3, language: 'en',
    });
    expect(subject).toContain('Request received');
    expect(html).toContain('We have received');
    expect(html).toContain('24 hours');
    expect(html).toContain('3');
  });

  it('HTML-escapes an org name containing markup', () => {
    const { subject, html } = renderSeatRequestReceivedEmail({
      recipient: 'a@b.dk', orgName: '<script>&"x"', additionalSeats: 1, language: 'da',
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;&amp;&quot;x&quot;');
    expect(subject).toContain('&lt;script&gt;');
  });
});

describe('renderSeatRequestFulfilledEmail — language pick, seat limit & escaping', () => {
  it('renders Danish by default with the new seat limit', () => {
    const { subject, html } = renderSeatRequestFulfilledEmail({
      recipient: 'a@b.dk', orgName: 'Acme A/S', additionalSeats: 5, seatLimit: 15, language: null,
    });
    expect(subject).toContain('nu aktive');
    expect(html).toContain('Dine 5 ekstra');
    expect(html).toContain('15');
  });

  it("renders English for language 'en' with the new seat limit", () => {
    const { subject, html } = renderSeatRequestFulfilledEmail({
      recipient: 'a@b.dk', orgName: 'Acme', additionalSeats: 2, seatLimit: 12, language: 'en',
    });
    expect(subject).toContain('now active');
    expect(html).toContain('Your 2 extra');
    expect(html).toContain('new seat limit is <strong>12</strong>');
  });

  it('HTML-escapes the org name', () => {
    const { html } = renderSeatRequestFulfilledEmail({
      recipient: 'a@b.dk', orgName: '<b>Evil</b>', additionalSeats: 1, seatLimit: 5, language: 'da',
    });
    expect(html).not.toContain('<b>Evil</b>');
    expect(html).toContain('&lt;b&gt;Evil&lt;/b&gt;');
  });
});

describe('notifySeatRequestReceived', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends to the requester from the branded sender (happy path)', async () => {
    mockSend.mockResolvedValueOnce({ id: 'e1' });
    await notifySeatRequestReceived(ctx(), {
      recipient: 'requester@acme.dk', orgName: 'Acme', additionalSeats: 4, language: 'en',
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
    const arg = mockSend.mock.calls[0][0];
    expect(arg.from).toBe('AI Uddannelse <no-reply@ai-uddannelse.dk>');
    expect(arg.to).toEqual(['requester@acme.dk']);
    expect(arg.subject).toContain('Request received');
  });

  it('does not send and does not throw when the requester email is null', async () => {
    const context = ctx();
    await expect(notifySeatRequestReceived(context, {
      recipient: null, orgName: 'Acme', additionalSeats: 4, language: 'da',
    })).resolves.toBeUndefined();
    expect(mockSend).not.toHaveBeenCalled();
    expect(context.log).toHaveBeenCalled();
  });

  it('swallows a Resend failure — logs, never throws', async () => {
    const context = ctx();
    mockSend.mockRejectedValueOnce(new Error('resend down'));
    await expect(notifySeatRequestReceived(context, {
      recipient: 'requester@acme.dk', orgName: 'Acme', additionalSeats: 4, language: 'da',
    })).resolves.toBeUndefined();
    expect(context.error).toHaveBeenCalled();
  });
});

describe('notifySeatRequestFulfilled', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends to the requester from the branded sender (happy path)', async () => {
    mockSend.mockResolvedValueOnce({ id: 'e2' });
    await notifySeatRequestFulfilled(ctx(), {
      recipient: 'requester@acme.dk', orgName: 'Acme', additionalSeats: 4, seatLimit: 20, language: 'da',
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
    const arg = mockSend.mock.calls[0][0];
    expect(arg.from).toBe('AI Uddannelse <no-reply@ai-uddannelse.dk>');
    expect(arg.to).toEqual(['requester@acme.dk']);
    expect(arg.html).toContain('20');
  });

  it('does not send and does not throw when the requester email is null', async () => {
    const context = ctx();
    await expect(notifySeatRequestFulfilled(context, {
      recipient: null, orgName: 'Acme', additionalSeats: 4, seatLimit: 20, language: 'da',
    })).resolves.toBeUndefined();
    expect(mockSend).not.toHaveBeenCalled();
    expect(context.log).toHaveBeenCalled();
  });

  it('swallows a Resend failure — logs, never throws', async () => {
    const context = ctx();
    mockSend.mockRejectedValueOnce(new Error('resend down'));
    await expect(notifySeatRequestFulfilled(context, {
      recipient: 'requester@acme.dk', orgName: 'Acme', additionalSeats: 4, seatLimit: 20, language: 'da',
    })).resolves.toBeUndefined();
    expect(context.error).toHaveBeenCalled();
  });
});
