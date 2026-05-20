import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import logoLight from '@/assets/logo-light.png';

export default function Login() {
  const { signIn, user, isPlatformAdmin, isOrgAdmin, isLoading } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();

  useEffect(() => {
    if (!isLoading && user) {
      if (isPlatformAdmin) {
        navigate('/app/admin/platform');
      } else if (isOrgAdmin) {
        navigate('/app/admin/org');
      } else {
        navigate('/app/dashboard');
      }
    }
  }, [user, isPlatformAdmin, isOrgAdmin, isLoading, navigate]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <div className="w-full max-w-sm text-center space-y-6">
        <img
          src={logoLight}
          alt="AI Uddannelse"
          className="mx-auto h-14 w-auto object-contain"
        />
        <p className="text-sm text-muted-foreground">{t('auth.platformDescription')}</p>
        <Button className="w-full" onClick={signIn}>
          {t('auth.signInWithMicrosoft', 'Sign in with Microsoft')}
        </Button>
      </div>
    </div>
  );
}
