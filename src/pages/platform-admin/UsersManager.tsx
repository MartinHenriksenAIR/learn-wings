import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
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
import { Profile, OrgMembership, Organization } from '@/lib/types';
import { Users, MoreHorizontal, Shield, ShieldOff, Search, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface UserWithDetails extends Profile {
  memberships: (OrgMembership & { organization: Organization })[];
}

export default function UsersManager() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [users, setUsers] = useState<UserWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    userId: string;
    userName: string;
    action: 'grant' | 'revoke';
  } | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);

  const fetchUsers = async () => {
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

    // Combine profiles with their memberships
    const usersWithDetails = profiles.map((profile) => ({
      ...profile,
      memberships: (memberships || []).filter((m) => m.user_id === profile.id) as any,
    })) as UserWithDetails[];

    setUsers(usersWithDetails);
    setLoading(false);
  };

  useEffect(() => {
    fetchUsers();
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
      fetchUsers();
    }

    setUpdating(null);
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
      {/* Search */}
      <div className="mb-6">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search users..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

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
