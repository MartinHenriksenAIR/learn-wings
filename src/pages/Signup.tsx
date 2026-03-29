import { useState, useEffect } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { toast } from '@/components/ui/sonner';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { z } from 'zod';
import { Invitation } from '@/lib/types';
import logoLight from '@/assets/logo-light.png';

const signupSchema = z.object({
  fullName: z.string().min(2, 'Full name must be at least 2 characters').max(100),
  email: z.string().email('Please enter a valid email address').max(255),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ['confirmPassword'],
});

export default function Signup() {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { signUp, user, isLoading } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const inviteToken = searchParams.get('invite');

  // Load invitation if token present - uses secure RPC function
  useEffect(() => {
    const loadInvitation = async () => {
      if (!inviteToken) return;
      
      setInviteLoading(true);
      
      // Use the secure RPC function to look up invitation by token
      const { data, error } = await supabase
        .rpc('get_invitation_by_token', { lookup_token: inviteToken });

      if (data && data.length > 0 && !error) {
        const invitationData = data[0];
        
        // Fetch organization details if org_id exists
        let organization = null;
        if (invitationData.org_id) {
          const { data: orgData } = await supabase
            .from('organizations')
            .select('*')
            .eq('id', invitationData.org_id)
            .single();
          organization = orgData;
        }
        
        setInvitation({
          ...invitationData,
          organization,
        } as Invitation);
        setEmail(invitationData.email);
      } else {
        toast({
          title: t('auth.invalidInvitation'),
          description: t('auth.invalidInvitationDescription'),
          variant: 'destructive',
        });
      }
      setInviteLoading(false);
    };

    loadInvitation();
  }, [inviteToken, toast, t]);

  // Redirect if already logged in
  useEffect(() => {
    if (!isLoading && user && !inviteToken) {
      navigate('/app/dashboard');
    }
  }, [user, isLoading, navigate, inviteToken]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    // Validate
    const result = signupSchema.safeParse({ fullName, email, password, confirmPassword });
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      result.error.errors.forEach((err) => {
        if (err.path[0]) fieldErrors[err.path[0] as string] = err.message;
      });
      setErrors(fieldErrors);
      return;
    }

    setLoading(true);
    const { error } = await signUp(email, password, fullName);

    if (error) {
      if (error.message.includes('already registered')) {
        toast({
          title: t('auth.accountExists'),
          description: t('auth.accountExistsDescription'),
          variant: 'destructive',
        });
      } else {
        toast({
          title: t('auth.signUpFailed'),
          description: error.message,
          variant: 'destructive',
        });
      }
      setLoading(false);
      return;
    }

    // If there's an invitation, accept it using the secure RPC function
    if (invitation && inviteToken) {
      // Wait for the profile trigger to create the profile
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Get the new user
      const { data: { user: newUser } } = await supabase.auth.getUser();
      
      if (newUser) {
        try {
          // Use the secure RPC function to accept the invitation
          // This bypasses RLS and correctly assigns the role from the invitation
          const { data: acceptResult, error: acceptError } = await supabase
            .rpc('accept_invitation', {
              p_invitation_link_id: inviteToken,
              p_user_id: newUser.id,
            });
          
          if (acceptError) {
            console.error('Failed to accept invitation:', acceptError);
          } else if (acceptResult && typeof acceptResult === 'object' && 'success' in acceptResult && !acceptResult.success) {
            console.error('Invitation acceptance failed:', (acceptResult as { error?: string }).error);
          }
        } catch (err) {
          console.error('Error processing invitation:', err);
        }
      }
    }

    toast({
      title: t('auth.accountCreated'),
      description: t('auth.welcomeToAcademy'),
    });

    // Small delay then redirect
    setTimeout(() => {
      navigate('/app/dashboard');
    }, 500);
    
    setLoading(false);
  };

  if (isLoading || inviteLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-8">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <img 
            src={logoLight} 
            alt="AI Uddannelse" 
            className="mb-4 h-14 w-auto object-contain"
          />
          <p className="text-sm text-muted-foreground">{t('auth.platformDescription')}</p>
        </div>

        {invitation && (
          <Alert className="mb-4 border-accent/50 bg-accent/10">
            <CheckCircle2 className="h-4 w-4 text-accent" />
            <AlertDescription className="text-sm">
              {invitation.is_platform_admin_invite ? (
                <span>{t('auth.invitedToPlatformAdminText')}</span>
              ) : (
                <span>
                  {t('auth.invitedToOrgPrefix')}{' '}
                  <strong>{invitation.organization?.name}</strong>{' '}
                  {t('auth.invitedToOrgMiddle')}{' '}
                  <strong>{invitation.role === 'org_admin' ? t('auth.teamAdmin') : t('nav.roles.learner')}</strong>
                </span>
              )}
            </AlertDescription>
          </Alert>
        )}

        <Card className="shadow-card">
          <CardHeader className="text-center">
            <CardTitle className="font-display text-xl">{t('auth.createYourAccount')}</CardTitle>
            <CardDescription>
              {t('auth.getStarted')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="fullName">{t('auth.fullName')}</Label>
                <Input
                  id="fullName"
                  type="text"
                  placeholder="John Doe"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  disabled={loading}
                  className={errors.fullName ? 'border-destructive' : ''}
                />
                {errors.fullName && (
                  <p className="text-xs text-destructive">{errors.fullName}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">{t('auth.email')}</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading || !!invitation}
                  className={errors.email ? 'border-destructive' : ''}
                />
                {errors.email && (
                  <p className="text-xs text-destructive">{errors.email}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">{t('auth.password')}</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                  className={errors.password ? 'border-destructive' : ''}
                />
                {errors.password && (
                  <p className="text-xs text-destructive">{errors.password}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword">{t('auth.confirmPassword')}</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={loading}
                  className={errors.confirmPassword ? 'border-destructive' : ''}
                />
                {errors.confirmPassword && (
                  <p className="text-xs text-destructive">{errors.confirmPassword}</p>
                )}
              </div>

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t('auth.creatingAccount')}
                  </>
                ) : (
                  t('auth.createAccount')
                )}
              </Button>
            </form>

            <div className="mt-6 text-center text-sm">
              <span className="text-muted-foreground">{t('auth.haveAccount')} </span>
              <Link
                to={inviteToken ? `/login?invite=${inviteToken}` : '/login'}
                className="font-medium text-accent hover:underline"
              >
                {t('auth.signIn')}
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
