import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import type { OrgRole } from '@/lib/types';

export interface InvitePayload {
  email: string;
  firstName: string;
  lastName: string;
  department: string;
  role: OrgRole;
}

interface InviteUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgName: string;
  onSubmit: (payload: InvitePayload) => void;
  pending: boolean;
}

/**
 * Invite-user dialog. Owns its own form state (email/first/last/department/
 * role), reset each time the dialog opens.
 */
export function InviteUserDialog({ open, onOpenChange, orgName, onSubmit, pending }: InviteUserDialogProps) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [department, setDepartment] = useState('');
  const [role, setRole] = useState<OrgRole>('learner');

  // Reset the form each time the dialog opens so a fresh invite starts clean.
  useEffect(() => {
    if (open) {
      setEmail('');
      setFirstName('');
      setLastName('');
      setDepartment('');
      setRole('learner');
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('orgDetail.inviteDialogTitle', { org: orgName })}</DialogTitle>
          <DialogDescription>{t('orgDetail.inviteDialogDescription')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="invite-email">{t('orgDetail.emailAddress')}</Label>
            <Input
              id="invite-email"
              type="email"
              placeholder="colleague@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="invite-first-name">{t('orgDetail.firstName')}</Label>
              <Input
                id="invite-first-name"
                placeholder="John"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-last-name">{t('orgDetail.lastName')}</Label>
              <Input
                id="invite-last-name"
                placeholder="Doe"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="invite-department">{t('orgDetail.department')}</Label>
            <Input
              id="invite-department"
              placeholder="Engineering"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>{t('orgDetail.role')}</Label>
            <Select value={role} onValueChange={(v) => setRole(v as OrgRole)}>
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
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={() => onSubmit({ email, firstName, lastName, department, role })}
            disabled={pending}
          >
            {pending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Mail className="mr-2 h-4 w-4" aria-hidden="true" />
            )}
            {t('orgDetail.createInvitation')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
