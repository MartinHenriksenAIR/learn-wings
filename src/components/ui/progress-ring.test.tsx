import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

import { ProgressRing } from './progress-ring';

describe('ProgressRing', () => {
  it('renders track and progress circles with the given colors and dash geometry', () => {
    const { container } = render(<ProgressRing pct={50} size={120} stroke={9} fg="#ffffff" bg="#e9eaf0" />);

    const circles = container.querySelectorAll('circle');
    expect(circles).toHaveLength(2);
    expect(circles[0].getAttribute('stroke')).toBe('#e9eaf0');
    expect(circles[1].getAttribute('stroke')).toBe('#ffffff');

    const radius = (120 - 9) / 2;
    const circumference = 2 * Math.PI * radius;
    expect(Number(circles[1].getAttribute('stroke-dasharray'))).toBeCloseTo(circumference, 5);
    expect(Number(circles[1].getAttribute('stroke-dashoffset'))).toBeCloseTo(circumference * 0.5, 5);
    expect(circles[1].getAttribute('stroke-linecap')).toBe('round');
  });

  it('shows a rounded centered percentage label when labelColor is given', () => {
    render(<ProgressRing pct={66.6} size={120} stroke={9} fg="#10298f" bg="#e9eaf0" labelColor="#171a26" />);

    const label = screen.getByText('67%');
    expect(label.getAttribute('fill')).toBe('#171a26');
  });

  it('renders no label when labelColor is omitted', () => {
    const { container } = render(<ProgressRing pct={40} size={24} stroke={3} fg="#10298f" bg="#e9eaf0" />);

    expect(container.querySelector('text')).toBeNull();
  });
});
