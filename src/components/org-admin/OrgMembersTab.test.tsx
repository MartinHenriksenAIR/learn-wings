import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: 'en', resolvedLanguage: 'en' },
  }),
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

const mockUseAuth = vi.fn();
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockUseOrgDetail = vi.fn();
vi.mock('@/hooks/useOrgDetail', () => ({
  useOrgDetail: (...args: unknown[]) => mockUseOrgDetail(...args),
}));

vi.mock('@/components/org-admin/BulkInviteDialog', () => ({
  BulkInviteDialog: () => null,
}));
vi.mock('@/components/org-admin/EnrollUserDialog', () => ({
  EnrollUserDialog: () => null,
}));
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
vi.mock('@/components/assignments/AssignmentsManager', async () => {
  const ReactActual = await import('react');
  return {
    AssignmentsManager: ({ orgId }: { orgId: string }) =>
      ReactActual.createElement('div', { 'data-testid': 'assignments-manager', 'data-org': orgId }),
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
import { OrgMembersTab } from './OrgMembersTab';

const mockCallApi = vi.mocked(callApi);

function renderTab() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <OrgMembersTab />
    </QueryClientProvider>,
  );
}

const membershipRow = {
  id: 'm-2',
  org_id: 'org-1',
  user_id: 'u-2',
  role: 'learner',
  status: 'active',
  created_at: '2026-01-01T00:00:00Z',
  full_name: 'Bob Member',
  email: 'bob@example.com',
  avatar_url: null,
  department: null,
};

describe('OrgMembersTab — AI champion toggle in-flight guard (#74)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({
      user: { id: 'oid-1' },
      profile: { id: 'admin-1', full_name: 'Org Admin', is_platform_admin: false },
      currentOrg: { id: 'org-1', name: 'Acme' },
      effectiveIsOrgAdmin: true,
      effectiveIsPlatformAdmin: false,
    });
    mockUseOrgDetail.mockReturnValue({ data: undefined, isLoading: false, isError: false, error: null });
  });

  it('second click while in-flight does not fire a second API call; guard clears in finally', async () => {
    let createCalls = 0;
    let resolveCreate: ((v: unknown) => void) | undefined;
    let champions: Array<{ user_id: string }> = [];

    mockCallApi.mockImplementation(async (path: string) => {
      if (path === '/api/org-memberships') return { memberships: [membershipRow] };
      if (path === '/api/invitations') return { invitations: [] };
      if (path === '/api/ai-champions') return { champions };
      if (path === '/api/ai-champion-create') {
        createCalls++;
        return new Promise((res) => {
          resolveCreate = res;
        });
      }
      throw new Error(`Unexpected callApi path: ${path}`);
    });

    renderTab();

    const item = await screen.findByRole('button', { name: 'analytics.members.makeAiChampion' });

    fireEvent.click(item);
    expect(item).toBeDisabled();
    await waitFor(() => expect(createCalls).toBe(1));

    fireEvent.click(item);
    expect(createCalls).toBe(1);

    champions = [{ user_id: 'u-2' }];
    await act(async () => {
      resolveCreate?.({});
    });
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'analytics.members.removeAiChampion' }),
      ).not.toBeDisabled()
    );
    expect(createCalls).toBe(1);
  });
});

const invitationRow = {
  id: 'inv-1',
  org_id: 'org-1',
  email: 'pending@example.com',
  role: 'learner',
  link_id: 'link-abc',
  status: 'pending',
  invited_by_user_id: 'admin-1',
  created_at: '2026-02-01T00:00:00Z',
  expires_at: '2026-03-01T00:00:00Z',
  is_platform_admin_invite: false,
};

describe('OrgMembersTab — pending invitation copy/revoke feedback (no toast)', () => {
  const writeText = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({
      user: { id: 'oid-1' },
      profile: { id: 'admin-1', full_name: 'Org Admin', is_platform_admin: false },
      currentOrg: { id: 'org-1', name: 'Acme' },
      effectiveIsOrgAdmin: true,
      effectiveIsPlatformAdmin: false,
    });
    mockUseOrgDetail.mockReturnValue({ data: undefined, isLoading: false, isError: false, error: null });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    mockCallApi.mockImplementation(async (path: string) => {
      if (path === '/api/org-memberships') return { memberships: [] };
      if (path === '/api/invitations') return { invitations: [invitationRow] };
      if (path === '/api/ai-champions') return { champions: [] };
      if (path === '/api/invitation-update') return {};
      throw new Error(`Unexpected callApi path: ${path}`);
    });
  });

  it('copy link writes to clipboard and morphs to "Copied!" with no toast', async () => {
    renderTab();

    const copyBtn = await screen.findByRole('button', { name: 'analytics.members.copyLink' });
    fireEvent.click(copyBtn);

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0][0]).toContain('link-abc');

    await screen.findByRole('button', { name: 'analytics.members.copied' });
    expect(mockToast).not.toHaveBeenCalled();
  });

  it('revoke shows inline "Revoked" feedback, removes the row, and fires no success toast', async () => {
    renderTab();

    const revokeBtn = await screen.findByRole('button', { name: 'analytics.members.revoke' });
    fireEvent.click(revokeBtn);

    await waitFor(() =>
      expect(
        mockCallApi.mock.calls.some(
          ([p, body]) =>
            p === '/api/invitation-update' &&
            (body as { id: string; status: string }).id === 'inv-1' &&
            (body as { id: string; status: string }).status === 'expired',
        ),
      ).toBe(true),
    );

    await waitFor(() =>
      expect(screen.queryByText('pending@example.com')).toBeNull(),
    );
    expect(mockToast).not.toHaveBeenCalled();
  });
});

