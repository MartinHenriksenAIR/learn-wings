import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SearchFilter, FilterConfig } from '@/components/ui/search-filter';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Profile, OrgMembership, Organization, OrgRole, Invitation } from '@/lib/types';
import { Users, Shield, Loader2, Mail, Copy, Check, UserPlus } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { z } from 'zod';
import { getInviteLink } from '@/lib/config';
import { UserDetailDialog } from '@/components/platform-admin/UserDetailDialog';
import { sendInvitationEmail } from '@/lib/sendInvitationEmail';

// Invite type includes platform_admin option
type InviteRoleType = 'learner' | 'org_admin' | 'platform_admin';

const inviteSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  inviteType: z.enum(['learner', 'org_admin', 'platform_admin']),
  orgId: z.string().uuid().optional(),
}).refine(
  (data) => data.inviteType === 'platform_admin' || data.orgId,
  { message: 'Please select an organization for non-platform admin invites', path: ['orgId'] }
);

interface UserWithDetails extends Profile {
  memberships: (OrgMembership & { organization: Organization })[];
}

export default function UsersManager() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [users, setUsers] = useState<UserWithDetails[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [invitations, setInvitations] = useState<(Invitation & { organization?: Organization })[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [orgFilter, setOrgFilter] = useState('all');
  
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteFirstName, setInviteFirstName] = useState('');
  const [inviteLastName, setInviteLastName] = useState('');
  const [inviteDepartment, setInviteDepartment] = useState('');
  const [inviteOrgId, setInviteOrgId] = useState<string>('');
  const [inviteType, setInviteType] = useState<InviteRoleType>('learner');
  const [inviting, setInviting] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  
  const [selectedUser, setSelectedUser] = useState<UserWithDetails | null>(null);
  const [userDetailOpen, setUserDetailOpen] = useState(false);

  const fetchData = async () => {
    // Fetch all profiles
    const { data: profiles } = await supabase
      .from('profiles')
      .select('*')
      .order('full_name');

    if (!profiles) {
      setLoading(false);
      return;
    }

    // Fetch all memberships with organizations
    const { data: memberships } = await supabase
      .from('org_memberships')
      .select('*, organization:organizations(*)')
      .eq('status', 'active');

    // Fetch all organizations
    const { data: orgs } = await supabase
      .from('organizations')
      .select('*')
      .order('name');

    if (orgs) {
      setOrganizations(orgs as Organization[]);
    }

    // Fetch pending invitations using secure RPC (excludes sensitive tokens)
    const { data: inviteData } = await supabase
      .rpc('get_platform_invitations_safe');

    if (inviteData) {
      // Filter to only pending status and enrich with organization data
      const pendingInvites = inviteData
        .filter((inv: any) => inv.status === 'pending')
        .map((inv: any) => ({
          ...inv,
          organization: orgs?.find((o: any) => o.id === inv.org_id) || null,
        }));
      setInvitations(pendingInvites as any);
    }

    // Combine profiles with their memberships
    const usersWithDetails = profiles.map((profile) => ({
      ...profile,
      memberships: (memberships || []).filter((m) => m.user_id === profile.id) as any,
    })) as UserWithDetails[];

    setUsers(usersWithDetails);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleUserClick = (userItem: UserWithDetails) => {
    setSelectedUser(userItem);
    setUserDetailOpen(true);
  };

  const handleInvite = async () => {
    const result = inviteSchema.safeParse({ 
      email: inviteEmail, 
      orgId: inviteType === 'platform_admin' ? undefined : inviteOrgId || undefined, 
      inviteType 
    });
    if (!result.success) {
      toast({
        title: 'Invalid input',
        description: result.error.errors[0].message,
        variant: 'destructive',
      });
      return;
    }

    setInviting(true);

    if (inviteType === 'platform_admin') {
      // Platform admin invite - no org required
      const { data: insertedInvitation, error } = await supabase
        .from('invitations')
        .insert({
          email: inviteEmail,
          role: 'learner', // Role doesn't matter for platform admins, they get is_platform_admin flag
          is_platform_admin_invite: true,
          org_id: null,
        })
        .select('id')
        .single();

      if (error) {
        toast({
          title: 'Failed to create invitation',
          description: error.message,
          variant: 'destructive',
        });
      } else {
        // Send invitation email
        let emailSent = false;
        if (insertedInvitation?.id) {
          const { data: linkId } = await supabase
            .rpc('get_invitation_link_id', { invitation_id: insertedInvitation.id });
          
          if (linkId) {
            const emailResult = await sendInvitationEmail({
              email: inviteEmail,
              orgName: null,
              role: 'platform_admin',
              linkId,
            });
            emailSent = emailResult.success;
          }
        }
        
        toast({
          title: 'Platform admin invitation created!',
          description: emailSent 
            ? 'Invitation email sent successfully.' 
            : 'Copy the invite link to share with the user.',
        });
        setInviteOpen(false);
        setInviteEmail('');
        setInviteFirstName('');
        setInviteLastName('');
        setInviteDepartment('');
        setInviteOrgId('');
        setInviteType('learner');
        fetchData();
      }
    } else {
      // Regular org invite
      const { data: insertedInvitation, error } = await supabase
        .from('invitations')
        .insert({
          org_id: inviteOrgId,
          email: inviteEmail,
          role: inviteType as OrgRole,
          is_platform_admin_invite: false,
        })
        .select('id')
        .single();

      if (error) {
        toast({
          title: 'Failed to create invitation',
          description: error.message,
          variant: 'destructive',
        });
      } else {
        // Send invitation email
        let emailSent = false;
        if (insertedInvitation?.id) {
          const { data: linkId } = await supabase
            .rpc('get_invitation_link_id', { invitation_id: insertedInvitation.id });
          
          // Get org name for the email
          const selectedOrg = organizations.find(org => org.id === inviteOrgId);
          
          if (linkId) {
            const emailResult = await sendInvitationEmail({
              email: inviteEmail,
              orgName: selectedOrg?.name || null,
              role: inviteType as 'learner' | 'org_admin',
              linkId,
            });
            emailSent = emailResult.success;
          }
        }
        
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
        setInviteOrgId('');
        setInviteType('learner');
        fetchData();
      }
    }

    setInviting(false);
  };

  const handleCopyInviteLink = async (invitationId: string) => {
    // Use the secure RPC function to get the link_id (not the raw token)
    const { data: linkId, error } = await supabase
      .rpc('get_invitation_link_id', { invitation_id: invitationId });
    
    if (error || !linkId) {
      toast({
        title: 'Failed to get invite link',
        description: 'Could not retrieve the invitation link.',
        variant: 'destructive',
      });
      return;
    }
    
    const link = getInviteLink(linkId);
    await navigator.clipboard.writeText(link);
    setCopiedToken(invitationId);
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

  const roleColors: Record<string, string> = {
    org_admin: 'bg-purple-100 text-purple-800',
    learner: 'bg-blue-100 text-blue-800',
    platform_admin: 'bg-amber-100 text-amber-800',
  };

  const userFilters: FilterConfig[] = [
    {
      key: 'role',
      label: 'Role',
      options: [
        { value: 'platform_admin', label: 'Platform Admin' },
        { value: 'org_admin', label: 'Org Admin' },
        { value: 'learner', label: 'Learner' },
      ],
    },
    {
      key: 'org',
      label: 'Organization',
      options: organizations.map(org => ({ value: org.id, label: org.name })),
    },
  ];

  const filterValues = { role: roleFilter, org: orgFilter };

  const handleFilterChange = (key: string, value: string) => {
    if (key === 'role') setRoleFilter(value);
    if (key === 'org') setOrgFilter(value);
  };

  const clearFilters = () => {
    setSearchQuery('');
    setRoleFilter('all');
    setOrgFilter('all');
  };

  const filteredUsers = users.filter((u) => {
    // Search filter
    const matchesSearch = searchQuery === '' ||
      u.full_name.toLowerCase().includes(searchQuery.toLowerCase());

    // Role filter
    let matchesRole = true;
    if (roleFilter === 'platform_admin') {
      matchesRole = u.is_platform_admin;
    } else if (roleFilter === 'org_admin') {
      matchesRole = u.memberships.some(m => m.role === 'org_admin');
    } else if (roleFilter === 'learner') {
      matchesRole = !u.is_platform_admin && u.memberships.every(m => m.role === 'learner');
    }

    // Organization filter
    const matchesOrg = orgFilter === 'all' ||
      u.memberships.some(m => m.org_id === orgFilter);

    return matchesSearch && matchesRole && matchesOrg;
  });

  if (loading) {
    return (
      <AppLayout title="Users" breadcrumbs={[{ label: 'Users' }]}>
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-accent" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Platform Users" breadcrumbs={[{ label: 'Users' }]}>
      {/* Header with search and invite */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <SearchFilter
          searchValue={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="Search users..."
          filters={userFilters}
          filterValues={filterValues}
          onFilterChange={handleFilterChange}
          onClearFilters={clearFilters}
          className="flex-1"
        />

        <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
          <DialogTrigger asChild>
            <Button>
              <UserPlus className="mr-2 h-4 w-4" />
              Invite User
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Invite User</DialogTitle>
              <DialogDescription>
                Send an invitation to join the platform.
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
                <Select value={inviteType} onValueChange={(v) => {
                  setInviteType(v as InviteRoleType);
                  if (v === 'platform_admin') {
                    setInviteOrgId('');
                  }
                }}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="learner">Learner</SelectItem>
                    <SelectItem value="org_admin">Organization Admin</SelectItem>
                    <SelectItem value="platform_admin">Platform Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {inviteType !== 'platform_admin' && (
                <div className="space-y-2">
                  <Label>Organization</Label>
                  <Select value={inviteOrgId} onValueChange={setInviteOrgId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select an organization..." />
                    </SelectTrigger>
                    <SelectContent>
                      {organizations.map((org) => (
                        <SelectItem key={org.id} value={org.id}>
                          {org.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {inviteType === 'platform_admin' && (
                <p className="text-sm text-muted-foreground">
                  Platform admins have full access to all organizations and settings.
                  They are not tied to any specific organization.
                </p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setInviteOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleInvite} disabled={inviting || (inviteType !== 'platform_admin' && !inviteOrgId)}>
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
                        {invitation.is_platform_admin_invite 
                          ? 'Platform Admin' 
                          : invitation.organization?.name}{' '}
                        • Expires {new Date(invitation.expires_at).toLocaleDateString()}
                      </p>
                    </div>
                    <Badge className={
                      invitation.is_platform_admin_invite 
                        ? roleColors.platform_admin 
                        : roleColors[invitation.role]
                    }>
                      {invitation.is_platform_admin_invite 
                        ? 'Platform Admin' 
                        : invitation.role === 'org_admin' ? 'Org Admin' : 'Learner'}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleCopyInviteLink(invitation.id)}
                    >
                      {copiedToken === invitation.id ? (
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

      {/* Users Table */}
      {filteredUsers.length === 0 ? (
        <EmptyState
          icon={<Users className="h-6 w-6" />}
          title="No users found"
          description={searchQuery ? 'Try a different search term.' : 'No users have signed up yet.'}
        />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Organizations</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Joined</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredUsers.map((userItem) => (
                <TableRow 
                  key={userItem.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => handleUserClick(userItem)}
                >
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary font-medium">
                        {userItem.full_name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-medium">{userItem.full_name}</p>
                        {userItem.id === user?.id && (
                          <span className="text-xs text-muted-foreground">(You)</span>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {userItem.department || '-'}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {userItem.memberships.length > 0 ? (
                        userItem.memberships.map((m) => (
                          <Badge key={m.id} variant="outline" className="text-xs">
                            {m.organization.name}
                            {m.role === 'org_admin' && (
                              <span className="ml-1 text-primary">•</span>
                            )}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-sm text-muted-foreground">No organizations</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {userItem.is_platform_admin ? (
                      <Badge className="bg-primary/10 text-primary">
                        <Shield className="mr-1 h-3 w-3" />
                        Platform Admin
                      </Badge>
                    ) : (
                      <Badge variant="secondary">User</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(userItem.created_at).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* User Detail Dialog */}
      <UserDetailDialog
        user={selectedUser}
        organizations={organizations}
        currentUserId={user?.id || ''}
        open={userDetailOpen}
        onOpenChange={setUserDetailOpen}
        onUserUpdated={fetchData}
      />
    </AppLayout>
  );
}
