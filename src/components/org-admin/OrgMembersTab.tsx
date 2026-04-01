import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SearchFilter, FilterConfig } from '@/components/ui/search-filter';
import { EmptyState } from '@/components/ui/empty-state';
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
import { Users, Plus, MoreHorizontal, Mail, Copy, Check, Loader2, UserX, ShieldCheck, User, FileSpreadsheet, GraduationCap, Sparkles } from 'lucide-react';
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
  const { user, currentOrg } = useAuth();
  const [members, setMembers] = useState<(OrgMembership & { profile: Profile })[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [aiChampions, setAiChampions] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
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
  const [bulkInviteOpen, setBulkInviteOpen] = useState(false);
  const [enrollDialogOpen, setEnrollDialogOpen] = useState(false);
  const [removeMemberDialog, setRemoveMemberDialog] = useState<{
    open: boolean;
    member: (OrgMembership & { profile: Profile }) | null;
  } | null>(null);

  const fetchData = async () => {
    if (!currentOrg) {
      setLoading(false);
      return;
    }

    const { data: memberData } = await supabase
      .from('org_memberships')
      .select('*, profile:profiles(*)')
      .eq('org_id', currentOrg.id)
      .order('created_at', { ascending: false });

    if (memberData) {
      setMembers(memberData as any);
    }

    const { data: inviteData } = await supabase
      .rpc('get_org_invitations_safe', { p_org_id: currentOrg.id });

    if (inviteData) {
      setInvitations(inviteData as Invitation[]);
    }

    const { data: championsData } = await supabase
      .from('ai_champions')
      .select('user_id')
      .eq('org_id', currentOrg.id);

    if (championsData) {
      setAiChampions(new Set(championsData.map((c) => c.user_id)));
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

    const { data: invitation, error } = await supabase
      .from('invitations')
      .insert({
        org_id: currentOrg.id,
        email: inviteEmail,
        role: inviteRole,
        invited_by_user_id: user.id,
        first_name: inviteFirstName || null,
        last_name: inviteLastName || null,
        department: inviteDepartment || null,
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
      let emailSent = false;
      if (invitation?.id) {
        const { data: linkId } = await supabase
          .rpc('get_invitation_link_id', { invitation_id: invitation.id });
        
        if (linkId) {
          const emailResult = await sendInvitationEmail({
            email: inviteEmail,
            orgName: currentOrg.name,
            role: inviteRole,
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
      setInviteRole('learner');
      fetchData();
    }

    setInviting(false);
  };

  const handleCopyInviteLink = async (linkId: string) => {
    const link = getInviteLink(linkId);
    await navigator.clipboard.writeText(link);
    setCopiedToken(linkId);
    toast({
      title: 'Link copied!',
      description: 'Share this link with the invited user.',
    });
    setTimeout(() => setCopiedToken(null), 2000);
  };

  const handleRemoveMember = async () => {
    if (!removeMemberDialog?.member) return;
    
    const { error } = await supabase
      .from('org_memberships')
      .delete()
      .eq('id', removeMemberDialog.member.id);

    if (error) {
      toast({
        title: 'Failed to remove member',
        description: error.message,
        variant: 'destructive',
      });
    } else {
      toast({
        title: 'Member removed',
        description: `${removeMemberDialog.member.profile?.full_name} has been removed from the organization.`,
      });
      fetchData();
    }
    setRemoveMemberDialog(null);
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
      toast({ title: 'Invitation cancelled' });
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

  const handleToggleAiChampion = async (member: OrgMembership & { profile: Profile }) => {
    if (!currentOrg || !user) return;
    
    const isCurrentlyChampion = aiChampions.has(member.user_id);
    
    if (isCurrentlyChampion) {
      const { error } = await supabase
        .from('ai_champions')
        .delete()
        .eq('user_id', member.user_id)
        .eq('org_id', currentOrg.id);

      if (error) {
        toast({ title: 'Failed to remove AI Champion status', description: error.message, variant: 'destructive' });
      } else {
        toast({ title: 'AI Champion status removed', description: `${member.profile?.full_name} is no longer an AI Champion.` });
        setAiChampions((prev) => { const next = new Set(prev); next.delete(member.user_id); return next; });
      }
    } else {
      const { error } = await supabase
        .from('ai_champions')
        .insert({ user_id: member.user_id, org_id: currentOrg.id, assigned_by: user.id });

      if (error) {
        toast({ title: 'Failed to assign AI Champion status', description: error.message, variant: 'destructive' });
      } else {
        toast({ title: 'AI Champion assigned!', description: `${member.profile?.full_name} is now an AI Champion.` });
        setAiChampions((prev) => new Set([...prev, member.user_id]));
      }
    }
  };

  const roleColors = {
    org_admin: 'bg-purple-100 text-purple-800',
    learner: 'bg-blue-100 text-blue-800',
  };

  const statusColors = {
    active: 'bg-green-100 text-green-800',
    invited: 'bg-yellow-100 text-yellow-800',
  };

  const memberFilters: FilterConfig[] = [
    {
      key: 'role',
      label: 'Role',
      options: [
        { value: 'org_admin', label: 'Admin' },
        { value: 'learner', label: 'Learner' },
      ],
    },
  ];

  const filterValues = { role: roleFilter };

  const handleFilterChange = (key: string, value: string) => {
    if (key === 'role') setRoleFilter(value);
  };

  const clearFilters = () => {
    setSearchQuery('');
    setRoleFilter('all');
  };

  const filteredMembers = members.filter(member => {
    const matchesSearch = searchQuery === '' ||
      member.profile?.full_name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesRole = roleFilter === 'all' || member.role === roleFilter;
    return matchesSearch && matchesRole;
  });

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
      </div>
    );
  }

  if (!currentOrg) {
    return (
      <div className="flex h-64 flex-col items-center justify-center text-center">
        <Users className="h-12 w-12 text-muted-foreground/50 mb-4" />
        <p className="text-muted-foreground">No organization selected.</p>
      </div>
    );
  }

  return (
    <div>
      {/* Search and Actions */}
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <SearchFilter
          searchValue={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="Search members..."
          filters={memberFilters}
          filterValues={filterValues}
          onFilterChange={handleFilterChange}
          onClearFilters={clearFilters}
          className="flex-1"
        />
        <div className="flex gap-2 shrink-0">
          <Button variant="outline" onClick={() => setEnrollDialogOpen(true)}>
            <GraduationCap className="mr-2 h-4 w-4" />
            Enroll User
          </Button>
          <Button variant="outline" onClick={() => setBulkInviteOpen(true)}>
            <FileSpreadsheet className="mr-2 h-4 w-4" />
            Bulk Invite
          </Button>
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
      </div>

      {/* Bulk Invite Dialog */}
      <BulkInviteDialog
        open={bulkInviteOpen}
        onOpenChange={setBulkInviteOpen}
        orgId={currentOrg.id}
        orgName={currentOrg.name}
        userId={user?.id || ''}
        onSuccess={fetchData}
      />

      {/* Enroll User Dialog */}
      <EnrollUserDialog
        open={enrollDialogOpen}
        onOpenChange={setEnrollDialogOpen}
        orgId={currentOrg.id}
        orgName={currentOrg.name}
        members={members}
        onSuccess={fetchData}
      />

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

      {filteredMembers.length === 0 ? (
        <EmptyState
          icon={<Users className="h-6 w-6" />}
          title={searchQuery || roleFilter !== 'all' ? "No matching members" : "No team members yet"}
          description={searchQuery || roleFilter !== 'all'
            ? "Try adjusting your filters." 
            : "Invite colleagues to join your organization."}
          action={
            !searchQuery && roleFilter === 'all' ? (
              <Button onClick={() => setInviteOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Invite Member
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredMembers.map((member) => (
                <TableRow key={member.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{member.profile?.full_name}</p>
                      {aiChampions.has(member.user_id) && (
                        <Badge variant="outline" className="bg-warning/10 text-warning border-warning/30">
                          <Sparkles className="h-3 w-3 mr-1" />
                          AI Champion
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {member.profile?.department || '-'}
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
                              onClick={() => setRoleChangeDialog({ open: true, member, newRole: 'org_admin' })}
                            >
                              <ShieldCheck className="mr-2 h-4 w-4" />
                              Promote to Admin
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              onClick={() => setRoleChangeDialog({ open: true, member, newRole: 'learner' })}
                            >
                              <User className="mr-2 h-4 w-4" />
                              Change to Learner
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => handleToggleAiChampion(member)}>
                            <Sparkles className="mr-2 h-4 w-4" />
                            {aiChampions.has(member.user_id) ? 'Remove AI Champion' : 'Make AI Champion'}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => setRemoveMemberDialog({ open: true, member })}
                            className="text-destructive"
                          >
                            <UserX className="mr-2 h-4 w-4" />
                            Remove from Team
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

      {/* Remove Member Confirmation Dialog */}
      <AlertDialog
        open={removeMemberDialog?.open}
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
