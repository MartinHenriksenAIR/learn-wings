import { describe, it, expect } from 'vitest';
import { getBand, rankIdeas } from './idea-priority';

describe('getBand', () => {
  it('returns null when either score is missing', () => {
    expect(getBand(null, 1)).toBeNull();
    expect(getBand(3, null)).toBeNull();
    expect(getBand(null, null)).toBeNull();
  });

  // Band rule: highValue = value >= 2 ; lowEffort = effort <= 2
  it('quick_win = high value, low effort', () => {
    expect(getBand(3, 1)).toBe('quick_win');
    expect(getBand(2, 2)).toBe('quick_win');
    expect(getBand(3, 2)).toBe('quick_win');
    expect(getBand(2, 1)).toBe('quick_win');
  });
  it('big_bet = high value, high effort', () => {
    expect(getBand(3, 3)).toBe('big_bet');
    expect(getBand(2, 3)).toBe('big_bet');
  });
  it('fill_in = low value, low effort', () => {
    expect(getBand(1, 1)).toBe('fill_in');
    expect(getBand(1, 2)).toBe('fill_in');
  });
  it('deprioritize = low value, high effort', () => {
    expect(getBand(1, 3)).toBe('deprioritize');
  });
});

describe('rankIdeas', () => {
  const mk = (id: string, v: number | null, e: number | null, votes = 0) =>
    ({ id, value_score: v, effort_score: e, vote_count: votes });

  it('orders value desc, then effort asc, then votes desc; unscored last', () => {
    const ideas = [
      mk('unscored', null, null, 99),
      mk('lowval', 1, 1, 0),
      mk('bigbet', 3, 3, 0),
      mk('quickwin', 3, 1, 0),
      mk('qw-tie-lowvotes', 3, 1, 1),
      mk('qw-tie-hivotes', 3, 1, 5),
    ];
    const order = rankIdeas(ideas).map((i) => i.id);
    // both quickwin(votes 0) tie on value+effort with the two tie rows → votes desc
    expect(order).toEqual(['qw-tie-hivotes', 'qw-tie-lowvotes', 'quickwin', 'bigbet', 'lowval', 'unscored']);
  });

  it('does not mutate the input array', () => {
    const ideas = [mk('a', 1, 1), mk('b', 3, 1)];
    const copy = [...ideas];
    rankIdeas(ideas);
    expect(ideas).toEqual(copy);
  });
});
