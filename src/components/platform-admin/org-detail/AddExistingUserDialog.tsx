import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SeatUsageNote } from '@/components/SeatUsageNote';
import type { SeatUsage } from '@/lib/seats';
import type { OrgRole, Profile } from '@/lib/types';

export interface AddUserPayload {
  userId: string;
  role: OrgRole;
}

interface AddExistingUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgName: string;
  availableUsers: Profile[];
  seatUsage: SeatUsage;
  /** Server error to surface inline (e.g. the seat-cap 409). */
  errorMessage?: string | null;
  onSubmit: (payload: AddUserPayload) => void;
  pending: boolean;
}

/**
 * Add-existing-user dialog. Owns its own selectedUserId + role state, reset
 * each time the dialog opens.
 */
export function AddExistingUserDialog({
  open,
  onOpenChange,
  orgName,
  availableUsers,
  seatUsage,
  errorMessage,
  onSubmit,
  pending,
}: AddExistingUserDialogProps) {
  const { t } = useTranslation();
  const atLimit = !seatUsage.isUnlimited && seatUsage.atLimit;
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [selectedRole, setSelectedRole] = useState<OrgRole>('learner');

  // Reset selections each time the dialog opens.
  useEffect(() => {
    if (open) {
      setSelectedUserId('');
      setSelectedRole('learner');
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('orgDetail.addDialogTitle', { org: orgName })}</DialogTitle>
          <DialogDescription>{t('orgDetail.addDialogDescription')}</DialogDescription>
          <SeatUsageNote usage={seatUsage} className="pt-1" />
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>{t('orgDetail.user')}</Label>
            <Select value={selectedUserId} onValueChange={setSelectedUserId}>
              <SelectTrigger>
                <SelectValue placeholder={t('orgDetail.selectUser')} />
              </SelectTrigger>
              <SelectContent>
                {availableUsers.length === 0 ? (
                  <div className="px-2 py-4 text-center text-sm text-muted-foreground">
                    {t('orgDetail.allUsersMembers')}
                  </div>
                ) : (
                  availableUsers.map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.full_name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t('orgDetail.role')}</Label>
            <Select value={selectedRole} onValueChange={(v) => setSelectedRole(v as OrgRole)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="learner">{t('orgDetail.learner')}</SelectItem>
                <SelectItem value="org_admin">{t('orgDetail.organizationAdmin')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        {(atLimit || errorMessage) && (
          <p className="text-xs font-medium text-destructive">
            {errorMessage ?? t('seats.limitReached')}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={() => onSubmit({ userId: selectedUserId, role: selectedRole })}
            disabled={pending || !selectedUserId || atLimit}
          >
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            {t('orgDetail.addUser')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
