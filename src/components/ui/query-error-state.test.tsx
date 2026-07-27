import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

import en from '@/i18n/locales/en.json';
import da from '@/i18n/locales/da.json';
import { QueryErrorState } from './query-error-state';

// `t` echoes the key so assertions can pin i18n keys without an i18n provider.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

// The component reads its default copy from these keys — assert en/da parity so
// a missing Danish key for the shared load-error card can't ship silently.
const LOAD_ERROR_KEYS = ['loadErrorTitle', 'loadErrorDescription', 'retry'] as const;

describe('common load-error i18n keys', () => {
  it.each(LOAD_ERROR_KEYS)('defines "common.%s" in both en and da', (key) => {
    expect(typeof en.common[key]).toBe('string');
    expect(en.common[key].length).toBeGreaterThan(0);
    expect(typeof da.common[key]).toBe('string');
    expect(da.common[key].length).toBeGreaterThan(0);
  });
});

describe('QueryErrorState', () => {
  it('renders default copy and calls onRetry when the button is clicked', () => {
    const onRetry = vi.fn();
    render(<QueryErrorState onRetry={onRetry} />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('common.loadErrorTitle')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'common.retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('honors title/description overrides', () => {
    render(<QueryErrorState onRetry={vi.fn()} title="Custom title" description="Custom desc" />);
    expect(screen.getByText('Custom title')).toBeInTheDocument();
    expect(screen.getByText('Custom desc')).toBeInTheDocument();
  });
});
