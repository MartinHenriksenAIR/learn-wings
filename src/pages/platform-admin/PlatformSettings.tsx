import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/components/ui/sonner';
import { Loader2, Palette, Users, Mail, ToggleLeft, Save } from 'lucide-react';

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

export default function PlatformSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<SettingsKey | null>(null);
  const [testingSmtp, setTestingSmtp] = useState(false);

  const [branding, setBranding] = useState<BrandingSettings>(defaultBranding);
  const [userAccess, setUserAccess] = useState<UserAccessSettings>(defaultUserAccess);
  const [email, setEmail] = useState<EmailSettings>(defaultEmail);
  const [features, setFeatures] = useState<FeatureSettings>(defaultFeatures);

  useEffect(() => {
    const fetchSettings = async () => {
      const { data } = await supabase
        .from('platform_settings')
        .select('key, value');

      if (data) {
        data.forEach((setting) => {
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

  const handleTestSmtpConnection = async () => {
    setTestingSmtp(true);
    try {
      const { data, error } = await supabase.functions.invoke('test-smtp-connection', {
        body: {
          host: email.smtp_host,
          port: email.smtp_port,
          username: email.smtp_username,
          password: email.smtp_password,
          encryption: email.smtp_encryption,
          fromEmail: email.from_email,
        },
      });

      if (error || !data?.success) {
        throw new Error(error?.message || data?.error || 'Connection test failed');
      }

      toast({
        title: 'SMTP test successful',
        description: data.message || 'Connection and authentication succeeded.',
      });
      setEmail((prev) => ({ ...prev, smtp_configured: true }));
    } catch (error: any) {
      toast({
        title: 'SMTP test failed',
        description: error?.message || 'Unable to connect to SMTP server.',
        variant: 'destructive',
      });
      setEmail((prev) => ({ ...prev, smtp_configured: false }));
    } finally {
      setTestingSmtp(false);
    }
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

        <TabsContent value="branding">
          <Card>
            <CardHeader>
              <CardTitle>Branding</CardTitle>
              <CardDescription>Customize the look and feel of your platform.</CardDescription>
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
                <Label htmlFor="accent_color">Accent Color</Label>
                <div className="flex gap-3">
                  <Input
                    id="accent_color"
                    type="color"
                    value={branding.accent_color}
                    onChange={(e) => setBranding({ ...branding, accent_color: e.target.value })}
                    className="h-10 w-16 p-1"
                  />
                  <Input
                    value={branding.accent_color}
                    onChange={(e) => setBranding({ ...branding, accent_color: e.target.value })}
                    placeholder="#10b981"
                    className="flex-1"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="sidebar_primary_color">Sidebar Primary Color</Label>
                <div className="flex gap-3">
                  <Input
                    id="sidebar_primary_color"
                    type="color"
                    value={branding.sidebar_primary_color}
                    onChange={(e) => setBranding({ ...branding, sidebar_primary_color: e.target.value })}
                    className="h-10 w-16 p-1"
                  />
                  <Input
                    value={branding.sidebar_primary_color}
                    onChange={(e) => setBranding({ ...branding, sidebar_primary_color: e.target.value })}
                    placeholder="#10b981"
                    className="flex-1"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="sidebar_accent_color">Sidebar Accent Color</Label>
                <div className="flex gap-3">
                  <Input
                    id="sidebar_accent_color"
                    type="color"
                    value={branding.sidebar_accent_color}
                    onChange={(e) => setBranding({ ...branding, sidebar_accent_color: e.target.value })}
                    className="h-10 w-16 p-1"
                  />
                  <Input
                    value={branding.sidebar_accent_color}
                    onChange={(e) => setBranding({ ...branding, sidebar_accent_color: e.target.value })}
                    placeholder="#1f2937"
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
              </div>

              <div className="space-y-2">
                <Label htmlFor="favicon_url">Favicon URL</Label>
                <Input
                  id="favicon_url"
                  value={branding.favicon_url || ''}
                  onChange={(e) => setBranding({ ...branding, favicon_url: e.target.value || null })}
                  placeholder="https://example.com/favicon.png"
                />
              </div>

              <Button onClick={() => saveSetting('branding', branding)} disabled={saving === 'branding'}>
                {saving === 'branding' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save Branding
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="user_access">
          <Card>
            <CardHeader>
              <CardTitle>User & Access</CardTitle>
              <CardDescription>Configure user registration and access policies.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="rounded-lg border p-4 bg-muted/50">
                <Label>Default Role for New Users</Label>
                <p className="mt-1 text-sm text-muted-foreground">
                  New users are always created as <strong>Learner</strong>. Elevated access is granted via explicit admin invitation flows.
                </p>
              </div>

              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="space-y-0.5">
                  <Label>Require Email Verification</Label>
                  <p className="text-sm text-muted-foreground">Users must verify their email before accessing the platform.</p>
                </div>
                <Switch
                  checked={userAccess.require_email_verification}
                  onCheckedChange={(checked) => setUserAccess({ ...userAccess, require_email_verification: checked })}
                />
              </div>

              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="space-y-0.5">
                  <Label>Allow Self Registration</Label>
                  <p className="text-sm text-muted-foreground">Allow users to sign up without an invitation.</p>
                </div>
                <Switch
                  checked={userAccess.allow_self_registration}
                  onCheckedChange={(checked) => setUserAccess({ ...userAccess, allow_self_registration: checked })}
                />
              </div>

              <Button
                onClick={() => saveSetting('user_access', { ...userAccess, default_role: 'learner' })}
                disabled={saving === 'user_access'}
              >
                {saving === 'user_access' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save User Settings
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="email">
          <Card>
            <CardHeader>
              <CardTitle>Email & Notifications</CardTitle>
              <CardDescription>Configure email sender settings and SMTP delivery.</CardDescription>
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
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="smtp_host">SMTP Host</Label>
                  <Input
                    id="smtp_host"
                    value={email.smtp_host}
                    onChange={(e) => setEmail({ ...email, smtp_host: e.target.value })}
                    placeholder="smtp.example.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="smtp_port">SMTP Port</Label>
                  <Input
                    id="smtp_port"
                    type="number"
                    min={1}
                    value={email.smtp_port}
                    onChange={(e) => setEmail({ ...email, smtp_port: Number(e.target.value || 587) })}
                    placeholder="587"
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="smtp_username">SMTP Username</Label>
                  <Input
                    id="smtp_username"
                    value={email.smtp_username}
                    onChange={(e) => setEmail({ ...email, smtp_username: e.target.value })}
                    placeholder="smtp-user"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="smtp_password">SMTP Password</Label>
                  <Input
                    id="smtp_password"
                    type="password"
                    value={email.smtp_password}
                    onChange={(e) => setEmail({ ...email, smtp_password: e.target.value })}
                    placeholder="••••••••"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="smtp_encryption">Encryption</Label>
                <div className="flex gap-2">
                  {(['none', 'starttls', 'ssl_tls'] as const).map((mode) => (
                    <Button
                      key={mode}
                      type="button"
                      variant={email.smtp_encryption === mode ? 'default' : 'outline'}
                      onClick={() => setEmail({ ...email, smtp_encryption: mode })}
                    >
                      {mode === 'none' ? 'None' : mode === 'starttls' ? 'STARTTLS' : 'SSL/TLS'}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between rounded-lg border p-4 bg-muted/50">
                <div className="space-y-0.5">
                  <Label>SMTP Configuration</Label>
                  <p className="text-sm text-muted-foreground">
                    {email.smtp_configured ? 'SMTP connection is configured and verified.' : 'SMTP settings not yet verified.'}
                  </p>
                </div>
                <span className={`text-sm font-medium ${email.smtp_configured ? 'text-green-600' : 'text-muted-foreground'}`}>
                  {email.smtp_configured ? 'Configured' : 'Not Configured'}
                </span>
              </div>

              <div className="flex flex-wrap gap-3">
                <Button type="button" variant="outline" onClick={handleTestSmtpConnection} disabled={testingSmtp}>
                  {testingSmtp ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Test Connection
                </Button>

                <Button onClick={() => saveSetting('email', email)} disabled={saving === 'email'}>
                  {saving === 'email' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Save Email Settings
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="features">
          <Card>
            <CardHeader>
              <CardTitle>Feature Toggles</CardTitle>
              <CardDescription>Enable or disable platform features.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="space-y-0.5">
                  <Label>Certificates</Label>
                  <p className="text-sm text-muted-foreground">Allow learners to earn certificates upon course completion.</p>
                </div>
                <Switch
                  checked={features.certificates_enabled}
                  onCheckedChange={(checked) => setFeatures({ ...features, certificates_enabled: checked })}
                />
              </div>

              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="space-y-0.5">
                  <Label>Quizzes</Label>
                  <p className="text-sm text-muted-foreground">Enable quiz lessons in courses.</p>
                </div>
                <Switch
                  checked={features.quizzes_enabled}
                  onCheckedChange={(checked) => setFeatures({ ...features, quizzes_enabled: checked })}
                />
              </div>

              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="space-y-0.5">
                  <Label>Analytics</Label>
                  <p className="text-sm text-muted-foreground">Show analytics dashboards to org admins.</p>
                </div>
                <Switch
                  checked={features.analytics_enabled}
                  onCheckedChange={(checked) => setFeatures({ ...features, analytics_enabled: checked })}
                />
              </div>

              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="space-y-0.5">
                  <Label>Community</Label>
                  <p className="text-sm text-muted-foreground">Enable community feed, ideas and moderation features.</p>
                </div>
                <Switch
                  checked={features.community_enabled}
                  onCheckedChange={(checked) => setFeatures({ ...features, community_enabled: checked })}
                />
              </div>

              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="space-y-0.5">
                  <Label>Course Reviews</Label>
                  <p className="text-sm text-muted-foreground">Allow learners to leave reviews on courses.</p>
                </div>
                <Switch
                  checked={features.course_reviews_enabled}
                  onCheckedChange={(checked) => setFeatures({ ...features, course_reviews_enabled: checked })}
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
