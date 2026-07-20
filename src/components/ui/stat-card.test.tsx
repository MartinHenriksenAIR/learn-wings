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
