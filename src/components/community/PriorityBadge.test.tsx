import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PriorityBadge } from './PriorityBadge';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

describe('PriorityBadge', () => {
  it('renders the band label for a scored idea', () => {
    render(<PriorityBadge value={3} effort={1} />);
    expect(screen.getByText('ideaManagement.bands.quick_win')).toBeInTheDocument();
  });
  it('renders nothing when unscored', () => {
    const { container } = render(<PriorityBadge value={null} effort={2} />);
    expect(container).toBeEmptyDOMElement();
  });
});
