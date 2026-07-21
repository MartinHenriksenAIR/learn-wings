import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
/** A current platform admin, projected from a profile (#198). */
export interface PlatformAdmin {
  id: string;
  full_name: string;
  email: string | null;
}

/** A user who could be granted platform-admin (non-admin profile). */
export interface GrantCandidate {
  id: string;
  full_name: string;
}

interface PlatformAdminsSectionProps {
  admins: PlatformAdmin[];
  /** Non-admin users selectable in the grant control. */
  availableUsers: GrantCandidate[];
  onGrant: (userId: string) => void;
  onRevoke: (userId: string) => void;
  /** A grant/revoke request is in flight. */
  pending: boolean;
}

type Confirm =
  | { action: 'grant'; userId: string; name: string }
  | { action: 'revoke'; userId: string; name: string };

/**
 * Platform-admin management (#128): lists current platform admins with a Revoke
 * action and a grant control to promote an existing user. Every grant/revoke is
 * gated behind a confirmation AlertDialog — the parent's mutation only fires
 * once the user confirms. The server independently HARD-REFUSES demoting the
 * last remaining admin; that 409 surfaces as an error toast at the call site.
 */
export function PlatformAdminsSection({
  admins,
  availableUsers,
  onGrant,
  onRevoke,
  pending,
}: PlatformAdminsSectionProps) {
  const { t } = useTranslation();
  const [selectedUserId, setSelectedUserId] = useState('');
  const [confirm, setConfirm] = useState<Confirm | null>(null);

  const nameFor = (id: string) => availableUsers.find((u) => u.id === id)?.full_name ?? id;

  const handleConfirm = () => {
    if (!confirm) return;
    if (confirm.action === 'grant') {
      onGrant(confirm.userId);
      setSelectedUserId('');
    } else {
      onRevoke(confirm.userId);
    }
    setConfirm(null);
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-[13px] font-bold text-[#4a4f60]">{t('platformAdmins.currentTitle')}</h2>
        {admins.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('platformAdmins.empty')}</p>
        ) : (
          <ul className="space-y-2">
            {admins.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#eceef3] px-4 py-[13px]"
              >
                <span className="text-sm text-muted-foreground">
                  <strong className="text-foreground">{a.full_name}</strong>
                  {a.email ? ` · ${a.email}` : ''}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() => setConfirm({ action: 'revoke', userId: a.id, name: a.full_name })}
                >
                  {t('platformAdmins.revoke')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2 border-t border-[#eceef3] pt-5">
        <Label className="text-[13px] font-bold text-[#4a4f60]">{t('platformAdmins.grantLabel')}</Label>
        <p className="text-[11.5px] text-muted-foreground">{t('platformAdmins.grantHint')}</p>
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Select value={selectedUserId} onValueChange={setSelectedUserId}>
            <SelectTrigger className="w-[260px]">
              <SelectValue placeholder={t('platformAdmins.selectUser')} />
            </SelectTrigger>
            <SelectContent>
              {availableUsers.length === 0 ? (
                <div className="px-2 py-4 text-center text-sm text-muted-foreground">
                  {t('platformAdmins.noCandidates')}
                </div>
              ) : (
                availableUsers.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.full_name}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
          <Button
            disabled={pending || !selectedUserId}
            onClick={() =>
              setConfirm({ action: 'grant', userId: selectedUserId, name: nameFor(selectedUserId) })
            }
          >
            {t('platformAdmins.grant')}
          </Button>
        </div>
      </div>

      <AlertDialog open={!!confirm} onOpenChange={(open) => { if (!open) setConfirm(null); }}>
        <AlertDialogContent>
          {confirm && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {confirm.action === 'grant'
                    ? t('platformAdmins.grantConfirmTitle')
                    : t('platformAdmins.revokeConfirmTitle')}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  <Trans
                    i18nKey={
                      confirm.action === 'grant'
                        ? 'platformAdmins.grantConfirmBody'
                        : 'platformAdmins.revokeConfirmBody'
                    }
                    values={{ name: confirm.name }}
                    components={[<strong key="0" />]}
                  />
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                <AlertDialogAction onClick={handleConfirm}>
                  {t('platformAdmins.confirm')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
