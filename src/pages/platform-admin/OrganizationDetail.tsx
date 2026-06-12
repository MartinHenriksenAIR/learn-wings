import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
import { callApi, ApiError } from '@/lib/api-client';
import { Organization, OrgMembership, Profile, OrgRole, Invitation } from '@/lib/types';
import { sendInvitationEmail } from '@/lib/sendInvitationEmail';
import { buildPublicUrl } from '@/lib/storage-url';
import {
  Building2,
  Users,
  Plus,
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
import { useTranslation } from 'react-i18next';
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
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

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
    setCopiedToken(linkId);
    toast({
      title: 'Link copied!',
      description: 'Share this link with the invited user.',
    });
    setTimeout(() => setCopiedToken(null), 2000);
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

  const roleColors = {
    org_admin: 'bg-purple-100 text-purple-800',
    learner: 'bg-blue-100 text-blue-800',
  };

  const statusColors = {
    active: 'bg-green-100 text-green-800',
    invited: 'bg-yellow-100 text-yellow-800',
    disabled: 'bg-red-100 text-red-800',
  };

  if (loading) {
    return (
      <AppLayout title="Organization" breadcrumbs={[{ label: 'Organizations', href: '/app/admin/organizations' }, { label: 'Loading...' }]}>
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-accent" />
        </div>
      </AppLayout>
    );
  }

  if (!org) {
    const loadFailed = orgError === 'load_failed';
    return (
      <AppLayout
        title={loadFailed ? t('orgDetail.loadFailedTitle') : 'Organization Not Found'}
        breadcrumbs={[
          { label: 'Organizations', href: '/app/admin/organizations' },
          { label: loadFailed ? t('orgDetail.loadFailedTitle') : 'Not Found' },
        ]}
      >
        <div className="flex h-64 flex-col items-center justify-center text-center">
          <Building2 className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <p className="text-muted-foreground">
            {loadFailed ? t('orgDetail.loadFailedDescription') : 'Organization not found.'}
          </p>
          <div className="mt-4 flex gap-2">
            {loadFailed && (
              <Button
                onClick={() => {
                  setLoading(true);
                  fetchData();
                }}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                {t('orgDetail.tryAgain')}
              </Button>
            )}
            <Button variant="outline" onClick={() => navigate('/app/admin/organizations')}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Organizations
            </Button>
          </div>
        </div>
      </AppLayout>
    );
  }

  const activeMembers = members.filter((m) => m.status === 'active');
  const disabledMembers = members.filter((m) => m.status === 'disabled');

  return (
    <AppLayout
      title={org.name}
      breadcrumbs={[
        { label: 'Organizations', href: '/app/admin/organizations' },
        { label: org.name },
      ]}
    >
      {/* Header with org info and actions */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          {org.logo_url ? (
            <img src={org.logo_url} alt={org.name} className="h-14 w-14 rounded-xl object-contain bg-muted" />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10">
              <Building2 className="h-7 w-7 text-primary" />
            </div>
          )}
          <div>
            <h2 className="text-xl font-semibold">{org.name}</h2>
            <p className="text-sm text-muted-foreground">/{org.slug}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={handleOpenEdit}>
            <Pencil className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex gap-2">
          {/* Invite User Dialog */}
          <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Mail className="mr-2 h-4 w-4" />
                Invite User
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Invite User to {org.name}</DialogTitle>
                <DialogDescription>
                  Send an invitation email to join this organization.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="invite-email">Email Address</Label>
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
                    <Label htmlFor="invite-first-name">First Name</Label>
                    <Input
                      id="invite-first-name"
                      placeholder="John"
                      value={inviteFirstName}
                      onChange={(e) => setInviteFirstName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="invite-last-name">Last Name</Label>
                    <Input
                      id="invite-last-name"
                      placeholder="Doe"
                      value={inviteLastName}
                      onChange={(e) => setInviteLastName(e.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="invite-department">Department</Label>
                  <Input
                    id="invite-department"
                    placeholder="Engineering"
                    value={inviteDepartment}
                    onChange={(e) => setInviteDepartment(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Role</Label>
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
              <DialogFooter>
                <Button variant="outline" onClick={() => setInviteOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleInvite} disabled={inviting}>
                  {inviting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Mail className="mr-2 h-4 w-4" />
                  )}
                  Create Invitation
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Add Existing User Dialog */}
          <Dialog open={addUserOpen} onOpenChange={setAddUserOpen}>
            <DialogTrigger asChild>
              <Button>
                <UserPlus className="mr-2 h-4 w-4" />
                Add User
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add User to {org.name}</DialogTitle>
                <DialogDescription>
                  Select an existing user and assign them a role in this organization.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>User</Label>
                  <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a user..." />
                    </SelectTrigger>
                    <SelectContent>
                      {availableUsers.length === 0 ? (
                        <div className="px-2 py-4 text-center text-sm text-muted-foreground">
                          All users are already members
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
                  <Label>Role</Label>
                  <Select value={selectedRole} onValueChange={(v) => setSelectedRole(v as OrgRole)}>
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
              <DialogFooter>
                <Button variant="outline" onClick={() => setAddUserOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleAddUser} disabled={adding || !selectedUserId}>
                  {adding && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Add User
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Delete Button */}
          <Button variant="outline" size="icon" onClick={() => setDeleteOpen(true)} className="text-destructive hover:bg-destructive/10">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <UsersRound className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-2xl font-bold">
                  {activeMembers.length}
                  {org.seat_limit ? <span className="text-base font-normal text-muted-foreground"> / {org.seat_limit}</span> : ''}
                </p>
                <p className="text-sm text-muted-foreground">
                  {org.seat_limit ? 'Seats Used' : 'Active Members'}
                </p>
              </div>
            </div>
            {org.seat_limit && activeMembers.length >= org.seat_limit && (
              <p className="mt-2 text-xs text-destructive font-medium">Seat limit reached</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <ShieldCheck className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-2xl font-bold">
                  {activeMembers.filter((m) => m.role === 'org_admin').length}
                </p>
                <p className="text-sm text-muted-foreground">Admins</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <User className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-2xl font-bold">
                  {activeMembers.filter((m) => m.role === 'learner').length}
                </p>
                <p className="text-sm text-muted-foreground">Learners</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Mail className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-2xl font-bold">{invitations.length}</p>
                <p className="text-sm text-muted-foreground">Pending Invites</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Pending Invitations */}
      {invitations.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Pending Invitations</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {invitations.map((invitation) => (
                <div
                  key={invitation.id}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div className="flex items-center gap-3">
                    <Mail className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="font-medium">{invitation.email}</p>
                      <p className="text-xs text-muted-foreground">
                        Expires {new Date(invitation.expires_at).toLocaleDateString()}
                      </p>
                    </div>
                    <Badge className={roleColors[invitation.role]}>
                      {invitation.role === 'org_admin' ? 'Admin' : 'Learner'}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleCopyInviteLink(invitation.link_id)}
                    >
                      {copiedToken === invitation.link_id ? (
                        <Check className="h-4 w-4" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleCancelInvitation(invitation.id)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Members Table */}
      {members.length === 0 ? (
        <EmptyState
          icon={<Users className="h-6 w-6" />}
          title="No members yet"
          description="Add users to this organization to get started."
          action={
            <Button onClick={() => setAddUserOpen(true)}>
              <UserPlus className="mr-2 h-4 w-4" />
              Add User
            </Button>
          }
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Members</CardTitle>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Added</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => (
                <TableRow key={member.id} className={member.status === 'disabled' ? 'opacity-60' : ''}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary font-medium">
                        {member.profile?.full_name?.charAt(0).toUpperCase() || '?'}
                      </div>
                      <span className="font-medium">{member.profile?.full_name}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge className={roleColors[member.role]}>
                      {member.role === 'org_admin' ? 'Admin' : 'Learner'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={statusColors[member.status]}>
                      {member.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(member.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" disabled={updatingRole === member.id}>
                          {updatingRole === member.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <MoreHorizontal className="h-4 w-4" />
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
                                <ShieldCheck className="mr-2 h-4 w-4" />
                                Promote to Admin
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
                                <User className="mr-2 h-4 w-4" />
                                Change to Learner
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => handleDisableMember(member.id)}
                              className="text-destructive"
                            >
                              <UserX className="mr-2 h-4 w-4" />
                              Disable Access
                            </DropdownMenuItem>
                          </>
                        )}
                        {member.status === 'disabled' && (
                          <DropdownMenuItem onClick={() => handleReactivateMember(member.id)}>
                            <User className="mr-2 h-4 w-4" />
                            Reactivate
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Role Change Confirmation Dialog */}
      <AlertDialog
        open={roleChangeDialog?.open}
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
                  manage team members, view analytics, and control settings for {org.name}.
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

      {/* Edit Organization Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Organization</DialogTitle>
            <DialogDescription>
              Update the organization details.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Logo</Label>
              <div className="border-2 border-dashed rounded-lg p-4 mb-3">
                <div className="flex flex-col items-center gap-2 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
                    <Building2 className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium">Recommended specifications</p>
                    <p className="text-xs text-muted-foreground">
                      Square image, 256×256px or larger
                    </p>
                    <p className="text-xs text-muted-foreground">
                      PNG or JPG format, max 5MB
                    </p>
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
              <Label htmlFor="edit-name">Organization Name</Label>
              <Input
                id="edit-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Acme Corp"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-slug">Slug</Label>
              <Input
                id="edit-slug"
                value={editSlug}
                onChange={(e) => setEditSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                placeholder="acme-corp"
              />
              <p className="text-xs text-muted-foreground">
                Used in URLs. Only lowercase letters, numbers, and hyphens.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-seat-limit">Seat Limit</Label>
              <Input
                id="edit-seat-limit"
                type="number"
                min="1"
                placeholder="Unlimited"
                value={editSeatLimit}
                onChange={(e) => setEditSeatLimit(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Maximum number of users allowed. Leave empty for unlimited.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveEdit} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Organization Confirmation */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Organization?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{org.name}</strong> and all associated data
              including memberships, invitations, enrollments, and progress records.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteOrg}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete Organization
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
