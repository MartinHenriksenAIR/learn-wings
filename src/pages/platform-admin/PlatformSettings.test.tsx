import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

// --- mock react-i18next (no i18n provider needed) ---
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

// --- mock AppLayout as a simple passthrough ---
vi.mock('@/components/layout/AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// --- mock api-client so no network fires ---
vi.mock('@/lib/api-client', () => ({
  callApi: vi.fn(),
}));

// --- mock sonner toast ---
vi.mock('@/components/ui/sonner', () => ({
  toast: vi.fn(),
}));

import { callApi } from '@/lib/api-client';
import PlatformSettings from './PlatformSettings';

const mockCallApi = callApi as ReturnType<typeof vi.fn>;

// Fixture — obviously fake values; SMTP credentials are not realistic secrets
const serverBrandingRow = {
  key: 'branding',
  value: {
    platform_name: 'Server Name',
    primary_color: '#111111',
    accent_color: '#222222',
    sidebar_primary_color: '#333333',
    sidebar_accent_color: '#444444',
    logo_url: null,
    favicon_url: null,
  },
};

const serverEmailRow = {
  key: 'email',
  value: {
    from_name: 'Test Sender',
    from_email: 'sender@example.test',
    smtp_configured: false,
    smtp_host: 'smtp.example.test',
    smtp_port: 587,
    smtp_username: 'fixture-user',
    smtp_password: 'fixture-not-a-secret',
    smtp_encryption: 'starttls' as const,
  },
};

const successResponse = {
  settings: [serverBrandingRow, serverEmailRow],
};

function renderPage() {
  return render(
    <MemoryRouter>
      <PlatformSettings />
    </MemoryRouter>
  );
}

describe('PlatformSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ----------------------------------------------------------------
  // Round-trip: unmount + remount returns server value, not local edit
  // ----------------------------------------------------------------
  it('round-trip: re-mount shows server value, not a locally-edited value or blank (#40 acceptance)', async () => {
    mockCallApi.mockResolvedValue(successResponse);

    // First mount
    const { unmount } = renderPage();

    // Wait for the form to appear (branding tab is default)
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: /Platform Name/i })).toBeInTheDocument();
    });

    // Local edit
    const input = screen.getByRole('textbox', { name: /Platform Name/i });
    fireEvent.change(input, { target: { value: 'Edited Name' } });
    expect(input).toHaveValue('Edited Name');

    // Unmount — simulates view switch away
    unmount();

    // Re-mount fresh instance; fetch mock still returns server values
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: /Platform Name/i })).toBeInTheDocument();
    });

    const freshInput = screen.getByRole('textbox', { name: /Platform Name/i });
    // Must show server value, not 'Edited Name' and not blank
    expect(freshInput).toHaveValue('Server Name');
    expect(freshInput).not.toHaveValue('Edited Name');
    expect(freshInput).not.toHaveValue('');
  });

  // ----------------------------------------------------------------
  // Failed read → no editable form
  // ----------------------------------------------------------------
  it('failed read: shows error EmptyState, no textboxes, no save buttons, no write call', async () => {
    mockCallApi.mockRejectedValue(new Error('Network error'));

    renderPage();

    // Wait for loading to resolve
    await waitFor(() => {
      expect(screen.getByText('platformSettings.loadFailedTitle')).toBeInTheDocument();
    });

    // Error EmptyState keys present
    expect(screen.getByText('platformSettings.loadFailedTitle')).toBeInTheDocument();
    expect(screen.getByText('platformSettings.loadFailedDescription')).toBeInTheDocument();

    // No editable textboxes
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);

    // No save buttons (only the retry button should exist)
    const buttons = screen.getAllByRole('button');
    for (const btn of buttons) {
      expect(btn).not.toHaveAccessibleName(/save/i);
    }

    // callApi was never called with the update endpoint
    const updateCalls = mockCallApi.mock.calls.filter(
      (args: unknown[]) => args[0] === '/api/platform-settings-update'
    );
    expect(updateCalls).toHaveLength(0);
  });

  // ----------------------------------------------------------------
  // Retry path: fetch fails once then succeeds
  // ----------------------------------------------------------------
  it('retry path: clicking retry after failure fetches again and renders form', async () => {
    // First call rejects, second call resolves
    mockCallApi
      .mockRejectedValueOnce(new Error('Transient error'))
      .mockResolvedValueOnce(successResponse);

    renderPage();

    // Wait for error state
    await waitFor(() => {
      expect(screen.getByText('platformSettings.loadFailedTitle')).toBeInTheDocument();
    });

    // Click the retry button
    const retryBtn = screen.getByRole('button', { name: 'platformSettings.retry' });
    fireEvent.click(retryBtn);

    // Wait for form to appear
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: /Platform Name/i })).toBeInTheDocument();
    });

    // Form shows the server value
    expect(screen.getByRole('textbox', { name: /Platform Name/i })).toHaveValue('Server Name');
  });

  // ----------------------------------------------------------------
  // Failed retry: fetch fails twice → error EmptyState persists, no form, no write
  // ----------------------------------------------------------------
  it('failed retry: clicking retry after two failures keeps error EmptyState and gate closed', async () => {
    // Both the initial call and the retry call reject
    mockCallApi
      .mockRejectedValueOnce(new Error('Network error'))
      .mockRejectedValueOnce(new Error('Network error'));

    renderPage();

    // Wait for the error EmptyState after first failure
    await waitFor(() => {
      expect(screen.getByText('platformSettings.loadFailedTitle')).toBeInTheDocument();
    });

    // Click the retry button
    const retryBtn = screen.getByRole('button', { name: 'platformSettings.retry' });
    fireEvent.click(retryBtn);

    // After the retry also fails, error EmptyState should still be shown
    await waitFor(() => {
      expect(screen.getByText('platformSettings.loadFailedTitle')).toBeInTheDocument();
    });

    // Gate is still closed — no editable textboxes
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);

    // The update endpoint was never called
    const updateCalls = mockCallApi.mock.calls.filter(
      (args: unknown[]) => args[0] === '/api/platform-settings-update'
    );
    expect(updateCalls).toHaveLength(0);
  });

  // ----------------------------------------------------------------
  // Save guarded: successful load → Save Branding calls the update endpoint
  // ----------------------------------------------------------------
  it('save guarded: after successful load, Save Branding calls platform-settings-update with branding key', async () => {
    mockCallApi.mockResolvedValue(successResponse);

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Save Branding/i })).toBeInTheDocument();
    });

    // Clear previous calls (the initial fetch)
    mockCallApi.mockClear();
    // Re-set so the save call resolves
    mockCallApi.mockResolvedValue({});

    fireEvent.click(screen.getByRole('button', { name: /Save Branding/i }));

    await waitFor(() => {
      expect(mockCallApi).toHaveBeenCalledWith(
        '/api/platform-settings-update',
        expect.objectContaining({ key: 'branding' })
      );
    });
  });
});
