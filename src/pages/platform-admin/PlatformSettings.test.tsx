import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

vi.mock('@/components/layout/AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/lib/api-client', () => ({
  callApi: vi.fn(),
}));

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
  // `retry: false` so hook queries surface load errors immediately (matching
  // the old imperative fetch, which never retried).
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PlatformSettings />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('PlatformSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('round-trip: re-mount shows server value, not a locally-edited value or blank (#40 acceptance)', async () => {
    mockCallApi.mockResolvedValue(successResponse);

    // First mount
    const { unmount } = renderPage();

    // Wait for the form to appear (branding tab is default). Labels are i18n
    // keys here (the mocked t returns the key).
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'platformSettings.branding.platformName' })).toBeInTheDocument();
    });

    const input = screen.getByRole('textbox', { name: 'platformSettings.branding.platformName' });
    fireEvent.change(input, { target: { value: 'Edited Name' } });
    expect(input).toHaveValue('Edited Name');

    unmount();

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'platformSettings.branding.platformName' })).toBeInTheDocument();
    });

    const freshInput = screen.getByRole('textbox', { name: 'platformSettings.branding.platformName' });
    expect(freshInput).toHaveValue('Server Name');
    expect(freshInput).not.toHaveValue('Edited Name');
    expect(freshInput).not.toHaveValue('');
  });

  it('failed read: shows error EmptyState, no textboxes, no save buttons, no write call', async () => {
    mockCallApi.mockRejectedValue(new Error('Network error'));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('platformSettings.loadFailedTitle')).toBeInTheDocument();
    });

    expect(screen.getByText('platformSettings.loadFailedTitle')).toBeInTheDocument();
    expect(screen.getByText('platformSettings.loadFailedDescription')).toBeInTheDocument();
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);

    // Save labels are i18n keys (platformSettings.*.save); only the retry button should exist.
    const buttons = screen.getAllByRole('button');
    for (const btn of buttons) {
      expect(btn).not.toHaveAccessibleName(/\.save$/i);
    }

    const updateCalls = mockCallApi.mock.calls.filter(
      (args: unknown[]) => args[0] === '/api/platform-settings-update'
    );
    expect(updateCalls).toHaveLength(0);
  });

  it('retry path: clicking retry after failure fetches again and renders form', async () => {
    mockCallApi
      .mockRejectedValueOnce(new Error('Transient error'))
      .mockResolvedValueOnce(successResponse);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('platformSettings.loadFailedTitle')).toBeInTheDocument();
    });

    const retryBtn = screen.getByRole('button', { name: 'platformSettings.retry' });
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'platformSettings.branding.platformName' })).toBeInTheDocument();
    });

    expect(screen.getByRole('textbox', { name: 'platformSettings.branding.platformName' })).toHaveValue('Server Name');
  });

  it('failed retry: clicking retry after two failures keeps error EmptyState and gate closed', async () => {
    mockCallApi
      .mockRejectedValueOnce(new Error('Network error'))
      .mockRejectedValueOnce(new Error('Network error'));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('platformSettings.loadFailedTitle')).toBeInTheDocument();
    });

    const retryBtn = screen.getByRole('button', { name: 'platformSettings.retry' });
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.getByText('platformSettings.loadFailedTitle')).toBeInTheDocument();
    });

    expect(screen.queryAllByRole('textbox')).toHaveLength(0);

    const updateCalls = mockCallApi.mock.calls.filter(
      (args: unknown[]) => args[0] === '/api/platform-settings-update'
    );
    expect(updateCalls).toHaveLength(0);
  });

  it('save guarded: after successful load, Save Branding calls platform-settings-update with branding key', async () => {
    mockCallApi.mockResolvedValue(successResponse);

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'platformSettings.branding.save' })).toBeInTheDocument();
    });

    mockCallApi.mockClear();
    mockCallApi.mockResolvedValue({});

    fireEvent.click(screen.getByRole('button', { name: 'platformSettings.branding.save' }));

    // Sends only the branding panel's fields under `value` (#90 merge: the
    // server never receives other keys, so it can't clobber them).
    await waitFor(() => {
      expect(mockCallApi).toHaveBeenCalledWith(
        '/api/platform-settings-update',
        expect.objectContaining({ key: 'branding' })
      );
    });
  });

  it('per-panel morph: successful branding save morphs the button into the Saved state', async () => {
    mockCallApi.mockResolvedValue(successResponse);

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'platformSettings.branding.save' })).toBeInTheDocument();
    });

    mockCallApi.mockClear();
    mockCallApi.mockResolvedValue({});

    fireEvent.click(screen.getByRole('button', { name: 'platformSettings.branding.save' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'common.saved' })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'common.saved' }).className).toMatch(/bg-success/);
    expect(screen.queryByRole('button', { name: 'platformSettings.branding.save' })).not.toBeInTheDocument();
  });
});
