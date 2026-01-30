import { useState, useEffect } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { z } from 'zod';
import { Invitation } from '@/lib/types';
import logoLight from '@/assets/logo-light.png';

const loginSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const { signIn, user, isPlatformAdmin, isOrgAdmin, isLoading, refreshUserContext } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const inviteToken = searchParams.get('invite');

  // Load invitation if token present
  useEffect(() => {
    const loadInvitation = async () => {
      if (!inviteToken) return;
      
      setInviteLoading(true);
      
      const { data, error } = await supabase
        .rpc('get_invitation_by_token', { lookup_token: inviteToken });

      if (data && data.length > 0 && !error) {
        const invitationData = data[0];
        
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
          title: 'Invalid invitation',
          description: 'This invitation link is invalid or has expired.',
          variant: 'destructive',
        });
      }
      setInviteLoading(false);
    };

    loadInvitation();
  }, [inviteToken, toast]);

  // Redirect if already logged in (unless processing invite)
  useEffect(() => {
    if (!isLoading && user && !inviteToken) {
      if (isPlatformAdmin) {
        navigate('/app/admin/platform');
      } else if (isOrgAdmin) {
        navigate('/app/admin/org');
      } else {
        navigate('/app/dashboard');
      }
    }
  }, [user, isPlatformAdmin, isOrgAdmin, isLoading, navigate, inviteToken]);

  const acceptInvitation = async (userId: string) => {
    if (!invitation || !inviteToken) return;

    // Use the secure RPC function for invitation acceptance
    const { data: acceptResult, error: acceptError } = await supabase
      .rpc('accept_invitation', {
        p_invitation_link_id: inviteToken,
        p_user_id: userId,
      });

    if (acceptError) {
      console.error('Failed to accept invitation:', acceptError);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    const result = loginSchema.safeParse({ email, password });
    if (!result.success) {
      const fieldErrors: { email?: string; password?: string } = {};
      result.error.errors.forEach((err) => {
        if (err.path[0] === 'email') fieldErrors.email = err.message;
        if (err.path[0] === 'password') fieldErrors.password = err.message;
      });
      setErrors(fieldErrors);
      return;
    }

    setLoading(true);
    const { error } = await signIn(email, password);

    if (error) {
      toast({
        title: 'Sign in failed',
        description: error.message === 'Invalid login credentials' 
          ? 'Invalid email or password. Please try again.' 
          : error.message,
        variant: 'destructive',
      });
      setLoading(false);
      return;
    }

    // Accept invitation if present
    if (invitation && inviteToken) {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (currentUser) {
        await acceptInvitation(currentUser.id);
        await refreshUserContext();
      }
    }

    toast({
      title: 'Welcome back!',
      description: invitation 
        ? `You have been added to ${invitation.organization?.name || 'the organization'}.`
        : 'You have successfully signed in.',
    });

    // Navigate based on role
    setTimeout(() => {
      if (invitation?.is_platform_admin_invite) {
        navigate('/app/admin/platform');
      } else {
        navigate('/app/dashboard');
      }
    }, 300);
    
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
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <img 
            src={logoLight} 
            alt="AI Uddannelse" 
            className="mb-4 h-14 w-auto object-contain"
          />
          <p className="text-sm text-muted-foreground">Enterprise Learning Platform</p>
        </div>

        {invitation && (
          <Alert className="mb-4 border-accent/50 bg-accent/10">
            <CheckCircle2 className="h-4 w-4 text-accent" />
            <AlertDescription className="text-sm">
              {invitation.is_platform_admin_invite ? (
                <>You've been invited to join <strong>AIR Academy</strong> as a <strong>Platform Admin</strong>.</>
              ) : (
                <>
                  You've been invited to join <strong>{invitation.organization?.name}</strong> as a{' '}
                  <strong>{invitation.role === 'org_admin' ? 'Team Admin' : 'Learner'}</strong>.
                </>
              )}
            </AlertDescription>
          </Alert>
        )}

        <Card className="shadow-card">
          <CardHeader className="text-center">
            <CardTitle className="font-display text-xl">Sign in to your account</CardTitle>
            <CardDescription>
              {invitation 
                ? 'Sign in to accept your invitation'
                : 'Enter your credentials to access the platform'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
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
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  <Link
                    to="/forgot-password"
                    className="text-xs font-medium text-accent hover:underline"
                  >
                    Forgot password?
                  </Link>
                </div>
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

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Signing in...
                  </>
                ) : invitation ? (
                  'Sign in & Accept Invitation'
                ) : (
                  'Sign in'
                )}
              </Button>
            </form>

            {inviteToken && (
              <div className="mt-6 text-center text-sm">
                <span className="text-muted-foreground">Don't have an account? </span>
                <Link
                  to={`/signup?invite=${inviteToken}`}
                  className="font-medium text-accent hover:underline"
                >
                  Sign up
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}