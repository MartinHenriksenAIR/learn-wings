import { useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageSpinner } from '@/components/ui/page-spinner';
import { Button } from '@/components/ui/button';
import { useFlash } from '@/hooks/useFlash';
import { useToastMutation } from '@/hooks/useToastMutation';
import { useOrgDetail } from '@/hooks/useOrgDetail';
import { useOrgMemberships } from '@/hooks/useOrgMemberships';
import { useInvitations } from '@/hooks/useInvitations';
import { useProfiles } from '@/hooks/useProfiles';
import { callApi, ApiError } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { getSeatUsage } from '@/lib/seats';
import { OrgMembership, Profile, OrgRole } from '@/lib/types';
import { sendInvitationEmail } from '@/lib/sendInvitationEmail';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from '@/components/ui/sonner';
import { z } from 'zod';
import { orgSchema } from '@/lib/org-validation';
import { OrgDetailHeader } from '@/components/platform-admin/org-detail/OrgDetailHeader';
import { OrgStatCards } from '@/components/platform-admin/org-detail/OrgStatCards';
import { OrgSeatLimitCard } from '@/components/platform-admin/org-detail/OrgSeatLimitCard';
import { MembersSection } from '@/components/platform-admin/org-detail/MembersSection';
import { PendingInvitationsList } from '@/components/platform-admin/org-detail/PendingInvitationsList';
import {
  InviteUserDialog,
  type InvitePayload,
} from '@/components/platform-admin/org-detail/InviteUserDialog';
import {
  AddExistingUserDialog,
  type AddUserPayload,
} from '@/components/platform-admin/org-detail/AddExistingUserDialog';
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

const addUserSchema = z.object({
  userId: z.string().uuid('Please select a user'),
  role: z.enum(['org_admin', 'learner']),
});

const inviteSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  role: z.enum(['org_admin', 'learner']),
});

