import type { InvocationContext } from '@azure/functions';
import { Resend } from 'resend';

// Lazy init — constructing Resend without an API key throws at load time, which
// would deregister ALL functions (functions.md).
let resendClient: Resend | null = null;
function getResend(): Resend {
  if (!resendClient) resendClient = new Resend(process.env.RESEND_API_KEY);
  return resendClient;
}

// The single branded sender for every seat-request email.
const FROM_ADDRESS = 'AI Uddannelse <no-reply@ai-uddannelse.dk>';

// Subjects are raw plain text (never HTML-escaped — that is bodies-only). Strip
// CR/LF so an org/requester name can't inject extra mail headers (LOW hardening).
function sanitizeSubject(subject: string): string {
  return subject.replace(/[\r\n]+/g, ' ');
}

interface BestEffortEmail {
  recipient: string | null; // null → skip the send
  subject: string;
  html: string;
  skipLog: string; // info-logged when the recipient is null
  failLog: string; // error-logged when the Resend send throws
}

// Best-effort send shared by every seat-request notification: a null recipient
// is skipped and a Resend failure is swallowed — both are logged, never thrown.
// The persisted request/fulfilment must never be blocked by mail delivery.
async function sendBestEffort(context: InvocationContext, email: BestEffortEmail): Promise<void> {
  if (!email.recipient) {
    context.log(email.skipLog);
    return;
  }
  try {
    await getResend().emails.send({
      from: FROM_ADDRESS,
      to: [email.recipient],
      subject: sanitizeSubject(email.subject),
      html: email.html,
    });
  } catch (err) {
    context.error(email.failLog, err);
  }
}

export interface SeatRequestEmailParams {
  recipient: string;
  orgName: string;
  requesterName: string;
  requesterEmail: string;
  seatLimit: number | null;
  usedSeats: number;
  additionalSeats: number;
  unitPrice: number;
  currency: string;
  requestId: string;
  createdAt: string;
}

export function renderSeatRequestEmail(p: SeatRequestEmailParams): { subject: string; html: string } {
  // User- and org-supplied strings are HTML-escaped before interpolation to
  // prevent HTML injection into the platform admin's mail client (#195).
  const org = escapeHtml(p.orgName);
  const requesterName = escapeHtml(p.requesterName);
  const requesterEmail = escapeHtml(p.requesterEmail);
  const currency = escapeHtml(p.currency);
  const requestId = escapeHtml(p.requestId);
  const createdAt = escapeHtml(p.createdAt);
  const total = p.additionalSeats * p.unitPrice;
  const money = (n: number) => `${n.toLocaleString('da-DK')} ${currency}`;
  const subject = `Anmodning om ${p.additionalSeats} ekstra pladser — ${p.orgName}`;
  const html = `
    <h2>Ny anmodning om ekstra pladser</h2>
    <p><strong>Organisation:</strong> ${org}</p>
    <p><strong>Anmodet af:</strong> ${requesterName} (${requesterEmail})</p>
    <p><strong>Nuværende forbrug:</strong> ${p.usedSeats} pladser brugt af ${p.seatLimit ?? 'ubegrænset'}</p>
    <p><strong>Ønsket antal ekstra pladser:</strong> ${p.additionalSeats}</p>
    <p><strong>Pris:</strong> ${p.additionalSeats} × ${money(p.unitPrice)}/år =
       <strong>${money(total)}/år</strong> ekskl. moms (+ 25% moms tilføjes på fakturaen)</p>
    <p style="color:#777;font-size:12px">Anmodnings-ID: ${requestId} · ${createdAt}</p>
  `;
  return { subject, html };
}

// Best-effort: the request row is already committed and visible in-app. A failed
// email is logged, never thrown — we must not lose the persisted request.
export async function notifySeatRequest(context: InvocationContext, p: SeatRequestEmailParams): Promise<void> {
  const { subject, html } = renderSeatRequestEmail(p);
  await sendBestEffort(context, {
    recipient: p.recipient,
    subject,
    html,
    skipLog: 'seat-request notification email skipped — no recipient',
    failLog: 'seat-request notification email failed',
  });
}

