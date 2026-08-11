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

/**
 * The sidebar header brand lockup (#372).
 *
 * In a real org context (an org member, or a platform admin impersonating an
 * org — i.e. NOT platform-admin view) it shows the org's logo + name.
 * Everywhere else (platform view, org-less / individual tier) it shows the
 * AI Uddannelse platform logo.
 *
 * Expanded, the org logo renders at its natural aspect ratio — uncropped (#411).
 * Collapsed to the icon rail there is only room for a small square mark (the
 * org's logo cropped square, or an initials monogram when it has none); the
 * platform fallback keeps the GraduationCap. (Collapse to an icon rail is #370;
 * this keeps the mark ready for it, matching the collapsed-header branch.)
 */
export function SidebarBrand() {
  const { currentOrg, effectiveIsPlatformAdmin } = useAuth();
  const { state } = useSidebar();
  const collapsed = state === 'collapsed';
  // Subscribe to language changes here rather than relying on a parent's
  // useTranslation() to re-render this subtree (frontend convention).
  const { i18n } = useTranslation();

  const coBranded = !effectiveIsPlatformAdmin && !!currentOrg && currentOrg.kind !== 'individual';
  // Only sign a logo we're actually going to display.
  const { data: orgLogoSrc } = useSignedBrandingUrl(coBranded ? currentOrg?.logo_url : null);

  // Remember a signed URL that failed to load so the expanded lockup can degrade
  // to the initials monogram — a bare <img> (used there so the logo shows at its
  // natural aspect, not cropped into an Avatar) has no built-in broken-image
  // fallback the way Radix Avatar does. Keyed on the src itself, not a boolean,
  // so switching orgs re-attempts the new logo without a reset effect.
  const [failedLogoSrc, setFailedLogoSrc] = useState<string | null>(null);

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

  // The org's initials on the brand color. Shared by the collapsed square mark
  // and the expanded no-logo / failed-logo fallback.
  const initialsFallback = (
    <AvatarFallback className="rounded-lg bg-primary text-xs font-bold text-primary-foreground">
      {getInitials(currentOrg.name)}
    </AvatarFallback>
  );

  // Collapsed icon rail: only room for a small square mark — the org logo cropped
  // to a square (object-cover; a wide logo has nowhere to go in the rail),
  // degrading to the monogram. Uncropping is the expanded path's concern (#411).
  // The mark carries the org name so the lone icon stays labelled.
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
    // min-w-0 on the row + the name is load-bearing: without it the name keeps
    // its auto min-width and overflows the fixed-width sidebar instead of
    // truncating.
    <div className="flex min-w-0 items-center gap-2.5">
      {showLogo ? (
        // Natural aspect ratio, uncropped (#411): fixed height, width auto,
        // capped so a wide logo can't crowd out the name (the sidebar is ~216px
        // usable, shared with the name). object-contain letterboxes anything past
        // the cap — still fully visible, just smaller. Decorative (alt="") here:
        // the org name sits beside it. onError degrades an expired/broken signed
        // URL to the monogram.
        <img
          src={orgLogoSrc}
          alt=""
          onError={() => setFailedLogoSrc(orgLogoSrc ?? null)}
          className="block h-8 w-auto max-w-[120px] shrink-0 object-contain"
        />
      ) : (
        // h-8 to match the logo's height, so the row doesn't grow when a logo
        // errors to the monogram (or an org has none).
        <Avatar className="h-8 w-8 shrink-0 rounded-lg">{initialsFallback}</Avatar>
      )}
      <span className="min-w-0 truncate text-[15px] font-bold leading-tight text-sidebar-foreground">
        {currentOrg.name}
      </span>
    </div>
  );
}
