import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { EmptyState } from '@/components/ui/empty-state';
import { PageSpinner } from '@/components/ui/page-spinner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { useAuth } from '@/hooks/useAuth';
import { useFlash } from '@/hooks/useFlash';
import { useOrgMemberships } from '@/hooks/useOrgMemberships';
import { useInvitations } from '@/hooks/useInvitations';
import { useOrgDetail } from '@/hooks/useOrgDetail';
import { useAiChampions } from '@/hooks/useAiChampions';
import { useToastMutation } from '@/hooks/useToastMutation';
import { useQueryErrorToast } from '@/components/platform-admin/org-detail/useQueryErrorToast';
import { queryKeys } from '@/lib/query-keys';
import { callApi, ApiError } from '@/lib/api-client';
import { getSeatUsage } from '@/lib/seats';
import { cn, getAvatarColor, getInitials } from '@/lib/utils';
import { SeatUsageNote } from '@/components/SeatUsageNote';
import { OrgMembership, Profile, Invitation, OrgRole } from '@/lib/types';
import {
  Users,
  Plus,
  MoreHorizontal,
  Mail,
  Copy,
  Check,
  Loader2,
  UserX,
  ShieldCheck,
  User,
  FileSpreadsheet,
  GraduationCap,
  Sparkles,
  Search,
} from 'lucide-react';
import { toast } from '@/components/ui/sonner';
import { z } from 'zod';
import { getInviteLink } from '@/lib/config';
import { sendInvitationEmail } from '@/lib/sendInvitationEmail';
import { BulkInviteDialog } from '@/components/org-admin/BulkInviteDialog';
import { EnrollUserDialog } from '@/components/org-admin/EnrollUserDialog';

const inviteSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  role: z.enum(['org_admin', 'learner']),
});

