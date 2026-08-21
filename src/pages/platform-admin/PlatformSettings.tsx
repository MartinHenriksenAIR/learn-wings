import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { SlidingTabs } from '@/components/ui/sliding-tabs';
import { SaveButton } from '@/components/ui/save-button';
import { useFlash } from '@/hooks/useFlash';
import { EmptyState } from '@/components/ui/empty-state';
import { PageSpinner } from '@/components/ui/page-spinner';
import { callApi } from '@/lib/api-client';
import { useToastMutation } from '@/hooks/useToastMutation';
import { usePlatformSettingsAdmin } from '@/hooks/usePlatformSettingsAdmin';
import { useProfiles } from '@/hooks/useProfiles';
import { PlatformAdminsSection } from '@/components/platform-admin/PlatformAdminsSection';
import { queryKeys } from '@/lib/query-keys';
import { Loader2, Users, ToggleLeft, AlertTriangle, DollarSign, ShieldCheck } from 'lucide-react';

interface UserAccessSettings {
  allow_self_registration: boolean;
  allow_individual_registration: boolean;
}

interface FeatureSettings {
  certificates_enabled: boolean;
  quizzes_enabled: boolean;
  analytics_enabled: boolean;
  community_enabled: boolean;
  course_reviews_enabled: boolean;
  exercises_enabled: boolean;
}

interface SeatPricingSettings {
  annual_price_per_seat: number | null;
  currency: string;
  notification_email: string;
}

type SettingsKey = 'user_access' | 'features' | 'seat_pricing' | 'platform_admins';
type SettingsValue = UserAccessSettings | FeatureSettings | SeatPricingSettings;

const defaultUserAccess: UserAccessSettings = {
  allow_self_registration: true,
  allow_individual_registration: true,
};

const defaultFeatures: FeatureSettings = {
  certificates_enabled: true,
  quizzes_enabled: true,
  analytics_enabled: true,
  community_enabled: true,
  course_reviews_enabled: false,
  exercises_enabled: false,
};

const defaultSeatPricing: SeatPricingSettings = {
  annual_price_per_seat: null,
  currency: 'DKK',
  notification_email: 'jacob@ai-raadgivning.dk',
};

const featureKeys: (keyof FeatureSettings)[] = [
  'certificates_enabled',
  'quizzes_enabled',
  'analytics_enabled',
  'community_enabled',
  'course_reviews_enabled',
  'exercises_enabled',
];

