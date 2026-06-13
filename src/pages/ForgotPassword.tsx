import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';
import logoLight from '@/assets/logo-light.png';

// Match Login's soft slate canvas + centered card chrome.
const PAGE_GRADIENT_CLASSES = 'bg-[linear-gradient(180deg,#f4f5f8_0%,#e9ecf4_100%)]';

export default function ForgotPassword() {
  const { t } = useTranslation();

  return (
    <div className={`grid min-h-screen place-items-center ${PAGE_GRADIENT_CLASSES} px-4`}>
      <div className="flex w-full max-w-[380px] flex-col items-center gap-5 rounded-[20px] border border-border bg-card px-10 py-11 text-center shadow-[0_24px_60px_rgba(16,41,143,0.10)]">
        <img src={logoLight} alt="AI Uddannelse" className="h-[52px] w-auto object-contain" />
        <p className="text-balance text-sm leading-[1.55] text-muted-foreground">
          {t('auth.passwordResetInfo')}
        </p>
        <Link to="/login">
          <Button variant="ghost" size="sm" className="gap-2">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            {t('auth.backToSignIn')}
          </Button>
        </Link>
      </div>
    </div>
  );
}
