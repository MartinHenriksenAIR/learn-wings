import { useTranslation } from 'react-i18next';
import {
  MoreHorizontal,
  Loader2,
  UserX,
  ShieldCheck,
  User,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BrandingAvatar } from '@/components/ui/branding-avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn, getAvatarColor, getInitials } from '@/lib/utils';
import type { OrgMembership, Profile, OrgRole } from '@/lib/types';

type Member = OrgMembership & { profile: Profile };

interface MembersTableProps {
  members: Member[];
  /** Membership id whose role change is in flight (per-row spinner). */
  updatingRoleId: string | null;
  onRoleChange: (member: Member, newRole: OrgRole) => void;
  onDisable: (membershipId: string) => void;
  onReactivate: (membershipId: string) => void;
}

/** The members table: header row + per-member rows with role/status pills and actions. */
export function MembersTable({
  members,
  updatingRoleId,
  onRoleChange,
  onDisable,
  onReactivate,
}: MembersTableProps) {
  const { t } = useTranslation();

  return (
    <div className="mb-6 overflow-hidden rounded-2xl border border-border bg-card">
      {/* Header row */}
      <div className="grid grid-cols-[2.2fr_0.9fr_0.9fr_0.9fr_0.5fr] gap-3 bg-[#f7f8fa] px-5 py-3 text-[11px] font-extrabold uppercase tracking-[0.06em] text-[#9aa0af]">
        <span>{t('orgDetail.colName')}</span>
        <span>{t('orgDetail.colRole')}</span>
        <span>{t('orgDetail.colStatus')}</span>
        <span>{t('orgDetail.colAdded')}</span>
        <span className="text-right">{t('orgDetail.colActions')}</span>
      </div>
      {members.map((member) => {
        const isAdmin = member.role === 'org_admin';
        return (
          <div
            key={member.id}
            className={cn(
              'grid grid-cols-[2.2fr_0.9fr_0.9fr_0.9fr_0.5fr] items-center gap-3 border-t border-[#f3f4f8] px-5 py-3',
              member.status === 'disabled' && 'opacity-60',
            )}
          >
            {/* Name: avatar + name */}
            <span className="flex min-w-0 items-center gap-[11px]">
              <BrandingAvatar
                avatarPath={member.profile?.avatar_url}
                fallback={getInitials(member.profile?.full_name, '??')}
                className="h-8 w-8 shrink-0"
                fallbackClassName="text-[11px] font-bold text-white"
                fallbackStyle={{ backgroundColor: getAvatarColor(member.profile?.full_name) }}
              />
              <span className="truncate text-[13px] font-bold">{member.profile?.full_name}</span>
            </span>
            {/* Role pill */}
            <span>
              <span
                className={cn(
                  'inline-flex items-center rounded-[7px] px-2.5 py-1 text-[11px] font-bold',
                  isAdmin ? 'bg-accent text-primary' : 'bg-[#f3f4f8] text-[#686d7e]',
                )}
              >
                {isAdmin ? t('orgDetail.admin') : t('orgDetail.learner')}
              </span>
            </span>
            {/* Status pill */}
            <span>
              <span
                className={cn(
                  'inline-flex items-center rounded-[7px] px-2.5 py-1 text-[11px] font-bold capitalize',
                  member.status === 'active'
                    ? 'bg-success/10 text-success'
                    : member.status === 'disabled'
                      ? 'bg-destructive/10 text-destructive'
                      : 'bg-warning/10 text-warning',
                )}
              >
                {member.status}
              </span>
            </span>
            {/* Added */}
            <span className="text-[12.5px] text-muted-foreground">
              {new Date(member.created_at).toLocaleDateString()}
            </span>
            {/* Actions */}
            <span className="text-right">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" disabled={updatingRoleId === member.id}>
                    {updatingRoleId === member.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="bg-popover">
                  {member.status === 'active' && (
                    <>
                      {member.role === 'learner' ? (
                        <DropdownMenuItem onClick={() => onRoleChange(member, 'org_admin')}>
                          <ShieldCheck className="mr-2 h-4 w-4" aria-hidden="true" />
                          {t('orgDetail.promoteToAdmin')}
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem onClick={() => onRoleChange(member, 'learner')}>
                          <User className="mr-2 h-4 w-4" aria-hidden="true" />
                          {t('orgDetail.changeToLearner')}
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => onDisable(member.id)}
                        className="text-destructive"
                      >
                        <UserX className="mr-2 h-4 w-4" aria-hidden="true" />
                        {t('orgDetail.disableAccess')}
                      </DropdownMenuItem>
                    </>
                  )}
                  {member.status === 'disabled' && (
                    <DropdownMenuItem onClick={() => onReactivate(member.id)}>
                      <User className="mr-2 h-4 w-4" aria-hidden="true" />
                      {t('orgDetail.reactivate')}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </span>
          </div>
        );
      })}
    </div>
  );
}
