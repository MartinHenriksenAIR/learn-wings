import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/hooks/useAuth';
import { useState, useEffect } from 'react';
import { toast } from '@/components/ui/sonner';
import { Loader2, User, Mail, Calendar, Shield, Building2, Globe } from 'lucide-react';
import { z } from 'zod';
import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { useTranslation } from 'react-i18next';
import { callApi } from '@/lib/api-client';

const profileSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(50, 'First name is too long'),
  lastName: z.string().trim().max(50, 'Last name is too long').optional(),
  department: z.string().trim().max(100, 'Department is too long').optional(),
});

export default function Settings() {
  const { profile, user, memberships, isPlatformAdmin, refreshUserContext } = useAuth();
  const { t, i18n } = useTranslation();
  
  // Profile state
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [department, setDepartment] = useState('');
  const [saving, setSaving] = useState(false);
  const [profileErrors, setProfileErrors] = useState<{ firstName?: string; lastName?: string; department?: string }>({});

  // Language state
  const [languageSaving, setLanguageSaving] = useState(false);

  // Sync profile fields when profile loads
  useEffect(() => {
    if (profile) {
      setFirstName(profile.first_name || '');
      setLastName(profile.last_name || '');
      setDepartment(profile.department || '');
      // Sync i18n language with profile preference
      if (profile.preferred_language && profile.preferred_language !== i18n.language) {
        i18n.changeLanguage(profile.preferred_language);
      }
    }
  }, [profile, i18n]);

  const handleLanguageChange = async (newLanguage: string) => {
    if (!profile) return;
    
    setLanguageSaving(true);
    
    // Update i18n immediately for instant feedback
    await i18n.changeLanguage(newLanguage);
    localStorage.setItem('preferred_language', newLanguage);
    
    // Persist to database
    try {
      await callApi('/api/profile-update', { preferred_language: newLanguage });
      toast({
        title: t('settings.languageUpdated'),
      });
      await refreshUserContext();
    } catch (error) {
      toast({
        title: t('settings.languageUpdateFailed'),
        description: (error as Error).message,
        variant: 'destructive',
      });
    } finally {
      setLanguageSaving(false);
    }
  };

  const handleProfileSave = async () => {
    setProfileErrors({});
    
    const result = profileSchema.safeParse({ firstName, lastName, department });
    if (!result.success) {
      const errors: { firstName?: string; lastName?: string; department?: string } = {};
      result.error.errors.forEach((err) => {
        const field = err.path[0] as 'firstName' | 'lastName' | 'department';
        errors[field] = err.message;
      });
      setProfileErrors(errors);
      return;
    }

    if (!profile) return;

    setSaving(true);

    try {
      await callApi('/api/profile-update', { first_name: firstName.trim(), last_name: lastName.trim(), department: department.trim() });
      toast({
        title: t('settings.profileUpdated'),
        description: t('settings.profileUpdatedDescription'),
      });
      await refreshUserContext();
    } catch (error) {
      toast({
        title: t('settings.profileUpdateFailed'),
        description: (error as Error).message,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  // Determine role display
  const getRoleDisplay = () => {
    if (isPlatformAdmin) {
      return { label: t('nav.roles.platformAdmin'), variant: 'default' as const };
    }
    
    const adminMembership = memberships.find(m => m.role === 'org_admin' && m.status === 'active');
    if (adminMembership) {
      return { 
        label: `${t('nav.roles.orgAdmin')} at ${adminMembership.organization?.name || 'Organization'}`,
        variant: 'secondary' as const 
      };
    }
    
    const learnerMembership = memberships.find(m => m.role === 'learner' && m.status === 'active');
    if (learnerMembership) {
      return { 
        label: `${t('nav.roles.learner')} at ${learnerMembership.organization?.name || 'Organization'}`,
        variant: 'outline' as const 
      };
    }
    
    return { label: 'User', variant: 'outline' as const };
  };

  const roleInfo = getRoleDisplay();

  return (
    <AppLayout title={t('settings.title')} breadcrumbs={[{ label: t('nav.settings') }]}>
      <div className="max-w-2xl space-y-6">
        {/* Profile Section */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <User className="h-5 w-5 text-muted-foreground" />
              <CardTitle>{t('settings.profile')}</CardTitle>
            </div>
            <CardDescription>{t('settings.updateProfile')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email" className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-muted-foreground" />
                {t('auth.email')}
              </Label>
              <Input
                id="email"
                value={user?.email || ''}
                disabled
                className="bg-muted"
              />
              <p className="text-xs text-muted-foreground">
                {t('settings.emailCannotBeChanged')}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="firstName">{t('settings.firstName')}</Label>
                <Input
                  id="firstName"
                  value={firstName}
                  onChange={(e) => {
                    setFirstName(e.target.value);
                    if (profileErrors.firstName) {
                      setProfileErrors((prev) => ({ ...prev, firstName: undefined }));
                    }
                  }}
                  placeholder={t('settings.firstName')}
                />
                {profileErrors.firstName && (
                  <p className="text-sm text-destructive">{profileErrors.firstName}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">{t('settings.lastName')}</Label>
                <Input
                  id="lastName"
                  value={lastName}
                  onChange={(e) => {
                    setLastName(e.target.value);
                    if (profileErrors.lastName) {
                      setProfileErrors((prev) => ({ ...prev, lastName: undefined }));
                    }
                  }}
                  placeholder={t('settings.lastName')}
                />
                {profileErrors.lastName && (
                  <p className="text-sm text-destructive">{profileErrors.lastName}</p>
                )}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="department">{t('settings.department')}</Label>
              <Input
                id="department"
                value={department}
                onChange={(e) => {
                  setDepartment(e.target.value);
                  if (profileErrors.department) {
                    setProfileErrors((prev) => ({ ...prev, department: undefined }));
                  }
                }}
                placeholder={t('settings.departmentPlaceholder')}
              />
              {profileErrors.department && (
                <p className="text-sm text-destructive">{profileErrors.department}</p>
              )}
            </div>
            <Button onClick={handleProfileSave} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('settings.saveChanges')}
            </Button>
          </CardContent>
        </Card>

        {/* Language Section */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Globe className="h-5 w-5 text-muted-foreground" />
              <CardTitle>{t('settings.language')}</CardTitle>
            </div>
            <CardDescription>{t('settings.languageDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <Select
                value={profile?.preferred_language || i18n.language || 'en'}
                onValueChange={handleLanguageChange}
                disabled={languageSaving}
              >
                <SelectTrigger className="w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">{t('languages.en')}</SelectItem>
                  <SelectItem value="da">{t('languages.da')}</SelectItem>
                </SelectContent>
              </Select>
              {languageSaving && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </div>
          </CardContent>
        </Card>

        {/* Account Information Section */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-muted-foreground" />
              <CardTitle>{t('settings.accountInfo')}</CardTitle>
            </div>
            <CardDescription>{t('settings.accountDetails')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">{t('settings.accountCreated')}</p>
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
                <p className="text-sm font-medium">{t('settings.role')}</p>
                <Badge variant={roleInfo.variant} className="mt-1">
                  {roleInfo.label}
                </Badge>
              </div>
            </div>
            {memberships.length > 1 && (
              <div className="pt-2">
                <p className="text-sm font-medium mb-2">{t('settings.organizations')}</p>
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
