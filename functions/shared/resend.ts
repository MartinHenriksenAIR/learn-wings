import { Resend } from 'resend';

/**
 * Lazy init — `new Resend(...)` at module load throws when RESEND_API_KEY is
 * absent, which crashes the worker entry and deregisters ALL functions
 * (`.claude/rules/functions.md`). Every caller must go through this.
 */
let resendClient: Resend | null = null;
export function getResend(): Resend {
  if (!resendClient) resendClient = new Resend(process.env.RESEND_API_KEY);
  return resendClient;
}

export const FROM_ADDRESS = 'AI Uddannelse <no-reply@ai-uddannelse.dk>';

// Subjects are raw plain text (never HTML-escaped — that is bodies-only). Strip
// CR/LF so an interpolated name can't inject extra mail headers.
function sanitizeSubject(subject: string): string {
  return subject.replace(/[\r\n]+/g, ' ');
}

/**
 * Escape a string before interpolating it into an email body. Anything that can
 * carry user- or org-supplied text — names, blob paths — goes through this, so a
 * payload cannot inject markup into the recipient's mail client (#195).
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * The slice of `InvocationContext` a best-effort send logs through. Structural
 * so a timer's own logger (e.g. `orphan-sweep`'s `SweepLogger`) satisfies it
 * without fabricating an `InvocationContext`.
 */
export interface EmailLogger {
  log(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export interface BestEffortEmail {
  /** null, an empty string, or an empty list → skip the send. */
  recipient: string | readonly string[] | null;
  subject: string;
  html: string;
  /** info-logged when there is no recipient to send to. */
  skipLog: string;
  /** error-logged when the send fails, by either route below. */
  failLog: string;
}

/**
 * Send one notification, never throwing: no recipient is skipped and a Resend
 * failure is swallowed — both are logged. The work that triggered the mail (a
 * persisted seat request, a completed sweep) must never be blocked by delivery.
 *
 * Returns true only when Resend accepted the message, so a caller that persists
 * "we told them" state stamps it on a real send rather than on an attempt.
 *
 * THE `{ error }` PAYLOAD IS THE REAL FAILURE PATH, NOT THE `catch`. The SDK's
 * `fetchRequest` resolves `{ data: null, error }` for every non-2xx (401 bad
 * key, 422 unverified domain, 429 rate limit, 5xx) AND wraps the whole `fetch`
 * in its own catch that returns the same shape on a network failure — so
 * `send()` essentially never rejects. Checking only the `catch` made this helper
 * return true for every one of those, which is exactly how a caller ends up
 * stamping "notified" on an email nobody received. The `catch` stays as defence
 * in depth (a bug in the SDK, a mock, a future version that does throw).
 */
export async function sendBestEffort(log: EmailLogger, email: BestEffortEmail): Promise<boolean> {
  const to = (typeof email.recipient === 'string' ? [email.recipient] : (email.recipient ?? []))
    .map((address) => address.trim())
    .filter((address) => address !== '');
  if (to.length === 0) {
    log.log(email.skipLog);
    return false;
  }
  try {
    const { error } = await getResend().emails.send({
      from: FROM_ADDRESS,
      to,
      subject: sanitizeSubject(email.subject),
      html: email.html,
    });
    if (error) {
      log.error(email.failLog, error);
      return false;
    }
    return true;
  } catch (err) {
    log.error(email.failLog, err);
    return false;
  }
}