export default function OrganizationDetail() {
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  // ── Data layer (shared TanStack Query hooks) ───────────────────────────────
  const orgQuery = useOrgDetail(orgId);
  const membershipsQuery = useOrgMemberships(orgId);
  const invitationsQuery = useInvitations(orgId, 'platform');
  const profilesQuery = useProfiles();

  const org = orgQuery.data ?? null;
  const members = useMemo<Member[]>(() => membershipsQuery.data ?? [], [membershipsQuery.data]);
  const invitations = useMemo(() => invitationsQuery.data ?? [], [invitationsQuery.data]);

  // availableUsers = all profiles not present in ANY membership (active or not),
  // preserving the original's use of the full membership set.
  const availableUsers = useMemo<Profile[]>(() => {
    const profiles = profilesQuery.data ?? [];
    const memberUserIds = new Set(members.map((m) => m.user_id));
    return profiles.filter((p) => !memberUserIds.has(p.id));
  }, [profilesQuery.data, members]);

  const activeMembers = useMemo(() => members.filter((m) => m.status === 'active'), [members]);
  const adminCount = useMemo(
    () => activeMembers.filter((m) => m.role === 'org_admin').length,
    [activeMembers],
  );
  const learnerCount = useMemo(
    () => activeMembers.filter((m) => m.role === 'learner').length,
    [activeMembers],
  );

  // Query-error toasts reproduce TanStack v5's missing useQuery onError.
  // Members / invitations / org failures toast; the org one skips the 404→null
  // case (that surfaces as the not-found screen). Profiles is console-only.
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
  useQueryErrorToast({
    isError: profilesQuery.isError,
    error: profilesQuery.error,
    logLabel: 'OrganizationDetail: failed to load profiles',
  });

  // ── Dialog open + selection state ──────────────────────────────────────────
  const [inviteOpen, setInviteOpen] = useState(false);
  const [addUserOpen, setAddUserOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [roleChangeDialog, setRoleChangeDialog] = useState<RoleChangeSelection | null>(null);
  const [updatingRoleId, setUpdatingRoleId] = useState<string | null>(null);

  // In-button "Copied!" morph for the invite link, keyed by link id (toast
  // policy: copy is routine — no toast).
  const { flashed: copyFlashed, flash: flashCopy } = useFlash();

  // ── Mutations (targeted invalidation replaces imperative refetch) ──────────
  // `useToastMutation` bakes in the shared destructive-toast-on-failure idiom
  // (title + err.message); success behavior stays per-handler.
  const invalidateMemberships = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.orgMemberships.list(orgId) });
  const invalidateInvitations = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.invitations.list(orgId, 'platform') });

  const addUserMutation = useToastMutation({
    mutationFn: (payload: AddUserPayload) =>
      callApi('/api/org-membership-create', {
        orgId,
        userId: payload.userId,
        role: payload.role,
        status: 'active',
      }),
    errorTitle: 'Failed to add user',
    onSuccess: () => {
      toast({
        title: 'User added!',
        description: 'The user has been added to the organization.',
      });
      setAddUserOpen(false);
      invalidateMemberships();
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.all });
    },
  });

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

  const inviteMutation = useToastMutation({
    mutationFn: async (payload: InvitePayload) => {
      const { invitation } = await callApi<{ invitation: { id: string; link_id: string } }>(
        '/api/invitation-create',
        {
          orgId,
          email: payload.email,
          role: payload.role,
          firstName: payload.firstName.trim() || undefined,
          lastName: payload.lastName.trim() || undefined,
          department: payload.department.trim() || undefined,
        },
      );

      // Send invitation email using link_id returned directly by invitation-create.
      if (invitation?.link_id) {
        const emailResult = await sendInvitationEmail({
          email: payload.email,
          orgName: org?.name || null,
          role: payload.role,
          linkId: invitation.link_id,
        });

        if (emailResult.success) {
          toast({
            title: 'Invitation sent!',
            description: 'An email has been sent to the invited user.',
          });
        } else {
          console.error('Failed to send invitation email:', emailResult.error);
          toast({
            title: 'Invitation created',
            description: 'The invitation was created but the email could not be sent. You can copy the invite link manually.',
            variant: 'default',
          });
        }
      } else {
        toast({
          title: 'Invitation created!',
          description: 'Copy the invite link to share with the user.',
        });
      }
    },
    errorTitle: 'Failed to create invitation',
    onSuccess: () => {
      setInviteOpen(false);
      invalidateInvitations();
      // A new pending invite consumes a seat: refresh the org's server-computed
      // pending_invite_count (detail + shared list) so "seats used / remaining"
      // updates immediately.
      queryClient.invalidateQueries({ queryKey: queryKeys.orgDetail.detail(orgId) });
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
      navigate('/app/admin/organizations');
    },
  });

  // ── Handlers (validation + selection wiring) ───────────────────────────────
  const handleAddUser = (payload: AddUserPayload) => {
    const result = addUserSchema.safeParse({ userId: payload.userId, role: payload.role });
    if (!result.success) {
      toast({
        title: 'Invalid input',
        description: result.error.errors[0].message,
        variant: 'destructive',
      });
      return;
    }
    addUserMutation.mutate(payload);
  };

  const handleInvite = (payload: InvitePayload) => {
    const result = inviteSchema.safeParse({ email: payload.email, role: payload.role });
    if (!result.success) {
      toast({
        title: 'Invalid input',
        description: result.error.errors[0].message,
        variant: 'destructive',
      });
      return;
    }
    inviteMutation.mutate(payload);
  };

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

  const handleCopyInviteLink = async (linkId: string) => {
    const link = `${window.location.origin}/signup?invite=${linkId}`;
    await navigator.clipboard.writeText(link);
    // In-button "Copied!" morph instead of a toast (toast policy: copy is routine).
    flashCopy(linkId);
  };

  // ── Three-way render: spinner → not-found/load-failed → content ────────────
  const loading =
    orgQuery.isLoading ||
    membershipsQuery.isLoading ||
    invitationsQuery.isLoading ||
    profilesQuery.isLoading;

  if (loading) {
    return (
      <AppLayout
        title={t('orgDetail.loadingBreadcrumb')}
        breadcrumbs={[
          { label: t('organizations.title'), href: '/app/admin/organizations' },
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
        onBack={() => navigate('/app/admin/organizations')}
      />
    );
  }

  // Seats consumed = active members + server-computed pending invites.
  const seatUsage = getSeatUsage({
    activeMembers: activeMembers.length,
    pendingInvites: org.pending_invite_count ?? 0,
    seatLimit: org.seat_limit,
  });

  // Surface the backend seat cap (409) inline in the invite dialog, in addition
  // to the failure toast, so it doesn't read as a generic error.
  const inviteErrorMessage =
    inviteMutation.error instanceof ApiError &&
    inviteMutation.error.code === 'SEAT_LIMIT_REACHED'
      ? inviteMutation.error.message
      : null;

  return (
    <AppLayout
      title={org.name}
      breadcrumbs={[
        { label: t('organizations.title'), href: '/app/admin/organizations' },
        { label: org.name },
      ]}
    >
      {/* Back link */}
      <button
        type="button"
        onClick={() => navigate('/app/admin/organizations')}
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

      <MembersSection
        members={members}
        updatingRoleId={updatingRoleId}
        onInviteClick={() => {
          inviteMutation.reset();
          setInviteOpen(true);
        }}
        onAddUserClick={() => setAddUserOpen(true)}
        onRoleChange={(member, newRole) => setRoleChangeDialog({ open: true, member, newRole })}
        onDisable={(id) => disableMemberMutation.mutate(id)}
        onReactivate={(id) => reactivateMemberMutation.mutate(id)}
      />

      {invitations.length > 0 && (
        <PendingInvitationsList
          invitations={invitations}
          isCopied={copyFlashed}
          onCopy={handleCopyInviteLink}
          onCancel={(id) => cancelInvitationMutation.mutate(id)}
        />
      )}

      <InviteUserDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        orgName={org.name}
        seatUsage={seatUsage}
        errorMessage={inviteErrorMessage}
        onSubmit={handleInvite}
        pending={inviteMutation.isPending}
      />

      <AddExistingUserDialog
        open={addUserOpen}
        onOpenChange={setAddUserOpen}
        orgName={org.name}
        availableUsers={availableUsers}
        onSubmit={handleAddUser}
        pending={addUserMutation.isPending}
      />

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