// --- Requester-facing emails (#193) --------------------------------------
// These go to the requesting org admin, not the platform admin. They embed
// user- and org-supplied strings, so every interpolated string is HTML-escaped
// via this local helper — as is the platform-admin template above (#195).
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Danish is the default: only an explicit 'en' preference selects English.
function isEnglish(language: string | null): boolean {
  return language === 'en';
}

export interface SeatRequestReceivedParams {
  recipient: string | null;      // requester's email; null → skip the send
  orgName: string;
  additionalSeats: number;
  language: string | null;       // requester's preferred_language ('en' | 'da' | null)
}

export interface SeatRequestFulfilledParams {
  recipient: string | null;
  orgName: string;
  additionalSeats: number;
  seatLimit: number;
  language: string | null;
}

export function renderSeatRequestReceivedEmail(p: SeatRequestReceivedParams): { subject: string; html: string } {
  // Subjects are plain text — only HTML bodies get escaped (matches renderSeatRequestEmail).
  const org = escapeHtml(p.orgName);
  const n = p.additionalSeats;
  if (isEnglish(p.language)) {
    return {
      subject: `Request received — ${p.orgName}`,
      html: `
    <h2>Request received</h2>
    <p>We have received your request for ${n} extra seat(s) for <strong>${org}</strong>.</p>
    <p>Your ${n} seat(s) will be available within 24 hours.</p>
  `,
    };
  }
  return {
    subject: `Anmodning modtaget — ${p.orgName}`,
    html: `
    <h2>Anmodning modtaget</h2>
    <p>Vi har modtaget din anmodning om ${n} ekstra plads(er) til <strong>${org}</strong>.</p>
    <p>Dine ${n} plads(er) vil være tilgængelige inden for 24 timer.</p>
  `,
  };
}

export function renderSeatRequestFulfilledEmail(p: SeatRequestFulfilledParams): { subject: string; html: string } {
  const org = escapeHtml(p.orgName);
  const n = p.additionalSeats;
  const limit = p.seatLimit;
  if (isEnglish(p.language)) {
    return {
      subject: `Your extra seats are now active — ${p.orgName}`,
      html: `
    <h2>Your extra seats are now active</h2>
    <p>Your ${n} extra seat(s) for <strong>${org}</strong> are now active.</p>
    <p>Your new seat limit is <strong>${limit}</strong>.</p>
  `,
    };
  }
  return {
    subject: `Dine ekstra pladser er nu aktive — ${p.orgName}`,
    html: `
    <h2>Dine ekstra pladser er nu aktive</h2>
    <p>Dine ${n} ekstra plads(er) til <strong>${org}</strong> er nu aktive.</p>
    <p>Din nye pladsgrænse er <strong>${limit}</strong>.</p>
  `,
  };
}

// Best-effort, same contract as notifySeatRequest: a null recipient or a Resend
// failure is logged and swallowed — the request/fulfilment must never be blocked.
export async function notifySeatRequestReceived(context: InvocationContext, p: SeatRequestReceivedParams): Promise<void> {
  const { subject, html } = renderSeatRequestReceivedEmail(p);
  await sendBestEffort(context, {
    recipient: p.recipient,
    subject,
    html,
    skipLog: 'seat-request received email skipped — requester has no email',
    failLog: 'seat-request received email failed',
  });
}

export async function notifySeatRequestFulfilled(context: InvocationContext, p: SeatRequestFulfilledParams): Promise<void> {
  const { subject, html } = renderSeatRequestFulfilledEmail(p);
  await sendBestEffort(context, {
    recipient: p.recipient,
    subject,
    html,
    skipLog: 'seat-request fulfilled email skipped — requester has no email',
    failLog: 'seat-request fulfilled email failed',
  });
}
