import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';

interface ComingSoonSectionProps {
  /** Section heading — already translated by the caller. */
  title: string;
}

/**
 * Deliberate "coming soon" placeholder for a Min Træning section whose content
 * lands in a later issue (Mandatory #365, Favorites #358/#380). Uses the page's
 * real section-heading treatment so it sits consistently with live sections, and
 * a soft dashed panel that reads as intentional — not as a broken/empty error.
 */
export function ComingSoonSection({ title }: ComingSoonSectionProps) {
  const { t } = useTranslation();

  return (
    <section className="mb-8">
      <h2 className="mb-3.5 font-display text-[17px] font-bold">{title}</h2>
      <div className="flex items-center gap-3 rounded-2xl border border-dashed border-[#d6d8e0] bg-muted/40 px-5 py-5 text-[13px] font-medium text-muted-foreground">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent text-accent-foreground">
          <Sparkles className="h-4 w-4" aria-hidden="true" />
        </span>
        {t('training.comingSoon')}
      </div>
    </section>
  );
}
