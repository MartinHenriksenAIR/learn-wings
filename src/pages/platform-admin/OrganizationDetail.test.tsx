import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';

// --- mock react-i18next (no i18n provider needed) ---
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

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
  return render(
    <MemoryRouter initialEntries={['/app/admin/organizations/org-1']}>
      <Routes>
        <Route path="/app/admin/organizations/:orgId" element={<OrganizationDetail />} />
      </Routes>
    </MemoryRouter>
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
    const promoteItem = await screen.findByRole('button', { name: /Promote to Admin/i });
    fireEvent.click(promoteItem);

    // The confirm dialog opened
    expect(await screen.findByText('Promote to Organization Admin?')).toBeInTheDocument();

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
    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));
    expect(screen.queryByText('Promote to Organization Admin?')).toBeNull();
  });
});
