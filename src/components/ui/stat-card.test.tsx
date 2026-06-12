import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import React from 'react';
import { BookOpen } from 'lucide-react';

import { StatCard } from './stat-card';

describe('StatCard', () => {
  it('renders icon chip, value and label', () => {
    render(<StatCard icon={<BookOpen data-testid="icon" />} value={7} label="Courses enrolled" />);

    expect(screen.getByTestId('icon')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('Courses enrolled')).toBeInTheDocument();
    // Not interactive without onClick.
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders the hover-reveal panel only when extra is given', () => {
    const { rerender } = render(<StatCard icon={<BookOpen />} value={7} label="Courses" />);
    expect(screen.queryByTestId('stat-card-extra')).toBeNull();

    rerender(<StatCard icon={<BookOpen />} value={7} label="Courses" extra="Next: Intro to AI" />);
    expect(screen.getByTestId('stat-card-extra')).toHaveTextContent('Next: Intro to AI');
  });

  it('reveals the extra panel on focus as well as hover (class wiring)', () => {
    render(
      <StatCard icon={<BookOpen />} value={7} label="Courses" extra="Next: Intro to AI" onClick={() => {}} />,
    );

    // jsdom applies no CSS, so assert the variant classes that drive the
    // reveal: hover for pointer users, focus-within for keyboard/touch users.
    const panel = screen.getByTestId('stat-card-extra');
    expect(panel.className).toContain('group-hover:max-h-[84px]');
    expect(panel.className).toContain('group-focus-within:max-h-[84px]');
    expect(panel.className).toContain('group-focus-within:opacity-100');
    expect(panel.className).toContain('group-focus-within:mt-[11px]');

    // The card itself is focusable (onClick given), so focusing it satisfies
    // the :focus-within reveal condition.
    const card = screen.getByRole('button');
    card.focus();
    expect(card).toHaveFocus();
    expect(card.contains(document.activeElement)).toBe(true);
  });

  it('is clickable and keyboard accessible when onClick is given', () => {
    const onClick = vi.fn();
    render(<StatCard icon={<BookOpen />} value={7} label="Courses" onClick={onClick} />);

    const card = screen.getByRole('button');
    expect(card).toHaveAttribute('tabindex', '0');

    fireEvent.click(card);
    fireEvent.keyDown(card, { key: 'Enter' });
    fireEvent.keyDown(card, { key: ' ' });

    expect(onClick).toHaveBeenCalledTimes(3);
  });
});