export function OrgMembersTab() {
  const { t } = useTranslation();
  const { user, profile, currentOrg } = useAuth();
  const queryClient = useQueryClient();

  // ── Data layer (shared TanStack Query hooks) ───────────────────────────────
  // useOrgMemberships returns the same reshaped (OrgMembership & { profile })[]
  // the tab used to hand-roll; useInvitations uses the 'org' scope (org-admin
  // authz path); useAiChampions supplies the champion user_ids we fold to a Set.
  const membershipsQuery = useOrgMemberships(currentOrg?.id);
  const invitationsQuery = useInvitations(currentOrg?.id, 'org');
  const championsQuery = useAiChampions(currentOrg?.id);
  const orgDetailQuery = useOrgDetail(currentOrg?.id);
  const orgDetail = orgDetailQuery.data;

  const members = useMemo(
    () => membershipsQuery.data ?? [],
    [membershipsQuery.data],
  );
  const invitations = useMemo(
    () => invitationsQuery.data ?? [],
    [invitationsQuery.data],
  );
  const aiChampions = useMemo(
    () => new Set((championsQuery.data ?? []).map((c) => c.user_id)),
    [championsQuery.data],
  );

  // Seats consumed = active members + pending invitations, measured against
  // the org's seat_limit. Prefer the org-wide server aggregates (`orgDetail`)
  // — the caller-scoped `invitations` list only contains invites THIS admin
  // created, so it undercounts pending seats when a co-admin (or platform
  // admin) has outstanding invites in the same org. Fall back to the
  // already-fetched lists only while `orgDetail` is still loading.
  const activeMemberCount = members.filter((m) => m.status === 'active').length;
  const seatUsage = useMemo(
    () =>
      getSeatUsage({
        activeMembers: orgDetail?.member_count ?? activeMemberCount,
        pendingInvites: orgDetail?.pending_invite_count ?? invitations.length,
        seatLimit: orgDetail?.seat_limit ?? currentOrg?.seat_limit ?? null,
      }),
    [orgDetail, activeMemberCount, invitations.length, currentOrg?.seat_limit],
  );
  const atSeatLimit = !seatUsage.isUnlimited && seatUsage.atLimit;

  // Query-error toasts reproduce TanStack v5's missing useQuery onError.
  // Members / invitations failures toast; the champions failure stays SILENT
  // (parity: the old client swallowed champion-fetch errors — badges simply
  // don't render). No toastTitle → console-only, same as OrganizationDetail's
  // profiles query.
  useQueryErrorToast({
    isError: membershipsQuery.isError,
    error: membershipsQuery.error,
    toastTitle: 'Failed to load members',
    logLabel: 'OrgMembersTab: failed to load members',
  });
  useQueryErrorToast({
    isError: invitationsQuery.isError,
    error: invitationsQuery.error,
    toastTitle: 'Failed to load invitations',
    logLabel: 'OrgMembersTab: failed to load invitations',
  });
  useQueryErrorToast({
    isError: championsQuery.isError,
    error: championsQuery.error,
    logLabel: 'OrgMembersTab: failed to load AI champions',
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteFirstName, setInviteFirstName] = useState('');
  const [inviteLastName, setInviteLastName] = useState('');
  const [inviteDepartment, setInviteDepartment] = useState('');
  const [inviteRole, setInviteRole] = useState<OrgRole>('learner');
  // In-button morph feedback for copy-link ("Copied!") and revoke ("Revoked"),
  // keyed by invitation link/id — replaces the routine success toasts.
  const { flashed: copyFlashed, flash: flashCopy } = useFlash();
  const { flashed: revokeFlashed, flash: flashRevoke } = useFlash();
  const [roleChangeDialog, setRoleChangeDialog] = useState<{
    open: boolean;
    member: (OrgMembership & { profile: Profile }) | null;
    newRole: OrgRole;
  } | null>(null);
  const [updatingRole, setUpdatingRole] = useState<string | null>(null);
  const [togglingChampion, setTogglingChampion] = useState<string | null>(null);
  const [bulkInviteOpen, setBulkInviteOpen] = useState(false);
  const [enrollDialogOpen, setEnrollDialogOpen] = useState(false);
  const [removeMemberDialog, setRemoveMemberDialog] = useState<{
    open: boolean;
    member: (OrgMembership & { profile: Profile }) | null;
  } | null>(null);

  // ── Cache helpers (targeted invalidation replaces imperative refetch) ──────
  const invalidateMemberships = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.orgMemberships.list(currentOrg?.id) });
  const invalidateInvitations = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.invitations.list(currentOrg?.id, 'org') });
  // Refresh the org-wide seat aggregates (member_count / pending_invite_count)
  // that seatUsage reads from. Every mutation that changes the org's active
  // member or pending invite count calls this so the "seats used · remaining"
  // note updates immediately after the user's own action — the caller-scoped
  // lists alone don't move these org-wide totals.
  const invalidateOrgDetail = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.orgDetail.detail(currentOrg?.id) });

  // Behavior-identical replacement for the old `fetchData` handed to the bulk /
  // enroll dialogs: both used to refetch all three lists on success.
  const refetchAll = () => {
    if (!currentOrg) return;
    invalidateMemberships();
    invalidateInvitations();
    queryClient.invalidateQueries({ queryKey: queryKeys.aiChampions.list(currentOrg.id) });
    invalidateOrgDetail();
  };

  // ── Mutations ──────────────────────────────────────────────────────────────
  // `useToastMutation` bakes in the shared destructive-toast-on-failure idiom
  // (title + err.message); success behavior stays per-handler.
  const inviteMutation = useToastMutation({
    mutationFn: async () => {
      const { invitation } = await callApi<{ invitation: { id: string; link_id: string } }>(
        '/api/invitation-create',
        {
          orgId: currentOrg?.id,
          email: inviteEmail,
          role: inviteRole,
          firstName: inviteFirstName || undefined,
          lastName: inviteLastName || undefined,
          department: inviteDepartment || undefined,
        },
      );

      let emailSent = false;
      if (invitation?.link_id) {
        const emailResult = await sendInvitationEmail({
          email: inviteEmail,
          orgName: currentOrg?.name ?? null,
          role: inviteRole,
          linkId: invitation.link_id,
        });
        emailSent = emailResult.success;
      }
      return { emailSent };
    },
    errorTitle: 'Failed to create invitation',
    onSuccess: ({ emailSent }) => {
      // Invitation creation is a submission — keep the success toast (toast policy).
      toast({
        title: 'Invitation created!',
        description: emailSent
          ? 'Invitation email sent successfully.'
          : 'Copy the invite link to share with the user.',
      });
      setInviteOpen(false);
      setInviteEmail('');
      setInviteFirstName('');
      setInviteLastName('');
      setInviteDepartment('');
      setInviteRole('learner');
      invalidateInvitations();
      invalidateOrgDetail();
    },
  });

  const removeMemberMutation = useToastMutation({
    mutationFn: (member: OrgMembership & { profile: Profile }) =>
      callApi('/api/org-membership-delete', { id: member.id }),
    errorTitle: 'Failed to remove member',
    onSuccess: (_data, member) => {
      toast({
        title: 'Member removed',
        description: `${member.profile?.full_name} has been removed from the organization.`,
      });
      invalidateMemberships();
      invalidateOrgDetail();
    },
    // The dialog closed unconditionally in the old `finally` — reproduce with onSettled.
    onSettled: () => setRemoveMemberDialog(null),
  });

  const cancelInvitationMutation = useToastMutation({
    mutationFn: (invitation: Invitation) =>
      callApi('/api/invitation-update', { id: invitation.id, status: 'expired' }),
    errorTitle: 'Failed to cancel invitation',
    onSuccess: (_data, invitation) => {
      // Instant on-success removal (no refetch), matching the old local-state
      // filter: drop the row from the cached list via setQueryData.
      queryClient.setQueryData<Invitation[]>(
        queryKeys.invitations.list(currentOrg?.id, 'org'),
        (prev) => prev?.filter((inv) => inv.id !== invitation.id) ?? [],
      );
      // Cancelling frees a seat — refresh the org-wide pending-invite aggregate.
      invalidateOrgDetail();
    },
  });

  const changeRoleMutation = useToastMutation({
    mutationFn: ({ member, newRole }: { member: OrgMembership & { profile: Profile }; newRole: OrgRole }) =>
      callApi('/api/org-membership-update', { id: member.id, role: newRole }),
    errorTitle: 'Failed to change role',
    onSuccess: (_data, { member, newRole }) => {
      toast({
        title: 'Role updated',
        description: `${member.profile?.full_name} is now ${newRole === 'org_admin' ? 'an Admin' : 'a Learner'}.`,
      });
      invalidateMemberships();
    },
    onSettled: () => setUpdatingRole(null),
  });

  const toggleChampionMutation = useToastMutation({
    mutationFn: ({
      member,
      isCurrentlyChampion,
    }: {
      member: OrgMembership & { profile: Profile };
      isCurrentlyChampion: boolean;
    }) =>
      isCurrentlyChampion
        ? callApi('/api/ai-champion-delete', { orgId: currentOrg?.id, userId: member.user_id })
        // assigned_by is derived server-side from the caller's profile (issue #11 audit item)
        : callApi('/api/ai-champion-create', { orgId: currentOrg?.id, userId: member.user_id }),
    errorTitle: ({ isCurrentlyChampion }) =>
      isCurrentlyChampion
        ? 'Failed to remove AI Champion status'
        : 'Failed to assign AI Champion status',
    onSuccess: (_data, { member, isCurrentlyChampion }) => {
      // Invalidate rather than hand-patch the cache: the ['ai-champions', orgId]
      // entry is shared with AIChampionsList, which reads full champion rows
      // (id/profile/assigned_at). Writing a partial { user_id } row here would
      // corrupt that consumer's render, so refetch the real rows instead —
      // consistent with how the role/member mutations invalidate.
      queryClient.invalidateQueries({ queryKey: queryKeys.aiChampions.list(currentOrg?.id) });
      if (isCurrentlyChampion) {
        toast({ title: 'AI Champion status removed', description: `${member.profile?.full_name} is no longer an AI Champion.` });
      } else {
        toast({ title: 'AI Champion assigned!', description: `${member.profile?.full_name} is now an AI Champion.` });
      }
    },
    onSettled: () => setTogglingChampion(null),
  });

  // Surface the backend seat cap (409) inline in the invite dialog, alongside
  // the failure toast, so it doesn't read as a generic error.
  const inviteErrorMessage =
    inviteMutation.error instanceof ApiError &&
    inviteMutation.error.code === 'SEAT_LIMIT_REACHED'
      ? inviteMutation.error.message
      : null;

  const handleInvite = () => {
    if (!currentOrg || !user) return;

    const result = inviteSchema.safeParse({ email: inviteEmail, role: inviteRole });
    if (!result.success) {
      toast({
        title: 'Invalid input',
        description: result.error.errors[0].message,
        variant: 'destructive',
      });
      return;
    }

    inviteMutation.mutate();
  };

  const handleCopyInviteLink = async (linkId: string) => {
    const link = getInviteLink(linkId);
    await navigator.clipboard.writeText(link);
    // In-button "Copied!" morph instead of a toast (toast policy: copy is routine).
    flashCopy(linkId);
  };

  const handleRemoveMember = () => {
    if (!removeMemberDialog?.member) return;
    removeMemberMutation.mutate(removeMemberDialog.member);
  };

  const handleCancelInvitation = (invitation: Invitation) => {
    // Optimistic inline feedback ("Revoked") fires immediately; the row drops
    // once the request succeeds (setQueryData in onSuccess). Errors keep toasts.
    flashRevoke(invitation.id);
    cancelInvitationMutation.mutate(invitation);
  };

  const handleChangeRole = () => {
    if (!roleChangeDialog?.member) return;

    const { member, newRole } = roleChangeDialog;
    setUpdatingRole(member.id);
    setRoleChangeDialog(null);
    changeRoleMutation.mutate({ member, newRole });
  };

  const handleToggleAiChampion = (member: OrgMembership & { profile: Profile }) => {
    if (!currentOrg) return;

    const isCurrentlyChampion = aiChampions.has(member.user_id);
    // In-flight guard (same pattern as updatingRole): set before mutate, cleared
    // in onSettled, so a double-click can't fire a second request.
    setTogglingChampion(member.id);
    toggleChampionMutation.mutate({ member, isCurrentlyChampion });
  };

  const filteredMembers = members.filter((member) => {
    const matchesSearch =
      searchQuery === '' ||
      member.profile?.full_name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesRole = roleFilter === 'all' || member.role === roleFilter;
    return matchesSearch && matchesRole;
  });

  const hasFilters = searchQuery !== '' || roleFilter !== 'all';

  // Loading gate: only meaningful when an org is selected — disabled queries
  // (no org) report isLoading=false, so this falls through to the empty state.
  if (
    currentOrg &&
    (membershipsQuery.isLoading || invitationsQuery.isLoading || championsQuery.isLoading)
  ) {
    return <PageSpinner />;
  }

  if (!currentOrg) {
    return (
      <div className="flex h-64 flex-col items-center justify-center text-center">
        <Users className="mb-4 h-12 w-12 text-muted-foreground/50" />
        <p className="text-muted-foreground">{t('common.noOrgSelected')}</p>
      </div>
    );
  }

  return (
    <div>
      {/* Search and actions toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <div className="relative min-w-[200px] flex-1">
          <Search aria-hidden="true" className="absolute left-[13px] top-1/2 h-4 w-4 -translate-y-1/2 text-[#9aa0af]" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('analytics.members.searchPlaceholder')}
            className="pl-10"
          />
        </div>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('analytics.members.allRoles')}</SelectItem>
            <SelectItem value="org_admin">{t('analytics.members.admins')}</SelectItem>
            <SelectItem value="learner">{t('analytics.members.learners')}</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={() => setEnrollDialogOpen(true)} className="shrink-0">
          <GraduationCap className="mr-2 h-4 w-4" aria-hidden="true" />
          {t('analytics.members.enrollInCourse')}
        </Button>
        <Button variant="outline" onClick={() => setBulkInviteOpen(true)} className="shrink-0">
          <FileSpreadsheet className="mr-2 h-4 w-4" aria-hidden="true" />
          {t('analytics.members.bulkInvite')}
        </Button>
        <Dialog
          open={inviteOpen}
          onOpenChange={(open) => {
            setInviteOpen(open);
            // Clear any prior seat-cap error when the dialog (re)opens.
            if (open) inviteMutation.reset();
          }}
        >
          <DialogTrigger asChild>
            <Button className="shrink-0">
              <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
              {t('analytics.members.inviteMember')}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Invite Team Member</DialogTitle>
              <DialogDescription>Send an invitation to join {currentOrg?.name}.</DialogDescription>
              <SeatUsageNote usage={seatUsage} className="pt-1" />
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email Address</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="colleague@company.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="first-name">First Name</Label>
                  <Input
                    id="first-name"
                    placeholder="John"
                    value={inviteFirstName}
                    onChange={(e) => setInviteFirstName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="last-name">Last Name</Label>
                  <Input
                    id="last-name"
                    placeholder="Doe"
                    value={inviteLastName}
                    onChange={(e) => setInviteLastName(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="department">Department</Label>
                <Input
                  id="department"
                  placeholder="Engineering"
                  value={inviteDepartment}
                  onChange={(e) => setInviteDepartment(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="role">Role</Label>
                <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as OrgRole)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="learner">Learner</SelectItem>
                    <SelectItem value="org_admin">Organization Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {(atSeatLimit || inviteErrorMessage) && (
              <p className="text-xs font-medium text-destructive">
                {inviteErrorMessage ?? t('seats.limitReached')}
              </p>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setInviteOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleInvite} disabled={inviteMutation.isPending || atSeatLimit}>
                {inviteMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Mail className="mr-2 h-4 w-4" aria-hidden="true" />
                )}
                Create Invitation
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Bulk Invite Dialog */}
      <BulkInviteDialog
        open={bulkInviteOpen}
        onOpenChange={setBulkInviteOpen}
        orgId={currentOrg.id}
        orgName={currentOrg.name}
        seatUsage={seatUsage}
        onSuccess={refetchAll}
      />

      {/* Enroll User Dialog */}
      <EnrollUserDialog
        open={enrollDialogOpen}
        onOpenChange={setEnrollDialogOpen}
        orgId={currentOrg.id}
        orgName={currentOrg.name}
        members={members}
        onSuccess={refetchAll}
      />

      {/* Members table */}
      {filteredMembers.length === 0 ? (
        <EmptyState
          icon={<Users className="h-6 w-6" />}
          title={hasFilters ? t('analytics.members.noMatchingTitle') : t('analytics.members.noMembersTitle')}
          description={
            hasFilters
              ? t('analytics.members.noMatchingDescription')
              : t('analytics.members.noMembersDescription')
          }
          action={
            !hasFilters ? (
              <Button
                onClick={() => {
                  inviteMutation.reset();
                  setInviteOpen(true);
                }}
              >
                <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                {t('analytics.members.inviteMember')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="mb-[18px] overflow-hidden rounded-2xl border border-border bg-card">
          {/* Header row */}
          <div className="grid grid-cols-[2.2fr_1.2fr_0.9fr_0.9fr_0.9fr_0.6fr] gap-3 bg-[#f7f8fa] px-5 py-3 text-[11px] font-extrabold uppercase tracking-[0.06em] text-[#9aa0af]">
            <span>{t('analytics.members.colMember')}</span>
            <span>{t('analytics.members.colDepartment')}</span>
            <span>{t('analytics.members.colRole')}</span>
            <span>{t('analytics.members.colStatus')}</span>
            <span>{t('analytics.members.colJoined')}</span>
            <span className="text-right">{t('analytics.members.colActions')}</span>
          </div>
          {filteredMembers.map((member) => {
            const isChampion = aiChampions.has(member.user_id);
            const isAdmin = member.role === 'org_admin';
            return (
              <div
                key={member.id}
                className="grid grid-cols-[2.2fr_1.2fr_0.9fr_0.9fr_0.9fr_0.6fr] items-center gap-3 border-t border-[#f3f4f8] px-5 py-3"
              >
                {/* Member: avatar + name/email */}
                <span className="flex min-w-0 items-center gap-[11px]">
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarFallback
                      className="text-[11px] font-bold text-white"
                      style={{ backgroundColor: getAvatarColor(member.profile?.full_name) }}
                    >
                      {getInitials(member.profile?.full_name, '??')}
                    </AvatarFallback>
                  </Avatar>
                  <span className="flex min-w-0 flex-col">
                    <span className="flex items-center gap-1.5 text-[13px] font-bold">
                      {member.profile?.full_name}
                      {isChampion && (
                        <Sparkles
                          aria-label={t('analytics.members.aiChampion')}
                          className="h-[13px] w-[13px] text-warning"
                        />
                      )}
                    </span>
                  </span>
                </span>
                {/* Department */}
                <span className="truncate text-[12.5px] text-[#4a4f60]">
                  {member.profile?.department || '-'}
                </span>
                {/* Role pill */}
                <span>
                  <span
                    className={cn(
                      'inline-flex items-center rounded-[7px] px-2.5 py-1 text-[11px] font-bold',
                      isAdmin ? 'bg-accent text-primary' : 'bg-[#f3f4f8] text-[#686d7e]',
                    )}
                  >
                    {isAdmin ? t('analytics.members.admin') : t('analytics.members.learner')}
                  </span>
                </span>
                {/* Status pill */}
                <span>
                  <span
                    className={cn(
                      'inline-flex items-center rounded-[7px] px-2.5 py-1 text-[11px] font-bold capitalize',
                      member.status === 'active'
                        ? 'bg-success/10 text-success'
                        : 'bg-warning/10 text-warning',
                    )}
                  >
                    {member.status}
                  </span>
                </span>
                {/* Joined */}
                <span className="text-[12.5px] text-muted-foreground">
                  {new Date(member.created_at).toLocaleDateString()}
                </span>
                {/* Actions */}
                <span className="text-right">
                  {member.user_id !== profile?.id && member.status === 'active' && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" disabled={updatingRole === member.id}>
                          {updatingRole === member.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                          ) : (
                            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                          )}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {member.role === 'learner' ? (
                          <DropdownMenuItem
                            onClick={() => setRoleChangeDialog({ open: true, member, newRole: 'org_admin' })}
                          >
                            <ShieldCheck className="mr-2 h-4 w-4" aria-hidden="true" />
                            {t('analytics.members.promoteToAdmin')}
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            onClick={() => setRoleChangeDialog({ open: true, member, newRole: 'learner' })}
                          >
                            <User className="mr-2 h-4 w-4" aria-hidden="true" />
                            {t('analytics.members.changeToLearner')}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          onClick={() => handleToggleAiChampion(member)}
                          disabled={togglingChampion === member.id}
                        >
                          <Sparkles className="mr-2 h-4 w-4" aria-hidden="true" />
                          {isChampion
                            ? t('analytics.members.removeAiChampion')
                            : t('analytics.members.makeAiChampion')}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => setRemoveMemberDialog({ open: true, member })}
                          className="text-destructive"
                        >
                          <UserX className="mr-2 h-4 w-4" aria-hidden="true" />
                          {t('analytics.members.removeFromTeam')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Pending invitations */}
      {invitations.length > 0 && (
        <>
          <h3 className="mb-3 text-[15px] font-extrabold">{t('analytics.members.pendingInvitations')}</h3>
          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            {invitations.map((invitation) => {
              const linkId = invitation.link_id || '';
              const copied = copyFlashed(linkId);
              const revoked = revokeFlashed(invitation.id);
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
                      {t('analytics.members.invitedOn', {
                        date: new Date(invitation.created_at).toLocaleDateString(),
                        role:
                          invitation.role === 'org_admin'
                            ? t('analytics.members.admin')
                            : t('analytics.members.learner'),
                      })}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopyInviteLink(linkId)}
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
                    {copied ? t('analytics.members.copied') : t('analytics.members.copyLink')}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCancelInvitation(invitation)}
                    disabled={revoked}
                    className="rounded-lg px-2.5 py-[7px] text-xs font-bold text-[#9aa0af] transition-colors hover:text-destructive disabled:text-success disabled:hover:text-success"
                  >
                    {revoked ? t('analytics.members.revoked') : t('analytics.members.revoke')}
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Role Change Confirmation Dialog */}
      {/* `open` must be a boolean from the first render — `roleChangeDialog?.open` is
          undefined until the dialog is first used, which flips the AlertDialog from
          uncontrolled to controlled and triggers a React console warning (#81 pattern). */}
      <AlertDialog
        open={!!roleChangeDialog?.open}
        onOpenChange={(open) => !open && setRoleChangeDialog(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {roleChangeDialog?.newRole === 'org_admin'
                ? 'Promote to Organization Admin?'
                : 'Change to Learner?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {roleChangeDialog?.newRole === 'org_admin' ? (
                <>
                  <strong>{roleChangeDialog?.member?.profile?.full_name}</strong> will be able to
                  manage team members, view analytics, and control course access for this organization.
                </>
              ) : (
                <>
                  <strong>{roleChangeDialog?.member?.profile?.full_name}</strong> will lose admin
                  privileges and only have access as a regular learner.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleChangeRole}>
              {roleChangeDialog?.newRole === 'org_admin' ? 'Promote to Admin' : 'Change to Learner'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Remove Member Confirmation Dialog */}
      <AlertDialog
        open={!!removeMemberDialog?.open}
        onOpenChange={(open) => !open && setRemoveMemberDialog(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove team member?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{removeMemberDialog?.member?.profile?.full_name}</strong> will be removed from
              this organization. They will lose access to all courses and their progress data will
              be retained but they won't be able to continue learning until re-invited.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRemoveMember}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove Member
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
