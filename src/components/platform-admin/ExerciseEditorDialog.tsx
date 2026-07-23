import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { callApi } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { toast } from '@/components/ui/sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ExerciseKind, ExerciseConfig, QuickCheckConfig, BucketSortConfig } from '@/lib/types';
import { useExerciseAdmin } from '@/hooks/useExerciseAdmin';
import { QuickCheckEditor } from './exercise-editors/QuickCheckEditor';
import { BucketSortEditor } from './exercise-editors/BucketSortEditor';
import { validateExercise, emptyQuickCheck, emptyBucketSort } from './exercise-editors/validateExercise';

interface Props { lessonId: string; lessonTitle: string; open: boolean; onOpenChange: (open: boolean) => void; }

const emptyFor = (kind: ExerciseKind): ExerciseConfig =>
  kind === 'quick_check' ? emptyQuickCheck() : emptyBucketSort();

export function ExerciseEditorDialog({ lessonId, lessonTitle, open, onOpenChange }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [kind, setKind] = useState<ExerciseKind>('quick_check');
  const [config, setConfig] = useState<ExerciseConfig>(() => emptyQuickCheck());

  const { data } = useExerciseAdmin(lessonId, { enabled: open && !!lessonId });

  // Seed the form from the fetched exercise (or empty for a fresh lesson).
  useEffect(() => {
    if (!open) return;
    if (data?.exercise) { setKind(data.exercise.exercise_kind); setConfig(data.exercise.config); }
    else { setKind('quick_check'); setConfig(emptyQuickCheck()); }
  }, [open, data]);

  // Kind switch = confirmed destructive reset (config shapes are incompatible).
  const changeKind = (next: ExerciseKind) => {
    if (next === kind) return;
    if (!window.confirm(t('exercise.editor.switchKindConfirm'))) return;
    setKind(next); setConfig(emptyFor(next));
  };

  const save = useMutation({
    mutationFn: () => callApi('/api/exercise-admin-save', { lessonId, exerciseKind: kind, config }),
    onSuccess: () => {
      toast.success(t('exercise.editor.saved'));
      qc.invalidateQueries({ queryKey: queryKeys.exerciseAdmin.detail(lessonId), refetchType: 'none' });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleSave = () => {
    const err = validateExercise(kind, config);
    if (err) { toast.error(err); return; }
    save.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{t('exercise.editor.title', { title: lessonTitle })}</DialogTitle></DialogHeader>

        <div className="mb-4">
          <Select value={kind} onValueChange={(v) => changeKind(v as ExerciseKind)}>
            <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="quick_check">{t('exercise.kind.quick_check')}</SelectItem>
              <SelectItem value="bucket_sort">{t('exercise.kind.bucket_sort')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {kind === 'quick_check'
          ? <QuickCheckEditor value={config as QuickCheckConfig} onChange={setConfig} />
          : <BucketSortEditor value={config as BucketSortConfig} onChange={setConfig} />}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button onClick={handleSave} disabled={save.isPending}>{t('common.save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
