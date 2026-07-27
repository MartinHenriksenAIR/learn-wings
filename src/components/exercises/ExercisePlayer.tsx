import type { Exercise, QuickCheckConfig, BucketSortConfig } from '@/lib/types';
import { QuickCheckPlayer } from './QuickCheckPlayer';
import { BucketSortPlayer } from './BucketSortPlayer';

interface Props { exercise: Exercise; onComplete: () => void; }

export function ExercisePlayer({ exercise, onComplete }: Props) {
  switch (exercise.exercise_kind) {
    case 'quick_check':
      return <QuickCheckPlayer config={exercise.config as QuickCheckConfig} onComplete={onComplete} />;
    case 'bucket_sort':
      return <BucketSortPlayer config={exercise.config as BucketSortConfig} onComplete={onComplete} />;
    default:
      return null; // unknown kind (future) — render nothing rather than crash
  }
}
