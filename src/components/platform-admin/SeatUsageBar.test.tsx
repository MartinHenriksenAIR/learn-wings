import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { SeatUsageBar } from './SeatUsageBar';

const fill = () => screen.getByTestId('seat-usage-bar-fill');

// jsdom's CSSOM does not recognise `hsl(var(--token))`, so reading back
// `style.background` yields ''. The fill's `data-danger` attribute is the
// single source of truth for the navy/red decision (it drives the inline
// background), so assertions target it rather than the dropped style value.

describe('SeatUsageBar', () => {
  it('stays navy below the limit', () => {
    render(<SeatUsageBar used={5} limit={10} />);
    const el = fill();
    expect(el).toHaveAttribute('data-danger', 'false');
    expect(el.style.width).toBe('50%');
  });

  it('does NOT trip danger at the old 90% threshold (consolidated rule)', () => {
    // 9/10 = 90%: under the prior list-screen rule this was red; the unified
    // limit-reached rule keeps it navy until used >= limit.
    render(<SeatUsageBar used={9} limit={10} />);
    const el = fill();
    expect(el).toHaveAttribute('data-danger', 'false');
    expect(el.style.width).toBe('90%');
  });

  it('turns danger-red at the limit (used === limit)', () => {
    render(<SeatUsageBar used={10} limit={10} />);
    const el = fill();
    expect(el).toHaveAttribute('data-danger', 'true');
    expect(el.style.width).toBe('100%');
  });

  it('turns red and clamps width to 100% when over the limit', () => {
    render(<SeatUsageBar used={15} limit={10} />);
    const el = fill();
    expect(el).toHaveAttribute('data-danger', 'true');
    expect(el.style.width).toBe('100%');
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['zero', 0],
  ])('renders gracefully (no NaN/Infinity, navy empty rail) when limit is %s', (_label, limit) => {
    render(<SeatUsageBar used={5} limit={limit as number | null | undefined} />);
    const el = fill();
    expect(el).toHaveAttribute('data-danger', 'false');
    expect(el.style.width).toBe('0%');
    expect(el.style.width).not.toContain('NaN');
    expect(el.style.width).not.toContain('Infinity');
  });

  it('is hidden from the a11y tree and forwards className to the rail', () => {
    render(<SeatUsageBar used={1} limit={10} className="mt-2 h-[6px]" />);
    const rail = screen.getByTestId('seat-usage-bar');
    expect(rail).toHaveAttribute('aria-hidden', 'true');
    expect(rail.className).toContain('mt-2');
    expect(rail.className).toContain('h-[6px]');
  });
});
