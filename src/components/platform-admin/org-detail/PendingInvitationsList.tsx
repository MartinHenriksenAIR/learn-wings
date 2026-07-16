import { useTranslation } from 'react-i18next';
import { Mail, Copy, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Invitation } from '@/lib/types';

interface PendingInvitationsListProps {
  invitations: Invitation[];
  /** Returns whether the given link id is currently in its "Copied!" flash. */
  isCopied: (linkId: string) => boolean;
  onCopy: (linkId: string) => void;
  onCancel: (invitationId: string) => void;
}

/**
 * Pending-invitations list with the in-button "Copied!" morph (copy stays
 * toast-free per the existing policy) and a cancel action.
 */
export function PendingInvitationsList({
  invitations,
  isCopied,
  onCopy,
  onCancel,
}: PendingInvitationsListProps) {
  const { t } = useTranslation();

  return (
    <>
      <h2 className="mb-3 text-[17px] font-extrabold">{t('orgDetail.pendingInvitations')}</h2>
      <div className="mb-6 overflow-hidden rounded-2xl border border-border bg-card">
        {invitations.map((invitation) => {
          const copied = isCopied(invitation.link_id);
          return (
            <div
              key={invitation.id}
              className="flex items-center gap-3.5 border-b border-[#f3f4f8] px-5 py-3 last:border-b-0"
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#f3f4f8] text-[#9aa0af]">
                <Mail className="h-[15px] w-[15px]" aria-hidden="true" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[13px] font-bold">{invitation.email}</span>
                <span className="text-[11.5px] text-[#9aa0af]">
                  {t('orgDetail.expiresOn', { date: new Date(invitation.expires_at).toLocaleDateString() })}
                </span>
              </span>
              <span
                className={cn(
                  'inline-flex items-center rounded-[7px] px-2.5 py-1 text-[11px] font-bold',
                  invitation.role === 'org_admin' ? 'bg-accent text-primary' : 'bg-[#f3f4f8] text-[#686d7e]',
                )}
              >
                {invitation.role === 'org_admin' ? t('orgDetail.admin') : t('orgDetail.learner')}
              </span>
              <button
                type="button"
                onClick={() => onCopy(invitation.link_id)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-[9px] border px-3 py-[7px] text-xs font-bold transition-colors',
                  copied
                    ? 'border-[#bfe5d3] bg-success/10 text-success'
                    : 'border-[#dcdee6] bg-card text-[#2a2d3a] hover:border-primary hover:text-primary',
                )}
              >
                <span className={cn('inline-flex', copied && 'animate-pop-in')} aria-hidden="true">
                  {copied ? <Check className="h-[13px] w-[13px]" /> : <Copy className="h-3 w-3" />}
                </span>
                {copied ? t('orgDetail.copied') : t('orgDetail.copyLink')}
              </button>
              <button
                type="button"
                onClick={() => onCancel(invitation.id)}
                className="rounded-lg px-2.5 py-[7px] text-xs font-bold text-[#9aa0af] transition-colors hover:text-destructive"
              >
                {t('orgDetail.cancelInvite')}
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}
