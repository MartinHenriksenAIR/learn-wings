import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { queryOne } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { Resend } from 'resend';

// Lazy init — constructing Resend without an API key throws, which would
// crash the worker entry point at load time and deregister ALL functions.
let resendClient: Resend | null = null;
function getResend(): Resend {
  if (!resendClient) resendClient = new Resend(process.env.RESEND_API_KEY);
  return resendClient;
}

// Only production domain allowed — Lovable preview URLs removed
const ALLOWED_LINK_DOMAINS = ['ai-uddannelse.dk'];

interface InvitationEmailRequest {
  email: string;
  orgName: string | null;
  role: string;
  inviteLink: string;
}

function generateEmailHtml({
  orgName,
  roleLabel,
  inviteLink,
  isPlatformAdmin,
}: {
  email: string;
  orgName: string | null;
  roleLabel: string;
  inviteLink: string;
  isPlatformAdmin: boolean;
}): string {
  const welcomeMessage = isPlatformAdmin
    ? 'Du er blevet inviteret til at blive Platform Administrator på AI Uddannelse.'
    : `Du er blevet inviteret til at blive ${roleLabel} hos <strong>${orgName}</strong> på AI Uddannelse.`;

  // Logo served from SWA static assets — not Supabase storage
  const logoUrl = `${process.env.STATIC_ASSETS_BASE_URL ?? 'https://ai-uddannelse.dk'}/logo-light.png`;

  return `
<!DOCTYPE html>
<html lang="da">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Invitation til AI Uddannelse</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f4f4f5;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #f4f4f5;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          <tr>
            <td style="padding: 40px 40px 20px; text-align: center; border-bottom: 1px solid #e4e4e7;">
              <img src="${logoUrl}" alt="AI Uddannelse" style="height: 50px; width: auto;" />
              <p style="margin: 12px 0 0; font-size: 14px; color: #71717a;">AI Uddannelse til Virksomheder</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 40px;">
              <h2 style="margin: 0 0 16px; font-size: 20px; font-weight: 600; color: #18181b;">Du er inviteret!</h2>
              <p style="margin: 0 0 24px; font-size: 16px; line-height: 1.6; color: #3f3f46;">${welcomeMessage}</p>
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-bottom: 24px;">
                <tr>
                  <td style="background-color: #f4f4f5; padding: 8px 16px; border-radius: 6px;">
                    <span style="font-size: 14px; font-weight: 500; color: #3f3f46;">Din rolle: <strong style="color: #18181b;">${roleLabel}</strong></span>
                  </td>
                </tr>
              </table>
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                <tr>
                  <td style="text-align: center; padding: 8px 0;">
                    <a href="${inviteLink}" style="display: inline-block; padding: 14px 32px; background-color: #18181b; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 8px;">Accepter invitation</a>
                  </td>
                </tr>
              </table>
              <p style="margin: 24px 0 0; font-size: 14px; color: #71717a; text-align: center;">Eller kopier dette link til din browser:</p>
              <p style="margin: 8px 0 0; font-size: 12px; word-break: break-all; color: #a1a1aa; text-align: center;">${inviteLink}</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 20px 40px 40px; border-top: 1px solid #e4e4e7;">
              <p style="margin: 0 0 8px; font-size: 12px; color: #a1a1aa; text-align: center;">Denne invitation udløber om 7 dage.</p>
              <p style="margin: 0; font-size: 12px; color: #a1a1aa; text-align: center;">Hvis du ikke forventede denne invitation, kan du ignorere denne email.</p>
            </td>
          </tr>
        </table>
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 600px; margin: 20px auto 0;">
          <tr>
            <td style="text-align: center;">
              <p style="margin: 0; font-size: 12px; color: #a1a1aa;">© ${new Date().getFullYear()} AI Uddannelse. Alle rettigheder forbeholdes.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();
}

async function handler(req: HttpRequest, _ctx: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin) as HttpResponseInit;
  try {
    const user = await authenticate(req);

    // Platform admin OR org admin can send invitations
    const profile = await queryOne<{ is_platform_admin: boolean; is_org_admin: boolean }>(
      `SELECT p.is_platform_admin,
        EXISTS(
          SELECT 1 FROM org_memberships om WHERE om.user_id = p.id AND om.role = 'org_admin' AND om.status = 'active'
        ) AS is_org_admin
       FROM profiles p WHERE p.entra_oid = $1`,
      [user.id]
    );
    if (!profile?.is_platform_admin && !profile?.is_org_admin) {
      return corsResponse(origin, 403, { error: 'Forbidden: Only admins can send invitations' }) as HttpResponseInit;
    }

    const { email, orgName, role, inviteLink } = await req.json() as InvitationEmailRequest;

    if (!email || !inviteLink) {
      return corsResponse(origin, 400, { error: 'Missing required fields: email and inviteLink' }) as HttpResponseInit;
    }

    // Validate invite link domain — only production domain allowed
    try {
      const linkUrl = new URL(inviteLink);
      if (!ALLOWED_LINK_DOMAINS.includes(linkUrl.hostname)) {
        return corsResponse(origin, 400, { error: 'Invalid invite link domain' }) as HttpResponseInit;
      }
    } catch {
      return corsResponse(origin, 400, { error: 'Invalid invite link format' }) as HttpResponseInit;
    }

    const isPlatformAdminInvite = role === 'platform_admin';
    const roleLabel = role === 'org_admin' ? 'Administrator' : role === 'platform_admin' ? 'Platform Administrator' : 'Learner';
    const subject = isPlatformAdminInvite
      ? 'Du er blevet inviteret som Platform Administrator på AI Uddannelse'
      : `Du er blevet inviteret til ${orgName} på AI Uddannelse`;

    const html = generateEmailHtml({ email, orgName, roleLabel, inviteLink, isPlatformAdmin: isPlatformAdminInvite });

    const emailResponse = await getResend().emails.send({
      from: 'AI Uddannelse <no-reply@ai-uddannelse.dk>',
      to: [email],
      subject,
      html,
    });

    return corsResponse(origin, 200, { success: true, data: emailResponse }) as HttpResponseInit;
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message }) as HttpResponseInit;
    return corsResponse(origin, 500, { error: err instanceof Error ? err.message : 'error' }) as HttpResponseInit;
  }
}

export default handler;
app.http('send-invitation-email', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
