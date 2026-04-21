import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

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
  accent_color: string;
  sidebar_primary_color: string;
  sidebar_accent_color: string;
  logo_url: string | null;
  favicon_url: string | null;
}

interface PlatformSettingsContextType {
  features: FeatureSettings;
  platformFeatures: FeatureSettings;
  orgFeatures: Partial<FeatureSettings> | null;
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
  accent_color: '#10b981',
  sidebar_primary_color: '#10b981',
  sidebar_accent_color: '#1f2937',
  logo_url: null,
  favicon_url: null,
};

const hexToHslValue = (hex: string, fallback: string) => {
  const cleanHex = hex.replace('#', '').trim();
  const valid = /^[0-9A-Fa-f]{6}$/.test(cleanHex);
  if (!valid) return fallback;

  const r = parseInt(cleanHex.slice(0, 2), 16) / 255;
  const g = parseInt(cleanHex.slice(2, 4), 16) / 255;
  const b = parseInt(cleanHex.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
  }
  h = Math.round(h * 60);
  if (h < 0) h += 360;

  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));

  return `${h} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
};

const PlatformSettingsContext = createContext<PlatformSettingsContextType>({
  features: defaultFeatures,
  platformFeatures: defaultFeatures,
  orgFeatures: null,
  branding: defaultBranding,
  isLoading: true,
  refetch: async () => {},
});

export function PlatformSettingsProvider({ children }: { children: ReactNode }) {
  const { currentOrg } = useAuth();
  const [platformFeatures, setPlatformFeatures] = useState<FeatureSettings>(defaultFeatures);
  const [orgFeatures, setOrgFeatures] = useState<Partial<FeatureSettings> | null>(null);
  const [branding, setBranding] = useState<BrandingSettings>(defaultBranding);
  const [isLoading, setIsLoading] = useState(true);

  const fetchSettings = async () => {
    setIsLoading(true);
    const [platformRes, orgRes] = await Promise.all([
      supabase.from('platform_settings').select('key, value'),
      currentOrg
        ? supabase.from('org_settings').select('features').eq('org_id', currentOrg.id).maybeSingle()
        : Promise.resolve({ data: null, error: null } as any),
    ]);

    const data = platformRes.data;
    if (data) {
      let nextFeatures = defaultFeatures;
      let nextBranding = defaultBranding;
      data.forEach((setting) => {
        const value = setting.value as Record<string, unknown>;
        if (setting.key === 'features') {
          nextFeatures = { ...nextFeatures, ...(value as Partial<FeatureSettings>) };
        } else if (setting.key === 'branding') {
          nextBranding = { ...nextBranding, ...(value as Partial<BrandingSettings>) };
        }
      });
      setPlatformFeatures(nextFeatures);
      setBranding(nextBranding);
    }

    const nextOrgFeatures = (orgRes?.data?.features as Partial<FeatureSettings> | undefined) || null;
    setOrgFeatures(nextOrgFeatures);
    setIsLoading(false);
  };

  useEffect(() => {
    fetchSettings();
  }, [currentOrg?.id]);

  const features: FeatureSettings = {
    certificates_enabled: platformFeatures.certificates_enabled && (orgFeatures?.certificates_enabled ?? true),
    quizzes_enabled: platformFeatures.quizzes_enabled && (orgFeatures?.quizzes_enabled ?? true),
    analytics_enabled: platformFeatures.analytics_enabled && (orgFeatures?.analytics_enabled ?? true),
    course_reviews_enabled: platformFeatures.course_reviews_enabled && (orgFeatures?.course_reviews_enabled ?? true),
    community_enabled: platformFeatures.community_enabled && (orgFeatures?.community_enabled ?? true),
  };

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--primary', hexToHslValue(branding.primary_color, '222 47% 20%'));
    root.style.setProperty('--accent', hexToHslValue(branding.accent_color, '173 80% 40%'));
    root.style.setProperty('--sidebar-primary', hexToHslValue(branding.sidebar_primary_color, '173 80% 40%'));
    root.style.setProperty('--sidebar-ring', hexToHslValue(branding.sidebar_primary_color, '173 80% 40%'));
    root.style.setProperty('--sidebar-accent', hexToHslValue(branding.sidebar_accent_color, '222 40% 18%'));

    const faviconEl = document.querySelector<HTMLLinkElement>('link[rel=\"icon\"]');
    if (faviconEl) {
      const defaultHref = faviconEl.dataset.defaultHref || faviconEl.href;
      faviconEl.dataset.defaultHref = defaultHref;
      faviconEl.href = branding.favicon_url || defaultHref;
    }
  }, [branding]);

  return (
    <PlatformSettingsContext.Provider
      value={{
        features,
        platformFeatures,
        orgFeatures,
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
