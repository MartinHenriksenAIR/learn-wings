import { useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageSpinner } from '@/components/ui/page-spinner';
import { Button } from '@/components/ui/button';
import { useToastMutation } from '@/hooks/useToastMutation';
import { useOrgDetail } from '@/hooks/useOrgDetail';
import { useOrgMemberships } from '@/hooks/useOrgMemberships';
import { useInvitations } from '@/hooks/useInvitations';
import { useSeatRequests } from '@/hooks/useSeatRequests';
import { callApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { getSeatUsage } from '@/lib/seats';
import { routes } from '@/lib/routes';
import { OrgMembership, Profile, OrgRole } from '@/lib/types';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from '@/components/ui/sonner';
import { orgSchema } from '@/lib/org-validation';
import { OrgDetailHeader } from '@/components/platform-admin/org-detail/OrgDetailHeader';
import { OrgStatCards } from '@/components/platform-admin/org-detail/OrgStatCards';
import { OrgSeatLimitCard } from '@/components/platform-admin/org-detail/OrgSeatLimitCard';
import { SeatRequestsSection } from '@/components/platform-admin/org-detail/SeatRequestsSection';
import { MembersSection } from '@/components/platform-admin/org-detail/MembersSection';
import { AssignCourseDialog } from '@/components/assignments/AssignCourseDialog';
import { AssignmentsManager } from '@/components/assignments/AssignmentsManager';
import { PendingInvitationsList } from '@/components/platform-admin/org-detail/PendingInvitationsList';
import {
  RoleChangeDialog,
  type RoleChangeSelection,
} from '@/components/platform-admin/org-detail/RoleChangeDialog';
import {
  EditOrganizationDialog,
  type EditOrgPayload,
} from '@/components/platform-admin/org-detail/EditOrganizationDialog';
import { DeleteOrganizationDialog } from '@/components/platform-admin/org-detail/DeleteOrganizationDialog';
import { OrgNotFoundScreen } from '@/components/platform-admin/org-detail/OrgNotFoundScreen';
import { useQueryErrorToast } from '@/components/platform-admin/org-detail/useQueryErrorToast';

type Member = OrgMembership & { profile: Profile };

export default function OrganizationDetail() {
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const orgQuery = useOrgDetail(orgId);
  const membershipsQuery = useOrgMemberships(orgId);
  const invitationsQuery = useInvitations(orgId, 'platform');
  const { data: seatRequests = [] } = useSeatRequests(orgId);

  const org = orgQuery.data ?? null;
  const members = useMemo<Member[]>(() => membershipsQuery.data ?? [], [membershipsQuery.data]);
  const invitations = useMemo(() => invitationsQuery.data ?? [], [invitationsQuery.data]);

  const activeMembers = useMemo(() => members.filter((m) => m.status === 'active'), [members]);
  const adminCount = useMemo(
    () => activeMembers.filter((m) => m.role === 'org_admin').length,
    [activeMembers],
  );
  const learnerCount = useMemo(
    () => activeMembers.filter((m) => m.role === 'learner').length,
    [activeMembers],
  );

  useQueryErrorToast({
    isError: membershipsQuery.isError,
    error: membershipsQuery.error,
    toastTitle: 'Failed to load members',
    logLabel: 'OrganizationDetail: failed to load members',
  });
  useQueryErrorToast({
    isError: invitationsQuery.isError,
    error: invitationsQuery.error,
    toastTitle: 'Failed to load invitations',
    logLabel: 'OrganizationDetail: failed to load invitations',
  });
  useQueryErrorToast({
    isError: orgQuery.isError,
    error: orgQuery.error,
    toastTitle: 'Failed to load organization',
    logLabel: 'OrganizationDetail: failed to load organization',
  });

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [roleChangeDialog, setRoleChangeDialog] = useState<RoleChangeSelection | null>(null);
  const [updatingRoleId, setUpdatingRoleId] = useState<string | null>(null);
  const [assignDialog, setAssignDialog] = useState<{ open: boolean; presetUserId?: string }>({ open: false });

  const invalidateMemberships = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.orgMemberships.list(orgId) });
  const invalidateInvitations = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.invitations.list(orgId, 'platform') });

  const changeRoleMutation = useToastMutation({
    mutationFn: ({ member, newRole }: { member: Member; newRole: OrgRole }) =>
      callApi('/api/org-membership-update', { id: member.id, role: newRole }),
    errorTitle: 'Failed to change role',
    onSuccess: (_data, { member, newRole }) => {
      toast({
        title: 'Role updated',
        description: `${member.profile?.full_name} is now ${newRole === 'org_admin' ? 'an Admin' : 'a Learner'}.`,
      });
      invalidateMemberships();
    },
    onSettled: () => {
      setUpdatingRoleId(null);
    },
  });

  const disableMemberMutation = useToastMutation({
    mutationFn: (membershipId: string) =>
      callApi('/api/org-membership-update', { id: membershipId, status: 'disabled' }),
    errorTitle: 'Failed to disable member',
    onSuccess: () => {
      toast({
        title: 'Member disabled',
        description: 'The user can no longer access this organization.',
      });
      invalidateMemberships();
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.all });
    },
  });

  const reactivateMemberMutation = useToastMutation({
    mutationFn: (membershipId: string) =>
      callApi('/api/org-membership-update', { id: membershipId, status: 'active' }),
    errorTitle: 'Failed to reactivate member',
    onSuccess: () => {
      toast({
        title: 'Member reactivated',
        description: 'The user can now access this organization again.',
      });
      invalidateMemberships();
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.all });
    },
  });

  const cancelInvitationMutation = useToastMutation({
    mutationFn: (invitationId: string) =>
      callApi('/api/invitation-update', { id: invitationId, status: 'expired' }),
    errorTitle: 'Failed to cancel invitation',
    onSuccess: () => {
      toast({ title: 'Invitation cancelled' });
      invalidateInvitations();
      // Cancelling frees a seat: refresh pending_invite_count so the seat math
      // stays truthful.
      queryClient.invalidateQueries({ queryKey: queryKeys.orgDetail.detail(orgId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.all });
    },
  });

  const saveEditMutation = useToastMutation({
    mutationFn: (payload: EditOrgPayload) => {
      const updates: Record<string, unknown> = {
        name: payload.name,
        slug: payload.slug,
        logo_url: payload.logoUrl,
        seat_limit: payload.seatLimit ? parseInt(payload.seatLimit, 10) : null,
      };
      // #353: only send the SSO tenant binding when it actually changed, so an
      // unrelated edit never clobbers a binding auto-seeded (or edited elsewhere)
      // since this dialog opened. Empty string = clear (null).
      const nextTid = payload.entraTid.trim() || null;
      const nextLabel = payload.entraTidLabel.trim() || null;
      if (nextTid !== (org?.entra_tid ?? null)) updates.entra_tid = nextTid;
      if (nextLabel !== (org?.entra_tid_label ?? null)) updates.entra_tid_label = nextLabel;
      // #356: same change-only rule — an unrelated edit never rewrites the
      // per-org self-registration switch. Default true mirrors the DB default.
      if (payload.allowSelfRegistration !== (org?.allow_self_registration ?? true)) {
        updates.allow_self_registration = payload.allowSelfRegistration;
      }
      return callApi('/api/organization-update', { orgId, updates });
    },
    errorTitle: 'Failed to update organization',
    onSuccess: () => {
      toast({
        title: 'Organization updated',
        description: 'The organization details have been saved.',
      });
      setEditOpen(false);
      queryClient.invalidateQueries({ queryKey: queryKeys.orgDetail.detail(orgId) });
      // The shared org-list cache (OrganizationsManager / OrgSelector) must not
      // show a stale name/logo after an edit.
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.all });
    },
  });

  const deleteOrgMutation = useToastMutation({
    mutationFn: () => callApi('/api/organization-delete', { orgId }),
    errorTitle: 'Failed to delete organization',
    onSuccess: () => {
      toast({
        title: 'Organization deleted',
        description: 'The organization has been permanently deleted.',
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.all });
      navigate(routes.platformAdmin.organizations);
    },
  });

  const fulfilSeatRequestMutation = useToastMutation({
    mutationFn: (id: string) => callApi('/api/seat-request-fulfill', { id }),
    errorTitle: t('seatRequests.fulfil'),
    onSuccess: () => {
      toast({ title: t('seatRequests.fulfilled') });
      queryClient.invalidateQueries({ queryKey: queryKeys.seatRequests.list(orgId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.orgDetail.detail(orgId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.all });
    },
  });

  const handleConfirmRoleChange = () => {
    if (!roleChangeDialog?.member) return;
    const { member, newRole } = roleChangeDialog;
    setUpdatingRoleId(member.id);
    setRoleChangeDialog(null);
    changeRoleMutation.mutate({ member, newRole });
  };

  const handleSaveEdit = (payload: EditOrgPayload) => {
    const result = orgSchema.safeParse({ name: payload.name, slug: payload.slug });
    if (!result.success) {
      toast({
        title: 'Invalid input',
        description: result.error.errors[0].message,
        variant: 'destructive',
      });
      return;
    }
    saveEditMutation.mutate(payload);
  };

  const loading =
    orgQuery.isLoading ||
    membershipsQuery.isLoading ||
    invitationsQuery.isLoading;

  if (loading) {
    return (
      <AppLayout
        title={t('orgDetail.loadingBreadcrumb')}
        breadcrumbs={[
          { label: t('organizations.title'), href: routes.platformAdmin.organizations },
          { label: t('orgDetail.loadingBreadcrumb') },
        ]}
      >
        <PageSpinner />
      </AppLayout>
    );
  }

  if (!org) {
    return (
      <OrgNotFoundScreen
        loadFailed={orgQuery.isError}
        onRetry={() => orgQuery.refetch()}
        onBack={() => navigate(routes.platformAdmin.organizations)}
      />
    );
  }

  const seatUsage = getSeatUsage({
    activeMembers: activeMembers.length,
    pendingInvites: org.pending_invite_count ?? 0,
    seatLimit: org.seat_limit,
  });

  // OrgDetailHeader owns the page's single <h1> (the org name), so AppLayout's `title`
  // is omitted here to avoid a duplicate <h1> (#320). The loading branch above keeps
  // `title` since it has no in-page header — same split as OrganizationsManager / CoursesManager.
  return (
    <AppLayout
      breadcrumbs={[
        { label: t('organizations.title'), href: routes.platformAdmin.organizations },
        { label: org.name },
      ]}
    >
      <button
        type="button"
        onClick={() => navigate(routes.platformAdmin.organizations)}
        className="mb-3.5 inline-flex items-center gap-[7px] rounded-lg px-2 py-1.5 text-[13px] font-bold text-muted-foreground transition-colors hover:text-primary"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        {t('orgDetail.allOrganizations')}
      </button>

      <OrgDetailHeader org={org} onEdit={() => setEditOpen(true)} onDelete={() => setDeleteOpen(true)} />

      <OrgStatCards
        activeCount={activeMembers.length}
        usedSeats={seatUsage.usedSeats}
        adminCount={adminCount}
        learnerCount={learnerCount}
        pendingInviteCount={invitations.length}
        seatLimit={org.seat_limit}
      />

      {org.seat_limit ? (
        <OrgSeatLimitCard usedCount={seatUsage.usedSeats} seatLimit={org.seat_limit} />
      ) : null}

      <SeatRequestsSection
        requests={seatRequests}
        onFulfil={(id) => fulfilSeatRequestMutation.mutate(id)}
        fulfilingId={fulfilSeatRequestMutation.isPending ? (fulfilSeatRequestMutation.variables as string) : null}
      />

      <MembersSection
        members={members}
        updatingRoleId={updatingRoleId}
        onRoleChange={(member, newRole) => setRoleChangeDialog({ open: true, member, newRole })}
        onDisable={(id) => disableMemberMutation.mutate(id)}
        onReactivate={(id) => reactivateMemberMutation.mutate(id)}
        onAssignClick={() => setAssignDialog({ open: true })}
        onAssignCourse={(member) => setAssignDialog({ open: true, presetUserId: member.user_id })}
      />

      <AssignmentsManager orgId={org.id} />

      <AssignCourseDialog
        open={assignDialog.open}
        onOpenChange={(open) => setAssignDialog((s) => ({ ...s, open }))}
        orgId={org.id}
        orgName={org.name}
        members={members}
        presetUserId={assignDialog.presetUserId}
      />

      {invitations.length > 0 && (
        <PendingInvitationsList
          invitations={invitations}
          onCancel={(id) => cancelInvitationMutation.mutate(id)}
        />
      )}

      <RoleChangeDialog
        selection={roleChangeDialog}
        orgName={org.name}
        onOpenChange={(open) => !open && setRoleChangeDialog(null)}
        onConfirm={handleConfirmRoleChange}
      />

      <EditOrganizationDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        org={org}
        orgId={orgId}
        onSubmit={handleSaveEdit}
        pending={saveEditMutation.isPending}
      />

      <DeleteOrganizationDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        orgName={org.name}
        onConfirm={() => deleteOrgMutation.mutate()}
        pending={deleteOrgMutation.isPending}
      />
    </AppLayout>
  );
}
