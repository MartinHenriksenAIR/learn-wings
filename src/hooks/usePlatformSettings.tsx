import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface FeatureSettings {
  certificates_enabled: boolean;
  quizzes_enabled: boolean;
  analytics_enabled: boolean;
  course_reviews_enabled: boolean;
  community_enabled: boolean;
}

interface BrandingSettings {
  platform_name: string;
  primary_color: string;
  logo_url: string | null;
}

interface PlatformSettingsContextType {
  features: FeatureSettings;
  branding: BrandingSettings;
  isLoading: boolean;
  refetch: () => Promise<void>;
}

const defaultFeatures: FeatureSettings = {
  certificates_enabled: true,
  quizzes_enabled: true,
  analytics_enabled: true,
  course_reviews_enabled: false,
  community_enabled: true,
};

const defaultBranding: BrandingSettings = {
  platform_name: 'AIR Academy',
  primary_color: '#6366f1',
  logo_url: null,
};

const PlatformSettingsContext = createContext<PlatformSettingsContextType>({
  features: defaultFeatures,
  branding: defaultBranding,
  isLoading: true,
  refetch: async () => {},
});

export function PlatformSettingsProvider({ children }: { children: ReactNode }) {
  const [features, setFeatures] = useState<FeatureSettings>(defaultFeatures);
  const [branding, setBranding] = useState<BrandingSettings>(defaultBranding);
  const [isLoading, setIsLoading] = useState(true);

  const fetchSettings = async () => {
    const { data } = await supabase
      .from('platform_settings')
      .select('key, value');

    if (data) {
      data.forEach((setting) => {
        const value = setting.value as Record<string, unknown>;
        if (setting.key === 'features') {
          // Merge with defaults to ensure new feature flags are included
          setFeatures(prev => ({ ...prev, ...value as unknown as Partial<FeatureSettings> }));
        } else if (setting.key === 'branding') {
          setBranding(prev => ({ ...prev, ...value as unknown as Partial<BrandingSettings> }));
        }
      });
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  return (
    <PlatformSettingsContext.Provider
      value={{
        features,
        branding,
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
