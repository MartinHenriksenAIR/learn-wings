import { useTranslation } from 'react-i18next';
import { GraduationCap } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useSidebar } from '@/components/ui/sidebar';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { useSignedBrandingUrl } from '@/hooks/useSignedBrandingUrl';
import { getInitials } from '@/lib/utils';
import logoLightDa from '@/assets/logo-light.png';
import logoLightEn from '@/assets/logo-light-en.png';

/**
 * The sidebar header brand lockup (#372).
 *
 * In a real org context (an org member, or a platform admin impersonating an
 * org — i.e. NOT platform-admin view) it co-brands: the org's logo + name as
 * the hero, with a smaller AI Uddannelse wordmark beneath as the endorsing
 * mark. Everywhere else (platform view, org-less / individual tier) it shows
 * the platform logo alone, exactly as before.
 *
 * Collapsed to the icon rail there is only room for the org's square mark
 * (its logo, or an initials monogram when it has none); the fallback keeps the
 * platform GraduationCap. (Collapse to an icon rail is #370; this keeps the
 * mark ready for it, matching the pre-existing collapsed-header branch.)
 */
export function SidebarBrand() {
  const { currentOrg, effectiveIsPlatformAdmin } = useAuth();
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';
  // Subscribe to language changes here rather than relying on a parent's
  // useTranslation() to re-render this subtree (frontend convention).
  const { i18n } = useTranslation();

  const coBranded = !effectiveIsPlatformAdmin && !!currentOrg;
  // Only sign a logo we're actually going to display.
  const { data: orgLogoSrc } = useSignedBrandingUrl(coBranded ? currentOrg?.logo_url : null);

  // Key on resolvedLanguage, not the raw detected code: an unsupported browser
  // language renders the English fallback (#226) and a region tag like 'da-DK'
  // still resolves to 'da' — matching how the app syncs <html lang>
  // (src/i18n/index.ts).
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

  // The org "mark": its logo, degrading to an initials monogram — same Avatar
  // idiom as the user avatar in the sidebar footer, so a failed/expired signed
  // URL falls back to initials instead of a broken image. alt="" because the
  // org name sits beside it in the expanded lockup (no double announcement).
  const orgMark = (
    <Avatar className="h-9 w-9 shrink-0 rounded-lg">
      {orgLogoSrc && <AvatarImage src={orgLogoSrc} alt="" className="object-cover" />}
      <AvatarFallback className="rounded-lg bg-primary text-xs font-bold text-primary-foreground">
        {getInitials(currentOrg.name)}
      </AvatarFallback>
    </Avatar>
  );

  if (collapsed) {
    return orgMark;
  }

  return (
    // min-w-0 on the row is load-bearing: without it this flex item keeps its
    // auto min-width and grows to fit a long org name, so the name never
    // truncates (it overflows the fixed-width sidebar instead).
    <div className="flex min-w-0 items-center gap-2.5">
      {orgMark}
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-[15px] font-bold leading-tight text-sidebar-foreground">
          {currentOrg.name}
        </span>
        <img
          src={platformSrc}
          alt={platformAlt}
          className="mt-1 block h-4 w-auto max-w-full object-contain opacity-60"
        />
      </div>
    </div>
  );
}
