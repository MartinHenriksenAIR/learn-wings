import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

interface IdeaScoreDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ideaTitle?: string;
  value: number | null;
  effort: number | null;
  onSave: (value: number, effort: number) => void;
  onClear: () => void;
  isPending?: boolean;
}

const LEVELS = [
  { value: '3', key: 'high' },
  { value: '2', key: 'medium' },
  { value: '1', key: 'low' },
] as const;

// Element ids linking each <label> to its Select trigger (a11y).
const VALUE_SELECT_ID = 'idea-score-value';
const EFFORT_SELECT_ID = 'idea-score-effort';

export function IdeaScoreDialog({
  open, onOpenChange, ideaTitle, value, effort, onSave, onClear, isPending,
}: IdeaScoreDialogProps) {
  const { t } = useTranslation();
  const [localValue, setLocalValue] = useState<string>('');
  const [localEffort, setLocalEffort] = useState<string>('');

  // Re-seed the selects each time the dialog opens for a (possibly different) idea.
  useEffect(() => {
    if (open) {
      setLocalValue(value != null ? String(value) : '');
      setLocalEffort(effort != null ? String(effort) : '');
    }
  }, [open, value, effort]);

  const renderSelect = (
    id: string,
    current: string,
    onChange: (v: string) => void,
  ) => (
    <Select value={current} onValueChange={onChange}>
      <SelectTrigger id={id}>
        <SelectValue placeholder={t('ideaManagement.scoreDialog.placeholder')} />
      </SelectTrigger>
      <SelectContent>
        {LEVELS.map((l) => (
          <SelectItem key={l.value} value={l.value}>
            {t(`ideaManagement.levels.${l.key}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('ideaManagement.scoreDialog.title')}</DialogTitle>
          {ideaTitle && <DialogDescription>{ideaTitle}</DialogDescription>}
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4 py-4">
          <div className="space-y-2">
            <label htmlFor={VALUE_SELECT_ID} className="text-sm font-medium">{t('ideaManagement.scoreDialog.valueLabel')}</label>
            {renderSelect(VALUE_SELECT_ID, localValue, setLocalValue)}
          </div>
          <div className="space-y-2">
            <label htmlFor={EFFORT_SELECT_ID} className="text-sm font-medium">{t('ideaManagement.scoreDialog.effortLabel')}</label>
            {renderSelect(EFFORT_SELECT_ID, localEffort, setLocalEffort)}
          </div>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            variant="ghost"
            onClick={onClear}
            disabled={isPending || (value == null && effort == null)}
          >
            {t('ideaManagement.scoreDialog.clear')}
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={() => onSave(Number(localValue), Number(localEffort))}
              disabled={isPending || !localValue || !localEffort}
            >
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('common.save')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
