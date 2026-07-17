import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// --- mock react-i18next (no i18n provider needed) ---
// `t` echoes the key (so assertions pin i18n keys); `Trans` renders its key
// text — enough for the controlled-dialog test, which never inspects the
// interpolated member name inside descriptions.
vi.mock('react-i18next', async () => {
  const ReactActual = await import('react');
  return {
    useTranslation: () => ({ t: (k: string) => k }),
    Trans: ({ i18nKey }: { i18nKey: string }) =>
      ReactActual.createElement(ReactActual.Fragment, null, i18nKey),
  };
});

// --- mock AppLayout as a simple passthrough ---
vi.mock('@/components/layout/AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children),
}));

// --- mock sonner toast ---
const mockToast = vi.fn();
vi.mock('@/components/ui/sonner', () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}));

// --- mock api-client so no network fires ---
vi.mock('@/lib/api-client', () => {
  class MockApiError extends Error {
    status: number;
    code?: string;
    constructor(message: string, status: number, code?: string) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.code = code;
    }
  }
  return { callApi: vi.fn(), ApiError: MockApiError };
});

// --- keep storage-backed children out of this focused test ---
vi.mock('@/components/ui/file-upload', () => ({
  FileUpload: () => null,
}));
vi.mock('@/lib/sendInvitationEmail', () => ({
  sendInvitationEmail: vi.fn(async () => ({ success: true })),
}));

// --- render the Radix dropdown menu inline (jsdom can't drive the real one) ---
vi.mock('@/components/ui/dropdown-menu', async () => {
  const ReactActual = await import('react');
  const h = ReactActual.createElement;
  return {
    DropdownMenu: ({ children }: { children?: React.ReactNode }) => h('div', null, children),
    DropdownMenuTrigger: ({ children }: { children?: React.ReactNode }) => h('div', null, children),
    DropdownMenuContent: ({ children }: { children?: React.ReactNode }) => h('div', null, children),
    DropdownMenuItem: ({
      children,
      onClick,
      disabled,
    }: {
      children?: React.ReactNode;
      onClick?: () => void;
      disabled?: boolean;
      className?: string;
    }) => h('button', { type: 'button', onClick, disabled }, children),
    DropdownMenuSeparator: () => h('hr'),
  };
});

import { callApi } from '@/lib/api-client';
import OrganizationDetail from './OrganizationDetail';

const mockCallApi = vi.mocked(callApi);

const organization = {
  id: 'org-1',
  name: 'Acme Corp',
  slug: 'acme-corp',
  logo_url: null,
  seat_limit: null,
};

const membershipRow = {
  id: 'm-1',
  org_id: 'org-1',
  user_id: 'u-1',
  role: 'learner',
  status: 'active',
  created_at: '2026-01-01T00:00:00Z',
  full_name: 'Bob Member',
  email: 'bob@example.com',
  avatar_url: null,
  department: null,
};

function renderPage() {
  // `retry: false` so hook queries surface load errors immediately (matching
  // the old imperative fetch, which never retried).
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/app/admin/organizations/org-1']}>
        <Routes>
          <Route path="/app/admin/organizations/:orgId" element={<OrganizationDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('OrganizationDetail — AlertDialog controlled from first render (#81)', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Radix's useControllableState emits the uncontrolled-to-controlled message
    // via console.warn; React's own variant uses console.error. Watch both.
    consoleErrorSpy = vi.spyOn(console, 'error');
    consoleWarnSpy = vi.spyOn(console, 'warn');
    mockCallApi.mockImplementation(async (path: string) => {
      if (path === '/api/organizations') return { organization };
      if (path === '/api/org-memberships') return { memberships: [membershipRow] };
      if (path === '/api/invitations') return { invitations: [] };
      if (path === '/api/profiles') return { profiles: [] };
      throw new Error(`Unexpected callApi path: ${path}`);
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  it('opening the promote-to-admin confirm emits no uncontrolled-to-controlled warning', async () => {
    renderPage();

    // Page loads with the member row (inline-mocked dropdown renders items directly)
    const promoteItem = await screen.findByRole('button', { name: 'orgDetail.promoteToAdmin' });
    fireEvent.click(promoteItem);

    // The confirm dialog opened (titles/labels are i18n keys under the test's `t` echo)
    expect(await screen.findByText('orgDetail.promoteTitle')).toBeInTheDocument();

    // No controlled/uncontrolled warning fired
    const controlledWarnings = [...consoleErrorSpy.mock.calls, ...consoleWarnSpy.mock.calls].filter(
      (call) =>
        call.some(
          (arg) =>
            typeof arg === 'string' && /changing from uncontrolled to controlled/i.test(arg)
        )
    );
    expect(controlledWarnings).toEqual([]);

    // Dialog still dismisses correctly
    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }));
    expect(screen.queryByText('orgDetail.promoteTitle')).toBeNull();
  });
});

describe('OrganizationDetail — load-failure retry (#53)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a Try again button on load failure and refetches when clicked', async () => {
    // First load: the organization fetch throws a non-404 (load_failed); the
    // other fetches resolve empty. The retry must re-run the load.
    let orgCallCount = 0;
    const { ApiError } = (await import('@/lib/api-client')) as unknown as {
      ApiError: new (m: string, s: number, c?: string) => Error;
    };
    mockCallApi.mockImplementation(async (path: string) => {
      if (path === '/api/organizations') {
        orgCallCount += 1;
        if (orgCallCount === 1) throw new ApiError('boom', 500);
        return { organization };
      }
      if (path === '/api/org-memberships') return { memberships: [] };
      if (path === '/api/invitations') return { invitations: [] };
      if (path === '/api/profiles') return { profiles: [] };
      throw new Error(`Unexpected callApi path: ${path}`);
    });

    renderPage();

    // The load-failed state surfaces a retry button (toast policy: load errors keep toast).
    const retry = await screen.findByRole('button', { name: /orgDetail\.tryAgain/i });
    expect(retry).toBeInTheDocument();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'destructive' }),
    );

    fireEvent.click(retry);

    // After the retry succeeds, the org header renders.
    expect(await screen.findByRole('heading', { name: 'Acme Corp' })).toBeInTheDocument();
  });

  it('shows an honest not-found (no retry) on a real 404', async () => {
    const { ApiError } = (await import('@/lib/api-client')) as unknown as {
      ApiError: new (m: string, s: number, c?: string) => Error;
    };
    mockCallApi.mockImplementation(async (path: string) => {
      if (path === '/api/organizations') throw new ApiError('missing', 404);
      if (path === '/api/org-memberships') return { memberships: [] };
      if (path === '/api/invitations') return { invitations: [] };
      if (path === '/api/profiles') return { profiles: [] };
      throw new Error(`Unexpected callApi path: ${path}`);
    });

    renderPage();

    // Not-found description shows; no Try again button (404 is honest, not retryable).
    expect(await screen.findByText('orgDetail.notFoundDescription')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /orgDetail\.tryAgain/i })).toBeNull();
  });
});
