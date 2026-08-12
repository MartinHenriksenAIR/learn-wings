import { useTranslation } from 'react-i18next';
import { Users, ClipboardList, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { MembersTable } from './MembersTable';
import { membersToCsv, downloadCsv, membersCsvFilename } from '@/lib/csv';
import type { OrgMembership, Profile, OrgRole } from '@/lib/types';

type Member = OrgMembership & { profile: Profile };

interface MembersSectionProps {
  members: Member[];
  /** Org name — used to build the CSV export filename. */
  orgName: string;
  updatingRoleId: string | null;
  onRoleChange: (member: Member, newRole: OrgRole) => void;
  onDisable: (membershipId: string) => void;
  onReactivate: (membershipId: string) => void;
  onAssignClick: () => void;
  onAssignCourse: (member: Member) => void;
}

export function MembersSection({
  members,
  orgName,
  updatingRoleId,
  onRoleChange,
  onDisable,
  onReactivate,
  onAssignClick,
  onAssignCourse,
}: MembersSectionProps) {
  const { t } = useTranslation();

  const handleExportCsv = () =>
    downloadCsv(membersCsvFilename(orgName, new Date()), membersToCsv(members));

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[17px] font-extrabold">{t('orgDetail.members')}</h2>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={handleExportCsv}
            disabled={members.length === 0}
          >
            <Download className="mr-2 h-4 w-4" aria-hidden="true" />
            {t('orgDetail.exportCsv')}
          </Button>
          <Button variant="outline" onClick={onAssignClick}>
            <ClipboardList className="mr-2 h-4 w-4" aria-hidden="true" />
            {t('assignments.assignCourse')}
          </Button>
        </div>
      </div>

      {members.length === 0 ? (
        <EmptyState
          icon={<Users className="h-6 w-6" />}
          title={t('orgDetail.noMembersTitle')}
          description={t('orgDetail.noMembersDescription')}
        />
      ) : (
        <MembersTable
          members={members}
          updatingRoleId={updatingRoleId}
          onRoleChange={onRoleChange}
          onDisable={onDisable}
          onReactivate={onReactivate}
          onAssignCourse={onAssignCourse}
        />
      )}
    </>
  );
}
