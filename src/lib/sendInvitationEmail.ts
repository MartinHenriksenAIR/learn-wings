import { callApi } from '@/lib/api-client';
import { getInviteLink } from '@/lib/config';

interface SendInvitationEmailParams {
  email: string;
  orgName: string | null;
  role: 'learner' | 'org_admin' | 'platform_admin';
  linkId: string;
}

/**
 * Sends an invitation email via the send-invitation-email edge function.
 * This is a fire-and-forget operation - errors are logged but don't block the flow.
 */
export async function sendInvitationEmail({
  email,
  orgName,
  role,
  linkId,
}: SendInvitationEmailParams): Promise<{ success: boolean; error?: string }> {
  try {
    const inviteLink = getInviteLink(linkId);
    
    const data = await callApi<{ success: boolean; error?: string }>('/api/send-invitation-email', {
      email,
      orgName,
      role,
      inviteLink,
    });

    if (data && !data.success) {
      console.error('Email service returned error:', data.error);
      return { success: false, error: data.error };
    }

    return { success: true };
  } catch (err: any) {
    console.error('Exception sending invitation email:', err);
    return { success: false, error: err.message };
  }
}
