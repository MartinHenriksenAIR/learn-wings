import { useTranslation } from 'react-i18next';
import { UsersRound, ShieldCheck, User, Mail } from 'lucide-react';
import { StatCard } from '@/components/ui/stat-card';

interface OrgStatCardsProps {
  activeCount: number;
  /** active members + pending invites — shown against the seat limit */
  usedSeats: number;
  adminCount: number;
  learnerCount: number;
  pendingInviteCount: number;
  seatLimit: number | null;
}

/** The four summary StatCards for the org-detail page. */
export function OrgStatCards({
  activeCount,
  usedSeats,
  adminCount,
  learnerCount,
  pendingInviteCount,
  seatLimit,
}: OrgStatCardsProps) {
  const { t } = useTranslation();

  return (
    <div className="mb-6 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        icon={<UsersRound className="h-[18px] w-[18px]" />}
        value={
          <>
            {/* Against a seat limit this is "seats used" (active + pending);
                with no limit it's just the active-member count. */}
            {seatLimit ? usedSeats : activeCount}
            {seatLimit ? (
              <span className="text-base font-normal text-muted-foreground"> / {seatLimit}</span>
            ) : null}
          </>
        }
        label={seatLimit ? t('orgDetail.seatsUsed') : t('orgDetail.activeMembers')}
      />
      <StatCard
        icon={<ShieldCheck className="h-[18px] w-[18px]" />}
        value={adminCount}
        label={t('orgDetail.admins')}
      />
      <StatCard
        icon={<User className="h-[18px] w-[18px]" />}
        value={learnerCount}
        label={t('orgDetail.learners')}
      />
      <StatCard
        icon={<Mail className="h-[18px] w-[18px]" />}
        value={pendingInviteCount}
        label={t('orgDetail.pendingInvites')}
      />
    </div>
  );
}
