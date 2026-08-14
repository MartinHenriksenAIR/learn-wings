import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIdleTimeout, ACTIVITY_EVENT } from './useIdleTimeout';

const opts = (over: Partial<Parameters<typeof useIdleTimeout>[0]> = {}) => ({
  enabled: true,
  onTimeout: vi.fn(),
  timeoutMs: 10_000,
  warningMs: 3_000,
  checkIntervalMs: 1_000,
  ...over,
});

describe('useIdleTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not warn or time out before the threshold', () => {
    const o = opts();
    const { result } = renderHook(() => useIdleTimeout(o));

    act(() => void vi.advanceTimersByTime(6_000)); // < 7s (timeout - warning)

    expect(result.current.warningActive).toBe(false);
    expect(o.onTimeout).not.toHaveBeenCalled();
  });

  it('shows the warning with a countdown in the final window', () => {
    const o = opts();
    const { result } = renderHook(() => useIdleTimeout(o));

    act(() => void vi.advanceTimersByTime(7_000));

    expect(result.current.warningActive).toBe(true);
    expect(result.current.secondsRemaining).toBeGreaterThan(0);
    expect(result.current.secondsRemaining).toBeLessThanOrEqual(3);
  });

  it('fires onTimeout exactly once after the full idle window', () => {
    const o = opts();
    renderHook(() => useIdleTimeout(o));

    act(() => void vi.advanceTimersByTime(12_000));

    expect(o.onTimeout).toHaveBeenCalledTimes(1);
  });

  it('resets the timer on raw user activity, dismissing an active warning', () => {
    const o = opts();
    const { result } = renderHook(() => useIdleTimeout(o));

    act(() => void vi.advanceTimersByTime(7_000));
    expect(result.current.warningActive).toBe(true);

    act(() => {
      window.dispatchEvent(new Event('mousemove'));
      vi.advanceTimersByTime(1_000);
    });
    expect(result.current.warningActive).toBe(false);

    act(() => void vi.advanceTimersByTime(5_000)); // 6s since activity < 7s
    expect(o.onTimeout).not.toHaveBeenCalled();
  });

  it('counts the custom activity event (video playback) as activity', () => {
    const o = opts();
    renderHook(() => useIdleTimeout(o));

    for (let i = 0; i < 15; i += 1) {
      act(() => {
        window.dispatchEvent(new Event(ACTIVITY_EVENT));
        vi.advanceTimersByTime(1_000);
      });
    }

    expect(o.onTimeout).not.toHaveBeenCalled();
  });

  it('stayActive() dismisses the warning and keeps the session', () => {
    const o = opts();
    const { result } = renderHook(() => useIdleTimeout(o));

    act(() => void vi.advanceTimersByTime(7_500));
    expect(result.current.warningActive).toBe(true);

    act(() => {
      result.current.stayActive();
      vi.advanceTimersByTime(1_000);
    });

    expect(result.current.warningActive).toBe(false);
    expect(o.onTimeout).not.toHaveBeenCalled();
  });

  it('picks up activity recorded by another tab via the shared clock', () => {
    const o = opts();
    const { result } = renderHook(() => useIdleTimeout(o));

    act(() => void vi.advanceTimersByTime(7_000));
    expect(result.current.warningActive).toBe(true);

    act(() => {
      localStorage.setItem('idleLastActivity', String(Date.now()));
      window.dispatchEvent(new StorageEvent('storage', { key: 'idleLastActivity' }));
    });

    expect(result.current.warningActive).toBe(false);
  });

  it('does nothing when disabled', () => {
    const o = opts({ enabled: false });
    const { result } = renderHook(() => useIdleTimeout(o));

    act(() => void vi.advanceTimersByTime(20_000));

    expect(result.current.warningActive).toBe(false);
    expect(o.onTimeout).not.toHaveBeenCalled();
  });
});
