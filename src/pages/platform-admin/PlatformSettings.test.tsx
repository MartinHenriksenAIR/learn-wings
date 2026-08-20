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

const serverUserAccessRow = {
  key: 'user_access',
  value: {
    allow_self_registration: true,
  },
};

const successResponse = {
  settings: [serverUserAccessRow],
};

const selfRegistrationSwitch = () =>
  screen.getByRole('switch', { name: 'platformSettings.userAccess.allowSelfRegistration' });

function renderPage() {
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

  it('round-trip: re-mount shows server value, not a locally-edited value (#40 acceptance)', async () => {
    mockCallApi.mockResolvedValue(successResponse);

    const { unmount } = renderPage();

    await waitFor(() => {
      expect(selfRegistrationSwitch()).toBeChecked();
    });

    fireEvent.click(selfRegistrationSwitch());
    expect(selfRegistrationSwitch()).not.toBeChecked();

    unmount();

    renderPage();

    await waitFor(() => {
      expect(selfRegistrationSwitch()).toBeChecked();
    });
  });

  it('failed read: shows error EmptyState, no form controls, no save buttons, no write call', async () => {
    mockCallApi.mockRejectedValue(new Error('Network error'));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('platformSettings.loadFailedTitle')).toBeInTheDocument();
    });

    expect(screen.getByText('platformSettings.loadFailedTitle')).toBeInTheDocument();
    expect(screen.getByText('platformSettings.loadFailedDescription')).toBeInTheDocument();
    expect(screen.queryAllByRole('switch')).toHaveLength(0);

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
      expect(selfRegistrationSwitch()).toBeChecked();
    });
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

    expect(screen.queryAllByRole('switch')).toHaveLength(0);

    const updateCalls = mockCallApi.mock.calls.filter(
      (args: unknown[]) => args[0] === '/api/platform-settings-update'
    );
    expect(updateCalls).toHaveLength(0);
  });

  it('save guarded: after successful load, Save calls platform-settings-update with the user_access key', async () => {
    mockCallApi.mockResolvedValue(successResponse);

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'platformSettings.userAccess.save' })).toBeInTheDocument();
    });

    mockCallApi.mockClear();
    mockCallApi.mockResolvedValue({});

    fireEvent.click(screen.getByRole('button', { name: 'platformSettings.userAccess.save' }));

    await waitFor(() => {
      expect(mockCallApi).toHaveBeenCalledWith(
        '/api/platform-settings-update',
        expect.objectContaining({ key: 'user_access' })
      );
    });
  });

  it('walk-in members toggle: default on, distinct from self-registration, persisted on save (#354)', async () => {
    mockCallApi.mockResolvedValue(successResponse);

    renderPage();

    const walkInSwitch = () =>
      screen.getByRole('switch', { name: 'platformSettings.userAccess.allowIndividualRegistration' });
    const selfRegSwitch = () =>
      screen.getByRole('switch', { name: 'platformSettings.userAccess.allowSelfRegistration' });

    await waitFor(() => expect(walkInSwitch()).toBeChecked());
    expect(walkInSwitch()).not.toBe(selfRegSwitch());

    fireEvent.click(walkInSwitch());
    expect(walkInSwitch()).not.toBeChecked();
    expect(selfRegSwitch()).toBeChecked();

    mockCallApi.mockClear();
    mockCallApi.mockResolvedValue({});
    fireEvent.click(screen.getByRole('button', { name: 'platformSettings.userAccess.save' }));

    await waitFor(() => {
      expect(mockCallApi).toHaveBeenCalledWith(
        '/api/platform-settings-update',
        expect.objectContaining({
          key: 'user_access',
          value: expect.objectContaining({ allow_individual_registration: false }),
        })
      );
    });
  });

  it('per-panel morph: a successful save morphs the button into the Saved state', async () => {
    mockCallApi.mockResolvedValue(successResponse);

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'platformSettings.userAccess.save' })).toBeInTheDocument();
    });

    mockCallApi.mockClear();
    mockCallApi.mockResolvedValue({});

    fireEvent.click(screen.getByRole('button', { name: 'platformSettings.userAccess.save' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'common.saved' })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'common.saved' }).className).toMatch(/bg-success/);
    expect(screen.queryByRole('button', { name: 'platformSettings.userAccess.save' })).not.toBeInTheDocument();
  });

  it('the save payload carries no default_role — the setting is gone, the caption stays (#486)', async () => {
    mockCallApi.mockResolvedValue(successResponse);

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'platformSettings.userAccess.save' })).toBeInTheDocument();
    });

    mockCallApi.mockClear();
    mockCallApi.mockResolvedValue({});
    fireEvent.click(screen.getByRole('button', { name: 'platformSettings.userAccess.save' }));

    await waitFor(() => expect(mockCallApi).toHaveBeenCalled());
    const [, payload] = mockCallApi.mock.calls[0] as [string, { value: Record<string, unknown> }];
    expect(Object.keys(payload.value)).not.toContain('default_role');
  });

  it('the fixed default-role caption is a heading, not a form label (#327)', async () => {
    mockCallApi.mockResolvedValueOnce(successResponse);

    renderPage();

    expect(await screen.findByText('platformSettings.userAccess.defaultRole')).toBeInTheDocument();
    expect(screen.queryByLabelText('platformSettings.userAccess.defaultRole')).toBeNull();
  });
});
