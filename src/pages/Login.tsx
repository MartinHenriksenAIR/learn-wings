import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { consumePostLoginRedirect } from '@/lib/post-login-redirect';
import { routes } from '@/lib/routes';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import logoLight from '@/assets/logo-light.png';

// Soft slate gradient behind both the loading spinner and the login card.
// Exported for Signup, which renders the same auth-card treatment (#175).
export const PAGE_GRADIENT_CLASSES = 'bg-[linear-gradient(180deg,#f4f5f8_0%,#e9ecf4_100%)]';
export const AUTH_CARD_CLASSES =
  'flex w-full max-w-[380px] flex-col items-center gap-5 rounded-[20px] border border-border bg-card px-10 py-11 shadow-[0_24px_60px_rgba(16,41,143,0.10)]';

export default function Login() {
  const { signIn, user, isPlatformAdmin, isOrgAdmin, isLoading } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();

  useEffect(() => {
    if (!isLoading && user) {
      // A guard stashed the originally requested URL before sending us here —
      // restore it; otherwise fall back to the role home (#16).
      const redirect = consumePostLoginRedirect();
      if (redirect) {
        navigate(redirect, { replace: true });
      } else if (isPlatformAdmin) {
        navigate(routes.platformAdmin.organizations);
      } else if (isOrgAdmin) {
        navigate(routes.orgAdmin.root);
      } else {
        navigate(routes.learner.dashboard);
      }
    }
  }, [user, isPlatformAdmin, isOrgAdmin, isLoading, navigate]);

  if (isLoading) {
    return (
      <div className={`grid min-h-screen place-items-center ${PAGE_GRADIENT_CLASSES}`}>
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className={`grid min-h-screen place-items-center ${PAGE_GRADIENT_CLASSES} px-4`}>
      <div className={AUTH_CARD_CLASSES}>
        <img
          src={logoLight}
          alt="AI Uddannelse"
          className="h-[52px] w-auto object-contain"
        />
        <p className="text-balance text-center text-sm leading-[1.55] text-muted-foreground">
          {t('auth.platformDescription')}
        </p>
        <Button
          className="h-auto w-full gap-2.5 rounded-xl px-4 py-[13px] text-[14.5px] font-semibold"
          onClick={signIn}
        >
          <svg width="16" height="16" viewBox="0 0 23 23" aria-hidden="true">
            <rect x="1" y="1" width="10" height="10" fill="#ffffff" />
            <rect x="12" y="1" width="10" height="10" fill="#dfe4f7" />
            <rect x="1" y="12" width="10" height="10" fill="#dfe4f7" />
            <rect x="12" y="12" width="10" height="10" fill="#ffffff" />
          </svg>
          {t('auth.signInWithMicrosoft', 'Sign in with Microsoft')}
        </Button>
        <span className="text-xs text-[#9aa0af]">{t('auth.accessProvidedByOrg')}</span>
      </div>
    </div>
  );
}
