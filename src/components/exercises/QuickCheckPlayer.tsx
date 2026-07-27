import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { QuickCheckConfig } from '@/lib/types';

interface Props { config: QuickCheckConfig; onComplete: () => void; }

export function QuickCheckPlayer({ config, onComplete }: Props) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<Record<string, string>>({}); // questionId -> optionId
  const [checked, setChecked] = useState(false);
  const [completed, setCompleted] = useState(false); // latch: onComplete fires exactly once

  const isQuestionCorrect = (qId: string) => {
    const q = config.questions.find((x) => x.id === qId)!;
    const chosen = selected[qId];
    return !!chosen && q.options.find((o) => o.id === chosen)?.correct === true;
  };
  const allCorrect = config.questions.every((q) => isQuestionCorrect(q.id));

  const handleCheck = () => {
    setChecked(true);
    if (allCorrect && !completed) { setCompleted(true); onComplete(); }
  };

  return (
    <div className="space-y-6">
      {config.questions.map((q) => (
        <div key={q.id} className="space-y-2">
          <p className="font-medium">{q.text}</p>
          <RadioGroup
            value={selected[q.id] ?? ''}
            onValueChange={(v) => { setSelected((p) => ({ ...p, [q.id]: v })); setChecked(false); }}
          >
            {q.options.map((o) => (
              <div key={o.id} className="flex items-center gap-2">
                <RadioGroupItem id={`${q.id}-${o.id}`} value={o.id} />
                <Label htmlFor={`${q.id}-${o.id}`}>{o.text}</Label>
              </div>
            ))}
          </RadioGroup>
          {checked && (
            <span role="status" className={cn('text-sm', isQuestionCorrect(q.id) ? 'text-green-600' : 'text-destructive')}>
              {isQuestionCorrect(q.id) ? t('exercise.allCorrect') : t('exercise.tryAgain')}
            </span>
          )}
        </div>
      ))}
      <Button onClick={handleCheck} disabled={completed}>{t('exercise.check')}</Button>
    </div>
  );
}
