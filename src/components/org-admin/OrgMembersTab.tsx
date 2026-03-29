import { useEffect, useState } from 'react';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SearchFilter, FilterConfig } from '@/components/ui/search-filter';
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
import { Users, Plus, MoreHorizontal, Mail, Copy, Check, Loader2, UserX, UserCog, ShieldCheck, User, FileSpreadsheet, GraduationCap, Sparkles } from 'lucide-react';
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

interface OrgMembersTabProps {
  orgId: string;
  orgName: string;
}

export function OrgMembersTab({ orgId, orgName }: OrgMembersTabProps) {
  const { user } = useAuth();
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
    const { data: memberData } = await supabase
      .from('org_memberships')
      .select('*, profile:profiles(*)')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false });

    if (memberData) setMembers(memberData as any);

    const { data: inviteData } = await supabase
      .rpc('get_org_invitations_safe', { p_org_id: orgId });

    if (inviteData) setInvitations(inviteData as Invitation[]);

    const { data: championsData } = await supabase
      .from('ai_champions')
      .select('user_id')
      .eq('org_id', orgId);

    if (championsData) setAiChampions(new Set(championsData.map((c) => c.user_id)));

    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, [orgId]);

  const handleInvite = async () => {
    if (!user) return;
    const result = inviteSchema.safeParse({ email: inviteEmail, role: inviteRole });
    if (!result.success) {
      toast({ title: 'Invalid input', description: result.error.errors[0].message, variant: 'destructive' });
      return;
    }

    setInviting(true);
    const { data: invitation, error } = await supabase
      .from('invitations')
      .insert({
        org_id: orgId,
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
      toast({ title: 'Failed to create invitation', description: error.message, variant: 'destructive' });
    } else {
      let emailSent = false;
      if (invitation?.id) {
        const { data: linkId } = await supabase.rpc('get_invitation_link_id', { invitation_id: invitation.id });
        if (linkId) {
          const emailResult = await sendInvitationEmail({ email: inviteEmail, orgName, role: inviteRole, linkId });
          emailSent = emailResult.success;
        }
      }
      toast({
        title: 'Invitation created!',
        description: emailSent ? 'Invitation email sent successfully.' : 'Copy the invite link to share with the user.',
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
    toast({ title: 'Link copied!', description: 'Share this link with the invited user.' });
    setTimeout(() => setCopiedToken(null), 2000);
  };

  const handleRemoveMember = async () => {
    if (!removeMemberDialog?.member) return;
    const { error } = await supabase.from('org_memberships').delete().eq('id', removeMemberDialog.member.id);
    if (error) {
      toast({ title: 'Failed to remove member', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Member removed', description: `${removeMemberDialog.member.profile?.full_name} has been removed.` });
      fetchData();
    }
    setRemoveMemberDialog(null);
  };

  const handleCancelInvitation = async (invitationId: string) => {
    const { error } = await supabase.from('invitations').update({ status: 'expired' }).eq('id', invitationId);
    if (error) {
      toast({ title: 'Failed to cancel invitation', description: error.message, variant: 'destructive' });
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
    const { error } = await supabase.from('org_memberships').update({ role: newRole }).eq('id', member.id);
    if (error) {
      toast({ title: 'Failed to change role', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Role updated', description: `${member.profile?.full_name} is now ${newRole === 'org_admin' ? 'an Admin' : 'a Learner'}.` });
      fetchData();
    }
    setUpdatingRole(null);
  };

  const handleToggleAiChampion = async (member: OrgMembership & { profile: Profile }) => {
    if (!user) return;
    const isCurrentlyChampion = aiChampions.has(member.user_id);
    if (isCurrentlyChampion) {
      const { error } = await supabase.from('ai_champions').delete().eq('user_id', member.user_id).eq('org_id', orgId);
      if (error) {
        toast({ title: 'Failed to remove AI Champion status', description: error.message, variant: 'destructive' });
      } else {
        toast({ title: 'AI Champion status removed' });
        setAiChampions((prev) => { const next = new Set(prev); next.delete(member.user_id); return next; });
      }
    } else {
      const { error } = await supabase.from('ai_champions').insert({ user_id: member.user_id, org_id: orgId, assigned_by: user.id });
      if (error) {
        toast({ title: 'Failed to assign AI Champion status', description: error.message, variant: 'destructive' });
      } else {
        toast({ title: 'AI Champion assigned!' });
        setAiChampions((prev) => new Set([...prev, member.user_id]));
      }
    }
  };

  const roleColors: Record<string, string> = {
    org_admin: 'bg-purple-100 text-purple-800',
    learner: 'bg-blue-100 text-blue-800',
  };
  const statusColors: Record<string, string> = {
    active: 'bg-green-100 text-green-800',
    invited: 'bg-yellow-100 text-yellow-800',
  };

  const memberFilters: FilterConfig[] = [
    { key: 'role', label: 'Role', options: [{ value: 'org_admin', label: 'Admin' }, { value: 'learner', label: 'Learner' }] },
  ];

  const filteredMembers = members.filter(member => {
    const matchesSearch = searchQuery === '' || member.profile?.full_name.toLowerCase().includes(searchQuery.toLowerCase());
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

  return (
    <div>
      {/* Search and Actions */}
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <SearchFilter
          searchValue={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="Search members..."
          filters={memberFilters}
          filterValues={{ role: roleFilter }}
          onFilterChange={(key, value) => { if (key === 'role') setRoleFilter(value); }}
          onClearFilters={() => { setSearchQuery(''); setRoleFilter('all'); }}
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
                <DialogDescription>Send an invitation to join {orgName}.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email Address</Label>
                  <Input id="email" type="email" placeholder="colleague@company.com" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>First Name</Label>
                    <Input placeholder="John" value={inviteFirstName} onChange={(e) => setInviteFirstName(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Last Name</Label>
                    <Input placeholder="Doe" value={inviteLastName} onChange={(e) => setInviteLastName(e.target.value)} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Department</Label>
                  <Input placeholder="Engineering" value={inviteDepartment} onChange={(e) => setInviteDepartment(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Role</Label>
                  <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as OrgRole)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="learner">Learner</SelectItem>
                      <SelectItem value="org_admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setInviteOpen(false)}>Cancel</Button>
                <Button onClick={handleInvite} disabled={inviting}>
                  {inviting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Sending...</> : <><Mail className="mr-2 h-4 w-4" />Send Invitation</>}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Members Table */}
      {filteredMembers.length === 0 ? (
        <EmptyState
          icon={<Users className="h-6 w-6" />}
          title="No members found"
          description="Invite team members to get started."
        />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="hidden md:table-cell">Department</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="hidden sm:table-cell">Status</TableHead>
                <TableHead className="hidden lg:table-cell">Joined</TableHead>
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredMembers.map((member) => (
                <TableRow key={member.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{member.profile?.full_name}</span>
                      {aiChampions.has(member.user_id) && (
                        <Badge variant="outline" className="text-xs gap-1">
                          <Sparkles className="h-3 w-3 text-warning" />
                          AI Champion
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-muted-foreground">
                    {member.profile?.department || '-'}
                  </TableCell>
                  <TableCell>
                    <Badge className={roleColors[member.role]}>
                      {member.role === 'org_admin' ? 'Admin' : 'Learner'}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <Badge className={statusColors[member.status] || ''}>
                      {member.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell text-muted-foreground text-sm">
                    {new Date(member.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setRoleChangeDialog({
                          open: true,
                          member,
                          newRole: member.role === 'org_admin' ? 'learner' : 'org_admin',
                        })}>
                          {member.role === 'org_admin' ? <User className="mr-2 h-4 w-4" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                          {member.role === 'org_admin' ? 'Change to Learner' : 'Change to Admin'}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleToggleAiChampion(member)}>
                          <Sparkles className="mr-2 h-4 w-4" />
                          {aiChampions.has(member.user_id) ? 'Remove AI Champion' : 'Make AI Champion'}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => setRemoveMemberDialog({ open: true, member })}
                        >
                          <UserX className="mr-2 h-4 w-4" />
                          Remove from Organization
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Pending Invitations */}
      {invitations.length > 0 && (
        <div className="mt-6">
          <h3 className="text-lg font-semibold mb-3">Pending Invitations</h3>
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="hidden sm:table-cell">Expires</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invitations.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="font-medium">{inv.email}</TableCell>
                    <TableCell>
                      <Badge className={roleColors[inv.role]}>
                        {inv.role === 'org_admin' ? 'Admin' : 'Learner'}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-muted-foreground text-sm">
                      {new Date(inv.expires_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {inv.link_id && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => handleCopyInviteLink(inv.link_id!)}
                          >
                            {copiedToken === inv.link_id ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive"
                          onClick={() => handleCancelInvitation(inv.id)}
                        >
                          <UserX className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>
      )}

      {/* Dialogs */}
      <AlertDialog
        open={removeMemberDialog?.open || false}
        onOpenChange={(open) => !open && setRemoveMemberDialog(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Member</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove {removeMemberDialog?.member?.profile?.full_name} from the organization?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRemoveMember} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={roleChangeDialog?.open || false}
        onOpenChange={(open) => !open && setRoleChangeDialog(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change Role</AlertDialogTitle>
            <AlertDialogDescription>
              Change {roleChangeDialog?.member?.profile?.full_name}'s role to {roleChangeDialog?.newRole === 'org_admin' ? 'Admin' : 'Learner'}?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleChangeRole}>Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <BulkInviteDialog
        open={bulkInviteOpen}
        onOpenChange={setBulkInviteOpen}
        orgId={orgId}
        orgName={orgName}
        onSuccess={fetchData}
      />

      <EnrollUserDialog
        open={enrollDialogOpen}
        onOpenChange={setEnrollDialogOpen}
        orgId={orgId}
        orgName={orgName}
        members={members}
        onSuccess={fetchData}
      />
    </div>
  );
}
