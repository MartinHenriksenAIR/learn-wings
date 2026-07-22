import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import { LanguageBadge } from './language-badge';

describe('LanguageBadge', () => {
  it('renders the label for "en" via i18n', () => {
    render(<LanguageBadge language="en" />);

    expect(screen.getByText('languages.en')).toBeInTheDocument();
  });

  it('renders the label for "da" via i18n', () => {
    render(<LanguageBadge language="da" />);

    expect(screen.getByText('languages.da')).toBeInTheDocument();
  });

  it('renders a globe icon', () => {
    const { container } = render(<LanguageBadge language="en" />);

    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('renders nothing when language is null', () => {
    const { container } = render(<LanguageBadge language={null} />);

    expect(container.firstChild).toBeNull();
  });
});
