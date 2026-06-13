import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Building2 } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { PageSpinner } from '@/components/ui/page-spinner';
import { SaveButton } from '@/components/ui/save-button';
import { useFlash } from '@/hooks/useFlash';
import { useAuth } from '@/hooks/useAuth';
import { useOrgGuard } from '@/hooks/useOrgGuard';
import { usePlatformSettings } from '@/hooks/usePlatformSettings';
import { callApi } from '@/lib/api-client';
import { toast } from '@/components/ui/sonner';

type FeatureSettings = {
  certificates_enabled: boolean;
  quizzes_enabled: boolean;
  analytics_enabled: boolean;
  course_reviews_enabled: boolean;
  community_enabled: boolean;
};

const featureKeys: (keyof FeatureSettings)[] = [
  'certificates_enabled',
  'quizzes_enabled',
  'analytics_enabled',
  'course_reviews_enabled',
  'community_enabled',
];

export default function OrgSettings() {
  const { currentOrg } = useAuth();
  const orgGuard = useOrgGuard();
  const { platformFeatures, orgFeatures, isLoading, refetch } = usePlatformSettings();
  const { t } = useTranslation();
  const { flashed, flash } = useFlash();
  const [saving, setSaving] = useState(false);
  const [localFeatures, setLocalFeatures] = useState<FeatureSettings>({
    certificates_enabled: true,
    quizzes_enabled: true,
    analytics_enabled: true,
    course_reviews_enabled: true,
    community_enabled: true,
  });

  useEffect(() => {
    setLocalFeatures({
      certificates_enabled: orgFeatures?.certificates_enabled ?? true,
      quizzes_enabled: orgFeatures?.quizzes_enabled ?? true,
      analytics_enabled: orgFeatures?.analytics_enabled ?? true,
      course_reviews_enabled: orgFeatures?.course_reviews_enabled ?? true,
      community_enabled: orgFeatures?.community_enabled ?? true,
    });
  }, [orgFeatures]);

  const handleSave = async () => {
    if (!currentOrg) return;
    setSaving(true);
    try {
      await callApi('/api/org-settings-update', { orgId: currentOrg.id, features: localFeatures });
      // Routine save: in-button "Saved" morph, no success toast (toast policy).
      flash('orgSettings');
      await refetch();
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

  // Spinner: settings still loading, OR user context not yet resolved (useOrgGuard).
  // `!saving` keeps the form mounted during the post-save refetch (which flips the
  // shared isLoading) — otherwise every Save flashes a full-page spinner mid-edit.
  if ((isLoading && !saving) || orgGuard === 'loading') {
    return (
      <AppLayout breadcrumbs={[{ label: t('orgSettings.title') }]}>
        <PageSpinner />
      </AppLayout>
    );
  }

  // Empty state: resolved but no org context
  if (!currentOrg) {
    return (
      <AppLayout breadcrumbs={[{ label: t('orgSettings.title') }]}>
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

  return (
    <AppLayout breadcrumbs={[{ label: t('orgSettings.title') }]}>
      <div className="max-w-[680px]">
        <h1 className="mb-1 font-display text-[26px] font-extrabold tracking-[-0.02em]">
          {t('orgSettings.title')}
        </h1>
        <p className="mb-[22px] text-sm text-muted-foreground">{t('orgSettings.combinedNote')}</p>

        <Card>
          <CardHeader>
            <CardTitle>{t('orgSettings.featureOverrides')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            <div className="mb-[22px] flex flex-col gap-2.5">
              {featureKeys.map((key) => (
                <div
                  key={key}
                  className="flex items-center justify-between rounded-xl border border-[#eceef3] px-4 py-[13px]"
                >
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
            </div>

            <SaveButton
              done={flashed('orgSettings')}
              idleLabel={t('orgSettings.saveButton')}
              onClick={handleSave}
              disabled={saving || !currentOrg}
            />
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
