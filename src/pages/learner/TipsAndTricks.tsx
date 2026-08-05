import { useTranslation } from 'react-i18next';
import { Lightbulb } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { EmptyState } from '@/components/ui/empty-state';

// Coming-soon placeholder (#366). Real content and the sidebar nav entry
// (inside the Læring group) arrive with the navigation restructure (#363).
export default function TipsAndTricks() {
  const { t } = useTranslation();

  return (
    <AppLayout breadcrumbs={[{ label: t('tipsAndTricks.title') }]}>
      <div className="mb-[22px]">
        <h1 className="font-display text-[26px] font-extrabold tracking-[-0.02em]">
          {t('tipsAndTricks.title')}
        </h1>
      </div>
      <EmptyState
        icon={<Lightbulb aria-hidden="true" className="h-6 w-6" />}
        title={t('tipsAndTricks.comingSoon')}
        description={t('tipsAndTricks.comingSoonBody')}
      />
    </AppLayout>
  );
}
