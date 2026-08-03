import { describe, it, expect } from 'vitest';
import type { TFunction } from 'i18next';
import { categoryLabel } from './community-category-label';

// Minimal i18next-like t: returns a mapped translation, else the raw key
// (i18next's no-defaultValue behavior — see #300).
const makeT = (translations: Record<string, string>): TFunction =>
  ((key: string) => translations[key] ?? key) as unknown as TFunction;

describe('categoryLabel (#342)', () => {
  it('resolves the slug-mapped translation', () => {
    const t = makeT({ 'community.categories.questions-help.name': 'Spørgsmål & Hjælp' });
    expect(categoryLabel({ slug: 'questions-help' }, t)).toBe('Spørgsmål & Hjælp');
  });

  it('keys off the slug, so the color/label stay decoupled from the DB name', () => {
    const t = makeT({ 'community.categories.wins-learnings.name': 'Sejre / Læring' });
    expect(categoryLabel({ slug: 'wins-learnings' }, t)).toBe('Sejre / Læring');
  });
});
