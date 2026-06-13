import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import { LevelBadge, type CourseLevel } from './level-badge';

function filledBarCount() {
  const bars = screen.getAllByTestId('level-bar');
  expect(bars).toHaveLength(3);
  return bars.filter((bar) => bar.dataset.filled === 'true' && bar.style.opacity === '1').length;
}

describe('LevelBadge', () => {
  it.each([
    ['basic', 1],
    ['intermediate', 2],
    ['advanced', 3],
  ] as [CourseLevel, number][])('renders %s with %i filled signal bars', (level, filled) => {
    render(<LevelBadge level={level} />);

    expect(filledBarCount()).toBe(filled);
    // Unfilled bars are dimmed, not removed.
    const dimmed = screen.getAllByTestId('level-bar').filter((bar) => bar.style.opacity === '0.28');
    expect(dimmed).toHaveLength(3 - filled);
  });

  it('renders the level label via i18n', () => {
    render(<LevelBadge level="intermediate" />);

    expect(screen.getByText('courses.levels.intermediate')).toBeInTheDocument();
  });

  it('uses the per-level pill colors from the prototype lvlStyles', () => {
    const { container } = render(<LevelBadge level="advanced" />);

    const pill = container.firstElementChild as HTMLElement;
    expect(pill.style.color).toBe('rgb(196, 61, 61)'); // #c43d3d
    expect(pill.style.backgroundColor).toBe('rgb(253, 236, 236)'); // #fdecec
  });
});
