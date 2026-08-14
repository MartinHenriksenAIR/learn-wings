import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export function SectionHeading({ children }: { children: ReactNode }) {
  return <h2 className="mb-3.5 font-display text-[19px] font-extrabold tracking-[-0.02em]">{children}</h2>;
}

export function SeeMore({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="mt-[11px] flex justify-end">
      <button
        type="button"
        onClick={onClick}
        className="text-[13px] font-bold text-foreground underline decoration-[1.5px] underline-offset-[3px] opacity-[0.62] transition-opacity hover:opacity-100"
      >
        {t('dashboard.seeMore')}
      </button>
    </div>
  );
}
