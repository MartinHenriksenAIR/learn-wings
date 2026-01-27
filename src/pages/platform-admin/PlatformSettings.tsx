import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Palette, Users, Mail, ToggleLeft, Save } from 'lucide-react';

interface BrandingSettings {
  platform_name: string;
  primary_color: string;
  logo_url: string | null;
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
}

interface FeatureSettings {
  certificates_enabled: boolean;
  quizzes_enabled: boolean;
  analytics_enabled: boolean;
  course_reviews_enabled: boolean;
}

type SettingsKey = 'branding' | 'user_access' | 'email' | 'features';

export default function PlatformSettings() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<SettingsKey | null>(null);

  const [branding, setBranding] = useState<BrandingSettings>({
    platform_name: 'AIR Academy',
    primary_color: '#6366f1',
    logo_url: null,
  });

  const [userAccess, setUserAccess] = useState<UserAccessSettings>({
    default_role: 'learner',
    require_email_verification: false,
    allow_self_registration: true,
  });

  const [email, setEmail] = useState<EmailSettings>({
    from_name: 'AIR Academy',
    from_email: null,
    smtp_configured: false,
  });

  const [features, setFeatures] = useState<FeatureSettings>({
    certificates_enabled: true,
    quizzes_enabled: true,
    analytics_enabled: true,
    course_reviews_enabled: false,
  });

  useEffect(() => {
    const fetchSettings = async () => {
      const { data } = await supabase
        .from('platform_settings')
        .select('key, value');

      if (data) {
        data.forEach((setting) => {
          const value = setting.value as Record<string, unknown>;
          switch (setting.key) {
            case 'branding':
              setBranding(value as unknown as BrandingSettings);
              break;
            case 'user_access':
              setUserAccess(value as unknown as UserAccessSettings);
              break;
            case 'email':
              setEmail(value as unknown as EmailSettings);
              break;
            case 'features':
              setFeatures(value as unknown as FeatureSettings);
              break;
          }
        });
      }
      setLoading(false);
    };

    fetchSettings();
  }, []);

  const saveSetting = async (key: SettingsKey, value: BrandingSettings | UserAccessSettings | EmailSettings | FeatureSettings) => {
    setSaving(key);
    const { error } = await supabase
      .from('platform_settings')
      .update({ value: JSON.parse(JSON.stringify(value)) })
      .eq('key', key);

    if (error) {
      toast({
        title: 'Failed to save',
        description: error.message,
        variant: 'destructive',
      });
    } else {
      toast({
        title: 'Settings saved',
        description: 'Your changes have been applied.',
      });
    }
    setSaving(null);
  };

  if (loading) {
    return (
      <AppLayout title="Platform Settings" breadcrumbs={[{ label: 'Settings' }]}>
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-accent" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Platform Settings" breadcrumbs={[{ label: 'Platform Settings' }]}>
      <Tabs defaultValue="branding" className="space-y-6">
        <TabsList className="grid w-full grid-cols-4 lg:w-auto lg:grid-cols-none lg:flex">
          <TabsTrigger value="branding" className="gap-2">
            <Palette className="h-4 w-4" />
            <span className="hidden sm:inline">Branding</span>
          </TabsTrigger>
          <TabsTrigger value="user_access" className="gap-2">
            <Users className="h-4 w-4" />
            <span className="hidden sm:inline">User & Access</span>
          </TabsTrigger>
          <TabsTrigger value="email" className="gap-2">
            <Mail className="h-4 w-4" />
            <span className="hidden sm:inline">Email</span>
          </TabsTrigger>
          <TabsTrigger value="features" className="gap-2">
            <ToggleLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Features</span>
          </TabsTrigger>
        </TabsList>

        {/* Branding Tab */}
        <TabsContent value="branding">
          <Card>
            <CardHeader>
              <CardTitle>Branding</CardTitle>
              <CardDescription>
                Customize the look and feel of your platform.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="platform_name">Platform Name</Label>
                <Input
                  id="platform_name"
                  value={branding.platform_name}
                  onChange={(e) => setBranding({ ...branding, platform_name: e.target.value })}
                  placeholder="AIR Academy"
                />
                <p className="text-xs text-muted-foreground">
                  Displayed in the header and emails.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="primary_color">Primary Color</Label>
                <div className="flex gap-3">
                  <Input
                    id="primary_color"
                    type="color"
                    value={branding.primary_color}
                    onChange={(e) => setBranding({ ...branding, primary_color: e.target.value })}
                    className="h-10 w-16 p-1"
                  />
                  <Input
                    value={branding.primary_color}
                    onChange={(e) => setBranding({ ...branding, primary_color: e.target.value })}
                    placeholder="#6366f1"
                    className="flex-1"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="logo_url">Logo URL</Label>
                <Input
                  id="logo_url"
                  value={branding.logo_url || ''}
                  onChange={(e) => setBranding({ ...branding, logo_url: e.target.value || null })}
                  placeholder="https://example.com/logo.png"
                />
                <p className="text-xs text-muted-foreground">
                  Link to your logo image (recommended: 200x50px).
                </p>
              </div>

              <Button onClick={() => saveSetting('branding', branding)} disabled={saving === 'branding'}>
                {saving === 'branding' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save Branding
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* User & Access Tab */}
        <TabsContent value="user_access">
          <Card>
            <CardHeader>
              <CardTitle>User & Access</CardTitle>
              <CardDescription>
                Configure user registration and access policies.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="default_role">Default Role for New Users</Label>
                <Select
                  value={userAccess.default_role}
                  onValueChange={(value: 'learner' | 'org_admin') => 
                    setUserAccess({ ...userAccess, default_role: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="learner">Learner</SelectItem>
                    <SelectItem value="org_admin">Organization Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="space-y-0.5">
                  <Label>Require Email Verification</Label>
                  <p className="text-sm text-muted-foreground">
                    Users must verify their email before accessing the platform.
                  </p>
                </div>
                <Switch
                  checked={userAccess.require_email_verification}
                  onCheckedChange={(checked) => 
                    setUserAccess({ ...userAccess, require_email_verification: checked })
                  }
                />
              </div>

              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="space-y-0.5">
                  <Label>Allow Self Registration</Label>
                  <p className="text-sm text-muted-foreground">
                    Allow users to sign up without an invitation.
                  </p>
                </div>
                <Switch
                  checked={userAccess.allow_self_registration}
                  onCheckedChange={(checked) => 
                    setUserAccess({ ...userAccess, allow_self_registration: checked })
                  }
                />
              </div>

              <Button onClick={() => saveSetting('user_access', userAccess)} disabled={saving === 'user_access'}>
                {saving === 'user_access' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save User Settings
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Email Tab */}
        <TabsContent value="email">
          <Card>
            <CardHeader>
              <CardTitle>Email & Notifications</CardTitle>
              <CardDescription>
                Configure email sender settings and notification preferences.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="from_name">Sender Name</Label>
                <Input
                  id="from_name"
                  value={email.from_name}
                  onChange={(e) => setEmail({ ...email, from_name: e.target.value })}
                  placeholder="AIR Academy"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="from_email">Sender Email</Label>
                <Input
                  id="from_email"
                  type="email"
                  value={email.from_email || ''}
                  onChange={(e) => setEmail({ ...email, from_email: e.target.value || null })}
                  placeholder="noreply@example.com"
                />
                <p className="text-xs text-muted-foreground">
                  Must be a verified domain for email delivery.
                </p>
              </div>

              <div className="flex items-center justify-between rounded-lg border p-4 bg-muted/50">
                <div className="space-y-0.5">
                  <Label>SMTP Configuration</Label>
                  <p className="text-sm text-muted-foreground">
                    {email.smtp_configured 
                      ? 'Custom SMTP server is configured.' 
                      : 'Using default email provider.'}
                  </p>
                </div>
                <span className={`text-sm font-medium ${email.smtp_configured ? 'text-green-600' : 'text-muted-foreground'}`}>
                  {email.smtp_configured ? 'Configured' : 'Not Configured'}
                </span>
              </div>

              <Button onClick={() => saveSetting('email', email)} disabled={saving === 'email'}>
                {saving === 'email' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save Email Settings
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Features Tab */}
        <TabsContent value="features">
          <Card>
            <CardHeader>
              <CardTitle>Feature Toggles</CardTitle>
              <CardDescription>
                Enable or disable platform features.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="space-y-0.5">
                  <Label>Certificates</Label>
                  <p className="text-sm text-muted-foreground">
                    Allow learners to earn certificates upon course completion.
                  </p>
                </div>
                <Switch
                  checked={features.certificates_enabled}
                  onCheckedChange={(checked) => 
                    setFeatures({ ...features, certificates_enabled: checked })
                  }
                />
              </div>

              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="space-y-0.5">
                  <Label>Quizzes</Label>
                  <p className="text-sm text-muted-foreground">
                    Enable quiz lessons in courses.
                  </p>
                </div>
                <Switch
                  checked={features.quizzes_enabled}
                  onCheckedChange={(checked) => 
                    setFeatures({ ...features, quizzes_enabled: checked })
                  }
                />
              </div>

              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="space-y-0.5">
                  <Label>Analytics</Label>
                  <p className="text-sm text-muted-foreground">
                    Show analytics dashboards to org admins.
                  </p>
                </div>
                <Switch
                  checked={features.analytics_enabled}
                  onCheckedChange={(checked) => 
                    setFeatures({ ...features, analytics_enabled: checked })
                  }
                />
              </div>

              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="space-y-0.5">
                  <Label>Course Reviews</Label>
                  <p className="text-sm text-muted-foreground">
                    Allow learners to leave reviews on courses.
                  </p>
                </div>
                <Switch
                  checked={features.course_reviews_enabled}
                  onCheckedChange={(checked) => 
                    setFeatures({ ...features, course_reviews_enabled: checked })
                  }
                />
              </div>

              <Button onClick={() => saveSetting('features', features)} disabled={saving === 'features'}>
                {saving === 'features' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save Feature Settings
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </AppLayout>
  );
}
