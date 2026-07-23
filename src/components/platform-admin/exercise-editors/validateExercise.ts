import type { ExerciseKind, ExerciseConfig, QuickCheckConfig, BucketSortConfig } from '@/lib/types';

let seq = 0;
export const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}`;

export const emptyQuickCheck = (): QuickCheckConfig => ({
  version: 1,
  questions: [{ id: newId('q'), text: '', options: [
    { id: newId('o'), text: '', correct: true },
    { id: newId('o'), text: '', correct: false },
  ] }],
});

export const emptyBucketSort = (): BucketSortConfig => ({
  version: 1,
  buckets: [{ id: newId('b'), label: '' }, { id: newId('b'), label: '' }],
  items: [{ id: newId('i'), text: '', bucketId: '' }],
});

export function validateExercise(kind: ExerciseKind, config: ExerciseConfig): string | null {
  if (kind === 'quick_check') {
    const c = config as QuickCheckConfig;
    if (c.questions.length < 1 || c.questions.length > 3) return 'Add 1–3 questions';
    for (const q of c.questions) {
      if (!q.text.trim()) return 'Every question needs text';
      if (q.options.length < 2) return 'Every question needs at least 2 options';
      if (q.options.some((o) => !o.text.trim())) return 'Every option needs text';
      if (q.options.filter((o) => o.correct).length !== 1) return 'Mark exactly one correct option per question';
    }
    return null;
  }
  const c = config as BucketSortConfig;
  if (c.buckets.length < 2) return 'Add at least 2 buckets';
  if (c.buckets.some((b) => !b.label.trim())) return 'Every bucket needs a label';
  if (c.items.length < 1) return 'Add at least 1 item';
  const ids = new Set(c.buckets.map((b) => b.id));
  for (const it of c.items) {
    if (!it.text.trim()) return 'Every item needs text';
    if (!it.bucketId || !ids.has(it.bucketId)) return 'Assign every item to a bucket';
  }
  return null;
}
