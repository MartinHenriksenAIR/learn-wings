import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { usePlatformSettings } from '@/hooks/usePlatformSettings';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/components/ui/sonner';

type FeatureSettings = {
  certificates_enabled: boolean;
  quizzes_enabled: boolean;
  analytics_enabled: boolean;
  course_reviews_enabled: boolean;
  community_enabled: boolean;
};

const featureLabels: Record<keyof FeatureSettings, string> = {
  certificates_enabled: 'Certificates',
  quizzes_enabled: 'Quizzes',
  analytics_enabled: 'Analytics',
  course_reviews_enabled: 'Course Reviews',
  community_enabled: 'Community',
};

export default function OrgSettings() {
  const { currentOrg } = useAuth();
  const { platformFeatures, orgFeatures, refetch } = usePlatformSettings();
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
    const { error } = await supabase.from('org_settings').upsert({
      org_id: currentOrg.id,
      features: localFeatures,
    });

    if (error) {
      toast({ title: 'Failed to save settings', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Organization settings saved' });
      await refetch();
    }
    setSaving(false);
  };

  return (
    <AppLayout title="Organization Settings" breadcrumbs={[{ label: 'Organization Settings' }]}>
      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>Feature Overrides</CardTitle>
          <p className="text-sm text-muted-foreground">
            Organization feature access is combined as: platform flag AND organization override.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {(Object.keys(featureLabels) as Array<keyof FeatureSettings>).map((key) => (
            <div key={key} className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label className="text-sm font-medium">{featureLabels[key]}</Label>
                <p className="text-xs text-muted-foreground">
                  Platform default: {platformFeatures[key] ? 'Enabled' : 'Disabled'}
                </p>
              </div>
              <Switch
                checked={localFeatures[key]}
                onCheckedChange={(checked) => setLocalFeatures((prev) => ({ ...prev, [key]: checked }))}
                disabled={!platformFeatures[key]}
              />
            </div>
          ))}

          <Button onClick={handleSave} disabled={saving || !currentOrg}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save Organization Settings
          </Button>
        </CardContent>
      </Card>
    </AppLayout>
  );
}
