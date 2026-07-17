import { Trans, useTranslation } from 'react-i18next';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { OrgMembership, Profile, OrgRole } from '@/lib/types';

export interface RoleChangeSelection {
  open: boolean;
  member: (OrgMembership & { profile: Profile }) | null;
  newRole: OrgRole;
}

interface RoleChangeDialogProps {
  selection: RoleChangeSelection | null;
  orgName: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

/** Role-change confirmation AlertDialog (promote to admin / change to learner). */
export function RoleChangeDialog({ selection, orgName, onOpenChange, onConfirm }: RoleChangeDialogProps) {
  const { t } = useTranslation();

  return (
    // `open` must be a boolean from the first render — `selection?.open` is
    // undefined until the dialog is first used, which flips the AlertDialog from
    // uncontrolled to controlled and triggers a React console warning.
    <AlertDialog open={!!selection?.open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {selection?.newRole === 'org_admin'
              ? t('orgDetail.promoteTitle')
              : t('orgDetail.changeToLearnerTitle')}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {selection?.newRole === 'org_admin' ? (
              <Trans
                i18nKey="orgDetail.promoteDescription"
                values={{ name: selection?.member?.profile?.full_name, org: orgName }}
                components={[<strong key="0" />]}
              />
            ) : (
              <Trans
                i18nKey="orgDetail.demoteDescription"
                values={{ name: selection?.member?.profile?.full_name }}
                components={[<strong key="0" />]}
              />
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            {selection?.newRole === 'org_admin'
              ? t('orgDetail.promoteToAdmin')
              : t('orgDetail.changeToLearner')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