describe('OrgMembersTab — seat usage uses the org-wide server aggregate (#126)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({
      user: { id: 'oid-1' },
      profile: { id: 'admin-1', full_name: 'Org Admin', is_platform_admin: false },
      currentOrg: { id: 'org-1', name: 'Acme' },
      effectiveIsOrgAdmin: true,
      effectiveIsPlatformAdmin: false,
    });
    mockCallApi.mockImplementation(async (path: string) => {
      if (path === '/api/org-memberships') return { memberships: [membershipRow] };
      if (path === '/api/invitations') return { invitations: [] };
      if (path === '/api/ai-champions') return { champions: [] };
      throw new Error(`Unexpected callApi path: ${path}`);
    });
  });

  it('disables invite and shows the limit-reached note from orgDetail.pending_invite_count, even though this admin\'s own invitation list is empty', async () => {
    mockUseOrgDetail.mockReturnValue({
      data: {
        id: 'org-1',
        name: 'Acme',
        seat_limit: 2,
        member_count: 1,
        pending_invite_count: 1,
      },
      isLoading: false,
      isError: false,
      error: null,
    });

    renderTab();

    const inviteTrigger = await screen.findByRole('button', { name: 'analytics.members.inviteMember' });
    fireEvent.click(inviteTrigger);

    await screen.findByText('seats.limitReached');
    expect(screen.getByRole('button', { name: 'Create Invitation' })).toBeDisabled();
  });

  it('does not show limit-reached while orgDetail is still loading (falls back to local counts)', async () => {
    mockUseOrgDetail.mockReturnValue({ data: undefined, isLoading: true, isError: false, error: null });

    renderTab();

    const inviteTrigger = await screen.findByRole('button', { name: 'analytics.members.inviteMember' });
    fireEvent.click(inviteTrigger);

    await screen.findByRole('button', { name: 'Create Invitation' });
    expect(screen.queryByText('seats.limitReached')).toBeNull();
    expect(screen.getByRole('button', { name: 'Create Invitation' })).not.toBeDisabled();
  });
});

describe('OrgMembersTab — assign course wiring (#365)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({
      user: { id: 'oid-1' },
      profile: { id: 'admin-1', full_name: 'Org Admin', is_platform_admin: false },
      currentOrg: { id: 'org-1', name: 'Acme' },
      effectiveIsOrgAdmin: true,
      effectiveIsPlatformAdmin: false,
    });
    mockUseOrgDetail.mockReturnValue({ data: undefined, isLoading: false, isError: false, error: null });
    mockCallApi.mockImplementation(async (path: string) => {
      if (path === '/api/org-memberships') return { memberships: [membershipRow] };
      if (path === '/api/invitations') return { invitations: [] };
      if (path === '/api/ai-champions') return { champions: [] };
      throw new Error(`Unexpected callApi path: ${path}`);
    });
  });

  it('mounts the AssignmentsManager for the current org', async () => {
    renderTab();
    const mgr = await screen.findByTestId('assignments-manager');
    expect(mgr).toHaveAttribute('data-org', 'org-1');
  });

  it('header "Assign course" opens the dialog with no preset (whole-org allowed)', async () => {
    renderTab();
    await screen.findByText('Bob Member');
    const buttons = screen.getAllByRole('button', { name: 'assignments.assignCourse' });
    fireEvent.click(buttons[0]); // header button
    const dialog = screen.getByTestId('assign-dialog');
    expect(dialog).toHaveAttribute('data-open', 'true');
    expect(dialog).toHaveAttribute('data-preset', '');
  });

  it('per-member "Assign course" opens the dialog preset to that member', async () => {
    renderTab();
    await screen.findByText('Bob Member');
    const buttons = screen.getAllByRole('button', { name: 'assignments.assignCourse' });
    fireEvent.click(buttons[buttons.length - 1]); // row dropdown item
    const dialog = screen.getByTestId('assign-dialog');
    expect(dialog).toHaveAttribute('data-open', 'true');
    expect(dialog).toHaveAttribute('data-preset', 'u-2');
  });
});

describe('OrgMembersTab — invite gated to the org-admin flow (#352)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseOrgDetail.mockReturnValue({ data: undefined, isLoading: false, isError: false, error: null });
    mockCallApi.mockImplementation(async (path: string) => {
      if (path === '/api/org-memberships') return { memberships: [membershipRow] };
      if (path === '/api/invitations') return { invitations: [invitationRow] };
      if (path === '/api/ai-champions') return { champions: [] };
      throw new Error(`Unexpected callApi path: ${path}`);
    });
  });

  it('hides every invite affordance for a platform admin in Platform view', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'oid-1' },
      profile: { id: 'admin-1', full_name: 'Platform Admin', is_platform_admin: true },
      currentOrg: { id: 'org-1', name: 'Acme' },
      effectiveIsOrgAdmin: true,
      effectiveIsPlatformAdmin: true,
    });

    renderTab();
    await screen.findByText('Bob Member');

    expect(screen.queryByRole('button', { name: 'analytics.members.inviteMember' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'analytics.members.bulkInvite' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'analytics.members.copyLink' })).toBeNull();
    expect(screen.getByRole('button', { name: 'analytics.members.enrollInCourse' })).toBeInTheDocument();
  });

  it('shows invite once that platform admin switches to Org-admin view', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'oid-1' },
      profile: { id: 'admin-1', full_name: 'Platform Admin', is_platform_admin: true },
      currentOrg: { id: 'org-1', name: 'Acme' },
      effectiveIsOrgAdmin: true,
      effectiveIsPlatformAdmin: false,
    });

    renderTab();

    expect(
      await screen.findByRole('button', { name: 'analytics.members.inviteMember' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'analytics.members.bulkInvite' })).toBeInTheDocument();
  });
});
