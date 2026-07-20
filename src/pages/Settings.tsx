import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { SaveButton } from '@/components/ui/save-button';
import { useFlash } from '@/hooks/useFlash';
import { useAuth } from '@/hooks/useAuth';
import { useState, useEffect } from 'react';
import { toast } from '@/components/ui/sonner';
import { Loader2, Mail, Calendar, Building2 } from 'lucide-react';
import { z } from 'zod';
import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { callApi } from '@/lib/api-client';
import { getInitials } from '@/lib/utils';
import { FileUpload } from '@/components/ui/file-upload';
import { buildPublicUrl } from '@/lib/storage-url';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';

const profileSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(50, 'First name is too long'),
  lastName: z.string().trim().max(50, 'Last name is too long').optional(),
  department: z.string().trim().max(100, 'Department is too long').optional(),
});

export default function Settings() {
  const { profile, user, memberships, isPlatformAdmin, refreshUserContext } = useAuth();
  const { t, i18n } = useTranslation();
  const { flashed, flash } = useFlash();

  // Profile state
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [department, setDepartment] = useState('');
  const [saving, setSaving] = useState(false);
  const [profileErrors, setProfileErrors] = useState<{ firstName?: string; lastName?: string; department?: string }>({});

  // Language state
  const [languageSaving, setLanguageSaving] = useState(false);

  // Profile-photo state
  const [avatarSaving, setAvatarSaving] = useState(false);

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
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setLanguageSaving(false);
    }
  };

  const handleAvatarChange = async (_url: string | null, storagePath: string | null) => {
    // Only persist a successful upload. A null storagePath means the upload
    // failed — FileUpload signals failure with onChange(null, null) — and
    // persisting then would silently wipe an existing photo. (Same guard the
    // org-logo upload uses in OrgAnalytics.) FileUpload surfaces the error to
    // the user for retry.
    if (!profile || !storagePath) return;

    setAvatarSaving(true);
    try {
      // Persist the raw container-relative blob path; display composes the
      // public URL via buildPublicUrl.
      await callApi('/api/profile-update', { avatar_url: storagePath });
      await refreshUserContext();
    } catch (error) {
      toast({
        title: t('settings.photoUpdateFailed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setAvatarSaving(false);
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
      // Routine save: in-button "Saved" morph, no success toast (toast policy;
      // supersedes the explicit success toast added for #20 — the morph is the
      // visible save confirmation now).
      flash('profile');
      await refreshUserContext();
    } catch (error) {
      toast({
        title: t('settings.profileUpdateFailed'),
        description: error instanceof Error ? error.message : String(error),
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
  const displayName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || user?.name;

  return (
    <AppLayout breadcrumbs={[{ label: t('settings.title') }]}>
      <div className="max-w-[680px]">
        <h1 className="mb-[22px] font-display text-[26px] font-extrabold tracking-[-0.02em]">
          {t('settings.title')}
        </h1>

        {/* Profile Section */}
        <Card className="mb-4">
          <CardContent className="space-y-3.5 px-[26px] py-6">
            <div className="mb-1 flex items-center gap-3.5">
              <Avatar className="h-[52px] w-[52px] shrink-0 rounded-2xl">
                {profile?.avatar_url && (
                  <AvatarImage src={buildPublicUrl(profile.avatar_url)} alt="" className="object-cover" />
                )}
                <AvatarFallback
                  aria-hidden="true"
                  className="rounded-2xl bg-accent text-[17px] font-extrabold text-accent-foreground"
                >
                  {getInitials(displayName)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <h3 className="text-[15px] font-extrabold">{t('settings.profile')}</h3>
                <p className="truncate text-[12.5px] text-muted-foreground">{t('settings.updateProfile')}</p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-[#4a4f60]">{t('settings.profilePhoto')}</Label>
              <FileUpload
                assetType="avatar"
                accept="image"
                onChange={handleAvatarChange}
                maxSizeMB={2}
                disabled={avatarSaving}
              />
              <p className="text-[11.5px] text-muted-foreground">{t('settings.profilePhotoHint')}</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="email" className="flex items-center gap-2 text-xs font-bold text-[#4a4f60]">
                <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                {t('auth.email')}
              </Label>
              <Input
                id="email"
                value={user?.email || ''}
                disabled
                className="bg-muted"
              />
              <p className="text-[11.5px] text-muted-foreground">
                {t('settings.emailCannotBeChanged')}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3.5">
              <div className="space-y-1.5">
                <Label htmlFor="firstName" className="text-xs font-bold text-[#4a4f60]">{t('settings.firstName')}</Label>
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
              <div className="space-y-1.5">
                <Label htmlFor="lastName" className="text-xs font-bold text-[#4a4f60]">{t('settings.lastName')}</Label>
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
            <div className="space-y-1.5">
              <Label htmlFor="department" className="text-xs font-bold text-[#4a4f60]">{t('settings.department')}</Label>
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
            <SaveButton
              done={flashed('profile')}
              idleLabel={t('settings.saveChanges')}
              onClick={handleProfileSave}
              disabled={saving}
            />
          </CardContent>
        </Card>

        {/* Language Section */}
        <Card className="mb-4">
          <CardContent className="space-y-3 px-[26px] py-6">
            <div>
              <h3 className="text-[15px] font-extrabold">{t('settings.language')}</h3>
              <p className="text-[12.5px] text-muted-foreground">{t('settings.languageDescription')}</p>
            </div>
            <div className="flex items-center gap-4">
              <Select
                value={profile?.preferred_language || i18n.language || 'da'}
                onValueChange={handleLanguageChange}
                disabled={languageSaving}
              >
                <SelectTrigger className="w-[240px]">
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
          <CardContent className="space-y-3.5 px-[26px] py-6">
            <h3 className="text-[15px] font-extrabold">{t('settings.accountInfo')}</h3>
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
                <p className="mb-2 text-sm font-medium">{t('settings.organizations')}</p>
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
