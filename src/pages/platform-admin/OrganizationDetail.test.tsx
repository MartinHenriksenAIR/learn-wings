import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('react-i18next', async () => {
  const ReactActual = await import('react');
  return {
    useTranslation: () => ({
      t: (k: string) => k,
      i18n: { language: 'en', resolvedLanguage: 'en' },
    }),
    Trans: ({ i18nKey }: { i18nKey: string }) =>
      ReactActual.createElement(ReactActual.Fragment, null, i18nKey),
  };
});

vi.mock('@/components/layout/AppLayout', () => ({
  AppLayout: ({ title, children }: { title?: string; children: React.ReactNode }) =>
    React.createElement('div', null, title ? React.createElement('h1', null, title) : null, children),
}));

const mockToast = vi.fn();
vi.mock('@/components/ui/sonner', () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}));

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

vi.mock('@/components/ui/file-upload', () => ({
  FileUpload: () => null,
}));

vi.mock('@/components/assignments/AssignmentsManager', async () => {
  const ReactActual = await import('react');
  return {
    AssignmentsManager: ({ orgId }: { orgId: string }) =>
      ReactActual.createElement('div', { 'data-testid': 'assignments-manager', 'data-org': orgId }),
  };
});
vi.mock('@/components/assignments/AssignCourseDialog', async () => {
  const ReactActual = await import('react');
  return {
    AssignCourseDialog: ({ open, presetUserId }: { open: boolean; presetUserId?: string }) =>
      ReactActual.createElement('div', {
        'data-testid': 'assign-dialog',
        'data-open': String(open),
        'data-preset': presetUserId ?? '',
      }),
  };
});

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
  created_at: '2026-01-01T00:00:00Z',
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

const invitationRow = {
  id: 'inv-1',
  org_id: 'org-1',
  email: 'pending@example.com',
  role: 'learner',
  link_id: 'link-abc',
  status: 'pending',
  invited_by_user_id: 'u-1',
  created_at: '2026-02-01T00:00:00Z',
  expires_at: '2026-03-01T00:00:00Z',
  is_platform_admin_invite: false,
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/app/admin/platform/organizations/org-1']}>
        <Routes>
          <Route path="/app/admin/platform/organizations/:orgId" element={<OrganizationDetail />} />
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
    consoleErrorSpy = vi.spyOn(console, 'error');
    consoleWarnSpy = vi.spyOn(console, 'warn');
    mockCallApi.mockImplementation(async (path: string) => {
      if (path === '/api/organizations') return { organization };
      if (path === '/api/org-memberships') return { memberships: [membershipRow] };
      if (path === '/api/invitations') return { invitations: [] };
      throw new Error(`Unexpected callApi path: ${path}`);
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  it('opening the promote-to-admin confirm emits no uncontrolled-to-controlled warning', async () => {
    renderPage();

    const promoteItem = await screen.findByRole('button', { name: 'orgDetail.promoteToAdmin' });
    fireEvent.click(promoteItem);

    expect(await screen.findByText('orgDetail.promoteTitle')).toBeInTheDocument();

    const controlledWarnings = [...consoleErrorSpy.mock.calls, ...consoleWarnSpy.mock.calls].filter(
      (call) =>
        call.some(
          (arg) =>
            typeof arg === 'string' && /changing from uncontrolled to controlled/i.test(arg)
        )
    );
    expect(controlledWarnings).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }));
    expect(screen.queryByText('orgDetail.promoteTitle')).toBeNull();
  });
});

describe('OrganizationDetail — load-failure retry (#53)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a Try again button on load failure and refetches when clicked', async () => {
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
      throw new Error(`Unexpected callApi path: ${path}`);
    });

    renderPage();

    const retry = await screen.findByRole('button', { name: /orgDetail\.tryAgain/i });
    expect(retry).toBeInTheDocument();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'destructive' }),
    );

    fireEvent.click(retry);

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
      throw new Error(`Unexpected callApi path: ${path}`);
    });

    renderPage();

    expect(await screen.findByText('orgDetail.notFoundDescription')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /orgDetail\.tryAgain/i })).toBeNull();
  });
});

describe('OrganizationDetail — heading (#320)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCallApi.mockImplementation(async (path: string) => {
      if (path === '/api/organizations') return { organization };
      if (path === '/api/org-memberships') return { memberships: [membershipRow] };
      if (path === '/api/invitations') return { invitations: [] };
      throw new Error(`Unexpected callApi path: ${path}`);
    });
  });

  it('renders the org name as a heading exactly once on the loaded page', async () => {
    renderPage();

    const headings = await screen.findAllByRole('heading', { name: 'Acme Corp' });
    expect(headings).toHaveLength(1);
    expect(headings[0].tagName).toBe('H1');
  });
});

describe('OrganizationDetail — assign course wiring (#365)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCallApi.mockImplementation(async (path: string) => {
      if (path === '/api/organizations') return { organization };
      if (path === '/api/org-memberships') return { memberships: [membershipRow] };
      if (path === '/api/invitations') return { invitations: [] };
      throw new Error(`Unexpected callApi path: ${path}`);
    });
  });

  it('mounts the AssignmentsManager scoped to the org', async () => {
    renderPage();
    const mgr = await screen.findByTestId('assignments-manager');
    expect(mgr).toHaveAttribute('data-org', 'org-1');
  });

  it('header "Assign course" opens the dialog with no preset (whole-org allowed)', async () => {
    renderPage();
    await screen.findByText('Bob Member');
    const buttons = screen.getAllByRole('button', { name: 'assignments.assignCourse' });
    fireEvent.click(buttons[0]); // section header button
    const dialog = screen.getByTestId('assign-dialog');
    expect(dialog).toHaveAttribute('data-open', 'true');
    expect(dialog).toHaveAttribute('data-preset', '');
  });

  it('per-member "Assign course" opens the dialog preset to that member', async () => {
    renderPage();
    await screen.findByText('Bob Member');
    const buttons = screen.getAllByRole('button', { name: 'assignments.assignCourse' });
    fireEvent.click(buttons[buttons.length - 1]); // row dropdown item
    const dialog = screen.getByTestId('assign-dialog');
    expect(dialog).toHaveAttribute('data-open', 'true');
    expect(dialog).toHaveAttribute('data-preset', 'u-1');
  });
});

describe('OrganizationDetail — no member-adding in Platform view (#352, #434)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCallApi.mockImplementation(async (path: string) => {
      if (path === '/api/organizations') return { organization };
      if (path === '/api/org-memberships') return { memberships: [membershipRow] };
      if (path === '/api/invitations') return { invitations: [invitationRow] };
      throw new Error(`Unexpected callApi path: ${path}`);
    });
  });

  it('renders no member-adding affordance at all — neither invite nor add-existing', async () => {
    renderPage();
    await screen.findByText('Bob Member');

    expect(screen.queryByRole('button', { name: 'orgDetail.inviteUser' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'orgDetail.addMember' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'assignments.assignCourse' }).length).toBeGreaterThan(0);
  });

  it('pending invitations can be viewed and cancelled, but not shared as a link', async () => {
    renderPage();
    await screen.findByText('pending@example.com');

    expect(screen.queryByRole('button', { name: 'orgDetail.copyLink' })).toBeNull();
    expect(screen.getByRole('button', { name: 'orgDetail.cancelInvite' })).toBeInTheDocument();
  });
});