export default function PlatformSettings() {
  const { t } = useTranslation();
  const { flashed, flash } = useFlash();
  const [activeTab, setActiveTab] = useState<SettingsKey>('user_access');

  const [userAccess, setUserAccess] = useState<UserAccessSettings>(defaultUserAccess);
  const [features, setFeatures] = useState<FeatureSettings>(defaultFeatures);
  const [seatPricing, setSeatPricing] = useState<SeatPricingSettings>(defaultSeatPricing);

  const query = usePlatformSettingsAdmin();
  const queryClient = useQueryClient();

  const platformAdminsTabActive = activeTab === 'platform_admins';
  const profilesQuery = useProfiles({ enabled: platformAdminsTabActive });

  const admins = useMemo(
    () =>
      (profilesQuery.data ?? [])
        .filter((p) => p.is_platform_admin)
        .map((p) => ({ id: p.id, full_name: p.full_name, email: p.email })),
    [profilesQuery.data],
  );

  const grantCandidates = useMemo(
    () => (profilesQuery.data ?? []).filter((p) => !p.is_platform_admin),
    [profilesQuery.data],
  );

  const invalidatePlatformAdmins = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.profiles.all });
  };

  const grantAdminMutation = useToastMutation({
    mutationFn: (userId: string) => callApi('/api/platform-admin-update', { userId, grant: true }),
    errorTitle: t('platformAdmins.updateFailed'),
    onSuccess: invalidatePlatformAdmins,
  });

  const revokeAdminMutation = useToastMutation({
    mutationFn: (userId: string) => callApi('/api/platform-admin-update', { userId, grant: false }),
    errorTitle: t('platformAdmins.updateFailed'),
    onSuccess: invalidatePlatformAdmins,
  });

  const adminsPending = grantAdminMutation.isPending || revokeAdminMutation.isPending;

  useEffect(() => {
    if (!query.data) return;
    query.data.forEach((setting) => {
      const value = (setting.value as Record<string, unknown>) || {};
      switch (setting.key) {
        case 'user_access':
          setUserAccess({ ...defaultUserAccess, ...(value as Partial<UserAccessSettings>) });
          break;
        case 'features':
          setFeatures({ ...defaultFeatures, ...(value as Partial<FeatureSettings>) });
          break;
        case 'seat_pricing':
          setSeatPricing({ ...defaultSeatPricing, ...(value as Partial<SeatPricingSettings>) });
          break;
      }
    });
  }, [query.data]);

  const saveSettingMutation = useToastMutation({
    mutationFn: ({ key, value }: { key: SettingsKey; value: SettingsValue }) =>
      callApi('/api/platform-settings-update', { key, value }),
    errorTitle: t('platformSettings.saveFailed'),
    onSuccess: (_data, variables) => {
      flash(variables.key);
    },
  });

  const isSaving = (key: SettingsKey) =>
    saveSettingMutation.isPending && saveSettingMutation.variables?.key === key;

  const saveSetting = (key: SettingsKey, value: SettingsValue) => {
    if (!query.isSuccess) return;
    saveSettingMutation.mutate({ key, value });
  };

  if (query.isLoading) {
    return (
      <AppLayout headerLabel={t('platformSettings.title')}>
        <PageSpinner />
      </AppLayout>
    );
  }

  if (!query.isSuccess) {
    return (
      <AppLayout headerLabel={t('platformSettings.title')}>
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
    { key: 'user_access', label: t('platformSettings.tabs.userAccess'), icon: <Users className="h-4 w-4" /> },
    { key: 'features', label: t('platformSettings.tabs.features'), icon: <ToggleLeft className="h-4 w-4" /> },
    { key: 'seat_pricing', label: t('platformSettings.seatPricing.tab'), icon: <DollarSign className="h-4 w-4" /> },
    { key: 'platform_admins', label: t('platformSettings.tabs.platformAdmins'), icon: <ShieldCheck className="h-4 w-4" /> },
  ];

  return (
    <AppLayout headerLabel={t('platformSettings.title')}>
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

        {activeTab === 'user_access' && (
          <Card>
            <CardContent className="space-y-[18px] px-[26px] py-6">
              <div className="rounded-xl border border-[#eceef3] bg-muted/50 p-4">
                <p className="text-[13.5px] font-bold leading-none">{t('platformSettings.userAccess.defaultRole')}</p>
                <p className="mt-1 text-[11.5px] text-muted-foreground">
                  {t('platformSettings.userAccess.defaultRoleNote')}
                </p>
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

              <div className="flex items-center justify-between rounded-xl border border-[#eceef3] px-4 py-[13px]">
                <div className="flex flex-col gap-px">
                  <Label htmlFor="allow_individual_registration" className="text-[13.5px] font-bold">
                    {t('platformSettings.userAccess.allowIndividualRegistration')}
                  </Label>
                  <p className="text-[11.5px] text-muted-foreground">
                    {t('platformSettings.userAccess.allowIndividualRegistrationHint')}
                  </p>
                </div>
                <Switch
                  id="allow_individual_registration"
                  checked={userAccess.allow_individual_registration}
                  onCheckedChange={(checked) => setUserAccess({ ...userAccess, allow_individual_registration: checked })}
                />
              </div>

              <SaveButton
                done={flashed('user_access')}
                idleLabel={t('platformSettings.userAccess.save')}
                onClick={() => saveSetting('user_access', userAccess)}
                disabled={isSaving('user_access')}
              />
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
                disabled={isSaving('features')}
              />
            </CardContent>
          </Card>
        )}

        {activeTab === 'seat_pricing' && (
          <Card>
            <CardContent className="space-y-[18px] px-[26px] py-6">
              <div className="space-y-1.5">
                <Label htmlFor="annual_price_per_seat" className="text-xs font-bold text-[#4a4f60]">
                  {t('platformSettings.seatPricing.annualPrice')}
                </Label>
                <Input
                  id="annual_price_per_seat"
                  type="number"
                  min={0}
                  value={seatPricing.annual_price_per_seat ?? ''}
                  onChange={(e) =>
                    setSeatPricing({
                      ...seatPricing,
                      annual_price_per_seat: e.target.value === '' ? null : Number(e.target.value),
                    })
                  }
                  placeholder="1200"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="seat_currency" className="text-xs font-bold text-[#4a4f60]">
                  {t('platformSettings.seatPricing.currency')}
                </Label>
                <Input id="seat_currency" value={seatPricing.currency} disabled />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="seat_notification_email" className="text-xs font-bold text-[#4a4f60]">
                  {t('platformSettings.seatPricing.notificationEmail')}
                </Label>
                <Input
                  id="seat_notification_email"
                  type="email"
                  value={seatPricing.notification_email}
                  onChange={(e) => setSeatPricing({ ...seatPricing, notification_email: e.target.value })}
                  placeholder="jacob@ai-raadgivning.dk"
                />
              </div>
              <SaveButton
                done={flashed('seat_pricing')}
                idleLabel={t('platformSettings.seatPricing.save')}
                onClick={() => saveSetting('seat_pricing', seatPricing)}
                disabled={isSaving('seat_pricing')}
              />
            </CardContent>
          </Card>
        )}

        {activeTab === 'platform_admins' && (
          <Card>
            <CardContent className="px-[26px] py-6">
              {profilesQuery.isPending ? (
                <div className="flex h-40 items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : !profilesQuery.isSuccess ? (
                <EmptyState
                  icon={<AlertTriangle className="h-6 w-6" />}
                  title={t('platformAdmins.loadFailedTitle')}
                  description={t('platformAdmins.loadFailedDescription')}
                  action={
                    <Button variant="outline" onClick={() => profilesQuery.refetch()}>
                      {t('platformSettings.retry')}
                    </Button>
                  }
                />
              ) : (
                <PlatformAdminsSection
                  admins={admins}
                  availableUsers={grantCandidates}
                  onGrant={(userId) => grantAdminMutation.mutate(userId)}
                  onRevoke={(userId) => revokeAdminMutation.mutate(userId)}
                  pending={adminsPending}
                />
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
