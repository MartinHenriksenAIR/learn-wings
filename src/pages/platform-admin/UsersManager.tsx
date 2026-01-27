import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Profile, OrgMembership, Organization, OrgRole, Invitation } from '@/lib/types';
import { Users, MoreHorizontal, Shield, ShieldOff, Search, Loader2, Mail, Copy, Check, UserPlus } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { z } from 'zod';

const inviteSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  orgId: z.string().uuid('Please select an organization'),
  role: z.enum(['org_admin', 'learner']),
});

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
  
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteOrgId, setInviteOrgId] = useState('');
  const [inviteRole, setInviteRole] = useState<OrgRole>('learner');
  const [inviting, setInviting] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    userId: string;
    userName: string;
    action: 'grant' | 'revoke';
  } | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);

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

    // Fetch pending invitations
    const { data: inviteData } = await supabase
      .from('invitations')
      .select('*, organization:organizations(*)')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (inviteData) {
      setInvitations(inviteData as any);
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

  const handleTogglePlatformAdmin = async () => {
    if (!confirmDialog) return;
    
    const { userId, action } = confirmDialog;
    setUpdating(userId);
    setConfirmDialog(null);

    const { error } = await supabase
      .from('profiles')
      .update({ is_platform_admin: action === 'grant' })
      .eq('id', userId);

    if (error) {
      toast({
        title: 'Failed to update user',
        description: error.message,
        variant: 'destructive',
      });
    } else {
      toast({
        title: action === 'grant' ? 'Admin access granted' : 'Admin access revoked',
        description: action === 'grant' 
          ? 'User now has platform admin privileges.' 
          : 'User no longer has platform admin privileges.',
      });
      fetchData();
    }

    setUpdating(null);
  };

  const handleInvite = async () => {
    const result = inviteSchema.safeParse({ email: inviteEmail, orgId: inviteOrgId, role: inviteRole });
    if (!result.success) {
      toast({
        title: 'Invalid input',
        description: result.error.errors[0].message,
        variant: 'destructive',
      });
      return;
    }

    setInviting(true);

    const { error } = await supabase
      .from('invitations')
      .insert({
        org_id: inviteOrgId,
        email: inviteEmail,
        role: inviteRole,
      });

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
      setInviteOrgId('');
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

  const roleColors = {
    org_admin: 'bg-purple-100 text-purple-800',
    learner: 'bg-blue-100 text-blue-800',
  };

  const filteredUsers = users.filter((u) =>
    u.full_name.toLowerCase().includes(searchQuery.toLowerCase())
  );

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
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search users..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

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
                Send an invitation to join an organization on the platform.
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
                        {invitation.organization?.name} • Expires{' '}
                        {new Date(invitation.expires_at).toLocaleDateString()}
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
                <TableHead>Organizations</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredUsers.map((userItem) => (
                <TableRow key={userItem.id}>
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
                      <Badge className="bg-purple-100 text-purple-800">
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
                  <TableCell>
                    {userItem.id !== user?.id && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" disabled={updating === userItem.id}>
                            {updating === userItem.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <MoreHorizontal className="h-4 w-4" />
                            )}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {userItem.is_platform_admin ? (
                            <DropdownMenuItem
                              onClick={() =>
                                setConfirmDialog({
                                  open: true,
                                  userId: userItem.id,
                                  userName: userItem.full_name,
                                  action: 'revoke',
                                })
                              }
                              className="text-destructive"
                            >
                              <ShieldOff className="mr-2 h-4 w-4" />
                              Revoke Platform Admin
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              onClick={() =>
                                setConfirmDialog({
                                  open: true,
                                  userId: userItem.id,
                                  userName: userItem.full_name,
                                  action: 'grant',
                                })
                              }
                            >
                              <Shield className="mr-2 h-4 w-4" />
                              Make Platform Admin
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Confirmation Dialog */}
      <AlertDialog
        open={confirmDialog?.open}
        onOpenChange={(open) => !open && setConfirmDialog(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmDialog?.action === 'grant'
                ? 'Grant Platform Admin Access?'
                : 'Revoke Platform Admin Access?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDialog?.action === 'grant' ? (
                <>
                  <strong>{confirmDialog?.userName}</strong> will have full access to manage all 
                  organizations, courses, users, and platform settings.
                </>
              ) : (
                <>
                  <strong>{confirmDialog?.userName}</strong> will lose platform admin privileges 
                  and will only have access based on their organization memberships.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleTogglePlatformAdmin}
              className={confirmDialog?.action === 'revoke' ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : ''}
            >
              {confirmDialog?.action === 'grant' ? 'Grant Access' : 'Revoke Access'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
