import { useTranslation } from 'react-i18next';
import type { ViewMode } from '@/hooks/useAuth';

export function useViewModeLabels(): Record<ViewMode, string> {
  const { t } = useTranslation();
  return {
    learner: t('nav.roles.learner'),
    org_admin: t('nav.roles.orgAdmin'),
    platform_admin: t('nav.roles.platformAdmin'),
  };
}
