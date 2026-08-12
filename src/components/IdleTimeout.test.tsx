import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Drive the hook's output directly so this test covers the wiring (auth gating,
// handler, modal) without re-exercising the timer logic (its own test does that).
const useIdleTimeoutSpy = vi.fn();
vi.mock('@/hooks/useIdleTimeout', () => ({
  useIdleTimeout: (opts: unknown) => useIdleTimeoutSpy(opts),
  ACTIVITY_EVENT: 'app:activity',
}));

const mockUseAuth = vi.fn();
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mockUseAuth() }));

vi.mock('@/lib/session-expired', () => ({ handleIdleTimeout: vi.fn() }));

// Resolve keys against the real en.json (with basic {{var}} interpolation) so
// assertions read the shipped copy — the shared pattern from Login.test.tsx.
vi.mock('react-i18next', async () => {
  const en = (await import('@/i18n/locales/en.json')).default;
  const translate = (key: string, opts?: Record<string, unknown>): string => {
    let node: unknown = en;
    for (const part of key.split('.')) {
      if (typeof node !== 'object' || node === null) return key;
      node = (node as Record<string, unknown>)[part];
    }
    if (typeof node !== 'string') return key;
    return node.replace(/{{(\w+)}}/g, (_, name) => String(opts?.[name] ?? ''));
  };
  return { useTranslation: () => ({ t: translate, i18n: { language: 'en' } }) };
});

import { IdleTimeout } from './IdleTimeout';
import { handleIdleTimeout } from '@/lib/session-expired';

const stayActive = vi.fn();

describe('IdleTimeout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({ user: { id: 'u1' } });
    useIdleTimeoutSpy.mockReturnValue({ warningActive: false, secondsRemaining: 0, stayActive });
  });

  it('arms the timer while signed in and wires the idle-timeout handler', () => {
    render(<IdleTimeout />);
    expect(useIdleTimeoutSpy).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true, onTimeout: handleIdleTimeout }),
    );
  });

  it('disarms the timer when signed out', () => {
    mockUseAuth.mockReturnValue({ user: null });
    render(<IdleTimeout />);
    expect(useIdleTimeoutSpy).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
  });

  it('renders no modal until the warning window', () => {
    render(<IdleTimeout />);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('shows the countdown modal during the warning and lets the user stay signed in', () => {
    useIdleTimeoutSpy.mockReturnValue({ warningActive: true, secondsRemaining: 42, stayActive });
    render(<IdleTimeout />);

    expect(screen.getByText('Still there?')).toBeInTheDocument();
    expect(screen.getByText(/42 seconds/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /stay signed in/i }));
    expect(stayActive).toHaveBeenCalledOnce();
  });
});
