import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface DeleteCourseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courseTitle: string | undefined;
  onConfirm: () => void;
  pending: boolean;
}

export function DeleteCourseDialog({
  open,
  onOpenChange,
  courseTitle,
  onConfirm,
  pending,
}: DeleteCourseDialogProps) {
  const { t } = useTranslation();

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('courseDelete.title')}</AlertDialogTitle>
          <AlertDialogDescription className="space-y-2">
            <span className="block">{t('courseDelete.intro', { title: courseTitle })}</span>
            <ul className="list-inside list-disc text-sm">
              <li>{t('courseDelete.itemModules')}</li>
              <li>{t('courseDelete.itemEnrollments')}</li>
              <li>{t('courseDelete.itemQuizzes')}</li>
            </ul>
            <span className="block font-medium">{t('courseDelete.irreversible')}</span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={pending}
            className="bg-legacy-destructive text-legacy-destructive-foreground hover:bg-legacy-destructive/90"
          >
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            {t('courseDelete.confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
