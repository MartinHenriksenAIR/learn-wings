import { describe, it, expect } from 'vitest';
import {
  levelThreshold,
  levelForXp,
  levelProgress,
  displayName,
  computeStreak,
  LESSON_XP,
  QUIZ_XP,
  COURSE_XP,
} from './gamification';

describe('level math', () => {
  it('has the documented rising thresholds', () => {
    expect([1, 2, 3, 4, 5].map(levelThreshold)).toEqual([0, 200, 500, 900, 1400]);
  });

  it('maps XP to the correct level at and around each boundary', () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(199)).toBe(1);
    expect(levelForXp(200)).toBe(2);
    expect(levelForXp(499)).toBe(2);
    expect(levelForXp(500)).toBe(3);
    expect(levelForXp(1400)).toBe(5);
    expect(levelForXp(-50)).toBe(1); // never below 1
  });

  it('reports progress within a level', () => {
    const p = levelProgress(75);
    expect(p.level).toBe(1);
    expect(p.xpIntoLevel).toBe(75);
    expect(p.xpForLevel).toBe(200);
    expect(p.xpToNext).toBe(125);
    expect(p.nextThreshold).toBe(200);
    expect(p.progressPct).toBe(38);
  });
});

describe('displayName', () => {
  it('is first name + last initial', () => {
    expect(displayName({ first_name: 'Martin', last_name: 'Henriksen', full_name: 'Martin Henriksen' })).toBe('Martin H.');
  });
  it('derives from full_name when first/last are absent', () => {
    expect(displayName({ first_name: null, last_name: null, full_name: 'Anna Berg' })).toBe('Anna B.');
  });
  it('handles a single-token name (no initial)', () => {
    expect(displayName({ first_name: 'Cher', last_name: null, full_name: 'Cher' })).toBe('Cher');
  });
});

describe('computeStreak', () => {
  it('counts consecutive days ending today', () => {
    expect(computeStreak('2026-08-06', ['2026-08-06', '2026-08-05', '2026-08-04'])).toEqual({ current: 3, activeToday: true });
  });
  it('stays alive if the last active day was yesterday (grace)', () => {
    expect(computeStreak('2026-08-06', ['2026-08-05', '2026-08-04'])).toEqual({ current: 2, activeToday: false });
  });
  it('is broken (0) when the last active day is older than yesterday', () => {
    expect(computeStreak('2026-08-06', ['2026-08-03', '2026-08-02'])).toEqual({ current: 0, activeToday: false });
  });
  it('crosses month boundaries correctly', () => {
    expect(computeStreak('2026-08-01', ['2026-08-01', '2026-07-31', '2026-07-30'])).toEqual({ current: 3, activeToday: true });
  });
  it('handles no activity', () => {
    expect(computeStreak('2026-08-06', [])).toEqual({ current: 0, activeToday: false });
  });
});

describe('XP rates', () => {
  it('are the agreed values', () => {
    expect([LESSON_XP, QUIZ_XP, COURSE_XP]).toEqual([10, 25, 100]);
  });
});
