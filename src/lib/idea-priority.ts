import type { IdeaStatusExtended } from './community-types';

/** Statuses that appear on the prioritization matrix (Backlog + In Progress). */
export const PRIORITIZABLE_STATUSES: readonly IdeaStatusExtended[] = ['accepted', 'in_progress'];

export type PriorityBand = 'quick_win' | 'big_bet' | 'fill_in' | 'deprioritize';

/**
 * Collapse the 3-level Value/Effort scores into one of four named bands.
 * Presentation heuristic (tunable): highValue = value >= 2; lowEffort = effort <= 2.
 * Returns null if either score is unset.
 */
export function getBand(value: number | null, effort: number | null): PriorityBand | null {
  if (value == null || effort == null) return null;
  const highValue = value >= 2;
  const lowEffort = effort <= 2;
  if (highValue && lowEffort) return 'quick_win';
  if (highValue && !lowEffort) return 'big_bet';
  if (!highValue && lowEffort) return 'fill_in';
  return 'deprioritize';
}

interface ScoredIdea {
  value_score: number | null;
  effort_score: number | null;
  vote_count?: number | null;
}

/**
 * Total order for the "Do next" list: value desc → effort asc → votes desc.
 * Unscored ideas (either score null) sort last. Pure — never mutates input.
 */
export function rankIdeas<T extends ScoredIdea>(ideas: T[]): T[] {
  return [...ideas].sort((a, b) => {
    const aScored = a.value_score != null && a.effort_score != null;
    const bScored = b.value_score != null && b.effort_score != null;
    if (aScored !== bScored) return aScored ? -1 : 1;
    if (!aScored) return 0;
    if (b.value_score! !== a.value_score!) return b.value_score! - a.value_score!;
    if (a.effort_score! !== b.effort_score!) return a.effort_score! - b.effort_score!;
    return (b.vote_count ?? 0) - (a.vote_count ?? 0);
  });
}
