import { useTranslation } from 'react-i18next';
import { Users, Mail, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { MembersTable } from './MembersTable';
import type { OrgMembership, Profile, OrgRole } from '@/lib/types';

type Member = OrgMembership & { profile: Profile };

interface MembersSectionProps {
  members: Member[];
  updatingRoleId: string | null;
  onInviteClick: () => void;
  onAddUserClick: () => void;
  onRoleChange: (member: Member, newRole: OrgRole) => void;
  onDisable: (membershipId: string) => void;
  onReactivate: (membershipId: string) => void;
}

/**
 * Members section: header + invite/add-user triggers + the members table
 * (or the empty state when the org has no members yet).
 */
export function MembersSection({
  members,
  updatingRoleId,
  onInviteClick,
  onAddUserClick,
  onRoleChange,
  onDisable,
  onReactivate,
}: MembersSectionProps) {
  const { t } = useTranslation();

  return (
    <>
      {/* Members section header + actions */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[17px] font-extrabold">{t('orgDetail.members')}</h2>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onInviteClick}>
            <Mail className="mr-2 h-4 w-4" aria-hidden="true" />
            {t('orgDetail.inviteUser')}
          </Button>
          <Button onClick={onAddUserClick}>
            <UserPlus className="mr-2 h-4 w-4" aria-hidden="true" />
            {t('orgDetail.addMember')}
          </Button>
        </div>
      </div>

      {/* Members list */}
      {members.length === 0 ? (
        <EmptyState
          icon={<Users className="h-6 w-6" />}
          title={t('orgDetail.noMembersTitle')}
          description={t('orgDetail.noMembersDescription')}
          action={
            <Button onClick={onAddUserClick}>
              <UserPlus className="mr-2 h-4 w-4" aria-hidden="true" />
              {t('orgDetail.addUser')}
            </Button>
          }
        />
      ) : (
        <MembersTable
          members={members}
          updatingRoleId={updatingRoleId}
          onRoleChange={onRoleChange}
          onDisable={onDisable}
          onReactivate={onReactivate}
        />
      )}
    </>
  );
}
