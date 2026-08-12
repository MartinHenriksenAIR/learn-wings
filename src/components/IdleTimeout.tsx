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

/**
 * App-wide inactivity guard (#447). While the user is signed in, an hour with no
 * activity signs them out and redirects to /login; the final minute shows this
 * countdown modal with a "Stay signed in" escape hatch. Renders nothing until
 * the warning window. Mounted once at the app root so a single timer, shared
 * across tabs via localStorage, governs the whole session.
 */
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
