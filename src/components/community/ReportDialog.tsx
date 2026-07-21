import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Loader2 } from 'lucide-react';

interface ReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (reason: string) => Promise<void>;
  targetType: 'post' | 'comment';
}

// Stable machine `value`s (persisted upstream as the report reason); the
// human-facing text is resolved through i18n via `labelKey` at render time.
const REPORT_REASONS = [
  { value: 'spam', labelKey: 'community.reportDialog.reasonSpam' },
  { value: 'inappropriate', labelKey: 'community.reportDialog.reasonInappropriate' },
  { value: 'harassment', labelKey: 'community.reportDialog.reasonHarassment' },
  { value: 'off-topic', labelKey: 'community.reportDialog.reasonOffTopic' },
  { value: 'other', labelKey: 'community.reportDialog.reasonOther' },
];

export function ReportDialog({
  open,
  onOpenChange,
  onSubmit,
  targetType,
}: ReportDialogProps) {
  const { t } = useTranslation();
  const [selectedReason, setSelectedReason] = useState<string>('');
  const [customReason, setCustomReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const typeLabel = t(
    targetType === 'post'
      ? 'community.reportDialog.typePost'
      : 'community.reportDialog.typeComment',
  );

  const handleSubmit = async () => {
    const matched = REPORT_REASONS.find(r => r.value === selectedReason);
    const reason = selectedReason === 'other'
      ? customReason.trim()
      : (matched ? t(matched.labelKey) : selectedReason);

    if (!reason) return;
    
    setIsSubmitting(true);
    try {
      await onSubmit(reason);
      onOpenChange(false);
      setSelectedReason('');
      setCustomReason('');
    } catch {
      // The caller surfaces feedback for failures (#21). Keep the dialog open so
      // the user can retry; terminal outcomes (e.g. duplicate report) are the
      // caller's job to resolve without rethrowing.
    } finally {
      setIsSubmitting(false);
    }
  };

  const isValid = selectedReason && (selectedReason !== 'other' || customReason.trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('community.reportDialog.title', { type: typeLabel })}</DialogTitle>
          <DialogDescription>
            {t('community.reportDialog.description', { type: typeLabel })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <RadioGroup value={selectedReason} onValueChange={setSelectedReason}>
            {REPORT_REASONS.map((reason) => (
              <div key={reason.value} className="flex items-center space-x-2">
                <RadioGroupItem value={reason.value} id={reason.value} />
                <Label htmlFor={reason.value} className="font-normal">
                  {t(reason.labelKey)}
                </Label>
              </div>
            ))}
          </RadioGroup>

          {selectedReason === 'other' && (
            <div className="space-y-2">
              <Label htmlFor="custom-reason">{t('community.reportDialog.customLabel')}</Label>
              <Textarea
                id="custom-reason"
                placeholder={t('community.reportDialog.customPlaceholder')}
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                className="min-h-[100px]"
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            {t('common.cancel')}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!isValid || isSubmitting}
          >
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {t('community.reportDialog.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
