import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// The "Platform Admins" tab (#198) derives BOTH lists — current admins and
// grant candidates — from the single /api/profiles read; the dedicated
// /api/platform-admins list endpoint was dropped. These tests prove that
// derivation and that a profiles failure renders an error, NOT the misleading
// "all users are already admins" empty-state.

// --- i18n echo: t/Trans return the key (Trans is used by PlatformAdminsSection). ---
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  Trans: ({ i18nKey }: { i18nKey: string }) => React.createElement('span', null, i18nKey),
}));

// --- mock AppLayout as a simple passthrough ---
vi.mock('@/components/layout/AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// --- passthrough Select: each item is a button so candidate names render into
// the DOM (jsdom can't drive the Radix Select portal). ---
vi.mock('@/components/ui/select', async () => (await import('@/test/select-mock')).selectMock());

// --- passthrough AlertDialog (not exercised here, but the section imports it). ---
vi.mock('@/components/ui/alert-dialog', () => {
  const pass = ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children);
  return {
    AlertDialog: pass,
    AlertDialogContent: pass,
    AlertDialogHeader: pass,
    AlertDialogTitle: pass,
    AlertDialogDescription: pass,
    AlertDialogFooter: pass,
    AlertDialogAction: pass,
    AlertDialogCancel: pass,
  };
});

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

// Two admins + one non-admin candidate, all sharing the /api/profiles shape.
const profiles = [
  {
    id: 'p1', full_name: 'Ada Admin', first_name: 'Ada', last_name: 'Admin',
    department: null, email: 'ada@contoso.test', avatar_url: null,
    is_platform_admin: true, created_at: '2026-01-01T00:00:00Z', preferred_language: null,
  },
  {
    id: 'p2', full_name: 'Bo Boss', first_name: 'Bo', last_name: 'Boss',
    department: null, email: 'bo@contoso.test', avatar_url: null,
    is_platform_admin: true, created_at: '2026-01-02T00:00:00Z', preferred_language: null,
  },
  {
    id: 'p3', full_name: 'Cy Candidate', first_name: 'Cy', last_name: 'Candidate',
    department: null, email: 'cy@contoso.test', avatar_url: null,
    is_platform_admin: false, created_at: '2026-01-03T00:00:00Z', preferred_language: null,
  },
];

function renderPage() {
  // retry:false so a profiles failure surfaces immediately as an error.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PlatformSettings />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/** Open the Platform Admins tab; the profiles query only fires once it's active. */
async function openAdminsTab() {
  await waitFor(() => {
    expect(screen.getByRole('tab', { name: 'platformSettings.tabs.platformAdmins' })).toBeInTheDocument();
  });
  fireEvent.click(screen.getByRole('tab', { name: 'platformSettings.tabs.platformAdmins' }));
}

describe('PlatformSettings — platform-settings-derived (#198)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('derives current admins AND grant candidates from the profiles query alone', async () => {
    mockCallApi.mockImplementation((endpoint: string) => {
      if (endpoint === '/api/platform-settings') return Promise.resolve({ settings: [] });
      if (endpoint === '/api/profiles') return Promise.resolve({ profiles });
      return Promise.resolve({});
    });

    renderPage();
    await openAdminsTab();

    // Current admins (is_platform_admin === true) are listed.
    await waitFor(() => {
      expect(screen.getByText('Ada Admin')).toBeInTheDocument();
    });
    expect(screen.getByText('Bo Boss')).toBeInTheDocument();

    // The lone non-admin is offered as a grant candidate (a Select item button).
    expect(screen.getByRole('button', { name: 'Cy Candidate' })).toBeInTheDocument();
    // ...and it is NOT shown in the current-admins list.
    expect(screen.queryByText('Cy Candidate')).toBe(
      screen.getByRole('button', { name: 'Cy Candidate' }),
    );
    // Admins are not offered as grant candidates.
    expect(screen.queryByRole('button', { name: 'Ada Admin' })).toBeNull();

    // Both lists came from ONE profiles read — the dropped /api/platform-admins
    // endpoint is never called.
    const profilesCalls = mockCallApi.mock.calls.filter((a: unknown[]) => a[0] === '/api/profiles');
    expect(profilesCalls).toHaveLength(1);
    const adminsCalls = mockCallApi.mock.calls.filter((a: unknown[]) => a[0] === '/api/platform-admins');
    expect(adminsCalls).toHaveLength(0);
  });

  it('renders an error state — not the "all users already admins" empty-state — when profiles fails', async () => {
    mockCallApi.mockImplementation((endpoint: string) => {
      if (endpoint === '/api/platform-settings') return Promise.resolve({ settings: [] });
      if (endpoint === '/api/profiles') return Promise.reject(new Error('Network error'));
      return Promise.resolve({});
    });

    renderPage();
    await openAdminsTab();

    // The failure surfaces as an explicit error, with a retry.
    await waitFor(() => {
      expect(screen.getByText('platformAdmins.loadFailedTitle')).toBeInTheDocument();
    });
    expect(screen.getByText('platformAdmins.loadFailedDescription')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'platformSettings.retry' })).toBeInTheDocument();

    // The misleading empty-state (rendered when the candidate list is empty) must
    // NOT appear — an error is an error, not "everyone is already an admin".
    expect(screen.queryByText('platformAdmins.noCandidates')).toBeNull();
    expect(screen.queryByText('platformAdmins.empty')).toBeNull();
  });
});
