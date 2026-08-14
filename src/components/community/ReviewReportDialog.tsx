import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Loader2, CheckCircle, XCircle } from 'lucide-react';

export interface ReviewReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  adminNotes: string;
  onAdminNotesChange: (value: string) => void;
  onDismiss: () => void;
  onReview: () => void;
  pending: boolean;
}

export function ReviewReportDialog({
  open,
  onOpenChange,
  adminNotes,
  onAdminNotesChange,
  onDismiss,
  onReview,
  pending,
}: ReviewReportDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('moderation.dialog.title')}</DialogTitle>
          <DialogDescription>{t('moderation.dialog.description')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">{t('moderation.dialog.adminNotesLabel')}</label>
            <Textarea
              placeholder={t('moderation.dialog.adminNotesPlaceholder')}
              value={adminNotes}
              onChange={(e) => onAdminNotesChange(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter className="flex gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button variant="secondary" onClick={onDismiss} disabled={pending}>
            <XCircle className="mr-2 h-4 w-4" />
            {t('moderation.dismiss')}
          </Button>
          <Button onClick={onReview} disabled={pending}>
            {pending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle className="mr-2 h-4 w-4" />
            )}
            {t('moderation.markReviewed')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
