import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import React from 'react';

import { SlidingTabs } from './sliding-tabs';

// jsdom does no layout: stub offsetLeft/offsetWidth so the indicator gets
// deterministic geometry (each tab button is 100px wide, 4px container pad).
const originalOffsetLeft = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetLeft');
const originalOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetLeft', {
    configurable: true,
    get(this: HTMLElement) {
      if (this.tagName !== 'BUTTON') return 0;
      const buttons = Array.from(this.parentElement?.querySelectorAll('button') ?? []);
      return 4 + buttons.indexOf(this as HTMLButtonElement) * 100;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.tagName === 'BUTTON' ? 100 : 0;
    },
  });
});

afterAll(() => {
  if (originalOffsetLeft) Object.defineProperty(HTMLElement.prototype, 'offsetLeft', originalOffsetLeft);
  if (originalOffsetWidth) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', originalOffsetWidth);
});

const tabs = [
  { key: 'overview', label: 'Overview' },
  { key: 'members', label: 'Members' },
  { key: 'locked', label: 'Locked', disabled: true },
];

describe('SlidingTabs', () => {
  it('renders all tabs with the active one marked', () => {
    render(<SlidingTabs tabs={tabs} active="overview" onChange={() => {}} />);

    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Members' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tab', { name: 'Locked' })).toHaveAttribute('aria-selected', 'false');
  });

  it('calls onChange with the clicked tab key (controlled: active does not change by itself)', () => {
    const onChange = vi.fn();
    render(<SlidingTabs tabs={tabs} active="overview" onChange={onChange} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Members' }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('members');
    // Still controlled by the active prop — selection unchanged until parent re-renders.
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
  });

  it('moves the indicator under the active tab when the active prop changes', () => {
    const { rerender } = render(<SlidingTabs tabs={tabs} active="overview" onChange={() => {}} />);

    const indicator = screen.getByTestId('sliding-tabs-indicator');
    expect(indicator.style.left).toBe('4px'); // first tab
    expect(indicator.style.width).toBe('100px');

    rerender(<SlidingTabs tabs={tabs} active="members" onChange={() => {}} />);

    expect(screen.getByTestId('sliding-tabs-indicator').style.left).toBe('104px'); // second tab
  });

  it('does not fire onChange for a disabled tab', () => {
    const onChange = vi.fn();
    render(<SlidingTabs tabs={tabs} active="overview" onChange={onChange} />);

    const locked = screen.getByRole('tab', { name: 'Locked' });
    expect(locked).toBeDisabled();

    fireEvent.click(locked);

    expect(onChange).not.toHaveBeenCalled();
  });
});
