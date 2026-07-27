import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));
vi.mock('resend', () => ({ Resend: vi.fn().mockImplementation(() => ({ emails: { send: mockSend } })) }));

import { sendBestEffort } from './resend';

// The regression these pin: the Resend SDK (v6) NEVER REJECTS. Its `fetchRequest`
// resolves `{ data: null, error }` for every non-2xx and wraps its own `fetch` in
// a catch that returns the same shape on a network failure. A helper that only
// watched the `catch` therefore returned "sent" for a 401, a 422, a 429, a 5xx
// and an unreachable API alike — and callers stamp "we told them" on that return
// value, which is how a run gets marked notified on an email nobody received.
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
