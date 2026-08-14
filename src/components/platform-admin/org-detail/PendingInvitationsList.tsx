import { useTranslation } from 'react-i18next';
import { formatDate } from '@/lib/date-locale';
import { Mail } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Invitation } from '@/lib/types';

interface PendingInvitationsListProps {
  invitations: Invitation[];
  onCancel: (invitationId: string) => void;
}

export function PendingInvitationsList({
  invitations,
  onCancel,
}: PendingInvitationsListProps) {
  const { t, i18n } = useTranslation();

  return (
    <>
      <h2 className="mb-3 text-[17px] font-extrabold">{t('orgDetail.pendingInvitations')}</h2>
      <div className="mb-6 overflow-hidden rounded-2xl border border-border bg-card">
        {invitations.map((invitation) => (
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
                  {t('orgDetail.expiresOn', { date: formatDate(new Date(invitation.expires_at), 'P', i18n.language) })}
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
                onClick={() => onCancel(invitation.id)}
                className="rounded-lg px-2.5 py-[7px] text-xs font-bold text-[#9aa0af] transition-colors hover:text-destructive"
              >
                {t('orgDetail.cancelInvite')}
              </button>
            </div>
          ))}
      </div>
    </>
  );
}
