import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import React from 'react';

// --- mock react-i18next (no i18n provider needed) ---
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

// --- mock sonner toast ---
const mockToast = vi.fn();
vi.mock('@/components/ui/sonner', () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}));

// --- mock api-client so no network fires ---
vi.mock('@/lib/api-client', () => ({
  callApi: vi.fn(),
}));

// --- useAuth mock factory ---
const mockUseAuth = vi.fn();
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
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
  });

  it('second click while in-flight does not fire a second API call; guard clears in finally', async () => {
    let createCalls = 0;
    let resolveCreate: ((v: unknown) => void) | undefined;

    mockCallApi.mockImplementation(async (path: string) => {
      if (path === '/api/org-memberships') return { memberships: [membershipRow] };
      if (path === '/api/invitations') return { invitations: [] };
      if (path === '/api/ai-champions') return { champions: [] };
      if (path === '/api/ai-champion-create') {
        createCalls++;
        return new Promise((res) => {
          resolveCreate = res;
        });
      }
      throw new Error(`Unexpected callApi path: ${path}`);
    });

    render(<OrgMembersTab />);

    const item = await screen.findByRole('button', { name: /Make AI Champion/i });

    fireEvent.click(item);
    expect(createCalls).toBe(1);
    expect(item).toBeDisabled();

    // Second fast click while the first request is still in flight
    fireEvent.click(item);
    expect(createCalls).toBe(1);

    // Let the request finish — the guard clears in finally and the badge state flips
    await act(async () => {
      resolveCreate?.({});
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Remove AI Champion/i })).not.toBeDisabled()
    );
    expect(createCalls).toBe(1);
  });
});
