import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: { label?: string }) =>
      k === 'exercise.placeInBucket' && opts?.label ? `Place in ${opts.label}` : k,
  }),
}));

import { BucketSortPlayer } from './BucketSortPlayer';
import en from '@/i18n/locales/en.json';
import da from '@/i18n/locales/da.json';
import type { BucketSortConfig } from '@/lib/types';

const config: BucketSortConfig = {
  version: 1,
  buckets: [{ id: 'b1', label: 'Draft' }, { id: 'b2', label: 'Human' }],
  items: [
    { id: 'i1', text: 'Brainstorm', bucketId: 'b1' },
    { id: 'i2', text: 'Approve firing', bucketId: 'b2' },
  ],
};

describe('BucketSortPlayer', () => {
  it('calls onComplete when every item is placed correctly (click-to-place path)', () => {
    const onComplete = vi.fn();
    render(<BucketSortPlayer config={config} onComplete={onComplete} />);

    fireEvent.click(screen.getByRole('button', { name: /Brainstorm/ }));
    fireEvent.click(screen.getByRole('button', { name: /place in Draft/i }));
    fireEvent.click(screen.getByRole('button', { name: /Approve firing/ }));
    fireEvent.click(screen.getByRole('button', { name: /place in Human/i }));

    fireEvent.click(screen.getByRole('button', { name: /check/i }));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('calls onComplete EXACTLY once even when Check is clicked repeatedly (completion latch)', () => {
    const onComplete = vi.fn();
    render(<BucketSortPlayer config={config} onComplete={onComplete} />);

    fireEvent.click(screen.getByRole('button', { name: /Brainstorm/ }));
    fireEvent.click(screen.getByRole('button', { name: /place in Draft/i }));
    fireEvent.click(screen.getByRole('button', { name: /Approve firing/ }));
    fireEvent.click(screen.getByRole('button', { name: /place in Human/i }));

    const check = screen.getByRole('button', { name: /check/i });
    fireEvent.click(check);
    fireEvent.click(check);
    fireEvent.click(check);

    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('does NOT call onComplete when an item is in the wrong bucket', () => {
    const onComplete = vi.fn();
    render(<BucketSortPlayer config={config} onComplete={onComplete} />);
    fireEvent.click(screen.getByRole('button', { name: /Brainstorm/ }));
    fireEvent.click(screen.getByRole('button', { name: /place in Human/i })); // wrong
    fireEvent.click(screen.getByRole('button', { name: /check/i }));
    expect(onComplete).not.toHaveBeenCalled();
  });
});

describe('exercise i18n keys', () => {
  it.each(['check', 'allCorrect', 'tryAgain', 'placeHere', 'placeInBucket'])('defines exercise.%s in en and da', (key) => {
    const enVal = (en as unknown as Record<string, Record<string, string>>).exercise?.[key];
    const daVal = (da as unknown as Record<string, Record<string, string>>).exercise?.[key];
    expect(typeof enVal).toBe('string');
    expect(enVal.length).toBeGreaterThan(0);
    expect(typeof daVal).toBe('string');
    expect(daVal.length).toBeGreaterThan(0);
  });
});
