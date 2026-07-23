import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { QuickCheckConfig } from '@/lib/types';
import { newId } from './validateExercise';

interface Props { value: QuickCheckConfig; onChange: (c: QuickCheckConfig) => void; }

export function QuickCheckEditor({ value, onChange }: Props) {
  const { t } = useTranslation();
  const setQuestions = (questions: QuickCheckConfig['questions']) => onChange({ ...value, questions });

  return (
    <div className="space-y-6">
      {value.questions.map((q) => (
        <div key={q.id} className="rounded-md border p-3 space-y-2">
          <div className="flex gap-2">
            <Input value={q.text} placeholder={t('exercise.editor.questionText')}
              onChange={(e) => setQuestions(value.questions.map((x) => x.id === q.id ? { ...x, text: e.target.value } : x))} />
            <Button variant="ghost" onClick={() => setQuestions(value.questions.filter((x) => x.id !== q.id))}
              disabled={value.questions.length <= 1}>✕</Button>
          </div>
          {q.options.map((o) => (
            <div key={o.id} className="flex items-center gap-2 pl-4">
              <input type="radio" name={`correct-${q.id}`} checked={o.correct}
                aria-label={t('exercise.editor.markCorrect')}
                onChange={() => setQuestions(value.questions.map((x) => x.id === q.id
                  ? { ...x, options: x.options.map((oo) => ({ ...oo, correct: oo.id === o.id })) } : x))} />
              <Input value={o.text} placeholder={t('exercise.editor.optionText')}
                onChange={(e) => setQuestions(value.questions.map((x) => x.id === q.id
                  ? { ...x, options: x.options.map((oo) => oo.id === o.id ? { ...oo, text: e.target.value } : oo) } : x))} />
              <Button variant="ghost" size="sm" disabled={q.options.length <= 2}
                onClick={() => setQuestions(value.questions.map((x) => x.id === q.id
                  ? { ...x, options: x.options.filter((oo) => oo.id !== o.id) } : x))}>✕</Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => setQuestions(value.questions.map((x) => x.id === q.id
            ? { ...x, options: [...x.options, { id: newId('o'), text: '', correct: false }] } : x))}>
            {t('exercise.editor.addOption')}
          </Button>
        </div>
      ))}
      {value.questions.length < 3 && (
        <Button variant="outline" size="sm" onClick={() => setQuestions([...value.questions, {
          id: newId('q'), text: '', options: [
            { id: newId('o'), text: '', correct: true }, { id: newId('o'), text: '', correct: false },
          ],
        }])}>{t('exercise.editor.addQuestion')}</Button>
      )}
    </div>
  );
}
