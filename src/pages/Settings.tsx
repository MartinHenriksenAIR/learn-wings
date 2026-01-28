import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/useAuth';
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Loader2, User, Lock, Mail, Calendar, Shield, Building2 } from 'lucide-react';
import { z } from 'zod';
import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';

const profileSchema = z.object({
  fullName: z.string().trim().min(1, 'Name is required').max(100, 'Name is too long'),
});

const passwordSchema = z.object({
  newPassword: z.string().min(6, 'Password must be at least 6 characters'),
  confirmPassword: z.string(),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "Passwords don't match",
  path: ['confirmPassword'],
});

export default function Settings() {
  const { profile, user, memberships, isPlatformAdmin, refreshUserContext } = useAuth();
  const { toast } = useToast();
  
  // Profile state
  const [fullName, setFullName] = useState('');
  const [saving, setSaving] = useState(false);
  const [profileErrors, setProfileErrors] = useState<{ fullName?: string }>({});

  // Password state
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordErrors, setPasswordErrors] = useState<{ 
    newPassword?: string; 
    confirmPassword?: string 
  }>({});

  // Sync fullName when profile loads
  useEffect(() => {
    if (profile?.full_name) {
      setFullName(profile.full_name);
    }
  }, [profile?.full_name]);

  const handleProfileSave = async () => {
    setProfileErrors({});
    
    const result = profileSchema.safeParse({ fullName });
    if (!result.success) {
      const errors: { fullName?: string } = {};
      result.error.errors.forEach((err) => {
        if (err.path[0] === 'fullName') {
          errors.fullName = err.message;
        }
      });
      setProfileErrors(errors);
      return;
    }

    if (!profile) return;
    
    setSaving(true);
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: fullName.trim() })
      .eq('id', profile.id);

    if (error) {
      toast({
        title: 'Failed to update profile',
        description: error.message,
        variant: 'destructive',
      });
    } else {
      toast({
        title: 'Profile updated',
        description: 'Your changes have been saved.',
      });
      await refreshUserContext();
    }
    setSaving(false);
  };

  const handlePasswordChange = async () => {
    setPasswordErrors({});
    
    const result = passwordSchema.safeParse({ newPassword, confirmPassword });
    if (!result.success) {
      const errors: { newPassword?: string; confirmPassword?: string } = {};
      result.error.errors.forEach((err) => {
        const field = err.path[0] as 'newPassword' | 'confirmPassword';
        errors[field] = err.message;
      });
      setPasswordErrors(errors);
      return;
    }

    setPasswordSaving(true);
    
    const { error } = await supabase.auth.updateUser({
      password: newPassword
    });

    if (error) {
      toast({
        title: 'Failed to update password',
        description: error.message,
        variant: 'destructive',
      });
    } else {
      toast({
        title: 'Password updated',
        description: 'Your password has been changed successfully.',
      });
      setNewPassword('');
      setConfirmPassword('');
    }
    setPasswordSaving(false);
  };

  // Determine role display
  const getRoleDisplay = () => {
    if (isPlatformAdmin) {
      return { label: 'Platform Admin', variant: 'default' as const };
    }
    
    const adminMembership = memberships.find(m => m.role === 'org_admin' && m.status === 'active');
    if (adminMembership) {
      return { 
        label: `Org Admin at ${adminMembership.organization?.name || 'Organization'}`,
        variant: 'secondary' as const 
      };
    }
    
    const learnerMembership = memberships.find(m => m.role === 'learner' && m.status === 'active');
    if (learnerMembership) {
      return { 
        label: `Learner at ${learnerMembership.organization?.name || 'Organization'}`,
        variant: 'outline' as const 
      };
    }
    
    return { label: 'User', variant: 'outline' as const };
  };

  const roleInfo = getRoleDisplay();

  return (
    <AppLayout title="Settings" breadcrumbs={[{ label: 'Settings' }]}>
      <div className="max-w-2xl space-y-6">
        {/* Profile Section */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <User className="h-5 w-5 text-muted-foreground" />
              <CardTitle>Profile</CardTitle>
            </div>
            <CardDescription>Update your personal information.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email" className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-muted-foreground" />
                Email
              </Label>
              <Input
                id="email"
                value={user?.email || ''}
                disabled
                className="bg-muted"
              />
              <p className="text-xs text-muted-foreground">
                Email cannot be changed.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="fullName">Full Name</Label>
              <Input
                id="fullName"
                value={fullName}
                onChange={(e) => {
                  setFullName(e.target.value);
                  if (profileErrors.fullName) {
                    setProfileErrors({});
                  }
                }}
                placeholder="Your full name"
              />
              {profileErrors.fullName && (
                <p className="text-sm text-destructive">{profileErrors.fullName}</p>
              )}
            </div>
            <Button onClick={handleProfileSave} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          </CardContent>
        </Card>

        {/* Security Section */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Lock className="h-5 w-5 text-muted-foreground" />
              <CardTitle>Security</CardTitle>
            </div>
            <CardDescription>Change your password.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="newPassword">New Password</Label>
              <Input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => {
                  setNewPassword(e.target.value);
                  if (passwordErrors.newPassword) {
                    setPasswordErrors((prev) => ({ ...prev, newPassword: undefined }));
                  }
                }}
                placeholder="Enter new password"
              />
              <p className="text-xs text-muted-foreground">
                Must be at least 6 characters.
              </p>
              {passwordErrors.newPassword && (
                <p className="text-sm text-destructive">{passwordErrors.newPassword}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm Password</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  if (passwordErrors.confirmPassword) {
                    setPasswordErrors((prev) => ({ ...prev, confirmPassword: undefined }));
                  }
                }}
                placeholder="Confirm new password"
              />
              {passwordErrors.confirmPassword && (
                <p className="text-sm text-destructive">{passwordErrors.confirmPassword}</p>
              )}
            </div>
            <Button 
              onClick={handlePasswordChange} 
              disabled={passwordSaving || !newPassword || !confirmPassword}
            >
              {passwordSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Update Password
            </Button>
          </CardContent>
        </Card>

        {/* Account Information Section */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-muted-foreground" />
              <CardTitle>Account Information</CardTitle>
            </div>
            <CardDescription>Your account details and role.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Account created</p>
                <p className="text-sm text-muted-foreground">
                  {profile?.created_at 
                    ? format(new Date(profile.created_at), 'MMMM d, yyyy')
                    : 'Unknown'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Role</p>
                <Badge variant={roleInfo.variant} className="mt-1">
                  {roleInfo.label}
                </Badge>
              </div>
            </div>
            {memberships.length > 1 && (
              <div className="pt-2">
                <p className="text-sm font-medium mb-2">Organizations</p>
                <div className="flex flex-wrap gap-2">
                  {memberships.map((m) => (
                    <Badge key={m.id} variant="outline">
                      {m.organization?.name || 'Unknown'} ({m.role})
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
