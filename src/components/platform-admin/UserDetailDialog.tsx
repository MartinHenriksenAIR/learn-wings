import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { Profile, OrgMembership, Organization, OrgRole } from '@/lib/types';
import { Loader2, Trash2, Plus, Shield, Building2 } from 'lucide-react';
import { toast } from '@/components/ui/sonner';

interface UserWithDetails extends Profile {
  memberships: (OrgMembership & { organization: Organization })[];
}

interface UserDetailDialogProps {
  user: UserWithDetails | null;
  organizations: Organization[];
  currentUserId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUserUpdated: () => void;
}

export function UserDetailDialog({
  user,
  organizations,
  currentUserId,
  open,
  onOpenChange,
  onUserUpdated,
}: UserDetailDialogProps) {
  const [loading, setLoading] = useState(false);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [memberships, setMemberships] = useState<(OrgMembership & { organization: Organization })[]>([]);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showAddOrg, setShowAddOrg] = useState(false);
  const [newOrgId, setNewOrgId] = useState('');
  const [newOrgRole, setNewOrgRole] = useState<OrgRole>('learner');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (user) {
      setIsPlatformAdmin(user.is_platform_admin);
      setMemberships(user.memberships);
    }
  }, [user]);

  if (!user) return null;

  const isCurrentUser = user.id === currentUserId;

  const handleTogglePlatformAdmin = async () => {
    setLoading(true);
    const newValue = !isPlatformAdmin;
    
    const { error } = await supabase
      .from('profiles')
      .update({ is_platform_admin: newValue })
      .eq('id', user.id);

    if (error) {
      toast({
        title: 'Failed to update user',
        description: error.message,
        variant: 'destructive',
      });
    } else {
      setIsPlatformAdmin(newValue);
      toast({
        title: newValue ? 'Platform admin granted' : 'Platform admin revoked',
      });
      onUserUpdated();
    }
    setLoading(false);
  };

  const handleChangeRole = async (membershipId: string, newRole: OrgRole) => {
    setLoading(true);
    
    const { error } = await supabase
      .from('org_memberships')
      .update({ role: newRole })
      .eq('id', membershipId);

    if (error) {
      toast({
        title: 'Failed to update role',
        description: error.message,
        variant: 'destructive',
      });
    } else {
      setMemberships(prev => 
        prev.map(m => m.id === membershipId ? { ...m, role: newRole } : m)
      );
      toast({ title: 'Role updated' });
      onUserUpdated();
    }
    setLoading(false);
  };

  const handleRemoveMembership = async (membershipId: string) => {
    setLoading(true);
    
    const { error } = await supabase
      .from('org_memberships')
      .delete()
      .eq('id', membershipId);

    if (error) {
      toast({
        title: 'Failed to remove membership',
        description: error.message,
        variant: 'destructive',
      });
    } else {
      setMemberships(prev => prev.filter(m => m.id !== membershipId));
      toast({ title: 'Membership removed' });
      onUserUpdated();
    }
    setLoading(false);
  };

  const handleAddMembership = async () => {
    if (!newOrgId) return;
    
    setLoading(true);
    
    const { error } = await supabase
      .from('org_memberships')
      .insert({
        org_id: newOrgId,
        user_id: user.id,
        role: newOrgRole,
        status: 'active',
      });

    if (error) {
      toast({
        title: 'Failed to add membership',
        description: error.message,
        variant: 'destructive',
      });
    } else {
      toast({ title: 'Membership added' });
      setShowAddOrg(false);
      setNewOrgId('');
      setNewOrgRole('learner');
      onUserUpdated();
      onOpenChange(false);
    }
    setLoading(false);
  };

  const handleDeleteUser = async () => {
    setDeleting(true);
    
    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delete-user`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({ userId: user.id }),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to delete user');
      }

      toast({ title: 'User deleted' });
      setShowDeleteConfirm(false);
      onOpenChange(false);
      onUserUpdated();
    } catch (error: any) {
      toast({
        title: 'Failed to delete user',
        description: error.message,
        variant: 'destructive',
      });
    }
    
    setDeleting(false);
  };

  const availableOrgs = organizations.filter(
    org => !memberships.some(m => m.org_id === org.id)
  );

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary font-medium">
                {user.full_name.charAt(0).toUpperCase()}
              </div>
              <div>
                <div>{user.full_name}</div>
                {user.department && (
                  <span className="text-sm text-muted-foreground font-normal">{user.department}</span>
                )}
                {isCurrentUser && (
                  <span className="text-xs text-muted-foreground font-normal block">(You)</span>
                )}
              </div>
            </DialogTitle>
            <DialogDescription>
              Manage user roles and organization memberships.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {/* Platform Admin Toggle */}
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div className="flex items-center gap-3">
                <Shield className="h-5 w-5 text-primary" />
                <div>
                  <Label htmlFor="platform-admin" className="text-base font-medium">
                    Platform Admin
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Full access to all organizations and settings
                  </p>
                </div>
              </div>
              <Switch
                id="platform-admin"
                checked={isPlatformAdmin}
                onCheckedChange={handleTogglePlatformAdmin}
                disabled={loading || isCurrentUser}
              />
            </div>

            {/* Organization Memberships */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-base font-medium">Organization Memberships</Label>
                {availableOrgs.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowAddOrg(true)}
                    disabled={loading}
                  >
                    <Plus className="mr-1 h-4 w-4" />
                    Add
                  </Button>
                )}
              </div>

              {memberships.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center border rounded-lg">
                  No organization memberships
                </p>
              ) : (
                <div className="space-y-2">
                  {memberships.map((membership) => (
                    <div
                      key={membership.id}
                      className="flex items-center justify-between rounded-lg border p-3"
                    >
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{membership.organization.name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Select
                          value={membership.role}
                          onValueChange={(value: OrgRole) => handleChangeRole(membership.id, value)}
                          disabled={loading}
                        >
                          <SelectTrigger className="w-32 h-8">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="learner">Learner</SelectItem>
                            <SelectItem value="org_admin">Org Admin</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => handleRemoveMembership(membership.id)}
                          disabled={loading}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Add Organization Form */}
              {showAddOrg && (
                <div className="rounded-lg border p-3 space-y-3 bg-muted/50">
                  <div className="grid grid-cols-2 gap-2">
                    <Select value={newOrgId} onValueChange={setNewOrgId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select organization..." />
                      </SelectTrigger>
                      <SelectContent>
                        {availableOrgs.map((org) => (
                          <SelectItem key={org.id} value={org.id}>
                            {org.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={newOrgRole} onValueChange={(v: OrgRole) => setNewOrgRole(v)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="learner">Learner</SelectItem>
                        <SelectItem value="org_admin">Org Admin</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setShowAddOrg(false);
                        setNewOrgId('');
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleAddMembership}
                      disabled={!newOrgId || loading}
                    >
                      Add Membership
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            {!isCurrentUser && (
              <Button
                variant="destructive"
                onClick={() => setShowDeleteConfirm(true)}
                disabled={loading}
                className="w-full sm:w-auto"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete User
              </Button>
            )}
            <Button variant="outline" onClick={() => onOpenChange(false)} className="w-full sm:w-auto">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete User?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{user.full_name}</strong> and all their data
              including enrollments, progress, and quiz attempts. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteUser}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-4 w-4" />
              )}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
