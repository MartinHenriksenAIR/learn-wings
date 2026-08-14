import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { callApi } from '@/lib/api-client';
import { useAuth } from '@/hooks/useAuth';

interface FeatureSettings {
  certificates_enabled: boolean;
  quizzes_enabled: boolean;
  analytics_enabled: boolean;
  course_reviews_enabled: boolean;
  community_enabled: boolean;
  exercises_enabled: boolean;
}

interface PlatformSettingsContextType {
  features: FeatureSettings;
  platformFeatures: FeatureSettings;
  orgFeatures: Partial<FeatureSettings> | null;
  isLoading: boolean;
  refetch: () => Promise<void>;
}

const defaultFeatures: FeatureSettings = {
  certificates_enabled: true,
  quizzes_enabled: true,
  analytics_enabled: true,
  course_reviews_enabled: false,
  community_enabled: true,
  exercises_enabled: false,
};

const PlatformSettingsContext = createContext<PlatformSettingsContextType>({
  features: defaultFeatures,
  platformFeatures: defaultFeatures,
  orgFeatures: null,
  isLoading: true,
  refetch: async () => {},
});

export function PlatformSettingsProvider({ children }: { children: ReactNode }) {
  const { user, currentOrg } = useAuth();
  const [platformFeatures, setPlatformFeatures] = useState<FeatureSettings>(defaultFeatures);
  const [orgFeatures, setOrgFeatures] = useState<Partial<FeatureSettings> | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchSettings = async () => {
    if (!user) {
      setPlatformFeatures(defaultFeatures);
      setOrgFeatures(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const [platformResult, orgResult] = await Promise.all([
        callApi<{ settings: Array<{ key: string; value: Record<string, unknown> }> }>('/api/platform-settings', {})
          .catch(() => ({ settings: [] as Array<{ key: string; value: Record<string, unknown> }> })),
        currentOrg
          ? callApi<{ settings: { org_id: string; features: Partial<FeatureSettings> } | null }>('/api/org-settings', { orgId: currentOrg.id })
              .catch(() => ({ settings: null }))
          : Promise.resolve({ settings: null }),
      ]);

      const data = platformResult.settings;
      let nextFeatures = defaultFeatures;
      data.forEach((setting) => {
        const value = setting.value as Record<string, unknown>;
        if (setting.key === 'features') {
          nextFeatures = { ...nextFeatures, ...(value as Partial<FeatureSettings>) };
        }
      });
      setPlatformFeatures(nextFeatures);

      const nextOrgFeatures = (orgResult.settings?.features as Partial<FeatureSettings> | undefined) ?? null;
      setOrgFeatures(nextOrgFeatures);
    } catch (err) {
      console.error('usePlatformSettings: failed to process settings', err);
      setPlatformFeatures(defaultFeatures);
      setOrgFeatures(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, [user?.id, currentOrg?.id]);

  const features: FeatureSettings = {
    certificates_enabled: platformFeatures.certificates_enabled && (orgFeatures?.certificates_enabled ?? true),
    quizzes_enabled: platformFeatures.quizzes_enabled && (orgFeatures?.quizzes_enabled ?? true),
    analytics_enabled: platformFeatures.analytics_enabled && (orgFeatures?.analytics_enabled ?? true),
    course_reviews_enabled: platformFeatures.course_reviews_enabled && (orgFeatures?.course_reviews_enabled ?? true),
    community_enabled: platformFeatures.community_enabled && (orgFeatures?.community_enabled ?? true),
    exercises_enabled: platformFeatures.exercises_enabled && (orgFeatures?.exercises_enabled ?? true),
  };

  return (
    <PlatformSettingsContext.Provider
      value={{
        features,
        platformFeatures,
        orgFeatures,
        isLoading,
        refetch: fetchSettings,
      }}
    >
      {children}
    </PlatformSettingsContext.Provider>
  );
}

export function usePlatformSettings() {
  return useContext(PlatformSettingsContext);
}
