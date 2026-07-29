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

// Fixture — the User & Access panel is the default tab. require_email_verification
// defaults to false, so a server value of `true` is distinguishable from the
// seed-default the component starts with.
const serverUserAccessRow = {
  key: 'user_access',
  value: {
    default_role: 'learner',
    require_email_verification: true,
    allow_self_registration: true,
  },
};

const successResponse = {
  settings: [serverUserAccessRow],
};

const verificationSwitch = () =>
  screen.getByRole('switch', { name: 'platformSettings.userAccess.requireEmailVerification' });

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

  it('round-trip: re-mount shows server value, not a locally-edited value (#40 acceptance)', async () => {
    mockCallApi.mockResolvedValue(successResponse);

    // First mount
    const { unmount } = renderPage();

    // Wait for the server value, not merely for the control to exist (#305). The
    // component seeds local state with defaults (require_email_verification:
    // false) and copies query.data in via an effect, so there is a render in
    // which the switch exists and is still unchecked. Awaiting existence can
    // resolve inside that window; awaiting the checked state cannot.
    await waitFor(() => {
      expect(verificationSwitch()).toBeChecked();
    });

    fireEvent.click(verificationSwitch());
    expect(verificationSwitch()).not.toBeChecked();

    unmount();

    renderPage();

    await waitFor(() => {
      expect(verificationSwitch()).toBeChecked();
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

    // Await the value, not the element (#305) — see the round-trip test above.
    await waitFor(() => {
      expect(verificationSwitch()).toBeChecked();
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

    // Sends only the panel's fields under `value` (#90 merge: the server never
    // receives other keys, so it can't clobber them).
    await waitFor(() => {
      expect(mockCallApi).toHaveBeenCalledWith(
        '/api/platform-settings-update',
        expect.objectContaining({ key: 'user_access' })
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

  it('the fixed default-role caption is a heading, not a form label (#327)', async () => {
    mockCallApi.mockResolvedValueOnce(successResponse);

    renderPage();

    // The caption renders (the default role is fixed to Learner)...
    expect(await screen.findByText('platformSettings.userAccess.defaultRole')).toBeInTheDocument();
    // ...but it labels no control, so it must not masquerade as a form label.
    expect(screen.queryByLabelText('platformSettings.userAccess.defaultRole')).toBeNull();
  });
});
