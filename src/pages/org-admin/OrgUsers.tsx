import { useEffect, useState } from 'react';
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
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { OrgMembership, Profile, Invitation, OrgRole } from '@/lib/types';
import { Users, Plus, MoreHorizontal, Mail, Copy, Check, Loader2, UserX, UserCog, ShieldCheck, User } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { z } from 'zod';

const inviteSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  role: z.enum(['org_admin', 'learner']),
});

export default function OrgUsers() {
  const { user, currentOrg } = useAuth();
  const { toast } = useToast();
  const [members, setMembers] = useState<(OrgMembership & { profile: Profile })[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
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

  const fetchData = async () => {
    if (!currentOrg) {
      setLoading(false);
      return;
    }

    // Fetch members
    const { data: memberData } = await supabase
      .from('org_memberships')
      .select('*, profile:profiles(*)')
      .eq('org_id', currentOrg.id)
      .order('created_at', { ascending: false });

    if (memberData) {
      setMembers(memberData as any);
    }

    // Fetch pending invitations using the secure RPC function
    const { data: inviteData } = await supabase
      .rpc('get_org_invitations_safe', { p_org_id: currentOrg.id });

    if (inviteData) {
      setInvitations(inviteData as Invitation[]);
    }

    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, [currentOrg]);

  const handleInvite = async () => {
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

    setInviting(true);

    // Check if user already exists in org
    const { data: existingMember } = await supabase
      .from('org_memberships')
      .select('id')
      .eq('org_id', currentOrg.id)
      .eq('user_id', (await supabase.from('profiles').select('id').eq('full_name', inviteEmail).maybeSingle()).data?.id || '')
      .maybeSingle();

    if (existingMember) {
      toast({
        title: 'Already a member',
        description: 'This user is already a member of your organization.',
        variant: 'destructive',
      });
      setInviting(false);
      return;
    }

    // Create invitation
    const { data: invitation, error } = await supabase
      .from('invitations')
      .insert({
        org_id: currentOrg.id,
        email: inviteEmail,
        role: inviteRole,
        invited_by_user_id: user.id,
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
      <AppLayout title="Team Members" breadcrumbs={[{ label: 'Team Members' }]}>
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-accent" />
        </div>
      </AppLayout>
    );
  }

  if (!currentOrg) {
    return (
      <AppLayout title="Team Members" breadcrumbs={[{ label: 'Team Members' }]}>
        <div className="flex h-64 flex-col items-center justify-center text-center">
          <Users className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <p className="text-muted-foreground">No organization selected.</p>
          <p className="text-sm text-muted-foreground">Join an organization to manage team members.</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Team Members" breadcrumbs={[{ label: 'Team Members' }]}>
      {/* Actions */}
      <div className="mb-6 flex justify-end">
        <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Invite Member
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Invite Team Member</DialogTitle>
              <DialogDescription>
                Send an invitation to join {currentOrg?.name}.
              </DialogDescription>
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
                      onClick={() => handleCopyInviteLink(invitation.link_id || '')}
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
          title="No team members yet"
          description="Invite colleagues to join your organization."
          action={
            <Button onClick={() => setInviteOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Invite Member
            </Button>
          }
        />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => (
                <TableRow key={member.id}>
                  <TableCell>
                    <div>
                      <p className="font-medium">{member.profile?.full_name}</p>
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
                    {member.user_id !== user?.id && member.status === 'active' && (
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
                        <DropdownMenuContent align="end">
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
    </AppLayout>
  );
}
