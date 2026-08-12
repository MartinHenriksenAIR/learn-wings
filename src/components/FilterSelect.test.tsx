import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// jsdom can't drive the real Radix Select portal — swap it for the shared test
// double (renders each item as a clickable button). Same pattern as the other
// Select-consuming suites.
vi.mock('@/components/ui/select', async () => (await import('@/test/select-mock')).selectMock());

import { FilterSelect } from './FilterSelect';

const options = [
  { value: 'all', label: 'All levels' },
  { value: 'basic', label: 'Basic' },
  { value: 'advanced', label: 'Advanced' },
];

describe('FilterSelect', () => {
  it('labels the trigger and renders a control for each option', () => {
    render(<FilterSelect label="Level" value="all" onValueChange={() => {}} options={options} />);

    expect(screen.getByLabelText('Level')).toBeInTheDocument();
    options.forEach((o) => expect(screen.getByRole('button', { name: o.label })).toBeInTheDocument());
  });

  it('calls onValueChange with the picked option value', () => {
    const onValueChange = vi.fn();
    render(<FilterSelect label="Level" value="all" onValueChange={onValueChange} options={options} />);

    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }));

    expect(onValueChange).toHaveBeenCalledWith('advanced');
  });
});
