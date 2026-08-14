import { Resend } from 'resend';

let resendClient: Resend | null = null;
export function getResend(): Resend {
  if (!resendClient) resendClient = new Resend(process.env.RESEND_API_KEY);
  return resendClient;
}

export const FROM_ADDRESS = 'AI Uddannelse <no-reply@ai-uddannelse.dk>';

function sanitizeSubject(subject: string): string {
  return subject.replace(/[\r\n]+/g, ' ');
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface EmailLogger {
  log(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export interface BestEffortEmail {
  recipient: string | readonly string[] | null;
  subject: string;
  html: string;
  skipLog: string;
  failLog: string;
}

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
