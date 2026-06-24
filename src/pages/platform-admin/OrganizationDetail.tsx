import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { EmptyState } from '@/components/ui/empty-state';
import { PageSpinner } from '@/components/ui/page-spinner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { StatCard } from '@/components/ui/stat-card';
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
import { FileUpload } from '@/components/ui/file-upload';
import { useFlash } from '@/hooks/useFlash';
import { callApi, ApiError } from '@/lib/api-client';
import { cn, getAvatarColor, getInitials } from '@/lib/utils';
import { Organization, OrgMembership, Profile, OrgRole, Invitation } from '@/lib/types';
import { sendInvitationEmail } from '@/lib/sendInvitationEmail';
import { buildPublicUrl } from '@/lib/storage-url';
import { SeatUsageBar } from '@/components/platform-admin/SeatUsageBar';
import {
  Building2,
  Users,
  MoreHorizontal,
  Loader2,
  UserX,
  ShieldCheck,
  User,
  UserPlus,
  ArrowLeft,
  Mail,
  Copy,
  Check,
  Pencil,
  Trash2,
  UsersRound,
  RefreshCw,
} from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';
import { toast } from '@/components/ui/sonner';
import { z } from 'zod';
import { orgSchema } from '@/lib/org-validation';

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

  const [org, setOrg] = useState<Organization | null>(null);
  const [orgError, setOrgError] = useState<'not_found' | 'load_failed' | null>(null);
  const [members, setMembers] = useState<(OrgMembership & { profile: Profile })[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [availableUsers, setAvailableUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  const [addUserOpen, setAddUserOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [selectedRole, setSelectedRole] = useState<OrgRole>('learner');
  const [adding, setAdding] = useState(false);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteFirstName, setInviteFirstName] = useState('');
  const [inviteLastName, setInviteLastName] = useState('');
  const [inviteDepartment, setInviteDepartment] = useState('');
  const [inviteRole, setInviteRole] = useState<OrgRole>('learner');
  const [inviting, setInviting] = useState(false);
  // In-button "Copied!" morph for the invite link, keyed by link id (toast
  // policy: copy is routine — no toast).
  const { flashed: copyFlashed, flash: flashCopy } = useFlash();

  const [roleChangeDialog, setRoleChangeDialog] = useState<{
    open: boolean;
    member: (OrgMembership & { profile: Profile }) | null;
    newRole: OrgRole;
  } | null>(null);
  const [updatingRole, setUpdatingRole] = useState<string | null>(null);

  // Edit organization state
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editSlug, setEditSlug] = useState('');
  const [editLogoUrl, setEditLogoUrl] = useState<string | null>(null);
  const [editSeatLimit, setEditSeatLimit] = useState<string>('');
  const [saving, setSaving] = useState(false);

  // Delete organization state
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const fetchData = async () => {
    if (!orgId) return;

    // Fetch organization
    try {
      const { organization } = await callApi<{ organization: Organization }>('/api/organizations', { orgId });
      if (organization) setOrg(organization);
      setOrgError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setOrgError('not_found');
      } else {
        setOrgError('load_failed');
        toast({
          title: 'Failed to load organization',
          description: err instanceof Error ? err.message : 'Unknown error',
          variant: 'destructive',
        });
      }
      console.error('OrganizationDetail: failed to load organization', err);
    }

    // Fetch members
    type MembershipRow = {
      id: string;
      org_id: string;
      user_id: string;
      role: OrgRole;
      status: 'active' | 'invited' | 'disabled';
      created_at: string;
      full_name: string;
      email: string;
      avatar_url: string | null;
      department: string | null;
    };
    let memberRows: MembershipRow[] = [];
    try {
      const { memberships } = await callApi<{ memberships: MembershipRow[] }>(
        '/api/org-memberships',
        { orgId },
      );
      memberRows = memberships;
      const reshaped: (OrgMembership & { profile: Profile })[] = memberships.map((row) => ({
        id: row.id,
        org_id: row.org_id,
        user_id: row.user_id,
        role: row.role,
        status: row.status,
        created_at: row.created_at,
        profile: {
          id: row.user_id,
          full_name: row.full_name,
          first_name: null,
          last_name: null,
          department: row.department,
          is_platform_admin: false,
          created_at: row.created_at,
          preferred_language: null,
        },
      }));
      setMembers(reshaped);
    } catch (err) {
      toast({
        title: 'Failed to load members',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
      console.error('OrganizationDetail: failed to load members', err);
    }

    // Fetch pending invitations (endpoint already filters to status = 'pending')
    try {
      const { invitations } = await callApi<{ invitations: Invitation[] }>(
        '/api/invitations',
        { scope: 'platform', orgId },
      );
      setInvitations(invitations);
    } catch (err) {
      toast({
        title: 'Failed to load invitations',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
      console.error('OrganizationDetail: failed to load invitations', err);
    }

    // Fetch all users to find ones not in this org
    try {
      const { profiles: allProfiles } = await callApi<{ profiles: Profile[] }>('/api/profiles', {});
      if (allProfiles) {
        const memberUserIds = new Set(memberRows.map((m) => m.user_id));
        const available = allProfiles.filter((p) => !memberUserIds.has(p.id));
        setAvailableUsers(available);
      }
    } catch (err) {
      console.error('OrganizationDetail: failed to load profiles', err);
    }

    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, [orgId]);

  const handleAddUser = async () => {
    const result = addUserSchema.safeParse({ userId: selectedUserId, role: selectedRole });
    if (!result.success) {
      toast({
        title: 'Invalid input',
        description: result.error.errors[0].message,
        variant: 'destructive',
      });
      return;
    }

    setAdding(true);
    try {
      await callApi('/api/org-membership-create', {
        orgId,
        userId: selectedUserId,
        role: selectedRole,
        status: 'active',
      });
      toast({
        title: 'User added!',
        description: 'The user has been added to the organization.',
      });
      setAddUserOpen(false);
      setSelectedUserId('');
      setSelectedRole('learner');
      fetchData();
    } catch (err) {
      toast({
        title: 'Failed to add user',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setAdding(false);
    }
  };

  const handleChangeRole = async () => {
    if (!roleChangeDialog?.member) return;

    const { member, newRole } = roleChangeDialog;
    setUpdatingRole(member.id);
    setRoleChangeDialog(null);

    try {
      await callApi('/api/org-membership-update', { id: member.id, role: newRole });
      toast({
        title: 'Role updated',
        description: `${member.profile?.full_name} is now ${newRole === 'org_admin' ? 'an Admin' : 'a Learner'}.`,
      });
      fetchData();
    } catch (err) {
      toast({
        title: 'Failed to change role',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setUpdatingRole(null);
    }
  };

  const handleDisableMember = async (membershipId: string) => {
    try {
      await callApi('/api/org-membership-update', { id: membershipId, status: 'disabled' });
      toast({
        title: 'Member disabled',
        description: 'The user can no longer access this organization.',
      });
      fetchData();
    } catch (err) {
      toast({
        title: 'Failed to disable member',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const handleReactivateMember = async (membershipId: string) => {
    try {
      await callApi('/api/org-membership-update', { id: membershipId, status: 'active' });
      toast({
        title: 'Member reactivated',
        description: 'The user can now access this organization again.',
      });
      fetchData();
    } catch (err) {
      toast({
        title: 'Failed to reactivate member',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const handleInvite = async () => {
    const result = inviteSchema.safeParse({ email: inviteEmail, role: inviteRole });
    if (!result.success) {
      toast({
        title: 'Invalid input',
        description: result.error.errors[0].message,
        variant: 'destructive',
      });
      return;
    }

    setInviting(true);

    try {
      const { invitation } = await callApi<{ invitation: { id: string; link_id: string } }>(
        '/api/invitation-create',
        {
          orgId,
          email: inviteEmail,
          role: inviteRole,
          firstName: inviteFirstName.trim() || undefined,
          lastName: inviteLastName.trim() || undefined,
          department: inviteDepartment.trim() || undefined,
        },
      );

      // Send invitation email using link_id returned directly by invitation-create
      if (invitation?.link_id) {
        const emailResult = await sendInvitationEmail({
          email: inviteEmail,
          orgName: org?.name || null,
          role: inviteRole,
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

      setInviteOpen(false);
      setInviteEmail('');
      setInviteFirstName('');
      setInviteLastName('');
      setInviteDepartment('');
      setInviteRole('learner');
      fetchData();
    } catch (err) {
      toast({
        title: 'Failed to create invitation',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setInviting(false);
    }
  };

  const handleCopyInviteLink = async (linkId: string) => {
    const link = `${window.location.origin}/signup?invite=${linkId}`;
    await navigator.clipboard.writeText(link);
    // In-button "Copied!" morph instead of a toast (toast policy: copy is routine).
    flashCopy(linkId);
  };

  const handleCancelInvitation = async (invitationId: string) => {
    try {
      await callApi('/api/invitation-update', { id: invitationId, status: 'expired' });
      toast({
        title: 'Invitation cancelled',
      });
      fetchData();
    } catch (err) {
      toast({
        title: 'Failed to cancel invitation',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const handleOpenEdit = () => {
    if (org) {
      setEditName(org.name);
      setEditSlug(org.slug);
      setEditLogoUrl(org.logo_url || null);
      setEditSeatLimit(org.seat_limit?.toString() || '');
      setEditOpen(true);
    }
  };

  const handleSaveEdit = async () => {
    const result = orgSchema.safeParse({ name: editName, slug: editSlug });
    if (!result.success) {
      toast({
        title: 'Invalid input',
        description: result.error.errors[0].message,
        variant: 'destructive',
      });
      return;
    }

    setSaving(true);
    try {
      const updates: Record<string, unknown> = {
        name: editName,
        slug: editSlug,
        logo_url: editLogoUrl,
        seat_limit: editSeatLimit ? parseInt(editSeatLimit, 10) : null,
      };
      await callApi('/api/organization-update', { orgId, updates });
      toast({
        title: 'Organization updated',
        description: 'The organization details have been saved.',
      });
      setEditOpen(false);
      fetchData();
    } catch (err) {
      toast({
        title: 'Failed to update organization',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteOrg = async () => {
    setDeleting(true);
    try {
      await callApi('/api/organization-delete', { orgId });
      toast({
        title: 'Organization deleted',
        description: 'The organization has been permanently deleted.',
      });
      navigate('/app/admin/organizations');
    } catch (err) {
      toast({
        title: 'Failed to delete organization',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setDeleting(false);
    }
  };

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
    const loadFailed = orgError === 'load_failed';
    return (
      <AppLayout
        title={loadFailed ? t('orgDetail.loadFailedTitle') : t('orgDetail.notFoundTitle')}
        breadcrumbs={[
          { label: t('organizations.title'), href: '/app/admin/organizations' },
          { label: loadFailed ? t('orgDetail.loadFailedTitle') : t('orgDetail.notFoundBreadcrumb') },
        ]}
      >
        <div className="flex h-64 flex-col items-center justify-center text-center">
          <Building2 className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <p className="text-muted-foreground">
            {loadFailed ? t('orgDetail.loadFailedDescription') : t('orgDetail.notFoundDescription')}
          </p>
          <div className="mt-4 flex gap-2">
            {loadFailed && (
              <Button
                onClick={() => {
                  setLoading(true);
                  fetchData();
                }}
              >
                <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
                {t('orgDetail.tryAgain')}
              </Button>
            )}
            <Button variant="outline" onClick={() => navigate('/app/admin/organizations')}>
              <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
              {t('orgDetail.backToOrganizations')}
            </Button>
          </div>
        </div>
      </AppLayout>
    );
  }

  const activeMembers = members.filter((m) => m.status === 'active');
  const seatLimitReached = !!org.seat_limit && activeMembers.length >= org.seat_limit;
  const adminCount = activeMembers.filter((m) => m.role === 'org_admin').length;
  const learnerCount = activeMembers.filter((m) => m.role === 'learner').length;

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

      {/* Header: icon chip + name/slug + actions */}
      <div className="mb-6 flex flex-wrap items-center gap-4">
        {org.logo_url ? (
          <img src={org.logo_url} alt="" className="h-14 w-14 shrink-0 rounded-2xl bg-muted object-contain" />
        ) : (
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-accent text-primary">
            <Building2 className="h-[26px] w-[26px]" aria-hidden="true" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-extrabold tracking-[-0.02em]">{org.name}</h1>
          <p className="truncate font-mono text-[13px] text-muted-foreground">
            {org.slug} · {new Date(org.created_at).toLocaleDateString()}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" onClick={handleOpenEdit}>
            <Pencil className="mr-2 h-4 w-4" aria-hidden="true" />
            {t('orgDetail.editSeatLimit')}
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setDeleteOpen(true)}
            className="text-destructive hover:bg-destructive/10"
            aria-label={t('orgDetail.deleteOrganization')}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="mb-6 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<UsersRound className="h-[18px] w-[18px]" />}
          value={
            <>
              {activeMembers.length}
              {org.seat_limit ? (
                <span className="text-base font-normal text-muted-foreground"> / {org.seat_limit}</span>
              ) : null}
            </>
          }
          label={org.seat_limit ? t('orgDetail.seatsUsed') : t('orgDetail.activeMembers')}
        />
        <StatCard
          icon={<ShieldCheck className="h-[18px] w-[18px]" />}
          value={adminCount}
          label={t('orgDetail.admins')}
        />
        <StatCard
          icon={<User className="h-[18px] w-[18px]" />}
          value={learnerCount}
          label={t('orgDetail.learners')}
        />
        <StatCard
          icon={<Mail className="h-[18px] w-[18px]" />}
          value={invitations.length}
          label={t('orgDetail.pendingInvites')}
        />
      </div>

      {/* Seat-limit usage bar — shown when a limit exists; the SEAT_LIMIT_REACHED
          warning is preserved. */}
      {org.seat_limit ? (
        <div className="mb-6 rounded-2xl border border-border bg-card px-5 py-4">
          <div className="flex items-center justify-between">
            <span className="text-[12.5px] font-bold text-[#4a4f60]">{t('orgDetail.seatLimit')}</span>
            <span className={cn('text-[12.5px] font-bold', seatLimitReached ? 'text-destructive' : 'text-muted-foreground')}>
              {activeMembers.length}/{org.seat_limit}
            </span>
          </div>
          <SeatUsageBar
            used={activeMembers.length}
            limit={org.seat_limit}
            className="mt-2 h-[6px]"
          />
          {seatLimitReached && (
            <p className="mt-2 text-xs font-medium text-destructive">{t('orgDetail.seatLimitReached')}</p>
          )}
        </div>
      ) : null}

      {/* Members section header + actions */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[17px] font-extrabold">{t('orgDetail.members')}</h2>
        <div className="flex gap-2">
          {/* Invite User Dialog */}
          <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Mail className="mr-2 h-4 w-4" aria-hidden="true" />
                {t('orgDetail.inviteUser')}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t('orgDetail.inviteDialogTitle', { org: org.name })}</DialogTitle>
                <DialogDescription>{t('orgDetail.inviteDialogDescription')}</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="invite-email">{t('orgDetail.emailAddress')}</Label>
                  <Input
                    id="invite-email"
                    type="email"
                    placeholder="colleague@company.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="invite-first-name">{t('orgDetail.firstName')}</Label>
                    <Input
                      id="invite-first-name"
                      placeholder="John"
                      value={inviteFirstName}
                      onChange={(e) => setInviteFirstName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="invite-last-name">{t('orgDetail.lastName')}</Label>
                    <Input
                      id="invite-last-name"
                      placeholder="Doe"
                      value={inviteLastName}
                      onChange={(e) => setInviteLastName(e.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="invite-department">{t('orgDetail.department')}</Label>
                  <Input
                    id="invite-department"
                    placeholder="Engineering"
                    value={inviteDepartment}
                    onChange={(e) => setInviteDepartment(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('orgDetail.role')}</Label>
                  <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as OrgRole)}>
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
                <Button variant="outline" onClick={() => setInviteOpen(false)}>
                  {t('common.cancel')}
                </Button>
                <Button onClick={handleInvite} disabled={inviting}>
                  {inviting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Mail className="mr-2 h-4 w-4" aria-hidden="true" />
                  )}
                  {t('orgDetail.createInvitation')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Add Existing User Dialog */}
          <Dialog open={addUserOpen} onOpenChange={setAddUserOpen}>
            <DialogTrigger asChild>
              <Button>
                <UserPlus className="mr-2 h-4 w-4" aria-hidden="true" />
                {t('orgDetail.addMember')}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t('orgDetail.addDialogTitle', { org: org.name })}</DialogTitle>
                <DialogDescription>{t('orgDetail.addDialogDescription')}</DialogDescription>
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
              <DialogFooter>
                <Button variant="outline" onClick={() => setAddUserOpen(false)}>
                  {t('common.cancel')}
                </Button>
                <Button onClick={handleAddUser} disabled={adding || !selectedUserId}>
                  {adding && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                  {t('orgDetail.addUser')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Members list */}
      {members.length === 0 ? (
        <EmptyState
          icon={<Users className="h-6 w-6" />}
          title={t('orgDetail.noMembersTitle')}
          description={t('orgDetail.noMembersDescription')}
          action={
            <Button onClick={() => setAddUserOpen(true)}>
              <UserPlus className="mr-2 h-4 w-4" aria-hidden="true" />
              {t('orgDetail.addUser')}
            </Button>
          }
        />
      ) : (
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
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarFallback
                      className="text-[11px] font-bold text-white"
                      style={{ backgroundColor: getAvatarColor(member.profile?.full_name) }}
                    >
                      {getInitials(member.profile?.full_name, '??')}
                    </AvatarFallback>
                  </Avatar>
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
                      <Button variant="ghost" size="icon" disabled={updatingRole === member.id}>
                        {updatingRole === member.id ? (
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
                            <DropdownMenuItem
                              onClick={() =>
                                setRoleChangeDialog({
                                  open: true,
                                  member,
                                  newRole: 'org_admin',
                                })
                              }
                            >
                              <ShieldCheck className="mr-2 h-4 w-4" aria-hidden="true" />
                              {t('orgDetail.promoteToAdmin')}
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              onClick={() =>
                                setRoleChangeDialog({
                                  open: true,
                                  member,
                                  newRole: 'learner',
                                })
                              }
                            >
                              <User className="mr-2 h-4 w-4" aria-hidden="true" />
                              {t('orgDetail.changeToLearner')}
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => handleDisableMember(member.id)}
                            className="text-destructive"
                          >
                            <UserX className="mr-2 h-4 w-4" aria-hidden="true" />
                            {t('orgDetail.disableAccess')}
                          </DropdownMenuItem>
                        </>
                      )}
                      {member.status === 'disabled' && (
                        <DropdownMenuItem onClick={() => handleReactivateMember(member.id)}>
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
      )}

      {/* Pending Invitations */}
      {invitations.length > 0 && (
        <>
          <h2 className="mb-3 text-[17px] font-extrabold">{t('orgDetail.pendingInvitations')}</h2>
          <div className="mb-6 overflow-hidden rounded-2xl border border-border bg-card">
            {invitations.map((invitation) => {
              const copied = copyFlashed(invitation.link_id);
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
                      {t('orgDetail.expiresOn', { date: new Date(invitation.expires_at).toLocaleDateString() })}
                    </span>
                  </span>
                  <span
                    className={cn(
                      'inline-flex items-center rounded-[7px] px-2.5 py-1 text-[11px] font-bold',
                      invitation.role === 'org_admin' ? 'bg-accent text-primary' : 'bg-[#f3f4f8] text-[#686d7e]',
                    )}
                  >
                    {invitation.role === 'org_admin' ? t('orgDetail.admin') : t('orgDetail.learner')}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopyInviteLink(invitation.link_id)}
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
                    {copied ? t('orgDetail.copied') : t('orgDetail.copyLink')}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCancelInvitation(invitation.id)}
                    className="rounded-lg px-2.5 py-[7px] text-xs font-bold text-[#9aa0af] transition-colors hover:text-destructive"
                  >
                    {t('orgDetail.cancelInvite')}
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
          uncontrolled to controlled and triggers a React console warning. */}
      <AlertDialog
        open={!!roleChangeDialog?.open}
        onOpenChange={(open) => !open && setRoleChangeDialog(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {roleChangeDialog?.newRole === 'org_admin'
                ? t('orgDetail.promoteTitle')
                : t('orgDetail.changeToLearnerTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {roleChangeDialog?.newRole === 'org_admin' ? (
                <Trans
                  i18nKey="orgDetail.promoteDescription"
                  values={{ name: roleChangeDialog?.member?.profile?.full_name, org: org.name }}
                  components={[<strong key="0" />]}
                />
              ) : (
                <Trans
                  i18nKey="orgDetail.demoteDescription"
                  values={{ name: roleChangeDialog?.member?.profile?.full_name }}
                  components={[<strong key="0" />]}
                />
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleChangeRole}>
              {roleChangeDialog?.newRole === 'org_admin'
                ? t('orgDetail.promoteToAdmin')
                : t('orgDetail.changeToLearner')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit Organization Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('orgDetail.editDialogTitle')}</DialogTitle>
            <DialogDescription>{t('orgDetail.editDialogDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>{t('orgDetail.logo')}</Label>
              <div className="border-2 border-dashed rounded-lg p-4 mb-3">
                <div className="flex flex-col items-center gap-2 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
                    <Building2 className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium">{t('orgDetail.logoRecommended')}</p>
                    <p className="text-xs text-muted-foreground">{t('orgDetail.logoSize')}</p>
                    <p className="text-xs text-muted-foreground">{t('orgDetail.logoFormat')}</p>
                  </div>
                </div>
              </div>
              <FileUpload
                bucket="org-logos"
                folder={orgId}
                accept="image"
                value={editLogoUrl}
                onChange={(url, storagePath) => {
                  if (url && storagePath) {
                    setEditLogoUrl(buildPublicUrl(storagePath));
                  } else {
                    setEditLogoUrl(null);
                  }
                }}
                maxSizeMB={5}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-name">{t('orgDetail.organizationName')}</Label>
              <Input
                id="edit-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Acme Corp"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-slug">{t('orgDetail.slug')}</Label>
              <Input
                id="edit-slug"
                value={editSlug}
                onChange={(e) => setEditSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                placeholder="acme-corp"
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">{t('orgDetail.slugHint')}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-seat-limit">{t('orgDetail.seatLimitLabel')}</Label>
              <Input
                id="edit-seat-limit"
                type="number"
                min="1"
                placeholder="Unlimited"
                value={editSeatLimit}
                onChange={(e) => setEditSeatLimit(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t('orgDetail.seatLimitHint')}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleSaveEdit} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Organization Confirmation */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('orgDetail.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              <Trans
                i18nKey="orgDetail.deleteDescription"
                values={{ name: org.name }}
                components={[<strong key="0" />]}
              />
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteOrg}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              {t('orgDetail.deleteOrganization')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
