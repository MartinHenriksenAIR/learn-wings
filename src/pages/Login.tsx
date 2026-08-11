import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { consumePostLoginRedirect } from '@/lib/post-login-redirect';
import { consumeSessionExpiredNotice } from '@/lib/session-expired';
import { routes } from '@/lib/routes';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import logoLight from '@/assets/logo-light.png';

// Soft slate gradient behind both the loading spinner and the login card.
// Exported for Signup, which renders the same auth-card treatment (#175).
export const PAGE_GRADIENT_CLASSES = 'bg-[linear-gradient(180deg,#f4f5f8_0%,#e9ecf4_100%)]';
export const AUTH_CARD_CLASSES =
  'flex w-full max-w-[380px] flex-col items-center gap-5 rounded-[20px] border border-border bg-card px-10 py-11 shadow-[0_24px_60px_rgba(16,41,143,0.10)]';

// Both front-door CTAs share one size; only the variant (primary vs. outline)
// differs. Both fire the same Entra sign-in — org-vs-individual is decided
// server-side by tenant match, so this is presentation, not two auth flows (#355).
const CTA_CLASSES = 'h-auto w-full gap-2.5 rounded-xl px-4 py-[13px] text-[14.5px] font-semibold';

export default function Login() {
  const { signIn, user, profile, isPlatformAdmin, isOrgAdmin, isLoading } = useAuth();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  // Read once on mount: true only when a dead session redirected here, so the
  // notice shows this visit and a later manual visit to /login stays quiet.
  const [sessionExpired] = useState(() => consumeSessionExpiredNotice());

  useEffect(() => {
    // `isLoading` covers the user-context fetch (useAuth), so once it clears
    // `profile` is resolved — guard on it too so a plain learner isn't routed
    // to the dashboard before the assessment predicate can be evaluated.
    if (!isLoading && user) {
      // A guard stashed the originally requested URL before sending us here —
      // restore it; otherwise fall back to the role home (#16). A deep-linked
      // login always keeps precedence and skips the assessment prompt.
      const redirect = consumePostLoginRedirect();
      if (redirect) {
        navigate(redirect, { replace: true });
      } else if (isPlatformAdmin) {
        navigate(routes.platformAdmin.organizations);
      } else if (isOrgAdmin) {
        navigate(routes.orgAdmin.root);
      } else if (profile && !profile.assessment_level && !profile.assessment_skipped_at) {
        // Plain learner who has neither taken nor explicitly skipped the
        // onboarding assessment: prompt them for it (#117).
        navigate(routes.learner.assessment, { replace: true });
      } else {
        navigate(routes.learner.dashboard);
      }
    }
  }, [user, profile, isPlatformAdmin, isOrgAdmin, isLoading, navigate]);

  if (isLoading) {
    return (
      <div className={`grid min-h-screen place-items-center ${PAGE_GRADIENT_CLASSES}`}>
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // The front door is public, so no signed-in language preference exists yet:
  // the browser-detected default is offered with a manual override. Persisted to
  // the LanguageDetector's localStorage key so the choice survives the full-page
  // Entra sign-in redirect and returns on the next visit.
  const activeLang = i18n.language?.startsWith('da') ? 'da' : 'en';
  const changeLanguage = (lng: 'en' | 'da') => {
    void i18n.changeLanguage(lng);
    localStorage.setItem('preferred_language', lng);
  };
  const langButtonClass = (lng: 'en' | 'da') =>
    activeLang === lng
      ? 'font-semibold text-foreground'
      : 'text-muted-foreground transition-colors hover:text-foreground';

  return (
    <div className={`grid min-h-screen place-items-center ${PAGE_GRADIENT_CLASSES} px-4`}>
      <div className={AUTH_CARD_CLASSES}>
        <img
          src={logoLight}
          alt="AI Uddannelse"
          className="h-[52px] w-auto object-contain"
        />
        {sessionExpired && (
          <p
            role="status"
            className="w-full rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-center text-sm leading-[1.5] text-amber-900"
          >
            {t('auth.sessionExpiredNotice')}
          </p>
        )}
        <p className="text-balance text-center text-sm leading-[1.55] text-muted-foreground">
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
          <span aria-hidden="true" className="text-muted-foreground">·</span>
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
