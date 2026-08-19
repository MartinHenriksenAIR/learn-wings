import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { SlidingTabs } from '@/components/ui/sliding-tabs';
import { FileUpload } from '@/components/ui/file-upload';
import { Building2, User, UserPlus, SlidersHorizontal, Trash2 } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { PageSpinner } from '@/components/ui/page-spinner';
import { SaveButton } from '@/components/ui/save-button';
import { useFlash } from '@/hooks/useFlash';
import { useAuth } from '@/hooks/useAuth';
import { useOrgGuard } from '@/hooks/useOrgGuard';
import { usePlatformSettings } from '@/hooks/usePlatformSettings';
import { useOrgSettings } from '@/hooks/useOrgSettings';
import { useSignedBrandingUrl } from '@/hooks/useSignedBrandingUrl';
import { callApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { formatDate } from '@/lib/date-locale';
import { toast } from '@/components/ui/sonner';

type FeatureKey =
  | 'certificates_enabled'
  | 'quizzes_enabled'
  | 'analytics_enabled'
  | 'course_reviews_enabled'
  | 'community_enabled';

const featureKeys: FeatureKey[] = [
  'certificates_enabled',
  'quizzes_enabled',
  'analytics_enabled',
  'course_reviews_enabled',
  'community_enabled',
];

type FeatureState = Record<FeatureKey, boolean>;

const rowClass =
  'flex items-center justify-between rounded-xl border border-[#eceef3] px-4 py-[13px]';

export default function OrgSettings() {
  const { currentOrg, refreshUserContext } = useAuth();
  const orgGuard = useOrgGuard();
  const { platformFeatures, isLoading: platformLoading, refetch: refetchPlatform } = usePlatformSettings();
  const orgSettingsQuery = useOrgSettings(currentOrg?.id);
  const { data: logoSrc } = useSignedBrandingUrl(currentOrg?.logo_url);
  const { t, i18n } = useTranslation();
  const { flashed, flash } = useFlash();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState('profile');
  const [saving, setSaving] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);

  const rawFeatures = orgSettingsQuery.data ?? null;

  const [name, setName] = useState('');
  const [allowSelfReg, setAllowSelfReg] = useState(true);
  const [localFeatures, setLocalFeatures] = useState<FeatureState>({
    certificates_enabled: true,
    quizzes_enabled: true,
    analytics_enabled: true,
    course_reviews_enabled: true,
    community_enabled: true,
  });
  const [leaderboardEnabled, setLeaderboardEnabled] = useState(true);

  useEffect(() => {
    setName(currentOrg?.name ?? '');
  }, [currentOrg?.id, currentOrg?.name]);

  useEffect(() => {
    setAllowSelfReg(currentOrg?.allow_self_registration ?? true);
  }, [currentOrg?.id, currentOrg?.allow_self_registration]);

  useEffect(() => {
    setLocalFeatures({
      certificates_enabled: rawFeatures?.certificates_enabled ?? true,
      quizzes_enabled: rawFeatures?.quizzes_enabled ?? true,
      analytics_enabled: rawFeatures?.analytics_enabled ?? true,
      course_reviews_enabled: rawFeatures?.course_reviews_enabled ?? true,
      community_enabled: rawFeatures?.community_enabled ?? true,
    });
    setLeaderboardEnabled(rawFeatures?.leaderboard_enabled ?? true);
  }, [currentOrg?.id, rawFeatures]);

  const trimmedName = name.trim();
  const nameInvalid = trimmedName.length < 2 || trimmedName.length > 100;

  const orgDirty =
    (!nameInvalid && trimmedName !== (currentOrg?.name ?? '')) ||
    allowSelfReg !== (currentOrg?.allow_self_registration ?? true);
  const featuresDirty =
    featureKeys.some((k) => localFeatures[k] !== (rawFeatures?.[k] ?? true)) ||
    leaderboardEnabled !== (rawFeatures?.leaderboard_enabled ?? true);
  const dirty = orgDirty || featuresDirty;

  const createdLabel = useMemo(() => {
    if (!currentOrg?.created_at) return '';
    return formatDate(new Date(currentOrg.created_at), 'P', i18n.language);
  }, [currentOrg?.created_at, i18n.language]);

  const handleSave = async () => {
    if (!currentOrg || nameInvalid) return;
    setSaving(true);
    try {
      const orgUpdates: Record<string, unknown> = {};
      if (trimmedName !== (currentOrg.name ?? '')) orgUpdates.name = trimmedName;
      if (allowSelfReg !== (currentOrg.allow_self_registration ?? true)) {
        orgUpdates.allow_self_registration = allowSelfReg;
      }
      if (Object.keys(orgUpdates).length > 0) {
        await callApi('/api/organization-update', { orgId: currentOrg.id, updates: orgUpdates });
      }

      if (featuresDirty) {
        const nextFeatures = {
          ...(rawFeatures ?? {}),
          ...localFeatures,
          leaderboard_enabled: leaderboardEnabled,
        };
        await callApi('/api/org-settings-update', { orgId: currentOrg.id, features: nextFeatures });
      }

      flash('orgSettings');
      await Promise.all([
        refreshUserContext(),
        refetchPlatform(),
        queryClient.invalidateQueries({ queryKey: queryKeys.orgSettings.detail(currentOrg.id) }),
      ]);
    } catch (error) {
      toast({
        title: t('orgSettings.saveFailed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const persistLogo = async (logo_url: string | null) => {
    if (!currentOrg) return;
    setLogoBusy(true);
    try {
      await callApi('/api/organization-update', { orgId: currentOrg.id, updates: { logo_url } });
      await refreshUserContext();
    } catch (error) {
      toast({
        title: t('orgSettings.logoUpdateFailed'),
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setLogoBusy(false);
    }
  };

  if (
    orgGuard === 'loading' ||
    (platformLoading && !saving) ||
    (orgSettingsQuery.isLoading && !saving)
  ) {
    return (
      <AppLayout headerLabel={t('orgSettings.title')}>
        <PageSpinner />
      </AppLayout>
    );
  }

  if (!currentOrg) {
    return (
      <AppLayout headerLabel={t('orgSettings.title')}>
        <div className="flex h-64 items-center justify-center">
          <EmptyState
            icon={<Building2 className="h-6 w-6" />}
            title={t('common.noOrgSelected')}
            description={t('orgSettings.noOrgDescription')}
          />
        </div>
      </AppLayout>
    );
  }

  const tabs = [
    { key: 'profile', label: t('orgSettings.tabs.profile'), icon: <User className="h-4 w-4" aria-hidden="true" /> },
    { key: 'access', label: t('orgSettings.tabs.access'), icon: <UserPlus className="h-4 w-4" aria-hidden="true" /> },
    { key: 'features', label: t('orgSettings.tabs.features'), icon: <SlidersHorizontal className="h-4 w-4" aria-hidden="true" /> },
  ];

  return (
    <AppLayout headerLabel={t('orgSettings.title')}>
      <div className="max-w-[680px]">
        <h1 className="mb-1 font-display text-[26px] font-extrabold tracking-[-0.02em]">
          {t('orgSettings.title')}
        </h1>
        <p className="mb-[22px] text-sm text-muted-foreground">{t('orgSettings.subtitle')}</p>

        <SlidingTabs tabs={tabs} active={activeTab} onChange={setActiveTab} className="mb-6" />

        {activeTab === 'profile' && (
          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle>{t('orgSettings.tabs.profile')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="org-name" className="text-[13.5px] font-bold">
                    {t('orgSettings.profile.nameLabel')}
                  </Label>
                  <Input
                    id="org-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={100}
                    aria-invalid={nameInvalid}
                  />
                  {nameInvalid ? (
                    <p className="text-[11.5px] text-destructive">{t('orgSettings.profile.nameError')}</p>
                  ) : (
                    <p className="text-[11.5px] text-muted-foreground">{t('orgSettings.profile.nameHint')}</p>
                  )}
                </div>

                <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-[13px]">
                  <dt className="font-bold">{t('orgSettings.profile.slugLabel')}</dt>
                  <dd className="text-muted-foreground">{currentOrg.slug}</dd>
                  <dt className="font-bold">{t('orgSettings.profile.memberLimitLabel')}</dt>
                  <dd className="text-muted-foreground">
                    {currentOrg.seat_limit ?? t('orgSettings.profile.unlimited')}
                  </dd>
                  {currentOrg.member_count != null && (
                    <>
                      <dt className="font-bold">{t('orgSettings.profile.membersUsedLabel')}</dt>
                      <dd className="text-muted-foreground">{currentOrg.member_count}</dd>
                    </>
                  )}
                  {createdLabel && (
                    <>
                      <dt className="font-bold">{t('orgSettings.profile.createdLabel')}</dt>
                      <dd className="text-muted-foreground">{createdLabel}</dd>
                    </>
                  )}
                </dl>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t('orgSettings.profile.logoLabel')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-4">
                  {logoSrc ? (
                    <img
                      src={logoSrc}
                      alt={`${currentOrg.name} logo`}
                      className="h-16 w-16 rounded-xl bg-muted object-contain"
                    />
                  ) : (
                    <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-primary/10">
                      <Building2 className="h-8 w-8 text-primary" aria-hidden="true" />
                    </div>
                  )}
                  {logoSrc && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => persistLogo(null)}
                      disabled={logoBusy}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
                      {t('orgSettings.profile.logoRemove')}
                    </Button>
                  )}
                </div>
                <p className="text-[11.5px] text-muted-foreground">{t('orgSettings.profile.logoHint')}</p>
                <FileUpload
                  assetType="org-logo"
                  folder={currentOrg.id}
                  accept="image"
                  maxSizeMB={2}
                  onChange={(_url, storagePath) => storagePath && persistLogo(storagePath)}
                  disabled={logoBusy}
                />
              </CardContent>
            </Card>
          </div>
        )}

        {activeTab === 'access' && (
          <Card>
            <CardHeader>
              <CardTitle>{t('orgSettings.selfRegTitle')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className={rowClass}>
                <div className="flex flex-col gap-px pr-4">
                  <Label htmlFor="allow-self-registration" className="text-[13.5px] font-bold">
                    {t('orgSettings.selfRegLabel')}
                  </Label>
                  <p className="text-[11.5px] text-muted-foreground">{t('orgSettings.selfRegHint')}</p>
                </div>
                <Switch
                  id="allow-self-registration"
                  checked={allowSelfReg}
                  onCheckedChange={setAllowSelfReg}
                />
              </div>
            </CardContent>
          </Card>
        )}

        {activeTab === 'features' && (
          <Card>
            <CardHeader>
              <CardTitle>{t('orgSettings.featureOverrides')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5">
              <p className="mb-2 text-[11.5px] text-muted-foreground">{t('orgSettings.combinedNote')}</p>
              <div className="flex flex-col gap-2.5">
                {featureKeys.map((key) => (
                  <div key={key} className={rowClass}>
                    <div className="flex flex-col gap-px">
                      <Label htmlFor={`feature-${key}`} className="text-[13.5px] font-bold">
                        {t(`orgSettings.features.${key}`)}
                      </Label>
                      <p className="text-[11.5px] text-muted-foreground">
                        {t('orgSettings.platformDefault', {
                          state: platformFeatures[key]
                            ? t('orgSettings.enabled')
                            : t('orgSettings.disabled'),
                        })}
                      </p>
                    </div>
                    <Switch
                      id={`feature-${key}`}
                      checked={localFeatures[key]}
                      onCheckedChange={(checked) =>
                        setLocalFeatures((prev) => ({ ...prev, [key]: checked }))
                      }
                      disabled={!platformFeatures[key]}
                    />
                  </div>
                ))}
                <div className={rowClass}>
                  <div className="flex flex-col gap-px pr-4">
                    <Label htmlFor="leaderboard-enabled" className="text-[13.5px] font-bold">
                      {t('orgSettings.leaderboardLabel')}
                    </Label>
                    <p className="text-[11.5px] text-muted-foreground">{t('orgSettings.leaderboardHint')}</p>
                  </div>
                  <Switch
                    id="leaderboard-enabled"
                    checked={leaderboardEnabled}
                    onCheckedChange={setLeaderboardEnabled}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="sticky bottom-0 mt-6 flex justify-end border-t border-[#eceef3] bg-background/95 py-3 backdrop-blur">
          <SaveButton
            done={flashed('orgSettings')}
            idleLabel={t('orgSettings.saveAll')}
            onClick={handleSave}
            disabled={saving || !dirty || nameInvalid}
          />
        </div>
      </div>
    </AppLayout>
  );
}
