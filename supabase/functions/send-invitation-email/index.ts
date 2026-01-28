import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { Resend } from "https://esm.sh/resend@4.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

// Allowed origins for CORS
const allowedOrigins = [
  'https://learn-wings.lovable.app',
  'https://id-preview--ee335e84-7b72-46fe-bdb4-cd3d716c9247.lovable.app',
  'https://ee335e84-7b72-46fe-bdb4-cd3d716c9247.lovableproject.com',
];

function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') || '';
  const allowedOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
    'Access-Control-Allow-Credentials': 'true',
  };
}

interface InvitationEmailRequest {
  email: string;
  orgName: string | null;
  role: string; // 'learner' | 'org_admin' | 'platform_admin'
  inviteLink: string;
}

const handler = async (req: Request): Promise<Response> => {
  const corsHeaders = getCorsHeaders(req);
  
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Validate authorization
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      console.error('Missing or invalid Authorization header');
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    // Validate user using getUser
    const { data: userData, error: userError } = await supabase.auth.getUser();
    
    if (userError || !userData?.user) {
      console.error('Failed to get user:', userError);
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = userData.user.id;
    console.log('Sending invitation email for user:', userId);

    // Check if user is platform admin or org admin
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_platform_admin')
      .eq('id', userId)
      .single();

    const isPlatformAdmin = profile?.is_platform_admin === true;

    // If not platform admin, check if they're an org admin
    if (!isPlatformAdmin) {
      const { data: memberships } = await supabase
        .from('org_memberships')
        .select('role')
        .eq('user_id', userId)
        .eq('status', 'active')
        .eq('role', 'org_admin');

      const isOrgAdmin = memberships && memberships.length > 0;

      if (!isOrgAdmin) {
        console.error('User is not authorized to send invitations:', userId);
        return new Response(
          JSON.stringify({ success: false, error: 'Forbidden: Only admins can send invitations' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    const { email, orgName, role, inviteLink }: InvitationEmailRequest = await req.json();

    // Validate required fields
    if (!email || !inviteLink) {
      throw new Error("Missing required fields: email and inviteLink are required");
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new Error("Invalid email format");
    }

    // Validate inviteLink is from allowed domains
    const allowedLinkDomains = [
      'learn-wings.lovable.app',
      'id-preview--ee335e84-7b72-46fe-bdb4-cd3d716c9247.lovable.app',
      'ai-uddannelse.dk',
    ];
    try {
      const linkUrl = new URL(inviteLink);
      if (!allowedLinkDomains.includes(linkUrl.hostname)) {
        console.error('Invalid invite link domain:', linkUrl.hostname);
        throw new Error("Invalid invite link domain");
      }
    } catch (urlError) {
      console.error('Invalid invite link URL:', inviteLink);
      throw new Error("Invalid invite link format");
    }

    // Determine email content based on invitation type
    const isPlatformAdminInvite = role === 'platform_admin';
    const roleLabel = role === 'org_admin' ? 'Administrator' : role === 'platform_admin' ? 'Platform Administrator' : 'Learner';
    
    const subject = isPlatformAdminInvite
      ? "Du er blevet inviteret som Platform Administrator på AIR Academy"
      : `Du er blevet inviteret til ${orgName} på AIR Academy`;

    const html = generateEmailHtml({
      email,
      orgName,
      roleLabel,
      inviteLink,
      isPlatformAdmin: isPlatformAdminInvite,
    });

    const emailResponse = await resend.emails.send({
      from: "AIR Academy <no-reply@ai-uddannelse.dk>",
      to: [email],
      subject,
      html,
    });

    console.log("Invitation email sent successfully:", emailResponse);

    return new Response(JSON.stringify({ success: true, data: emailResponse }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    console.error("Error in send-invitation-email function:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

function generateEmailHtml({
  email,
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
    ? "Du er blevet inviteret til at blive Platform Administrator på AIR Academy."
    : `Du er blevet inviteret til at blive ${roleLabel} hos <strong>${orgName}</strong> på AIR Academy.`;

  return `
<!DOCTYPE html>
<html lang="da">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Invitation til AIR Academy</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f4f4f5;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: #f4f4f5;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          <!-- Header -->
          <tr>
            <td style="padding: 40px 40px 20px; text-align: center; border-bottom: 1px solid #e4e4e7;">
              <h1 style="margin: 0; font-size: 24px; font-weight: 700; color: #18181b;">
                AIR Academy
              </h1>
              <p style="margin: 8px 0 0; font-size: 14px; color: #71717a;">
                AI Uddannelse til Virksomheder
              </p>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 40px;">
              <h2 style="margin: 0 0 16px; font-size: 20px; font-weight: 600; color: #18181b;">
                Du er inviteret! 🎉
              </h2>
              <p style="margin: 0 0 24px; font-size: 16px; line-height: 1.6; color: #3f3f46;">
                ${welcomeMessage}
              </p>
              
              <!-- Role Badge -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-bottom: 24px;">
                <tr>
                  <td style="background-color: #f4f4f5; padding: 8px 16px; border-radius: 6px;">
                    <span style="font-size: 14px; font-weight: 500; color: #3f3f46;">
                      Din rolle: <strong style="color: #18181b;">${roleLabel}</strong>
                    </span>
                  </td>
                </tr>
              </table>
              
              <!-- CTA Button -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                <tr>
                  <td style="text-align: center; padding: 8px 0;">
                    <a href="${inviteLink}" style="display: inline-block; padding: 14px 32px; background-color: #18181b; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 8px;">
                      Accepter invitation
                    </a>
                  </td>
                </tr>
              </table>
              
              <p style="margin: 24px 0 0; font-size: 14px; color: #71717a; text-align: center;">
                Eller kopier dette link til din browser:
              </p>
              <p style="margin: 8px 0 0; font-size: 12px; word-break: break-all; color: #a1a1aa; text-align: center;">
                ${inviteLink}
              </p>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="padding: 20px 40px 40px; border-top: 1px solid #e4e4e7;">
              <p style="margin: 0 0 8px; font-size: 12px; color: #a1a1aa; text-align: center;">
                Denne invitation udløber om 7 dage.
              </p>
              <p style="margin: 0; font-size: 12px; color: #a1a1aa; text-align: center;">
                Hvis du ikke forventede denne invitation, kan du ignorere denne email.
              </p>
            </td>
          </tr>
        </table>
        
        <!-- Legal Footer -->
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 600px; margin: 20px auto 0;">
          <tr>
            <td style="text-align: center;">
              <p style="margin: 0; font-size: 12px; color: #a1a1aa;">
                © ${new Date().getFullYear()} AIR Academy. Alle rettigheder forbeholdes.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

serve(handler);
