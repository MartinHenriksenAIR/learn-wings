import { useMemo, useState } from 'react';
import type { BucketSortConfig } from '@/lib/types';

/** Input-agnostic state: itemId -> bucketId | null (null = unassigned tray). */
export type Assignments = Record<string, string | null>;

export function useBucketAssignments(config: BucketSortConfig) {
  const [assignments, setAssignments] = useState<Assignments>(
    () => Object.fromEntries(config.items.map((it) => [it.id, null])),
  );

  const assign = (itemId: string, bucketId: string | null) =>
    setAssignments((prev) => ({ ...prev, [itemId]: bucketId }));

  const reset = () => setAssignments(Object.fromEntries(config.items.map((it) => [it.id, null])));

  const isAllCorrect = useMemo(
    () => config.items.every((it) => assignments[it.id] === it.bucketId),
    [assignments, config.items],
  );

  return { assignments, assign, reset, isAllCorrect };
}
