import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { consumePostLoginRedirect } from '@/lib/post-login-redirect';
import { consumeSessionExpiredNotice, consumeIdleTimeoutNotice } from '@/lib/session-expired';
import { routes } from '@/lib/routes';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import logoLight from '@/assets/logo-light.png';

export const PAGE_GRADIENT_CLASSES = 'bg-[linear-gradient(180deg,#f4f5f8_0%,#e9ecf4_100%)]';
export const AUTH_CARD_CLASSES =
  'flex w-full max-w-[380px] flex-col items-center gap-5 rounded-[20px] border border-legacy-border bg-legacy-card px-10 py-11 shadow-[0_24px_60px_rgba(16,41,143,0.10)]';

const CTA_CLASSES = 'h-auto w-full gap-2.5 rounded-legacy-xl px-4 py-[13px] text-[14.5px] font-semibold';

export default function Login() {
  const { signIn, user, profile, isPlatformAdmin, isOrgAdmin, isLoading } = useAuth();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const [notice] = useState<'idle' | 'expired' | null>(() => {
    if (consumeIdleTimeoutNotice()) return 'idle';
    if (consumeSessionExpiredNotice()) return 'expired';
    return null;
  });

  useEffect(() => {
    if (!isLoading && user) {
      const redirect = consumePostLoginRedirect();
      if (redirect) {
        navigate(redirect, { replace: true });
      } else if (isPlatformAdmin) {
        navigate(routes.platformAdmin.organizations);
      } else if (isOrgAdmin) {
        navigate(routes.orgAdmin.root);
      } else if (profile && !profile.assessment_level && !profile.assessment_skipped_at) {
        navigate(routes.learner.assessment, { replace: true });
      } else {
        navigate(routes.learner.dashboard);
      }
    }
  }, [user, profile, isPlatformAdmin, isOrgAdmin, isLoading, navigate]);

  if (isLoading) {
    return (
      <div className={`grid min-h-screen place-items-center ${PAGE_GRADIENT_CLASSES}`}>
        <Loader2 className="h-8 w-8 animate-spin text-legacy-primary" />
      </div>
    );
  }

  const activeLang = i18n.language?.startsWith('da') ? 'da' : 'en';
  const changeLanguage = (lng: 'en' | 'da') => {
    void i18n.changeLanguage(lng);
    localStorage.setItem('preferred_language', lng);
  };
  const langButtonClass = (lng: 'en' | 'da') =>
    activeLang === lng
      ? 'font-semibold text-legacy-foreground'
      : 'text-legacy-muted-foreground transition-colors hover:text-legacy-foreground';

  return (
    <div className={`grid min-h-screen place-items-center ${PAGE_GRADIENT_CLASSES} px-4`}>
      <div className={AUTH_CARD_CLASSES}>
        <img
          src={logoLight}
          alt="AI Uddannelse"
          className="h-[52px] w-auto object-contain"
        />
        {notice && (
          <p
            role="status"
            className="w-full rounded-legacy-xl border border-amber-pastel bg-amber-tint px-4 py-3 text-center text-sm leading-[1.5] text-amber-deep"
          >
            {notice === 'idle' ? t('auth.idleTimeoutNotice') : t('auth.sessionExpiredNotice')}
          </p>
        )}
        <p className="text-balance text-center text-sm leading-[1.55] text-legacy-muted-foreground">
          {t('auth.platformDescription')}
        </p>
        <div className="flex w-full flex-col gap-2.5">
          <Button className={CTA_CLASSES} onClick={signIn}>
            {t('auth.startFree')}
          </Button>
          <Button variant="outline" className={CTA_CLASSES} onClick={signIn}>
            {t('auth.signIn')}
          </Button>
        </div>
        <span className="text-xs text-[#9aa0af]">{t('auth.accessProvidedByOrg')}</span>
        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => changeLanguage('en')}
            aria-pressed={activeLang === 'en'}
            className={langButtonClass('en')}
          >
            English
          </button>
          <span aria-hidden="true" className="text-legacy-muted-foreground">·</span>
          <button
            type="button"
            onClick={() => changeLanguage('da')}
            aria-pressed={activeLang === 'da'}
            className={langButtonClass('da')}
          >
            Dansk
          </button>
        </div>
      </div>
    </div>
  );
}
