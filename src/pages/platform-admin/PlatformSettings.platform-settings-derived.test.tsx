import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';


vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  Trans: ({ i18nKey }: { i18nKey: string }) => React.createElement('span', null, i18nKey),
}));

vi.mock('@/components/layout/AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/select', async () => (await import('@/test/select-mock')).selectMock());

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

vi.mock('@/lib/api-client', () => ({
  callApi: vi.fn(),
}));

vi.mock('@/components/ui/sonner', () => ({
  toast: vi.fn(),
}));

import { callApi } from '@/lib/api-client';
import PlatformSettings from './PlatformSettings';

const mockCallApi = callApi as ReturnType<typeof vi.fn>;

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
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PlatformSettings />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

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

    await waitFor(() => {
      expect(screen.getByText('Ada Admin')).toBeInTheDocument();
    });
    expect(screen.getByText('Bo Boss')).toBeInTheDocument();

    expect(screen.getByRole('button', { name: 'Cy Candidate' })).toBeInTheDocument();
    expect(screen.queryByText('Cy Candidate')).toBe(
      screen.getByRole('button', { name: 'Cy Candidate' }),
    );
    expect(screen.queryByRole('button', { name: 'Ada Admin' })).toBeNull();

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

    await waitFor(() => {
      expect(screen.getByText('platformAdmins.loadFailedTitle')).toBeInTheDocument();
    });
    expect(screen.getByText('platformAdmins.loadFailedDescription')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'platformSettings.retry' })).toBeInTheDocument();

    expect(screen.queryByText('platformAdmins.noCandidates')).toBeNull();
    expect(screen.queryByText('platformAdmins.empty')).toBeNull();
  });
});
