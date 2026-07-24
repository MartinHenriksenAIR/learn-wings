import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// --- mock react-i18next (no i18n provider needed) ---
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}));

// --- mock sonner toast ---
const mockToast = vi.fn();
vi.mock('@/components/ui/sonner', () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}));

// --- mock api-client so no network fires (ApiError mirrors the real class so
// --- `instanceof ApiError` checks in the component resolve) ---
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

// --- useAuth mock factory ---
const mockUseAuth = vi.fn();
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

// --- useOrgDetail mock factory — the component reads server-wide seat
// --- aggregates (member_count / pending_invite_count) from this hook rather
// --- than fetching '/api/organizations' itself (#126) ---
const mockUseOrgDetail = vi.fn();
vi.mock('@/hooks/useOrgDetail', () => ({
  useOrgDetail: (...args: unknown[]) => mockUseOrgDetail(...args),
}));

// --- keep the heavy child dialogs out of this focused test ---
vi.mock('@/components/org-admin/BulkInviteDialog', () => ({
  BulkInviteDialog: () => null,
}));
vi.mock('@/components/org-admin/EnrollUserDialog', () => ({
  EnrollUserDialog: () => null,
}));

// --- render the Radix dropdown menu inline (jsdom can't drive the real one).
// --- createElement (not JSX) because vi.mock factories are hoisted above the jsx-runtime import ---
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

// The component now reads from the shared TanStack Query hooks, so every render
// needs a QueryClient in context. retry:false keeps error paths deterministic.
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
    });
    // No org-detail aggregates yet loaded — seatUsage falls back to the
    // locally-fetched members/invitations lists (unrelated to this test).
    mockUseOrgDetail.mockReturnValue({ data: undefined, isLoading: false, isError: false, error: null });
  });

  it('second click while in-flight does not fire a second API call; guard clears in finally', async () => {
    let createCalls = 0;
    let resolveCreate: ((v: unknown) => void) | undefined;
    // The champion toggle invalidates the ['ai-champions'] cache on success
    // (rather than hand-patching it), so the badge flip is driven by this
    // refetch returning the newly-created champion.
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

    // The mocked t() returns the i18n key verbatim, so the action labels are the
    // keys themselves (analytics.members.makeAiChampion / removeAiChampion).
    const item = await screen.findByRole('button', { name: 'analytics.members.makeAiChampion' });

    fireEvent.click(item);
    // The in-flight guard (setTogglingChampion) fires synchronously in the click
    // handler, so the item disables immediately.
    expect(item).toBeDisabled();
    // useMutation dispatches the mutationFn on a microtask, so the request fires
    // one tick after the click (the old imperative code called it synchronously).
    await waitFor(() => expect(createCalls).toBe(1));

    // Second fast click while the first request is still in flight — the button
    // is disabled, so onClick never fires and no second request is dispatched.
    fireEvent.click(item);
    expect(createCalls).toBe(1);

    // Let the request finish — the server now reports the member as a champion,
    // so the post-success refetch flips the badge and the guard clears.
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

    // Clipboard received the invite link (built from the link_id)
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0][0]).toContain('link-abc');

    // The button morphs to the "Copied!" label — no success toast
    await screen.findByRole('button', { name: 'analytics.members.copied' });
    expect(mockToast).not.toHaveBeenCalled();
  });

  it('revoke shows inline "Revoked" feedback, removes the row, and fires no success toast', async () => {
    renderTab();

    const revokeBtn = await screen.findByRole('button', { name: 'analytics.members.revoke' });
    fireEvent.click(revokeBtn);

    // The update mutation fired with the expired status
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

    // The invitation row is removed (heading + row gone) and no success toast fired
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
    });
    mockCallApi.mockImplementation(async (path: string) => {
      if (path === '/api/org-memberships') return { memberships: [membershipRow] };
      // This admin has created NO invitations of their own — the caller-scoped
      // list is empty, which is exactly the undercounting bug being fixed.
      if (path === '/api/invitations') return { invitations: [] };
      if (path === '/api/ai-champions') return { champions: [] };
      throw new Error(`Unexpected callApi path: ${path}`);
    });
  });

  it('disables invite and shows the limit-reached note from orgDetail.pending_invite_count, even though this admin\'s own invitation list is empty', async () => {
    // A co-admin (invisible to this caller's /api/invitations scope) has 1
    // pending invite outstanding. The server-wide aggregate reports it; the
    // caller-scoped `invitations` list (mocked empty above) does not.
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

    // 1 active member + 1 org-wide pending invite === seat_limit (2): at cap.
    // If the component still summed the caller-scoped `invitations` array
    // (length 0) this would read 1/2 used and NOT be at the limit.
    await screen.findByText('seats.limitReached');
    expect(screen.getByRole('button', { name: 'Create Invitation' })).toBeDisabled();
  });

  it('does not show limit-reached while orgDetail is still loading (falls back to local counts)', async () => {
    mockUseOrgDetail.mockReturnValue({ data: undefined, isLoading: true, isError: false, error: null });

    renderTab();

    const inviteTrigger = await screen.findByRole('button', { name: 'analytics.members.inviteMember' });
    fireEvent.click(inviteTrigger);

    // Fallback: 1 active member + 0 caller-scoped invitations, no seat_limit
    // known yet (currentOrg has none in this test) — unlimited, so no cap note.
    await screen.findByRole('button', { name: 'Create Invitation' });
    expect(screen.queryByText('seats.limitReached')).toBeNull();
    expect(screen.getByRole('button', { name: 'Create Invitation' })).not.toBeDisabled();
  });
});
