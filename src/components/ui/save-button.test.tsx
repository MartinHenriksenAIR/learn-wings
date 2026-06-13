import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, screen, act } from '@testing-library/react';
import React from 'react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import { SaveButton } from './save-button';
import { useFlash } from '@/hooks/useFlash';

/** Caller-owned timing, as in production: useFlash drives the `done` prop. */
function Harness({ onSave }: { onSave?: () => void }) {
  const { flashed, flash } = useFlash();
  return (
    <SaveButton
      done={flashed('save')}
      idleLabel="Save changes"
      doneLabel="Saved!"
      onClick={() => {
        onSave?.();
        flash('save');
      }}
    />
  );
}

describe('SaveButton + useFlash', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('morphs to the green done state on click, then reverts after 1.6s', () => {
    const onSave = vi.fn();
    render(<Harness onSave={onSave} />);

    const button = screen.getByRole('button', { name: 'Save changes' });
    expect(button.className).not.toContain('bg-success');

    fireEvent.click(button);

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Saved!' })).toBeInTheDocument();
    expect(screen.getByRole('button').className).toContain('bg-success');

    act(() => {
      vi.advanceTimersByTime(1600);
    });

    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
    expect(screen.getByRole('button').className).not.toContain('bg-success');
  });

  it('falls back to the i18n "Saved" label when doneLabel is omitted', () => {
    render(<SaveButton done idleLabel="Save changes" />);

    expect(screen.getByRole('button', { name: 'common.saved' })).toBeInTheDocument();
  });

  it('renders a disabled idle button when disabled', () => {
    const onClick = vi.fn();
    render(<SaveButton done={false} idleLabel="Save changes" onClick={onClick} disabled />);

    const button = screen.getByRole('button', { name: 'Save changes' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('clears pending revert timers on unmount (useFlash cleanup)', () => {
    const { unmount } = render(<Harness />);

    fireEvent.click(screen.getByRole('button'));
    expect(vi.getTimerCount()).toBe(1);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });
});
