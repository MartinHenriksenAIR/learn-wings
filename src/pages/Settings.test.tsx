import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// --- mock AppLayout as a simple passthrough ---
vi.mock('@/components/layout/AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// --- mock api-client so no network fires ---
const mockCallApi = vi.fn();
vi.mock('@/lib/api-client', () => ({
  callApi: (...args: unknown[]) => mockCallApi(...args),
}));

// --- mock sonner toast (assertable spy) ---
const mockToast = vi.fn();
vi.mock('@/components/ui/sonner', () => ({ toast: (...args: unknown[]) => mockToast(...args) }));

// --- mock react-i18next (t returns the key) ---
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

// --- useAuth mock factory ---
const mockUseAuth = vi.fn();
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => mockUseAuth() }));
// Avatar signing hits a query hook; stub it so this focused save-feedback test
// needs no QueryClientProvider (avatar display is exercised elsewhere).
vi.mock('@/hooks/useSignedBrandingUrl', () => ({ useSignedBrandingUrl: () => ({ data: undefined }) }));

import Settings from './Settings';

describe('Settings — profile save feedback (#20)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({
      user: { id: 'u-1', tid: 'tid-1', email: 'test@example.com', name: 'Test User' },
      profile: {
        id: 'p-1', first_name: 'Test', last_name: 'User', department: '',
        preferred_language: 'en', created_at: '2026-01-01T00:00:00Z', is_platform_admin: false,
      },
      memberships: [],
      isPlatformAdmin: false,
      refreshUserContext: vi.fn().mockResolvedValue(undefined),
    });
  });

  // #20: a successful profile save now confirms via the SaveButton morph
  // (in-button "Saved" + success styling), replacing the old success toast
  // (toast policy). Pins the morph AND the mutation firing — equal strength.
  it('morphs the save button into the Saved state after a successful profile save', async () => {
    mockCallApi.mockResolvedValue({ profile: {} });

    render(<Settings />);
    fireEvent.click(screen.getByRole('button', { name: /settings.saveChanges/i }));

    await waitFor(() => {
      expect(mockCallApi).toHaveBeenCalledWith('/api/profile-update', {
        first_name: 'Test', last_name: 'User', department: '',
      });
    });

    // Button morphs to the "Saved" label with success styling.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'common.saved' })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'common.saved' }).className).toMatch(/bg-success/);

    // No success toast is fired for the routine save.
    expect(mockToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'success' })
    );
  });

  it('shows a destructive toast when the save fails', async () => {
    mockCallApi.mockRejectedValue(new Error('save failed'));

    render(<Settings />);
    fireEvent.click(screen.getByRole('button', { name: /settings.saveChanges/i }));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
        title: 'settings.profileUpdateFailed',
        variant: 'destructive',
      }));
    });
    expect(mockToast).not.toHaveBeenCalledWith(expect.objectContaining({ variant: 'success' }));
  });
});
