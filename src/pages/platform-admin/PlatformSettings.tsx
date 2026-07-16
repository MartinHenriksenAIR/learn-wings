import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SlidingTabs } from '@/components/ui/sliding-tabs';
import { SaveButton } from '@/components/ui/save-button';
import { useFlash } from '@/hooks/useFlash';
import { EmptyState } from '@/components/ui/empty-state';
import { PageSpinner } from '@/components/ui/page-spinner';
import { callApi } from '@/lib/api-client';
import { toast } from '@/components/ui/sonner';
import { useToastMutation } from '@/hooks/useToastMutation';
import { usePlatformSettingsAdmin } from '@/hooks/usePlatformSettingsAdmin';
import { Loader2, Palette, Users, Mail, ToggleLeft, AlertTriangle } from 'lucide-react';

interface BrandingSettings {
  platform_name: string;
  primary_color: string;
  accent_color: string;
  sidebar_primary_color: string;
  sidebar_accent_color: string;
  logo_url: string | null;
  favicon_url: string | null;
}

interface UserAccessSettings {
  default_role: 'learner' | 'org_admin';
  require_email_verification: boolean;
  allow_self_registration: boolean;
}

interface EmailSettings {
  from_name: string;
  from_email: string | null;
  smtp_configured: boolean;
  smtp_host: string;
  smtp_port: number;
  smtp_username: string;
  smtp_password: string;
  smtp_encryption: 'none' | 'ssl_tls' | 'starttls';
}

interface FeatureSettings {
  certificates_enabled: boolean;
  quizzes_enabled: boolean;
  analytics_enabled: boolean;
  community_enabled: boolean;
  course_reviews_enabled: boolean;
}

type SettingsKey = 'branding' | 'user_access' | 'email' | 'features';

const defaultBranding: BrandingSettings = {
  platform_name: 'AIR Academy',
  primary_color: '#6366f1',
  accent_color: '#10b981',
  sidebar_primary_color: '#10b981',
  sidebar_accent_color: '#1f2937',
  logo_url: null,
  favicon_url: null,
};

const defaultUserAccess: UserAccessSettings = {
  default_role: 'learner',
  require_email_verification: false,
  allow_self_registration: true,
};

const defaultEmail: EmailSettings = {
  from_name: 'AIR Academy',
  from_email: null,
  smtp_configured: false,
  smtp_host: '',
  smtp_port: 587,
  smtp_username: '',
  smtp_password: '',
  smtp_encryption: 'starttls',
};

const defaultFeatures: FeatureSettings = {
  certificates_enabled: true,
  quizzes_enabled: true,
  analytics_enabled: true,
  community_enabled: true,
  course_reviews_enabled: false,
};

const featureKeys: (keyof FeatureSettings)[] = [
  'certificates_enabled',
  'quizzes_enabled',
  'analytics_enabled',
  'community_enabled',
  'course_reviews_enabled',
];

