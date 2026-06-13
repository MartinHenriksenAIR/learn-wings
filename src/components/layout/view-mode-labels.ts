import { useTranslation } from 'react-i18next';
import type { ViewMode } from '@/hooks/useAuth';

// Single source for the view-mode display names shown in the sidebar
// role line / switcher and the AppLayout "Viewing as" header chip.
export function useViewModeLabels(): Record<ViewMode, string> {
  const { t } = useTranslation();
  return {
    learner: t('nav.roles.learner'),
    org_admin: t('nav.roles.orgAdmin'),
    platform_admin: t('nav.roles.platformAdmin'),
  };
}
