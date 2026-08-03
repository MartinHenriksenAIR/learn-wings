import { describe, it, expect } from 'vitest';
import type { TFunction } from 'i18next';
import { categoryLabel } from './community-category-label';
import en from '@/i18n/locales/en.json';
import da from '@/i18n/locales/da.json';

// The fixed, seeded community taxonomy (migration/azure/02-seed.sql). There is
// no UI to create categories, so this is the closed set that must stay keyed.
const SEEDED_SLUGS = [
  'challenges-obstacles',
  'risks-mitigation',
  'questions-help',
  'wins-learnings',
  'announcements',
  'events',
] as const;

// Minimal i18next-like t: returns a mapped translation, else the raw key
// (i18next's no-defaultValue behavior — see #300).
const makeT = (translations: Record<string, string>): TFunction =>
  ((key: string) => translations[key] ?? key) as unknown as TFunction;

describe('categoryLabel (#342)', () => {
  it('resolves the slug-mapped translation', () => {
    const t = makeT({ 'community.categories.questions-help.name': 'Spørgsmål & Hjælp' });
    expect(categoryLabel({ slug: 'questions-help' }, t)).toBe('Spørgsmål & Hjælp');
  });

  it('keys off the slug, so color/label stay decoupled from the DB name', () => {
    const t = makeT({ 'community.categories.wins-learnings.name': 'Sejre / Læring' });
    expect(categoryLabel({ slug: 'wins-learnings' }, t)).toBe('Sejre / Læring');
  });

  it('returns the raw key for an unmapped slug — no defaultValue masking (#300)', () => {
    const t = makeT({});
    expect(categoryLabel({ slug: 'not-a-category' }, t)).toBe(
      'community.categories.not-a-category.name',
    );
  });
});

describe('community category i18n coverage (#342)', () => {
  const enCats = en.community.categories as Record<string, { name: string }>;
  const daCats = da.community.categories as Record<string, { name: string }>;

  it('every seeded slug has a non-empty name in both en and da', () => {
    for (const slug of SEEDED_SLUGS) {
      expect(enCats[slug]?.name, `en missing ${slug}`).toBeTruthy();
      expect(daCats[slug]?.name, `da missing ${slug}`).toBeTruthy();
    }
  });

  it('en and da expose exactly the seeded slug set (parity, no drift)', () => {
    const expected = [...SEEDED_SLUGS].sort();
    expect(Object.keys(enCats).sort()).toEqual(expected);
    expect(Object.keys(daCats).sort()).toEqual(expected);
  });
});
