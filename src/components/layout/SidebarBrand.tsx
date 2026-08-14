import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GraduationCap } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useSidebar } from '@/components/ui/sidebar';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { useSignedBrandingUrl } from '@/hooks/useSignedBrandingUrl';
import { getInitials } from '@/lib/utils';
import logoLightDa from '@/assets/logo-light.png';
import logoLightEn from '@/assets/logo-light-en.png';

export function SidebarBrand() {
  const { currentOrg, effectiveIsPlatformAdmin } = useAuth();
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';
  const { i18n } = useTranslation();

  const coBranded = !effectiveIsPlatformAdmin && !!currentOrg && currentOrg.kind !== 'individual';
  const { data: orgLogoSrc } = useSignedBrandingUrl(coBranded ? currentOrg?.logo_url : null);

  const [failedLogoSrc, setFailedLogoSrc] = useState<string | null>(null);

  const isDanish = i18n.resolvedLanguage === 'da';
  const platformSrc = isDanish ? logoLightDa : logoLightEn;
  const platformAlt = isDanish ? 'AI Uddannelse' : 'AI Education';

  if (!coBranded || !currentOrg) {
    return collapsed ? (
      <GraduationCap className="h-6 w-6 text-sidebar-primary" />
    ) : (
      <img
        src={platformSrc}
        alt={platformAlt}
        className="block h-10 w-auto max-w-full object-contain"
      />
    );
  }

  const initialsFallback = (
    <AvatarFallback className="rounded-lg bg-primary text-xs font-bold text-primary-foreground">
      {getInitials(currentOrg.name)}
    </AvatarFallback>
  );

  if (collapsed) {
    return (
      <Avatar className="h-9 w-9 shrink-0 rounded-lg">
        {orgLogoSrc && (
          <AvatarImage src={orgLogoSrc} alt={currentOrg.name} className="object-cover" />
        )}
        {initialsFallback}
      </Avatar>
    );
  }

  const showLogo = !!orgLogoSrc && orgLogoSrc !== failedLogoSrc;

  return (
    <div className="flex min-w-0 items-center gap-2.5">
      {showLogo ? (
        <img
          src={orgLogoSrc}
          alt=""
          onError={() => setFailedLogoSrc(orgLogoSrc ?? null)}
          className="block h-8 w-auto max-w-[120px] shrink-0 object-contain"
        />
      ) : (
        <Avatar className="h-8 w-8 shrink-0 rounded-lg">{initialsFallback}</Avatar>
      )}
      <span className="min-w-0 truncate text-[15px] font-bold leading-tight text-sidebar-foreground">
        {currentOrg.name}
      </span>
    </div>
  );
}
