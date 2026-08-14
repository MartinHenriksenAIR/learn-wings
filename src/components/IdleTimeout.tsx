import { useTranslation } from 'react-i18next';

import { useAuth } from '@/hooks/useAuth';
import { useIdleTimeout } from '@/hooks/useIdleTimeout';
import { handleIdleTimeout } from '@/lib/session-expired';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export function IdleTimeout() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const { warningActive, secondsRemaining, stayActive } = useIdleTimeout({
    enabled: !!user,
    onTimeout: handleIdleTimeout,
  });

  return (
    <AlertDialog open={warningActive}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('idleTimeout.title')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('idleTimeout.description', { seconds: secondsRemaining })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={stayActive}>
            {t('idleTimeout.staySignedIn')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
