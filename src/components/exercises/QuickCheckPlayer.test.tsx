import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// i18n echo — REPO CONVENTION (see save-button.test.tsx / BucketSortPlayer.test.tsx):
// t returns the key so the render resolves without a global i18n instance (test files
// run isolated, so nothing initialises react-i18next otherwise). The key strings still
// satisfy the /check/i name matcher below (t('exercise.check') -> "exercise.check").
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import { QuickCheckPlayer } from './QuickCheckPlayer';
import en from '@/i18n/locales/en.json';
import da from '@/i18n/locales/da.json';
import type { QuickCheckConfig } from '@/lib/types';

const config: QuickCheckConfig = {
  version: 1,
  questions: [{
    id: 'q1', text: 'Good use of AI?',
    options: [
      { id: 'o1', text: 'Draft a first version', correct: true },
      { id: 'o2', text: 'Sign a contract unread', correct: false },
    ],
  }],
};

describe('QuickCheckPlayer', () => {
  it('completes when the correct option is chosen', () => {
    const onComplete = vi.fn();
    render(<QuickCheckPlayer config={config} onComplete={onComplete} />);
    fireEvent.click(screen.getByRole('radio', { name: /Draft a first version/ }));
    fireEvent.click(screen.getByRole('button', { name: /check/i }));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('does not complete on a wrong choice, and allows retry', () => {
    const onComplete = vi.fn();
    render(<QuickCheckPlayer config={config} onComplete={onComplete} />);
    fireEvent.click(screen.getByRole('radio', { name: /Sign a contract unread/ }));
    fireEvent.click(screen.getByRole('button', { name: /check/i }));
    expect(onComplete).not.toHaveBeenCalled();
    // retry with the right one
    fireEvent.click(screen.getByRole('radio', { name: /Draft a first version/ }));
    fireEvent.click(screen.getByRole('button', { name: /check/i }));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('calls onComplete EXACTLY once even when Check is clicked repeatedly (completion latch)', () => {
    const onComplete = vi.fn();
    render(<QuickCheckPlayer config={config} onComplete={onComplete} />);
    fireEvent.click(screen.getByRole('radio', { name: /Draft a first version/ }));
    const check = screen.getByRole('button', { name: /check/i });
    fireEvent.click(check);
    fireEvent.click(check);
    fireEvent.click(check);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});

// The exercise.* keys the component renders must exist in BOTH locales
// (frontend convention: every user-facing string has en + da).
describe('exercise i18n keys', () => {
  it.each(['check', 'allCorrect', 'tryAgain'])('defines exercise.%s in en and da', (key) => {
    const enVal = (en as unknown as Record<string, Record<string, string>>).exercise?.[key];
    const daVal = (da as unknown as Record<string, Record<string, string>>).exercise?.[key];
    expect(typeof enVal).toBe('string');
    expect(enVal.length).toBeGreaterThan(0);
    expect(typeof daVal).toBe('string');
    expect(daVal.length).toBeGreaterThan(0);
  });
});