export default function PlatformSettings() {
  const { t } = useTranslation();
  const { flashed, flash } = useFlash();
  const [savingKey, setSavingKey] = useState<SettingsKey | null>(null);
  const [testingSmtp, setTestingSmtp] = useState(false);
  const [activeTab, setActiveTab] = useState<SettingsKey>('branding');

  const [branding, setBranding] = useState<BrandingSettings>(defaultBranding);
  const [userAccess, setUserAccess] = useState<UserAccessSettings>(defaultUserAccess);
  const [email, setEmail] = useState<EmailSettings>(defaultEmail);
  const [features, setFeatures] = useState<FeatureSettings>(defaultFeatures);

  const query = usePlatformSettingsAdmin();

  // Seed local form state from the server — runs the same switch as the old
  // fetchSettings so merge semantics are byte-for-byte identical.
  useEffect(() => {
    if (!query.data) return;
    query.data.forEach((setting) => {
      const value = (setting.value as Record<string, unknown>) || {};
      switch (setting.key) {
        case 'branding':
          setBranding({ ...defaultBranding, ...(value as Partial<BrandingSettings>) });
          break;
        case 'user_access':
          setUserAccess({ ...defaultUserAccess, ...(value as Partial<UserAccessSettings>) });
          break;
        case 'email':
          setEmail({ ...defaultEmail, ...(value as Partial<EmailSettings>) });
          break;
        case 'features':
          setFeatures({ ...defaultFeatures, ...(value as Partial<FeatureSettings>) });
          break;
      }
    });
  }, [query.data]);

  // Per-panel save. Sends ONLY the panel's fields under `value`; the server
  // merges with the stored config (`value || $2::jsonb`), so partial/malformed
  // writes never clobber other keys (#90). Routine saves morph the button
  // ("Saved" / green) instead of firing a success toast (toast policy); errors
  // keep their toast.
  const saveSettingMutation = useToastMutation({
    mutationFn: ({ key, value }: { key: SettingsKey; value: BrandingSettings | UserAccessSettings | EmailSettings | FeatureSettings }) =>
      callApi('/api/platform-settings-update', { key, value }),
    errorTitle: t('platformSettings.saveFailed'),
    onSuccess: (_data, variables) => {
      flash(variables.key);
    },
    onSettled: () => setSavingKey(null),
  });

  const saveSetting = (key: SettingsKey, value: BrandingSettings | UserAccessSettings | EmailSettings | FeatureSettings) => {
    if (!query.isSuccess) return;
    setSavingKey(key);
    saveSettingMutation.mutate({ key, value });
  };

  const handleTestSmtpConnection = async () => {
    setTestingSmtp(true);
    try {
      const data = await callApi<{ success: boolean; message?: string; error?: string }>('/api/test-smtp-connection', {
        host: email.smtp_host,
        port: email.smtp_port,
        username: email.smtp_username,
        password: email.smtp_password,
        encryption: email.smtp_encryption,
        fromEmail: email.from_email,
      });

      if (!data?.success) {
        throw new Error(data?.error || t('platformSettings.email.testFailedFallback'));
      }

      toast({
        title: t('platformSettings.email.testSuccessTitle'),
        description: data.message || t('platformSettings.email.testSuccessDescription'),
      });
      setEmail((prev) => ({ ...prev, smtp_configured: true }));
    } catch (error: any) {
      toast({
        title: t('platformSettings.email.testFailedTitle'),
        description: error?.message || t('platformSettings.email.testFailedDescription'),
        variant: 'destructive',
      });
      setEmail((prev) => ({ ...prev, smtp_configured: false }));
    } finally {
      setTestingSmtp(false);
    }
  };

  if (query.isLoading) {
    return (
      <AppLayout breadcrumbs={[{ label: t('platformSettings.title') }]}>
        <PageSpinner />
      </AppLayout>
    );
  }

  if (!query.isSuccess) {
    return (
      <AppLayout breadcrumbs={[{ label: t('platformSettings.title') }]}>
        <div className="flex h-64 items-center justify-center">
          <EmptyState
            icon={<AlertTriangle className="h-6 w-6" />}
            title={t('platformSettings.loadFailedTitle')}
            description={t('platformSettings.loadFailedDescription')}
            action={
              <Button variant="outline" onClick={() => query.refetch()}>
                {t('platformSettings.retry')}
              </Button>
            }
          />
        </div>
      </AppLayout>
    );
  }

  const tabs = [
    { key: 'branding', label: t('platformSettings.tabs.branding'), icon: <Palette className="h-4 w-4" /> },
    { key: 'user_access', label: t('platformSettings.tabs.userAccess'), icon: <Users className="h-4 w-4" /> },
    { key: 'email', label: t('platformSettings.tabs.email'), icon: <Mail className="h-4 w-4" /> },
    { key: 'features', label: t('platformSettings.tabs.features'), icon: <ToggleLeft className="h-4 w-4" /> },
  ];

  const brandingColors: { key: keyof BrandingSettings; label: string; placeholder: string }[] = [
    { key: 'primary_color', label: t('platformSettings.branding.primaryColor'), placeholder: '#6366f1' },
    { key: 'accent_color', label: t('platformSettings.branding.accentColor'), placeholder: '#10b981' },
    { key: 'sidebar_primary_color', label: t('platformSettings.branding.sidebarPrimaryColor'), placeholder: '#10b981' },
    { key: 'sidebar_accent_color', label: t('platformSettings.branding.sidebarAccentColor'), placeholder: '#1f2937' },
  ];

  return (
    <AppLayout breadcrumbs={[{ label: t('platformSettings.title') }]}>
      <div className="max-w-[760px]">
        <h1 className="mb-1 font-display text-[26px] font-extrabold tracking-[-0.02em]">
          {t('platformSettings.title')}
        </h1>
        <p className="mb-5 text-sm text-muted-foreground">{t('platformSettings.subtitle')}</p>

        <SlidingTabs
          tabs={tabs}
          active={activeTab}
          onChange={(k) => setActiveTab(k as SettingsKey)}
          className="mb-5"
        />

        {activeTab === 'branding' && (
          <Card>
            <CardContent className="space-y-[18px] px-[26px] py-6">
              <div className="space-y-1.5">
                <Label htmlFor="platform_name" className="text-xs font-bold text-[#4a4f60]">
                  {t('platformSettings.branding.platformName')}
                </Label>
                <Input
                  id="platform_name"
                  value={branding.platform_name}
                  onChange={(e) => setBranding({ ...branding, platform_name: e.target.value })}
                  placeholder="AIR Academy"
                />
              </div>

              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                {brandingColors.map((c) => (
                  <div key={c.key} className="space-y-1.5">
                    <Label htmlFor={c.key} className="text-xs font-bold text-[#4a4f60]">
                      {c.label}
                    </Label>
                    <div className="flex items-center gap-2">
                      <span
                        className="h-[38px] w-[38px] shrink-0 rounded-[10px] border border-input"
                        style={{ background: (branding[c.key] as string) || '#ffffff' }}
                      />
                      <Input
                        id={c.key}
                        value={(branding[c.key] as string) || ''}
                        onChange={(e) => setBranding({ ...branding, [c.key]: e.target.value })}
                        placeholder={c.placeholder}
                        className="flex-1 font-mono text-[13px]"
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="logo_url" className="text-xs font-bold text-[#4a4f60]">
                    {t('platformSettings.branding.logoUrl')}
                  </Label>
                  <Input
                    id="logo_url"
                    value={branding.logo_url || ''}
                    onChange={(e) => setBranding({ ...branding, logo_url: e.target.value || null })}
                    placeholder="https://example.com/logo.png"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="favicon_url" className="text-xs font-bold text-[#4a4f60]">
                    {t('platformSettings.branding.faviconUrl')}
                  </Label>
                  <Input
                    id="favicon_url"
                    value={branding.favicon_url || ''}
                    onChange={(e) => setBranding({ ...branding, favicon_url: e.target.value || null })}
                    placeholder="https://example.com/favicon.png"
                  />
                </div>
              </div>

              <SaveButton
                done={flashed('branding')}
                idleLabel={t('platformSettings.branding.save')}
                onClick={() => saveSetting('branding', branding)}
                disabled={savingKey === 'branding'}
              />
            </CardContent>
          </Card>
        )}

        {activeTab === 'user_access' && (
          <Card>
            <CardContent className="space-y-[18px] px-[26px] py-6">
              <div className="rounded-xl border border-[#eceef3] bg-muted/50 p-4">
                <Label className="text-[13.5px] font-bold">{t('platformSettings.userAccess.defaultRole')}</Label>
                <p className="mt-1 text-[11.5px] text-muted-foreground">
                  {t('platformSettings.userAccess.defaultRoleNote')}
                </p>
              </div>

              <div className="flex items-center justify-between rounded-xl border border-[#eceef3] px-4 py-[13px]">
                <div className="flex flex-col gap-px">
                  <Label htmlFor="require_email_verification" className="text-[13.5px] font-bold">
                    {t('platformSettings.userAccess.requireEmailVerification')}
                  </Label>
                  <p className="text-[11.5px] text-muted-foreground">
                    {t('platformSettings.userAccess.requireEmailVerificationHint')}
                  </p>
                </div>
                <Switch
                  id="require_email_verification"
                  checked={userAccess.require_email_verification}
                  onCheckedChange={(checked) => setUserAccess({ ...userAccess, require_email_verification: checked })}
                />
              </div>

              <div className="flex items-center justify-between rounded-xl border border-[#eceef3] px-4 py-[13px]">
                <div className="flex flex-col gap-px">
                  <Label htmlFor="allow_self_registration" className="text-[13.5px] font-bold">
                    {t('platformSettings.userAccess.allowSelfRegistration')}
                  </Label>
                  <p className="text-[11.5px] text-muted-foreground">
                    {t('platformSettings.userAccess.allowSelfRegistrationHint')}
                  </p>
                </div>
                <Switch
                  id="allow_self_registration"
                  checked={userAccess.allow_self_registration}
                  onCheckedChange={(checked) => setUserAccess({ ...userAccess, allow_self_registration: checked })}
                />
              </div>

              <SaveButton
                done={flashed('user_access')}
                idleLabel={t('platformSettings.userAccess.save')}
                onClick={() => saveSetting('user_access', { ...userAccess, default_role: 'learner' })}
                disabled={savingKey === 'user_access'}
              />
            </CardContent>
          </Card>
        )}

        {activeTab === 'email' && (
          <Card>
            <CardContent className="space-y-3.5 px-[26px] py-6">
              {!email.smtp_configured && (
                <div className="flex items-center gap-2.5 rounded-xl border border-[#efddb2] bg-[#fbf2dd] px-4 py-3 text-[12.5px] font-semibold text-[#8a5e10]">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  {t('platformSettings.email.notConfiguredWarning')}
                </div>
              )}

              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="from_name" className="text-xs font-bold text-[#4a4f60]">
                    {t('platformSettings.email.fromName')}
                  </Label>
                  <Input
                    id="from_name"
                    value={email.from_name}
                    onChange={(e) => setEmail({ ...email, from_name: e.target.value })}
                    placeholder="AIR Academy"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="from_email" className="text-xs font-bold text-[#4a4f60]">
                    {t('platformSettings.email.fromEmail')}
                  </Label>
                  <Input
                    id="from_email"
                    type="email"
                    value={email.from_email || ''}
                    onChange={(e) => setEmail({ ...email, from_email: e.target.value || null })}
                    placeholder="noreply@example.com"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="smtp_host" className="text-xs font-bold text-[#4a4f60]">
                    {t('platformSettings.email.smtpHost')}
                  </Label>
                  <Input
                    id="smtp_host"
                    value={email.smtp_host}
                    onChange={(e) => setEmail({ ...email, smtp_host: e.target.value })}
                    placeholder="smtp.example.com"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="smtp_port" className="text-xs font-bold text-[#4a4f60]">
                    {t('platformSettings.email.smtpPort')}
                  </Label>
                  <Input
                    id="smtp_port"
                    type="number"
                    min={1}
                    value={email.smtp_port}
                    onChange={(e) => setEmail({ ...email, smtp_port: Number(e.target.value || 587) })}
                    placeholder="587"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="smtp_username" className="text-xs font-bold text-[#4a4f60]">
                    {t('platformSettings.email.smtpUsername')}
                  </Label>
                  <Input
                    id="smtp_username"
                    value={email.smtp_username}
                    onChange={(e) => setEmail({ ...email, smtp_username: e.target.value })}
                    placeholder="smtp-user"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="smtp_password" className="text-xs font-bold text-[#4a4f60]">
                    {t('platformSettings.email.smtpPassword')}
                  </Label>
                  <Input
                    id="smtp_password"
                    type="password"
                    value={email.smtp_password}
                    onChange={(e) => setEmail({ ...email, smtp_password: e.target.value })}
                    placeholder="••••••••"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="smtp_encryption" className="text-xs font-bold text-[#4a4f60]">
                  {t('platformSettings.email.encryption')}
                </Label>
                <Select
                  value={email.smtp_encryption}
                  onValueChange={(value) => setEmail({ ...email, smtp_encryption: value as EmailSettings['smtp_encryption'] })}
                >
                  <SelectTrigger id="smtp_encryption" className="w-[200px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="starttls">{t('platformSettings.email.encryptionStarttls')}</SelectItem>
                    <SelectItem value="ssl_tls">{t('platformSettings.email.encryptionSslTls')}</SelectItem>
                    <SelectItem value="none">{t('platformSettings.email.encryptionNone')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Button type="button" variant="outline" onClick={handleTestSmtpConnection} disabled={testingSmtp}>
                  {testingSmtp ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {t('platformSettings.email.testConnection')}
                </Button>

                <SaveButton
                  done={flashed('email')}
                  idleLabel={t('platformSettings.email.save')}
                  onClick={() => saveSetting('email', email)}
                  disabled={savingKey === 'email'}
                />
              </div>
            </CardContent>
          </Card>
        )}

        {activeTab === 'features' && (
          <Card>
            <CardContent className="space-y-2.5 px-[26px] py-6">
              <p className="mb-4 text-[13px] text-muted-foreground">{t('platformSettings.features.note')}</p>
              <div className="mb-[22px] flex flex-col gap-2.5">
                {featureKeys.map((key) => (
                  <div
                    key={key}
                    className="flex items-center justify-between rounded-xl border border-[#eceef3] px-4 py-[13px]"
                  >
                    <div className="flex flex-col gap-px">
                      <Label htmlFor={`feature-${key}`} className="text-[13.5px] font-bold">
                        {t(`platformSettings.features.${key}`)}
                      </Label>
                      <p className="text-[11.5px] text-muted-foreground">
                        {t(`platformSettings.features.${key}_hint`)}
                      </p>
                    </div>
                    <Switch
                      id={`feature-${key}`}
                      checked={features[key]}
                      onCheckedChange={(checked) => setFeatures({ ...features, [key]: checked })}
                    />
                  </div>
                ))}
              </div>

              <SaveButton
                done={flashed('features')}
                idleLabel={t('platformSettings.features.save')}
                onClick={() => saveSetting('features', features)}
                disabled={savingKey === 'features'}
              />
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
