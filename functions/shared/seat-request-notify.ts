import type { InvocationContext } from '@azure/functions';
import { Resend } from 'resend';

// Lazy init — constructing Resend without an API key throws at load time, which
// would deregister ALL functions (functions.md).
let resendClient: Resend | null = null;
function getResend(): Resend {
  if (!resendClient) resendClient = new Resend(process.env.RESEND_API_KEY);
  return resendClient;
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
  const total = p.additionalSeats * p.unitPrice;
  const money = (n: number) => `${n.toLocaleString('da-DK')} ${p.currency}`;
  const subject = `Anmodning om ${p.additionalSeats} ekstra pladser — ${p.orgName}`;
  const html = `
    <h2>Ny anmodning om ekstra pladser</h2>
    <p><strong>Organisation:</strong> ${p.orgName}</p>
    <p><strong>Anmodet af:</strong> ${p.requesterName} (${p.requesterEmail})</p>
    <p><strong>Nuværende forbrug:</strong> ${p.usedSeats} pladser brugt af ${p.seatLimit ?? 'ubegrænset'}</p>
    <p><strong>Ønsket antal ekstra pladser:</strong> ${p.additionalSeats}</p>
    <p><strong>Pris:</strong> ${p.additionalSeats} × ${money(p.unitPrice)}/år =
       <strong>${money(total)}/år</strong> ekskl. moms (+ 25% moms tilføjes på fakturaen)</p>
    <p style="color:#777;font-size:12px">Anmodnings-ID: ${p.requestId} · ${p.createdAt}</p>
  `;
  return { subject, html };
}

// Best-effort: the request row is already committed and visible in-app. A failed
// email is logged, never thrown — we must not lose the persisted request.
export async function notifySeatRequest(context: InvocationContext, p: SeatRequestEmailParams): Promise<void> {
  try {
    const { subject, html } = renderSeatRequestEmail(p);
    await getResend().emails.send({
      from: 'AI Uddannelse <no-reply@ai-uddannelse.dk>',
      to: [p.recipient],
      subject,
      html,
    });
  } catch (err) {
    context.error('seat-request notification email failed', err);
  }
}
