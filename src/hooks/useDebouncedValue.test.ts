import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDebouncedValue } from './useDebouncedValue';

describe('useDebouncedValue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the initial value immediately', () => {
    const { result } = renderHook(() => useDebouncedValue('initial', 250));

    expect(result.current).toBe('initial');
  });

  it('settles to the new value only after the delay', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 250),
      { initialProps: { value: 'a' } }
    );

    rerender({ value: 'ab' });
    expect(result.current).toBe('a');

    act(() => {
      vi.advanceTimersByTime(249);
    });
    expect(result.current).toBe('a');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe('ab');
  });

  it('does not leak intermediate values when typing keeps resetting the timer', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 250),
      { initialProps: { value: '' } }
    );

    // Simulate keystrokes 100ms apart — each resets the pending timer.
    rerender({ value: 'r' });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    rerender({ value: 're' });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    rerender({ value: 'rea' });
    act(() => {
      vi.advanceTimersByTime(100);
    });

    // 300ms since the first keystroke, but only 100ms since the last:
    // none of the intermediate values may have leaked through.
    expect(result.current).toBe('');

    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(result.current).toBe('rea');
  });

  it('uses the default 250ms delay when none is given', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value), {
      initialProps: { value: 1 },
    });

    rerender({ value: 2 });
    act(() => {
      vi.advanceTimersByTime(249);
    });
    expect(result.current).toBe(1);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe(2);
  });
});
