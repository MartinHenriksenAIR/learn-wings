import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));
vi.mock('resend', () => ({ Resend: vi.fn().mockImplementation(() => ({ emails: { send: mockSend } })) }));

import { sendBestEffort } from './resend';

const email = {
  recipient: 'ops@example.com',
  subject: 'subject',
  html: '<p>body</p>',
  skipLog: 'skipped — no recipient',
  failLog: 'send failed',
};

const makeLog = () => ({ log: vi.fn(), error: vi.fn() });

describe('sendBestEffort — a Resend `{ error }` payload is a FAILURE, not a send', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns true only when Resend actually accepted the message', async () => {
    mockSend.mockResolvedValue({ data: { id: 'e1' }, error: null });
    const log = makeLog();

    await expect(sendBestEffort(log, email)).resolves.toBe(true);
    expect(log.error).not.toHaveBeenCalled();
  });

  it.each([
    ['401 — a missing or revoked API key', { name: 'missing_api_key', message: 'Missing API key' }],
    ['422 — an unverified from-domain', { name: 'validation_error', message: 'The domain is not verified' }],
    ['429 — the rate limit', { name: 'rate_limit_exceeded', message: 'Too many requests' }],
    ['a 5xx or an unreachable API (the SDK catches its own fetch)', {
      name: 'application_error',
      statusCode: null,
      message: 'Unable to fetch data. The request could not be resolved.',
    }],
  ])('returns false and logs on %s', async (_label, error) => {
    mockSend.mockResolvedValue({ data: null, error });
    const log = makeLog();

    await expect(sendBestEffort(log, email)).resolves.toBe(false);
    expect(log.error).toHaveBeenCalledWith(email.failLog, error);
  });

  it('still returns false when the SDK does reject — the catch stays as defence in depth', async () => {
    mockSend.mockRejectedValue(new Error('resend down'));
    const log = makeLog();

    await expect(sendBestEffort(log, email)).resolves.toBe(false);
    expect(log.error).toHaveBeenCalled();
  });

  it('skips without touching Resend when there is no recipient', async () => {
    const log = makeLog();

    await expect(sendBestEffort(log, { ...email, recipient: null })).resolves.toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
    expect(log.log).toHaveBeenCalledWith(email.skipLog);
    expect(log.error).not.toHaveBeenCalled();
  });
});
