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
import { supabase } from '@/integrations/supabase/client';
import { Organization, OrgMembership, Profile, OrgRole, Invitation } from '@/lib/types';
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
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { z } from 'zod';

const addUserSchema = z.object({
  userId: z.string().uuid('Please select a user'),
  role: z.enum(['org_admin', 'learner']),
});

const inviteSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  role: z.enum(['org_admin', 'learner']),
});

const editOrgSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name must be less than 100 characters'),
  slug: z.string().min(1, 'Slug is required').max(50, 'Slug must be less than 50 characters')
    .regex(/^[a-z0-9-]+$/, 'Slug can only contain lowercase letters, numbers, and hyphens'),
});

export default function OrganizationDetail() {
  const { orgId } = useParams<{ orgId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [org, setOrg] = useState<Organization | null>(null);
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
  const [saving, setSaving] = useState(false);

  // Delete organization state
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const fetchData = async () => {
    if (!orgId) return;

    // Fetch organization
    const { data: orgData } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', orgId)
      .maybeSingle();

    if (orgData) {
      setOrg(orgData as Organization);
    }

    // Fetch members
    const { data: memberData } = await supabase
      .from('org_memberships')
      .select('*, profile:profiles(*)')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false });

    if (memberData) {
      setMembers(memberData as any);
    }

    // Fetch pending invitations
    const { data: inviteData } = await supabase
      .from('invitations')
      .select('*')
      .eq('org_id', orgId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (inviteData) {
      setInvitations(inviteData as Invitation[]);
    }

    // Fetch all users to find ones not in this org
    const { data: allProfiles } = await supabase
      .from('profiles')
      .select('*')
      .order('full_name');

    if (allProfiles && memberData) {
      const memberUserIds = new Set(memberData.map((m) => m.user_id));
      const available = allProfiles.filter((p) => !memberUserIds.has(p.id));
      setAvailableUsers(available as Profile[]);
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

    const { error } = await supabase.from('org_memberships').insert({
      org_id: orgId,
      user_id: selectedUserId,
      role: selectedRole,
      status: 'active',
    });

    if (error) {
      toast({
        title: 'Failed to add user',
        description: error.message,
        variant: 'destructive',
      });
    } else {
      toast({
        title: 'User added!',
        description: 'The user has been added to the organization.',
      });
      setAddUserOpen(false);
      setSelectedUserId('');
      setSelectedRole('learner');
      fetchData();
    }

    setAdding(false);
  };

  const handleChangeRole = async () => {
    if (!roleChangeDialog?.member) return;

    const { member, newRole } = roleChangeDialog;
    setUpdatingRole(member.id);
    setRoleChangeDialog(null);

    const { error } = await supabase
      .from('org_memberships')
      .update({ role: newRole })
      .eq('id', member.id);

    if (error) {
      toast({
        title: 'Failed to change role',
        description: error.message,
        variant: 'destructive',
      });
    } else {
      toast({
        title: 'Role updated',
        description: `${member.profile?.full_name} is now ${newRole === 'org_admin' ? 'an Admin' : 'a Learner'}.`,
      });
      fetchData();
    }

    setUpdatingRole(null);
  };

  const handleDisableMember = async (membershipId: string) => {
    const { error } = await supabase
      .from('org_memberships')
      .update({ status: 'disabled' })
      .eq('id', membershipId);

    if (error) {
      toast({
        title: 'Failed to disable member',
        description: error.message,
        variant: 'destructive',
      });
    } else {
      toast({
        title: 'Member disabled',
        description: 'The user can no longer access this organization.',
      });
      fetchData();
    }
  };

  const handleReactivateMember = async (membershipId: string) => {
    const { error } = await supabase
      .from('org_memberships')
      .update({ status: 'active' })
      .eq('id', membershipId);

    if (error) {
      toast({
        title: 'Failed to reactivate member',
        description: error.message,
        variant: 'destructive',
      });
    } else {
      toast({
        title: 'Member reactivated',
        description: 'The user can now access this organization again.',
      });
      fetchData();
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

    const { data: invitation, error } = await supabase
      .from('invitations')
      .insert({
        org_id: orgId,
        email: inviteEmail,
        role: inviteRole,
      })
      .select()
      .single();

    if (error) {
      toast({
        title: 'Failed to create invitation',
        description: error.message,
        variant: 'destructive',
      });
    } else {
      toast({
        title: 'Invitation created!',
        description: 'Copy the invite link to share with the user.',
      });
      setInviteOpen(false);
      setInviteEmail('');
      setInviteRole('learner');
      fetchData();
    }

    setInviting(false);
  };

  const handleCopyInviteLink = async (token: string) => {
    const link = `${window.location.origin}/signup?invite=${token}`;
    await navigator.clipboard.writeText(link);
    setCopiedToken(token);
    toast({
      title: 'Link copied!',
      description: 'Share this link with the invited user.',
    });
    setTimeout(() => setCopiedToken(null), 2000);
  };

  const handleCancelInvitation = async (invitationId: string) => {
    const { error } = await supabase
      .from('invitations')
      .update({ status: 'expired' })
      .eq('id', invitationId);

    if (error) {
      toast({
        title: 'Failed to cancel invitation',
        description: error.message,
        variant: 'destructive',
      });
    } else {
      toast({
        title: 'Invitation cancelled',
      });
      fetchData();
    }
  };

  const handleOpenEdit = () => {
    if (org) {
      setEditName(org.name);
      setEditSlug(org.slug);
      setEditLogoUrl(org.logo_url || null);
      setEditOpen(true);
    }
  };

  const handleSaveEdit = async () => {
    const result = editOrgSchema.safeParse({ name: editName, slug: editSlug });
    if (!result.success) {
      toast({
        title: 'Invalid input',
        description: result.error.errors[0].message,
        variant: 'destructive',
      });
      return;
    }

    setSaving(true);

    const { error } = await supabase
      .from('organizations')
      .update({ name: editName, slug: editSlug, logo_url: editLogoUrl })
      .eq('id', orgId);

    if (error) {
      toast({
        title: 'Failed to update organization',
        description: error.message,
        variant: 'destructive',
      });
    } else {
      toast({
        title: 'Organization updated',
        description: 'The organization details have been saved.',
      });
      setEditOpen(false);
      fetchData();
    }

    setSaving(false);
  };

  const handleDeleteOrg = async () => {
    setDeleting(true);

    const { error } = await supabase
      .from('organizations')
      .delete()
      .eq('id', orgId);

    if (error) {
      toast({
        title: 'Failed to delete organization',
        description: error.message,
        variant: 'destructive',
      });
      setDeleting(false);
    } else {
      toast({
        title: 'Organization deleted',
        description: 'The organization has been permanently deleted.',
      });
      navigate('/app/admin/organizations');
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
    return (
      <AppLayout title="Organization Not Found" breadcrumbs={[{ label: 'Organizations', href: '/app/admin/organizations' }, { label: 'Not Found' }]}>
        <div className="flex h-64 flex-col items-center justify-center text-center">
          <Building2 className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <p className="text-muted-foreground">Organization not found.</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate('/app/admin/organizations')}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Organizations
          </Button>
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
            <img src={org.logo_url} alt={org.name} className="h-14 w-14 rounded-xl object-cover" />
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
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Users className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-2xl font-bold">{activeMembers.length}</p>
                <p className="text-sm text-muted-foreground">Active Members</p>
              </div>
            </div>
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
                      onClick={() => handleCopyInviteLink(invitation.token)}
                    >
                      {copiedToken === invitation.token ? (
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Organization</DialogTitle>
            <DialogDescription>
              Update the organization details.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Logo</Label>
              <FileUpload
                bucket="org-logos"
                accept="image"
                value={editLogoUrl}
                onChange={(url) => setEditLogoUrl(url)}
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
