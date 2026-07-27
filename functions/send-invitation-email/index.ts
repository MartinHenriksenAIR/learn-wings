// Hand-rolled (not shared/endpoint.ts): bespoke authz (org-admin in ANY org, oid-only lookup) and a custom 403 body.
import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { authenticate, AuthError } from '../shared/auth';
import { queryOne } from '../shared/db';
import { corsPreflightResponse, corsResponse } from '../shared/cors';
import { internalError } from '../shared/errors';
import { escapeHtml, sendBestEffort } from '../shared/resend';
import { EMAIL_STRINGS, resolveEmailLanguage, type EmailLanguage } from './strings';

// Link targets are restricted to hosts the app actually runs on: the production
// domain (post-#115 cutover) plus every host in ALLOWED_ORIGINS — the same env
// CORS trusts, which is what the frontend's invite links are minted on until
// the cutover sets VITE_PLATFORM_BASE_URL. Computed per-request so tests can
// vary the env; Lovable preview URLs remain excluded.
function allowedLinkDomains(): string[] {
  const originHosts = (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .filter(Boolean)
    .map((origin) => {
      try {
        return new URL(origin).hostname;
      } catch {
        return null;
      }
    })
    .filter((host): host is string => host !== null);
  return ['ai-uddannelse.dk', ...originHosts];
}

interface InvitationEmailRequest {
  email: string;
  orgName: string | null;
  role: string;
  inviteLink: string;
  inviterLanguage?: 'da' | 'en';
}

function generateEmailHtml({
  orgName,
  roleLabel,
  inviteLink,
  isPlatformAdmin,
  lang,
  s,
}: {
  orgName: string | null;
  roleLabel: string;
  inviteLink: string;
  isPlatformAdmin: boolean;
  lang: EmailLanguage;
  s: typeof EMAIL_STRINGS[EmailLanguage];
}): string {
  // `orgName` is caller-supplied and `inviteLink` is only validated by hostname —
  // its path/query reach the body verbatim. Both are escaped before they touch
  // the markup so neither can break out of the attribute or inject a link (#195).
  // `roleLabel` comes from the EMAIL_STRINGS whitelist, so it needs no escaping.
  // The truthy guard also covers a null/undefined org name (unused on the
  // platform-admin path) so escapeHtml is never handed a non-string.
  const safeOrgName = orgName ? escapeHtml(orgName) : null;
  const safeInviteLink = escapeHtml(inviteLink);
  const welcomeMessage = isPlatformAdmin ? s.welcomePlatformAdmin : s.welcomeOrg(roleLabel, safeOrgName);
  const logoUrl = `${process.env.STATIC_ASSETS_BASE_URL ?? 'https://ai-uddannelse.dk'}/logo-light.png`;

  return `
<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${s.documentTitle}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f4f4f5;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #f4f4f5;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          <tr>
            <td style="padding: 40px 40px 20px; text-align: center; border-bottom: 1px solid #e4e4e7;">
              <img src="${logoUrl}" alt="AI Uddannelse" style="height: 50px; width: auto;" />
              <p style="margin: 12px 0 0; font-size: 14px; color: #71717a;">${s.tagline}</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 40px;">
              <h2 style="margin: 0 0 16px; font-size: 20px; font-weight: 600; color: #18181b;">${s.heading}</h2>
              <p style="margin: 0 0 24px; font-size: 16px; line-height: 1.6; color: #3f3f46;">${welcomeMessage}</p>
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-bottom: 24px;">
                <tr>
                  <td style="background-color: #f4f4f5; padding: 8px 16px; border-radius: 6px;">
                    <span style="font-size: 14px; font-weight: 500; color: #3f3f46;">${s.yourRole} <strong style="color: #18181b;">${roleLabel}</strong></span>
                  </td>
                </tr>
              </table>
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                <tr>
                  <td style="text-align: center; padding: 8px 0;">
                    <a href="${safeInviteLink}" style="display: inline-block; padding: 14px 32px; background-color: #18181b; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 8px;">${s.cta}</a>
                  </td>
                </tr>
              </table>
              <p style="margin: 24px 0 0; font-size: 14px; color: #71717a; text-align: center;">${s.copyLinkHint}</p>
              <p style="margin: 8px 0 0; font-size: 12px; word-break: break-all; color: #a1a1aa; text-align: center;">${safeInviteLink}</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 20px 40px 40px; border-top: 1px solid #e4e4e7;">
              <p style="margin: 0 0 8px; font-size: 12px; color: #a1a1aa; text-align: center;">${s.expiryNote}</p>
              <p style="margin: 0; font-size: 12px; color: #a1a1aa; text-align: center;">${s.ignoreNote}</p>
            </td>
          </tr>
        </table>
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 600px; margin: 20px auto 0;">
          <tr>
            <td style="text-align: center;">
              <p style="margin: 0; font-size: 12px; color: #a1a1aa;">© ${new Date().getFullYear()} AI Uddannelse. ${s.rightsReserved}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();
}

async function handler(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return corsPreflightResponse(origin);
  try {
    const user = await authenticate(req);

    const profile = await queryOne<{ is_platform_admin: boolean; is_org_admin: boolean }>(
      `SELECT p.is_platform_admin,
        EXISTS(
          SELECT 1 FROM org_memberships om WHERE om.user_id = p.id AND om.role = 'org_admin' AND om.status = 'active'
        ) AS is_org_admin
       FROM profiles p WHERE p.entra_oid = $1`,
      [user.id]
    );
    if (!profile?.is_platform_admin && !profile?.is_org_admin) {
      return corsResponse(origin, 403, { error: 'Forbidden: Only admins can send invitations' });
    }

    const { email, orgName, role, inviteLink, inviterLanguage } = await req.json() as InvitationEmailRequest;

    if (!email || !inviteLink) {
      return corsResponse(origin, 400, { error: 'Missing required fields: email and inviteLink' });
    }

    try {
      const linkUrl = new URL(inviteLink);
      if (!allowedLinkDomains().includes(linkUrl.hostname)) {
        return corsResponse(origin, 400, { error: 'Invalid invite link domain' });
      }
    } catch {
      return corsResponse(origin, 400, { error: 'Invalid invite link format' });
    }

    const isPlatformAdminInvite = role === 'platform_admin';

    // An org invite names the org in its subject and body; without a name the
    // template would render the literal string "null". The UI only ever passes
    // a null org name when its org context is missing (a broken state), so a
    // 400 surfaces that instead of sending a malformed email. Platform-admin
    // invites carry no org and are exempt.
    if (!isPlatformAdminInvite && !orgName) {
      return corsResponse(origin, 400, { error: 'Missing required field: orgName for organization invitations' });
    }

    // Resolve email language (ADR-0016 cat.3): existing recipient's stored
    // preference wins; else the inviter's dialog pick; else default 'da'.
    // Best-effort — a lookup failure must not block the send.
    let profileLang: string | null = null;
    try {
      const invitee = await queryOne<{ preferred_language: string }>(
        `SELECT preferred_language FROM profiles
         WHERE lower(email) = lower($1) AND preferred_language IS NOT NULL
         ORDER BY created_at ASC LIMIT 1`,
        [email],
      );
      profileLang = invitee?.preferred_language ?? null;
    } catch (lookupErr) {
      context.warn?.('invitee language lookup failed; falling back', lookupErr);
    }
    const lang = resolveEmailLanguage(inviterLanguage, profileLang);
    const s = EMAIL_STRINGS[lang];

    const roleLabel =
      role === 'org_admin' ? s.roleLabels.org_admin
      : role === 'platform_admin' ? s.roleLabels.platform_admin
      : s.roleLabels.learner;
    const subject = isPlatformAdminInvite ? s.subjectPlatformAdmin : s.subjectOrg(orgName);
    const html = generateEmailHtml({ orgName, roleLabel, inviteLink, isPlatformAdmin: isPlatformAdminInvite, lang, s });

    // The Resend SDK resolves `{ data: null, error }` instead of rejecting on a
    // failed send, so a bad address, unverified domain or quota breach used to
    // return `success: true` and the admin was never told to share the link
    // manually. `sendBestEffort` is the shared path that reads `error`.
    const sent = await sendBestEffort(context, {
      recipient: email,
      subject,
      html,
      skipLog: `send-invitation-email: no recipient address for invite to ${orgName ?? 'platform'}`,
      failLog: 'send-invitation-email: Resend rejected the invitation email',
    });
    // 200, not 5xx: the invitation itself was already created by the caller and
    // stands — only delivery failed. `success: false` is the partial-success
    // shape the client reads to tell the admin to share the link manually.
    if (!sent) {
      return corsResponse(origin, 200, { success: false, error: 'Email delivery failed' });
    }

    return corsResponse(origin, 200, { success: true });
  } catch (err: unknown) {
    if (err instanceof AuthError) return corsResponse(origin, 401, { error: err.message });
    return internalError(context, origin, err);
  }
}

export default handler;
app.http('send-invitation-email', { methods: ['POST', 'OPTIONS'], authLevel: 'anonymous', handler });
